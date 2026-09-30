import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/domain/time';
import {
  isoWeek,
  monthDates,
  monthKey,
  parseWeekKey,
  shortWeekLabel,
  weekDates,
  weekKey,
  weekStart,
  weekdaysInMonth,
  weeksInYear,
} from '../../src/domain/week';

describe('weekKey', () => {
  it.each([
    ['2026-09-30', '2026-W40'],
    ['2026-09-28', '2026-W40'],
    ['2026-10-04', '2026-W40'],
    ['2026-10-05', '2026-W41'],
    // Week 1 starting in the previous year
    ['2025-12-29', '2026-W01'],
    ['2026-01-01', '2026-W01'],
    ['2024-12-30', '2025-W01'],
    // Week 53
    ['2026-12-31', '2026-W53'],
    ['2027-01-01', '2026-W53'],
    ['2027-01-03', '2026-W53'],
    ['2027-01-04', '2027-W01'],
    ['2020-12-31', '2020-W53'],
    ['2021-01-03', '2020-W53'],
    // Week 52 spilling into the next year
    ['2023-01-01', '2022-W52'],
    ['2022-01-02', '2021-W52'],
  ])('%s → %s', (date, key) => {
    expect(weekKey(date)).toBe(key);
  });

  it('agrees with weekDates for every day from 2019 to 2028', () => {
    let date = '2019-01-01';
    while (date < '2029-01-01') {
      const key = weekKey(date);
      const dates = weekDates(key);
      expect(dates).toContain(date);
      expect(dates).toHaveLength(7);
      date = addDays(date, 1);
    }
  });
});

describe('isoWeek / weeksInYear', () => {
  it('returns year and week numbers', () => {
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
  });

  it('knows which years have 53 weeks', () => {
    expect(weeksInYear(2015)).toBe(53);
    expect(weeksInYear(2020)).toBe(53);
    expect(weeksInYear(2025)).toBe(52);
    expect(weeksInYear(2026)).toBe(53);
    expect(weeksInYear(2027)).toBe(52);
  });
});

describe('parseWeekKey / weekStart / weekDates', () => {
  it('parses valid keys and rejects invalid ones', () => {
    expect(parseWeekKey('2026-W53')).toEqual({ year: 2026, week: 53 });
    expect(parseWeekKey('2025-W53')).toBeNull();
    expect(parseWeekKey('2026-W00')).toBeNull();
    expect(parseWeekKey('2026-W1')).toBeNull();
    expect(parseWeekKey('nonsense')).toBeNull();
  });

  it('finds the Monday of a week', () => {
    expect(weekStart('2026-W40')).toBe('2026-09-28');
    expect(weekStart('2026-W01')).toBe('2025-12-29');
    expect(weekStart('2026-W53')).toBe('2026-12-28');
    expect(weekStart('2025-W01')).toBe('2024-12-30');
  });

  it('throws on an invalid key', () => {
    expect(() => weekStart('2025-W53')).toThrow(RangeError);
  });

  it('lists Monday to Sunday', () => {
    expect(weekDates('2026-W53')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });

  it('shortens keys for commit messages', () => {
    expect(shortWeekLabel('2026-W40')).toBe('W40');
  });
});

describe('months', () => {
  it('derives month keys and dates', () => {
    expect(monthKey('2026-09-30')).toBe('2026-09');
    expect(monthDates('2024-02')).toHaveLength(29);
    expect(monthDates('2026-02')).toHaveLength(28);
    expect(monthDates('2026-09').at(-1)).toBe('2026-09-30');
  });

  it('counts weekdays in a month', () => {
    expect(weekdaysInMonth('2026-09')).toBe(22);
    expect(weekdaysInMonth('2026-02')).toBe(20);
    expect(weekdaysInMonth('2026-08')).toBe(21);
  });
});
