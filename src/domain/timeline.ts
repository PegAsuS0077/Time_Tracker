import { activeEntries, computeEntry, findEntry, openProgress } from './entries';
import { endsNextDay, timeToMinutes, weekdayIndex } from './time';
import type { DateStr, Entry } from './types';

const DAY = 1440;
const DEFAULT_AXIS: [number, number] = [7 * 60, 19 * 60];

export interface TimelineRow {
  date: DateStr;
  entry: Entry | undefined;
  /** Wall-clock minutes from the date's midnight; the end can pass 1440 for overnight shifts. */
  startMin: number | null;
  endMin: number | null;
  running: boolean;
  /** The shift continues past midnight; the bar is clipped at the axis end. */
  overnight: boolean;
  /** Net minutes (live for a running day), or null when there is nothing to count. */
  netMinutes: number | null;
}

export interface Timeline {
  /** Axis bounds in minutes from midnight, on whole hours. */
  axisStart: number;
  axisEnd: number;
  rows: TimelineRow[];
}

function rowFor(date: DateStr, entry: Entry | undefined, nowMs: number): TimelineRow {
  const empty = {
    date,
    entry,
    startMin: null,
    endMin: null,
    running: false,
    overnight: false,
    netMinutes: null,
  };
  if (!entry) return empty;
  const startMin = timeToMinutes(entry.start);
  if (entry.end === null) {
    const progress = openProgress(entry, nowMs);
    if (!progress) return empty;
    return {
      date,
      entry,
      startMin,
      endMin: startMin + progress.elapsedMinutes,
      running: true,
      overnight: startMin + progress.elapsedMinutes > DAY,
      netMinutes: progress.netMinutes,
    };
  }
  const status = computeEntry(entry);
  const endMin = timeToMinutes(entry.end) + (endsNextDay(entry.start, entry.end) ? DAY : 0);
  return {
    date,
    entry,
    startMin,
    endMin,
    running: false,
    overnight: endMin > DAY,
    netMinutes: status.kind === 'closed' ? status.netMinutes : null,
  };
}

/**
 * Bars for the given dates on a shared axis that always covers 07:00–19:00.
 * The axis never goes past midnight, so one night shift does not squash the
 * rest of the week; overnight bars are clipped there instead.
 */
export function timeline(
  entries: readonly Entry[],
  dates: readonly DateStr[],
  nowMs: number,
): Timeline {
  const active = activeEntries(entries);
  const rows = dates.map((date) => rowFor(date, findEntry(active, date), nowMs));
  let [axisStart, axisEnd] = DEFAULT_AXIS;
  for (const row of rows) {
    if (row.startMin !== null) axisStart = Math.min(axisStart, Math.floor(row.startMin / 60) * 60);
    if (row.endMin !== null) axisEnd = Math.max(axisEnd, Math.ceil(row.endMin / 60) * 60);
  }
  return { axisStart, axisEnd: Math.min(axisEnd, DAY), rows };
}

export interface Progress {
  /** Net minutes of closed days. */
  closedMinutes: number;
  /** Live net minutes of a running day in the period. */
  runningMinutes: number;
  /** Contracted minutes for the whole period (Mon–Fri), or null when not configured. */
  targetMinutes: number | null;
  /** Contracted minutes for the workdays that are already finished. */
  targetToDateMinutes: number | null;
  /** Closed net minus target to date (positive = ahead). */
  deltaToDateMinutes: number | null;
  /** The last workday included in the target to date. */
  countedThrough: DateStr | null;
}

/**
 * Totals for a period compared fairly against the contract: only workdays
 * that are over (before today, or today once it has ended) count toward the
 * target, and a running day is reported separately instead of as a shortfall.
 */
export function progress(
  entries: readonly Entry[],
  dates: readonly DateStr[],
  today: DateStr,
  nowMs: number,
  contractedWeeklyHours: number | null,
): Progress {
  let closedMinutes = 0;
  let runningMinutes = 0;
  const inPeriod = new Set(dates);
  for (const entry of activeEntries(entries)) {
    if (!inPeriod.has(entry.date)) continue;
    const status = computeEntry(entry);
    if (status.kind === 'closed') closedMinutes += status.netMinutes;
    else if (status.kind === 'open') runningMinutes += openProgress(entry, nowMs)?.netMinutes ?? 0;
  }

  if (contractedWeeklyHours === null) {
    return {
      closedMinutes,
      runningMinutes,
      targetMinutes: null,
      targetToDateMinutes: null,
      deltaToDateMinutes: null,
      countedThrough: null,
    };
  }

  const daily = (contractedWeeklyHours * 60) / 5;
  const workdays = dates.filter((d) => weekdayIndex(d) < 5);
  const todayEntry = findEntry(entries, today);
  const todayDone = todayEntry !== undefined && todayEntry.end !== null;
  const counted = workdays.filter((d) => d < today || (d === today && todayDone));
  const targetToDate = Math.round(daily * counted.length);
  return {
    closedMinutes,
    runningMinutes,
    targetMinutes: Math.round(daily * workdays.length),
    targetToDateMinutes: targetToDate,
    deltaToDateMinutes: closedMinutes - targetToDate,
    countedThrough: counted.at(-1) ?? null,
  };
}
