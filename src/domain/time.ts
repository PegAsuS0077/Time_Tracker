import { err, ok, type DateStr, type Result, type TimeStr } from './types';

/**
 * Pure time helpers for Europe/Berlin wall-clock times.
 * Nothing here reads the system clock or depends on the device timezone:
 * callers pass instants (epoch milliseconds) explicitly.
 */

export const TIME_ZONE = 'Europe/Berlin';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const berlinFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(epochMs: number): WallParts {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const p of berlinFormatter.formatToParts(new Date(epochMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    // Some engines report midnight as 24 even with h23.
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Berlin UTC offset in minutes at the given instant (60 in winter, 120 in summer). */
export function berlinOffsetMinutes(epochMs: number): number {
  const truncated = Math.floor(epochMs / 1000) * 1000;
  const p = wallParts(truncated);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - truncated) / MINUTE_MS);
}

/** Berlin date and time (`HH:mm`) for an instant. */
export function berlinDateTime(epochMs: number): { date: DateStr; time: TimeStr } {
  const p = wallParts(epochMs);
  return {
    date: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
    time: `${pad2(p.hour)}:${pad2(p.minute)}`,
  };
}

export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1970 || y > 9999) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** Minutes since midnight for `HH:mm`. Assumes a valid time. */
export function timeToMinutes(time: TimeStr): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

function dateToUtcMs(date: DateStr): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Date arithmetic on plain calendar dates (no timezone involved). */
export function addDays(date: DateStr, days: number): DateStr {
  const dt = new Date(dateToUtcMs(date) + days * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Whole calendar days from `a` to `b` (positive if `b` is later). */
export function daysBetween(a: DateStr, b: DateStr): number {
  return Math.round((dateToUtcMs(b) - dateToUtcMs(a)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: DateStr): number {
  return (new Date(dateToUtcMs(date)).getUTCDay() + 6) % 7;
}

export type ZonedError = 'invalid' | 'nonexistent';

/**
 * Convert a Berlin wall-clock date+time into an instant.
 * - Times skipped by the spring-forward transition (e.g. 02:30 on the last
 *   Sunday of March) are rejected as `nonexistent`.
 * - Times repeated by the fall-back transition resolve to the first
 *   occurrence (still summer time).
 */
export function berlinToEpoch(date: DateStr, time: TimeStr): Result<number, ZonedError> {
  if (!isValidDate(date) || !isValidTime(time)) return err('invalid');
  const naive = dateToUtcMs(date) + timeToMinutes(time) * MINUTE_MS;
  const offsets = new Set([
    berlinOffsetMinutes(naive - 3 * 3_600_000),
    berlinOffsetMinutes(naive + 3 * 3_600_000),
  ]);
  const candidates: number[] = [];
  for (const offset of offsets) {
    const instant = naive - offset * MINUTE_MS;
    const back = berlinDateTime(instant);
    if (back.date === date && back.time === time) candidates.push(instant);
  }
  if (candidates.length === 0) return err('nonexistent');
  return ok(Math.min(...candidates));
}

/** Whether an entry's end time falls on the day after its start date. */
export function endsNextDay(start: TimeStr, end: TimeStr): boolean {
  return timeToMinutes(end) < timeToMinutes(start);
}

export type IntervalError = ZonedError | 'zero-length';

/**
 * Real elapsed minutes between start and end, DST-aware.
 * `end < start` means the shift ended the next day.
 */
export function elapsedMinutes(
  date: DateStr,
  start: TimeStr,
  end: TimeStr,
): Result<number, IntervalError> {
  if (isValidTime(start) && start === end) return err('zero-length');
  const s = berlinToEpoch(date, start);
  if (!s.ok) return s;
  const endDate = endsNextDay(start, end) ? addDays(date, 1) : date;
  const e = berlinToEpoch(endDate, end);
  if (!e.ok) return e;
  return ok(Math.round((e.value - s.value) / MINUTE_MS));
}
