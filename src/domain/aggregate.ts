import { activeEntries, computeEntry } from './entries';
import { monthKey, weekKey, weekdaysInMonth } from './week';
import type { Entry, MonthKey, WeekKey } from './types';

export interface Totals {
  /** Net minutes of closed, valid entries. Open entries are not counted. */
  netMinutes: number;
  closedDays: number;
  openDays: number;
  invalidDays: number;
}

export function totals(entries: readonly Entry[]): Totals {
  const result: Totals = { netMinutes: 0, closedDays: 0, openDays: 0, invalidDays: 0 };
  for (const entry of activeEntries(entries)) {
    const status = computeEntry(entry);
    if (status.kind === 'closed') {
      result.netMinutes += status.netMinutes;
      result.closedDays += 1;
    } else if (status.kind === 'open') {
      result.openDays += 1;
    } else {
      result.invalidDays += 1;
    }
  }
  return result;
}

const byDateAsc = (a: Entry, b: Entry): number => a.date.localeCompare(b.date);

export interface WeekGroup {
  key: WeekKey;
  entries: Entry[];
  totals: Totals;
}

/** Active entries grouped by ISO week, newest week first, days ascending. */
export function groupByWeek(entries: readonly Entry[]): WeekGroup[] {
  const groups = new Map<WeekKey, Entry[]>();
  for (const entry of activeEntries(entries)) {
    const key = weekKey(entry.date);
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, list]) => {
      const sorted = list.sort(byDateAsc);
      return { key, entries: sorted, totals: totals(sorted) };
    });
}

export function entriesInWeek(entries: readonly Entry[], key: WeekKey): Entry[] {
  return activeEntries(entries)
    .filter((e) => weekKey(e.date) === key)
    .sort(byDateAsc);
}

export function entriesInMonth(entries: readonly Entry[], key: MonthKey): Entry[] {
  return activeEntries(entries)
    .filter((e) => monthKey(e.date) === key)
    .sort(byDateAsc);
}

export interface PeriodSummary {
  totals: Totals;
  /** Contracted minutes for the whole period, or null when not configured. */
  targetMinutes: number | null;
  /** Net minus target (positive = overtime), or null when not configured. */
  deltaMinutes: number | null;
}

function summarize(periodEntries: Entry[], target: number | null): PeriodSummary {
  const t = totals(periodEntries);
  return {
    totals: t,
    targetMinutes: target,
    deltaMinutes: target === null ? null : t.netMinutes - target,
  };
}

export function weekSummary(
  entries: readonly Entry[],
  key: WeekKey,
  contractedWeeklyHours: number | null,
): PeriodSummary {
  const target = contractedWeeklyHours === null ? null : Math.round(contractedWeeklyHours * 60);
  return summarize(entriesInWeek(entries, key), target);
}

/** Month target = weekly hours × (Mon–Fri days in month ÷ 5). */
export function monthSummary(
  entries: readonly Entry[],
  key: MonthKey,
  contractedWeeklyHours: number | null,
): PeriodSummary {
  const target =
    contractedWeeklyHours === null
      ? null
      : Math.round((contractedWeeklyHours * 60 * weekdaysInMonth(key)) / 5);
  return summarize(entriesInMonth(entries, key), target);
}
