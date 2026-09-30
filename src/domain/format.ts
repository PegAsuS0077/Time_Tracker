import { weekdayIndex } from './time';
import { weekDates } from './week';
import type { DateStr, MonthKey, TimeStr, WeekKey } from './types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MINUS = '−';

/** `450` → `7:30`, `-15` → `−0:15`. */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? MINUS : '';
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/** Like formatDuration but always signed: `+1:30`, `−0:15`, `0:00`. */
export function formatSignedDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded === 0) return '0:00';
  return rounded > 0 ? `+${formatDuration(rounded)}` : formatDuration(rounded);
}

/** Seconds → `H:MM:SS` for the running clock. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** `450` → `7.50` (decimal hours for spreadsheets). */
export function formatHoursDecimal(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function formatTime(time: TimeStr, use24h: boolean): string {
  if (use24h) return time;
  const [h = 0, m = 0] = time.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function weekdayShort(date: DateStr): string {
  return WEEKDAYS[weekdayIndex(date)] ?? '';
}

/** `2026-09-30` → `Wed 30 Sep`. */
export function formatDateShort(date: DateStr): string {
  const [, m = 1, d = 1] = date.split('-').map(Number);
  return `${weekdayShort(date)} ${d} ${MONTHS_SHORT[m - 1] ?? ''}`;
}

/** `2026-09-30` → `Wed 30 Sep 2026`. */
export function formatDateLong(date: DateStr): string {
  return `${formatDateShort(date)} ${date.slice(0, 4)}`;
}

/** `2026-W40` → `28 Sep – 4 Oct 2026`. */
export function formatWeekRange(key: WeekKey): string {
  const dates = weekDates(key);
  const first = dates[0] ?? '';
  const last = dates[6] ?? '';
  const [fy, fm = 1, fd] = first.split('-').map(Number);
  const [ly, lm = 1, ld] = last.split('-').map(Number);
  const firstPart =
    fy === ly ? `${fd} ${MONTHS_SHORT[fm - 1] ?? ''}` : `${fd} ${MONTHS_SHORT[fm - 1] ?? ''} ${fy}`;
  return `${firstPart} – ${ld} ${MONTHS_SHORT[lm - 1] ?? ''} ${ly}`;
}

/** `2026-09` → `September 2026`. */
export function formatMonth(key: MonthKey): string {
  const [y, m = 1] = key.split('-').map(Number);
  return `${MONTHS_LONG[m - 1] ?? ''} ${y}`;
}
