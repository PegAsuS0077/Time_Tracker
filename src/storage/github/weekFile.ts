import { err, ok, type Entry, type Result, type WeekKey } from '../../domain/types';
import { parseEntry } from '../../domain/validate';
import { parseWeekKey, weekKey } from '../../domain/week';

export const WEEK_FILE_FORMAT = 'time-tracker-week';
export const WEEK_FILE_VERSION = 1;

const PATH_RE = /^(\d{4})\/(\d{4}-W\d{2})\.json$/;

/** `2026-W40` → `2026/2026-W40.json`. */
export function weekFilePath(week: WeekKey): string {
  return `${week.slice(0, 4)}/${week}.json`;
}

export function weekFromPath(path: string): WeekKey | null {
  const m = PATH_RE.exec(path);
  if (!m?.[2] || m[1] !== m[2].slice(0, 4) || !parseWeekKey(m[2])) return null;
  return m[2];
}

/** Stable, pretty-printed file content so git diffs stay readable. */
export function serializeWeek(week: WeekKey, entries: readonly Entry[]): string {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const file = {
    format: WEEK_FILE_FORMAT,
    version: WEEK_FILE_VERSION,
    week,
    entries: sorted.map((e) => ({
      date: e.date,
      start: e.start,
      end: e.end,
      breakMinutes: e.breakMinutes,
      ...(e.note !== undefined ? { note: e.note } : {}),
      updatedAt: e.updatedAt,
      ...(e.deletedAt !== undefined ? { deletedAt: e.deletedAt } : {}),
    })),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Parse an untrusted week file; entries from other weeks are rejected. */
export function parseWeekFile(text: string, week: WeekKey): Result<Entry[]> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return err('not valid JSON');
  }
  if (typeof data !== 'object' || data === null) return err('not a week file');
  const file = data as Record<string, unknown>;
  if (file.format !== WEEK_FILE_FORMAT || file.version !== WEEK_FILE_VERSION) {
    return err('unknown file format or version');
  }
  if (file.week !== week || !Array.isArray(file.entries)) return err('wrong week or no entries');
  const entries: Entry[] = [];
  for (const raw of file.entries as unknown[]) {
    const entry = parseEntry(raw);
    if (!entry || weekKey(entry.date) !== week) return err('contains an invalid entry');
    entries.push(entry);
  }
  return ok(entries);
}
