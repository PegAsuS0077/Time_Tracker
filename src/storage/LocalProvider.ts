import { DEFAULT_SETTINGS, type Entry, type Settings } from '../domain/types';
import type { TrackerDatabase } from './idb';
import type { SettingsStore, StorageProvider, SyncReport } from './StorageProvider';

/** IndexedDB-only storage: the offline working copy. */
export class LocalProvider implements StorageProvider {
  readonly kind = 'local' as const;

  constructor(private readonly db: TrackerDatabase) {}

  list(): Promise<Entry[]> {
    return this.db.getAll('entries');
  }

  async save(entries: readonly Entry[]): Promise<void> {
    const tx = this.db.transaction('entries', 'readwrite');
    await Promise.all([...entries.map((e) => tx.store.put(e)), tx.done]);
  }

  sync(): Promise<SyncReport> {
    return Promise.resolve({ state: { status: 'off', pending: 0 }, conflicts: [] });
  }

  async resolveConflict(): Promise<void> {
    // Local-only mode never produces conflicts.
  }

  pendingConflicts(): Promise<never[]> {
    return Promise.resolve([]);
  }

  dispose(): void {
    // Nothing to release; the database is owned by the caller.
  }
}

const SETTINGS_KEY = 'settings';

/** Fill in defaults for settings saved by older versions. */
export function withDefaults(stored: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    sync: { ...DEFAULT_SETTINGS.sync, ...stored?.sync },
  };
}

export class IdbSettingsStore implements SettingsStore {
  constructor(private readonly db: TrackerDatabase) {}

  async load(): Promise<Settings> {
    return withDefaults(await this.db.get('settings', SETTINGS_KEY));
  }

  async save(settings: Settings): Promise<void> {
    await this.db.put('settings', settings, SETTINGS_KEY);
  }
}
