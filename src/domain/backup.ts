import { err, ok, type Entry, type Result, type Settings } from './types';
import { parseEntry } from './validate';

export const BACKUP_FORMAT = 'time-tracker-backup';
export const BACKUP_VERSION = 1;
/** Refuse absurdly large files before parsing them. */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

/** Preferences that are safe to back up and restore (never the token). */
export type Preferences = Pick<
  Settings,
  'defaultBreakMinutes' | 'legalBreakWarning' | 'contractedWeeklyHours' | 'use24h'
>;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  preferences: Preferences;
  /** All entries including tombstones, so deletions are preserved. */
  entries: Entry[];
}

export function preferencesOf(settings: Settings): Preferences {
  return {
    defaultBreakMinutes: settings.defaultBreakMinutes,
    legalBreakWarning: settings.legalBreakWarning,
    contractedWeeklyHours: settings.contractedWeeklyHours,
    use24h: settings.use24h,
  };
}

export function createBackup(entries: readonly Entry[], settings: Settings, nowMs: number): string {
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date(nowMs).toISOString(),
    preferences: preferencesOf(settings),
    entries: [...entries].sort((a, b) => a.date.localeCompare(b.date)),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export interface ParsedBackup {
  entries: Entry[];
  preferences: Preferences | null;
  /** Entries that failed validation and were ignored. */
  invalid: number;
}

function parsePreferences(value: unknown): Preferences | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const { defaultBreakMinutes, legalBreakWarning, contractedWeeklyHours, use24h } = v;
  if (
    typeof defaultBreakMinutes !== 'number' ||
    !Number.isInteger(defaultBreakMinutes) ||
    defaultBreakMinutes < 0 ||
    defaultBreakMinutes > 600
  ) {
    return null;
  }
  if (typeof legalBreakWarning !== 'boolean' || typeof use24h !== 'boolean') return null;
  if (
    contractedWeeklyHours !== null &&
    (typeof contractedWeeklyHours !== 'number' ||
      !(contractedWeeklyHours > 0 && contractedWeeklyHours <= 100))
  ) {
    return null;
  }
  return { defaultBreakMinutes, legalBreakWarning, contractedWeeklyHours, use24h };
}

/** Parse and validate an untrusted backup file. */
export function parseBackup(text: string): Result<ParsedBackup> {
  if (text.length > MAX_BACKUP_BYTES) return err('The file is too large to be a backup.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return err('The file is not valid JSON.');
  }
  if (typeof data !== 'object' || data === null) return err('The file is not a backup.');
  const file = data as Record<string, unknown>;
  if (file.format !== BACKUP_FORMAT) return err('The file is not a Time Tracker backup.');
  if (file.version !== BACKUP_VERSION) {
    return err(`Unsupported backup version ${String(file.version)}.`);
  }
  if (!Array.isArray(file.entries)) return err('The backup has no entries list.');

  const entries: Entry[] = [];
  let invalid = 0;
  for (const raw of file.entries as unknown[]) {
    const entry = parseEntry(raw);
    if (entry) entries.push(entry);
    else invalid += 1;
  }
  return ok({ entries, preferences: parsePreferences(file.preferences), invalid });
}
