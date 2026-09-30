import type { Conflict } from '../domain/merge';
import { DEFAULT_SETTINGS, type DateStr, type Entry, type Settings } from '../domain/types';
import type { SettingsStore, StorageProvider, SyncReport } from './StorageProvider';

/** In-memory provider for tests and as a fallback when IndexedDB is unavailable. */
export class MemoryProvider implements StorageProvider {
  readonly kind = 'local' as const;
  private readonly entries = new Map<DateStr, Entry>();
  conflicts: Conflict[] = [];
  /** Set to make every save fail, to exercise error handling. */
  failWrites = false;

  constructor(initial: readonly Entry[] = []) {
    for (const e of initial) this.entries.set(e.date, e);
  }

  list(): Promise<Entry[]> {
    return Promise.resolve([...this.entries.values()]);
  }

  save(entries: readonly Entry[]): Promise<void> {
    if (this.failWrites) return Promise.reject(new Error('Simulated storage failure'));
    for (const e of entries) this.entries.set(e.date, e);
    return Promise.resolve();
  }

  sync(): Promise<SyncReport> {
    return Promise.resolve({ state: { status: 'off', pending: 0 }, conflicts: this.conflicts });
  }

  async resolveConflict(date: DateStr, chosen: Entry | null): Promise<void> {
    this.conflicts = this.conflicts.filter((c) => c.date !== date);
    if (chosen) await this.save([chosen]);
  }

  pendingConflicts(): Promise<Conflict[]> {
    return Promise.resolve(this.conflicts);
  }

  dispose(): void {
    // Nothing to release.
  }
}

export class MemorySettingsStore implements SettingsStore {
  constructor(private settings: Settings = structuredClone(DEFAULT_SETTINGS)) {}

  load(): Promise<Settings> {
    return Promise.resolve(structuredClone(this.settings));
  }

  save(settings: Settings): Promise<void> {
    this.settings = structuredClone(settings);
    return Promise.resolve();
  }
}
