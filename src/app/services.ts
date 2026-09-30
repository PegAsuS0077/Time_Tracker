import { entriesInMonth, entriesInWeek } from '../domain/aggregate';
import { createBackup, parseBackup, type Preferences } from '../domain/backup';
import { entriesToCsv } from '../domain/csv';
import { endDay, findEntry, markDeleted, restoreDeleted, startDay } from '../domain/entries';
import { planImport, type Conflict, type ImportPlan } from '../domain/merge';
import { berlinDateTime } from '../domain/time';
import { validateEntryInput, type EntryInput, type FieldErrors } from '../domain/validate';
import {
  DEFAULT_SETTINGS,
  err,
  ok,
  type DateStr,
  type Entry,
  type MonthKey,
  type Result,
  type Settings,
  type SyncSettings,
  type WeekKey,
} from '../domain/types';
import type { SettingsStore, StorageProvider, SyncState } from '../storage/StorageProvider';
import { createStore, type Store } from './store';

export interface AppState {
  ready: boolean;
  /** All entries including tombstones. */
  entries: Entry[];
  settings: Settings;
  sync: SyncState;
  conflicts: Conflict[];
  /** Set when local storage failed; the app keeps working in memory. */
  storageError: string | null;
}

export type FormErrors = FieldErrors & { form?: string };

export type CsvScope =
  { kind: 'week'; key: WeekKey } | { kind: 'month'; key: MonthKey } | { kind: 'all' };

export interface ExportFile {
  filename: string;
  mimeType: string;
  content: string;
}

export interface ImportPreview {
  plan: ImportPlan;
  preferences: Preferences | null;
  invalid: number;
}

export interface ConnectionInfo {
  fullName: string;
  private: boolean;
  canPush: boolean;
}

export type ConnectionTester = (sync: SyncSettings) => Promise<Result<ConnectionInfo>>;

export type ProviderFactory = (settings: Settings) => StorageProvider;

const START_ERRORS = {
  'already-exists': 'Today already has an entry. Edit it instead.',
  'other-open': 'Another day is still open. End or edit it first.',
} as const;

const END_ERRORS = {
  'not-open': 'This day is already closed.',
  'too-long':
    'This day has been open for 24 hours or more. Edit it and enter the end time by hand.',
  'zero-length': 'End time would equal the start time. Wait a minute or edit the entry.',
} as const;

const STORAGE_ERROR =
  'Could not save to this device’s storage. Your change is kept in memory only — export a backup.';

/**
 * Application service: orchestrates domain logic and storage. The UI calls
 * these methods and renders `store`; it contains no business rules itself.
 */
export class TrackerService {
  readonly store: Store<AppState>;
  private provider: StorageProvider;

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly providerFactory: ProviderFactory,
    private readonly clock: () => number = Date.now,
    private readonly connectionTester: ConnectionTester = () =>
      Promise.resolve(err('Sync is not available.')),
  ) {
    this.provider = providerFactory(DEFAULT_SETTINGS);
    this.store = createStore<AppState>({
      ready: false,
      entries: [],
      settings: DEFAULT_SETTINGS,
      sync: { status: 'off', pending: 0 },
      conflicts: [],
      storageError: null,
    });
  }

  now(): number {
    return this.clock();
  }

  get providerKind(): StorageProvider['kind'] {
    return this.provider.kind;
  }

  async load(): Promise<void> {
    let settings = DEFAULT_SETTINGS;
    try {
      settings = await this.settingsStore.load();
    } catch {
      this.store.set({ storageError: STORAGE_ERROR });
    }
    this.provider.dispose();
    this.provider = this.providerFactory(settings);
    await this.refreshEntries();
    this.store.set({ settings, ready: true });
    void this.sync();
  }

  private async refreshEntries(): Promise<void> {
    try {
      const [entries, conflicts] = await Promise.all([
        this.provider.list(),
        this.provider.pendingConflicts(),
      ]);
      this.store.set({ entries, conflicts });
    } catch {
      this.store.set({ storageError: STORAGE_ERROR });
    }
  }

  /** Persist entries, updating in-memory state even if storage fails. */
  private async persist(changed: readonly Entry[]): Promise<void> {
    const byDate = new Map(this.store.get().entries.map((e) => [e.date, e]));
    for (const e of changed) byDate.set(e.date, e);
    this.store.set({ entries: [...byDate.values()] });
    try {
      await this.provider.save(changed);
      if (this.store.get().storageError) this.store.set({ storageError: null });
    } catch {
      this.store.set({ storageError: STORAGE_ERROR });
      return;
    }
    void this.sync();
  }

  async start(): Promise<Result<Entry>> {
    const { entries, settings } = this.store.get();
    const result = startDay(entries, this.clock(), settings.defaultBreakMinutes);
    if (!result.ok) return err(START_ERRORS[result.error]);
    await this.persist([result.value]);
    return result;
  }

  async end(date: DateStr): Promise<Result<Entry>> {
    const entry = findEntry(this.store.get().entries, date);
    if (!entry) return err('Entry not found.');
    const result = endDay(entry, this.clock());
    if (!result.ok) return err(END_ERRORS[result.error]);
    await this.persist([result.value]);
    return result;
  }

  /**
   * Create or update an entry from form input. When editing, `originalDate`
   * is the date being edited; changing the date moves the entry.
   */
  async saveEntry(input: EntryInput, originalDate?: DateStr): Promise<Result<Entry, FormErrors>> {
    const nowMs = this.clock();
    const result = validateEntryInput(input, new Date(nowMs).toISOString());
    if (!result.ok) return result;
    const entry = result.value;
    const { entries } = this.store.get();

    if (entry.date !== originalDate && findEntry(entries, entry.date)) {
      return err({ date: 'There is already an entry for this date. Edit that one instead.' });
    }
    if (entry.end === null) {
      const otherOpen = entries.find(
        (e) => e.end === null && !e.deletedAt && e.date !== entry.date && e.date !== originalDate,
      );
      if (otherOpen) {
        return err({ end: `Only one day can be open. ${otherOpen.date} is still open.` });
      }
    }

    const changed: Entry[] = [entry];
    if (originalDate && originalDate !== entry.date) {
      const old = findEntry(entries, originalDate);
      if (old) changed.push(markDeleted(old, nowMs));
    }
    await this.persist(changed);
    return ok(entry);
  }

  async deleteEntry(date: DateStr): Promise<void> {
    const entry = findEntry(this.store.get().entries, date);
    if (!entry) return;
    await this.persist([markDeleted(entry, this.clock())]);
  }

  /** Bring back a deleted day. Fails if the date has been re-used meanwhile. */
  async restoreEntry(date: DateStr): Promise<Result<Entry>> {
    const entries = this.store.get().entries;
    if (findEntry(entries, date)) {
      return err('That date already has an entry. Delete or edit it first.');
    }
    const tombstone = entries.find((e) => e.date === date && e.deletedAt !== undefined);
    if (!tombstone) return err('Nothing to restore for that date.');
    const restored = restoreDeleted(tombstone, this.clock());
    await this.persist([restored]);
    return ok(restored);
  }

  /** Add or overwrite many entries at once (used by import). */
  async saveMany(entries: readonly Entry[]): Promise<void> {
    if (entries.length > 0) await this.persist(entries);
  }

  async saveSettings(settings: Settings): Promise<void> {
    const prev = this.store.get().settings;
    this.store.set({ settings });
    try {
      await this.settingsStore.save(settings);
    } catch {
      this.store.set({ storageError: STORAGE_ERROR });
    }
    if (JSON.stringify(prev.sync) !== JSON.stringify(settings.sync)) {
      this.provider.dispose();
      this.provider = this.providerFactory(settings);
      await this.refreshEntries();
      void this.sync();
    }
  }

  async sync(): Promise<void> {
    if (this.provider.kind === 'local') {
      this.store.set({ sync: { status: 'off', pending: 0 } });
      return;
    }
    const provider = this.provider;
    this.store.set({ sync: { ...this.store.get().sync, status: 'syncing' } });
    const report = await provider.sync();
    // Ignore results from a provider replaced by a settings change meanwhile.
    if (provider !== this.provider) return;
    this.store.set({ sync: report.state, conflicts: report.conflicts });
    await this.refreshEntries();
  }

  /** Check that a sync configuration can reach its repository. */
  testConnection(sync: SyncSettings): Promise<Result<ConnectionInfo>> {
    return this.connectionTester(sync);
  }

  async resolveConflict(date: DateStr, choice: 'local' | 'remote'): Promise<void> {
    const conflict = this.store.get().conflicts.find((c) => c.date === date);
    if (!conflict) return;
    const picked = choice === 'local' ? conflict.local : conflict.remote;
    // Re-stamp so the decision wins over both versions everywhere.
    const chosen = picked ? { ...picked, updatedAt: new Date(this.clock()).toISOString() } : null;
    await this.provider.resolveConflict(date, chosen);
    await this.refreshEntries();
    void this.sync();
  }

  exportCsv(scope: CsvScope): ExportFile {
    const { entries } = this.store.get();
    const selected =
      scope.kind === 'week'
        ? entriesInWeek(entries, scope.key)
        : scope.kind === 'month'
          ? entriesInMonth(entries, scope.key)
          : entries;
    const suffix = scope.kind === 'all' ? `all-${berlinDateTime(this.clock()).date}` : scope.key;
    return {
      filename: `time-tracker-${suffix}.csv`,
      mimeType: 'text/csv;charset=utf-8',
      content: entriesToCsv(selected),
    };
  }

  exportBackup(): ExportFile {
    const { entries, settings } = this.store.get();
    const nowMs = this.clock();
    return {
      filename: `time-tracker-backup-${berlinDateTime(nowMs).date}.json`,
      mimeType: 'application/json',
      content: createBackup(entries, settings, nowMs),
    };
  }

  /** Validate a backup file and work out what importing it would change. */
  previewImport(text: string): Result<ImportPreview> {
    const parsed = parseBackup(text);
    if (!parsed.ok) return parsed;
    return ok({
      plan: planImport(this.store.get().entries, parsed.value.entries),
      preferences: parsed.value.preferences,
      invalid: parsed.value.invalid,
    });
  }

  async applyImport(preview: ImportPreview, restorePreferences: boolean): Promise<void> {
    await this.saveMany(preview.plan.toWrite);
    if (restorePreferences && preview.preferences) {
      await this.saveSettings({ ...this.store.get().settings, ...preview.preferences });
    }
  }
}
