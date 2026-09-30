import type { Conflict } from '../domain/merge';
import type { DateStr, Entry, Settings } from '../domain/types';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  /** Human-readable detail for `error` (never contains the token). */
  message?: string;
  /** Weeks waiting to be pushed. */
  pending: number;
  lastSyncedAt?: string;
  /** Set when the configured data repository turned out to be public. */
  publicRepo?: boolean;
}

export interface SyncReport {
  state: SyncState;
  conflicts: Conflict[];
}

/**
 * Where entries live. The local provider is the working copy; the GitHub
 * provider wraps it and mirrors changes to a private repository.
 * Entries include tombstones (`deletedAt`); callers filter them.
 */
export interface StorageProvider {
  readonly kind: 'local' | 'github';
  list(): Promise<Entry[]>;
  /** Persist locally; remote-backed providers also queue a push. */
  save(entries: readonly Entry[]): Promise<void>;
  /** Pull remote changes and flush queued writes. Local-only: no-op. */
  sync(): Promise<SyncReport>;
  /** Settle a sync conflict with the chosen version (`null` keeps the day deleted). */
  resolveConflict(date: DateStr, chosen: Entry | null): Promise<void>;
  /** Conflicts still waiting for a decision. */
  pendingConflicts(): Promise<Conflict[]>;
  dispose(): void;
}

export interface SettingsStore {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
}
