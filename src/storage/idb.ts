import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Conflict } from '../domain/merge';
import type { DateStr, Entry, Settings, WeekKey } from '../domain/types';

/** Per-week remote bookkeeping for the GitHub provider. */
export interface WeekSyncMeta {
  week: WeekKey;
  /** Blob sha of the remote file as last seen, or null if it does not exist yet. */
  sha: string | null;
  /** Entries as last agreed with the remote (the three-way merge base). */
  base: Entry[];
  /** owner/repo@branch this record belongs to. */
  target: string;
}

export interface QueueItem {
  week: WeekKey;
  queuedAt: string;
  /** Unique per enqueue, so a re-queue during a sync is not lost. */
  id: string;
}

export interface TrackerDB extends DBSchema {
  entries: { key: DateStr; value: Entry };
  settings: { key: string; value: Settings };
  syncMeta: { key: WeekKey; value: WeekSyncMeta };
  queue: { key: WeekKey; value: QueueItem };
  conflicts: { key: DateStr; value: Conflict };
}

export type TrackerDatabase = IDBPDatabase<TrackerDB>;

export const DB_NAME = 'time-tracker';
const DB_VERSION = 1;

export function openTrackerDb(name = DB_NAME): Promise<TrackerDatabase> {
  return openDB<TrackerDB>(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('entries', { keyPath: 'date' });
      db.createObjectStore('settings');
      db.createObjectStore('syncMeta', { keyPath: 'week' });
      db.createObjectStore('queue', { keyPath: 'week' });
      db.createObjectStore('conflicts', { keyPath: 'date' });
    },
  });
}
