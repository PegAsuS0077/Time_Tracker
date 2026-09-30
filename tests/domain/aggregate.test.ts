import { describe, expect, it } from 'vitest';
import {
  entriesInMonth,
  entriesInWeek,
  groupByWeek,
  monthSummary,
  totals,
  weekSummary,
} from '../../src/domain/aggregate';
import type { Entry } from '../../src/domain/types';

const TS = '2026-09-30T00:00:00.000Z';
const day = (date: string, start: string, end: string | null, breakMinutes = 30): Entry => ({
  date,
  start,
  end,
  breakMinutes,
  updatedAt: TS,
});

const entries: Entry[] = [
  day('2026-09-28', '08:00', '16:30'), // 480
  day('2026-09-29', '08:00', '17:30'), // 540
  day('2026-09-30', '08:00', null), // open
  day('2026-10-01', '09:00', '12:00', 0), // 180, month October
  { ...day('2026-10-02', '08:00', '16:00'), deletedAt: TS }, // deleted
  day('2026-10-04', '22:00', '06:00'), // Sunday overnight, 450, counts in W40
  day('2026-09-21', '08:00', '12:00', 0), // W39, 240
  day('2026-03-29', '02:30', '06:00', 0), // invalid (nonexistent start)
];

describe('totals', () => {
  it('sums closed entries and counts open, invalid and deleted separately', () => {
    expect(totals(entries)).toEqual({
      netMinutes: 480 + 540 + 180 + 450 + 240,
      closedDays: 5,
      openDays: 1,
      invalidDays: 1,
    });
  });

  it('is zero for no entries', () => {
    expect(totals([])).toEqual({ netMinutes: 0, closedDays: 0, openDays: 0, invalidDays: 0 });
  });
});

describe('groupByWeek', () => {
  it('groups by ISO week, newest week first, days ascending', () => {
    const groups = groupByWeek(entries);
    expect(groups.map((g) => g.key)).toEqual(['2026-W40', '2026-W39', '2026-W13']);
    const w40 = groups[0];
    expect(w40?.entries.map((e) => e.date)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-04',
    ]);
    expect(w40?.totals.netMinutes).toBe(480 + 540 + 180 + 450);
    expect(w40?.totals.openDays).toBe(1);
  });

  it('groups year-boundary weeks together', () => {
    const groups = groupByWeek([
      day('2026-12-31', '08:00', '12:00'),
      day('2027-01-02', '08:00', '12:00'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('2026-W53');
  });
});

describe('period filters', () => {
  it('selects a week and a month, excluding tombstones', () => {
    expect(entriesInWeek(entries, '2026-W40')).toHaveLength(5);
    expect(entriesInMonth(entries, '2026-10').map((e) => e.date)).toEqual([
      '2026-10-01',
      '2026-10-04',
    ]);
  });
});

describe('summaries with contracted hours', () => {
  it('has no target when contracted hours are off', () => {
    const s = weekSummary(entries, '2026-W40', null);
    expect(s.targetMinutes).toBeNull();
    expect(s.deltaMinutes).toBeNull();
  });

  it('computes weekly overtime', () => {
    const s = weekSummary(entries, '2026-W40', 20);
    expect(s.targetMinutes).toBe(1200);
    expect(s.deltaMinutes).toBe(1650 - 1200);
  });

  it('computes weekly shortfall with fractional hours', () => {
    const s = weekSummary(entries, '2026-W39', 38.5);
    expect(s.targetMinutes).toBe(2310);
    expect(s.deltaMinutes).toBe(240 - 2310);
  });

  it('scales the month target by weekdays', () => {
    const s = monthSummary(entries, '2026-09', 40);
    expect(s.targetMinutes).toBe(Math.round((40 * 60 * 22) / 5));
    expect(s.totals.netMinutes).toBe(480 + 540 + 240);
    expect(s.deltaMinutes).toBe(1260 - 10560);
  });
});
