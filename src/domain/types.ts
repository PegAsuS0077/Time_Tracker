/** Calendar date in Europe/Berlin, `YYYY-MM-DD`. */
export type DateStr = string;
/** Wall-clock time in Europe/Berlin, `HH:mm` (24h). */
export type TimeStr = string;
/** ISO week key, e.g. `2026-W40`. */
export type WeekKey = string;
/** Month key, e.g. `2026-09`. */
export type MonthKey = string;

/**
 * One working day. `date` is the primary key (one entry per day) and is the
 * Berlin date on which the shift started. An `end` earlier than `start` means
 * the shift ended on the following day. `end: null` means the day is still open.
 */
export interface Entry {
  date: DateStr;
  start: TimeStr;
  end: TimeStr | null;
  breakMinutes: number;
  note?: string;
  /** ISO-8601 UTC timestamp of the last change. Used for merging. */
  updatedAt: string;
  /** Tombstone: set when the entry was deleted, so deletes survive sync. */
  deletedAt?: string;
}

export interface SyncSettings {
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  /** Fine-grained personal access token. Stored on this device only. */
  token: string;
  /** User explicitly accepted syncing to a repository that is public. */
  allowPublicRepo: boolean;
}

export interface Settings {
  defaultBreakMinutes: number;
  /** Warn when a break is below the German legal minimum (ArbZG §4). */
  legalBreakWarning: boolean;
  /** Contracted hours per week; `null` disables overtime/shortfall display. */
  contractedWeeklyHours: number | null;
  use24h: boolean;
  sync: SyncSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultBreakMinutes: 30,
  legalBreakWarning: true,
  contractedWeeklyHours: null,
  use24h: true,
  sync: {
    enabled: false,
    owner: '',
    repo: '',
    branch: 'main',
    token: '',
    allowPublicRepo: false,
  },
};

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const err = <E>(error: E): { ok: false; error: E } => ({ ok: false, error });
