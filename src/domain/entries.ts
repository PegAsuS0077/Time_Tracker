import {
  addDays,
  berlinDateTime,
  elapsedMinutes,
  elapsedSince,
  endsNextDay,
  type IntervalError,
} from './time';
import { err, ok, type DateStr, type Entry, type Result } from './types';

/** An open entry older than this is considered forgotten and must be edited by hand. */
export const STALE_OPEN_MINUTES = 16 * 60;

export type EntryStatus =
  | { kind: 'closed'; grossMinutes: number; netMinutes: number }
  | { kind: 'open' }
  | { kind: 'invalid'; error: IntervalError };

/** Gross (attendance) and net (minus break) minutes for an entry. */
export function computeEntry(entry: Entry): EntryStatus {
  if (entry.end === null) return { kind: 'open' };
  const gross = elapsedMinutes(entry.date, entry.start, entry.end);
  if (!gross.ok) return { kind: 'invalid', error: gross.error };
  return {
    kind: 'closed',
    grossMinutes: gross.value,
    netMinutes: Math.max(0, gross.value - entry.breakMinutes),
  };
}

/** Live figures for an open entry at `nowMs`. */
export function openProgress(
  entry: Entry,
  nowMs: number,
): { elapsedMinutes: number; netMinutes: number } | null {
  if (entry.end !== null) return null;
  const elapsed = elapsedSince(entry.date, entry.start, nowMs);
  if (elapsed === null) return null;
  return { elapsedMinutes: elapsed, netMinutes: Math.max(0, elapsed - entry.breakMinutes) };
}

export function isStaleOpen(entry: Entry, nowMs: number): boolean {
  const progress = openProgress(entry, nowMs);
  return progress !== null && progress.elapsedMinutes > STALE_OPEN_MINUTES;
}

export const isActive = (entry: Entry): boolean => entry.deletedAt === undefined;

export function activeEntries(entries: readonly Entry[]): Entry[] {
  return entries.filter(isActive);
}

/** The most recent active entry without an end time. */
export function findOpenEntry(entries: readonly Entry[]): Entry | undefined {
  return activeEntries(entries)
    .filter((e) => e.end === null)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function findEntry(entries: readonly Entry[], date: DateStr): Entry | undefined {
  return entries.find((e) => e.date === date && isActive(e));
}

export type StartError = 'already-exists' | 'other-open';

/** Create today's entry stamped with the current Berlin time. */
export function startDay(
  entries: readonly Entry[],
  nowMs: number,
  defaultBreakMinutes: number,
): Result<Entry, StartError> {
  const { date, time } = berlinDateTime(nowMs);
  if (findEntry(entries, date)) return err('already-exists');
  if (findOpenEntry(entries)) return err('other-open');
  return ok({
    date,
    start: time,
    end: null,
    breakMinutes: defaultBreakMinutes,
    updatedAt: new Date(nowMs).toISOString(),
  });
}

export type EndError = 'not-open' | 'too-long' | 'zero-length';

/**
 * Stamp the end time on an open entry. The current time must fall on the
 * start date or, for an overnight shift, the day after (and before the start
 * time); otherwise the entry was forgotten and needs manual editing.
 */
export function endDay(entry: Entry, nowMs: number): Result<Entry, EndError> {
  if (entry.end !== null) return err('not-open');
  const now = berlinDateTime(nowMs);
  if (now.time === entry.start && now.date === entry.date) return err('zero-length');
  const expectedEndDate = endsNextDay(entry.start, now.time) ? addDays(entry.date, 1) : entry.date;
  if (now.date !== expectedEndDate) return err('too-long');
  return ok({ ...entry, end: now.time, updatedAt: new Date(nowMs).toISOString() });
}

/** Tombstone an entry so the delete propagates through sync. */
export function markDeleted(entry: Entry, nowMs: number): Entry {
  const at = new Date(nowMs).toISOString();
  return { ...entry, deletedAt: at, updatedAt: at };
}
