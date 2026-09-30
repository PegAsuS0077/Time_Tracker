import { addDays, daysBetween, weekdayIndex } from './time';
import type { DateStr, MonthKey, WeekKey } from './types';

const WEEK_RE = /^(\d{4})-W(\d{2})$/;

export interface IsoWeek {
  year: number;
  week: number;
}

/** ISO-8601 week (Monday start; week 1 contains the year's first Thursday). */
export function isoWeek(date: DateStr): IsoWeek {
  const thursday = addDays(date, 3 - weekdayIndex(date));
  const year = Number(thursday.slice(0, 4));
  const dayOfYear = daysBetween(`${year}-01-01`, thursday);
  return { year, week: Math.floor(dayOfYear / 7) + 1 };
}

export function weekKey(date: DateStr): WeekKey {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** 52 or 53. */
export function weeksInYear(year: number): number {
  return isoWeek(`${year}-12-28`).week;
}

export function parseWeekKey(key: string): IsoWeek | null {
  const m = WEEK_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (year < 1970 || week < 1 || week > weeksInYear(year)) return null;
  return { year, week };
}

/** Monday of the ISO week. */
export function weekStart(key: WeekKey): DateStr {
  const parsed = parseWeekKey(key);
  if (!parsed) throw new RangeError(`Invalid week key: ${key}`);
  const jan4 = `${parsed.year}-01-04`;
  const week1Monday = addDays(jan4, -weekdayIndex(jan4));
  return addDays(week1Monday, (parsed.week - 1) * 7);
}

/** The seven dates Monday..Sunday of the ISO week. */
export function weekDates(key: WeekKey): DateStr[] {
  const monday = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Short week label as used in commit messages, e.g. `W40`. */
export function shortWeekLabel(key: WeekKey): string {
  return key.slice(5);
}

export function monthKey(date: DateStr): MonthKey {
  return date.slice(0, 7);
}

export function monthDates(key: MonthKey): DateStr[] {
  const [y = 0, m = 1] = key.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`);
}

/** Monday–Friday count in a month (public holidays are not modelled). */
export function weekdaysInMonth(key: MonthKey): number {
  return monthDates(key).filter((d) => weekdayIndex(d) < 5).length;
}
