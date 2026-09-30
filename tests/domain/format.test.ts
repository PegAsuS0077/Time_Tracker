import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDateLong,
  formatDateShort,
  formatDuration,
  formatHoursDecimal,
  formatMonth,
  formatSignedDuration,
  formatTime,
  formatWeekRange,
  weekdayShort,
} from '../../src/domain/format';

describe('durations', () => {
  it('formats h:mm', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(450)).toBe('7:30');
    expect(formatDuration(6000)).toBe('100:00');
    expect(formatDuration(-15)).toBe('−0:15');
  });

  it('formats signed durations', () => {
    expect(formatSignedDuration(90)).toBe('+1:30');
    expect(formatSignedDuration(-15)).toBe('−0:15');
    expect(formatSignedDuration(0)).toBe('0:00');
  });

  it('formats the running clock', () => {
    expect(formatClock(0)).toBe('0:00:00');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('0:00:00');
  });

  it('formats decimal hours', () => {
    expect(formatHoursDecimal(450)).toBe('7.50');
    expect(formatHoursDecimal(20)).toBe('0.33');
  });
});

describe('formatTime', () => {
  it('keeps 24h times', () => {
    expect(formatTime('08:05', true)).toBe('08:05');
  });

  it('converts to 12h', () => {
    expect(formatTime('00:30', false)).toBe('12:30 AM');
    expect(formatTime('08:05', false)).toBe('8:05 AM');
    expect(formatTime('12:00', false)).toBe('12:00 PM');
    expect(formatTime('23:59', false)).toBe('11:59 PM');
  });
});

describe('dates', () => {
  it('formats weekdays and dates', () => {
    expect(weekdayShort('2026-09-30')).toBe('Wed');
    expect(formatDateShort('2026-09-30')).toBe('Wed 30 Sep');
    expect(formatDateLong('2026-09-30')).toBe('Wed 30 Sep 2026');
  });

  it('formats week ranges within and across years', () => {
    expect(formatWeekRange('2026-W40')).toBe('28 Sep – 4 Oct 2026');
    expect(formatWeekRange('2026-W53')).toBe('28 Dec 2026 – 3 Jan 2027');
  });

  it('formats months', () => {
    expect(formatMonth('2026-09')).toBe('September 2026');
  });
});
