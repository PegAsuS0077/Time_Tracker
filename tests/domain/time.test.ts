import { describe, expect, it } from 'vitest';
import {
  addDays,
  berlinDateTime,
  berlinOffsetMinutes,
  berlinToEpoch,
  daysBetween,
  elapsedMinutes,
  elapsedSince,
  endsNextDay,
  isValidDate,
  isValidTime,
  timeToMinutes,
  weekdayIndex,
} from '../../src/domain/time';

const at = (iso: string): number => Date.parse(iso);

describe('test environment', () => {
  it('runs in a non-Berlin device timezone, proving TZ independence', () => {
    expect(new Date(at('2026-01-15T12:00:00Z')).getTimezoneOffset()).toBe(300);
  });
});

describe('berlinDateTime', () => {
  it('converts summer instants (UTC+2)', () => {
    expect(berlinDateTime(at('2026-09-30T06:15:00Z'))).toEqual({
      date: '2026-09-30',
      time: '08:15',
    });
  });

  it('converts winter instants (UTC+1) across midnight', () => {
    expect(berlinDateTime(at('2026-01-15T23:30:00Z'))).toEqual({
      date: '2026-01-16',
      time: '00:30',
    });
  });

  it('reports midnight as 00:00', () => {
    expect(berlinDateTime(at('2026-09-29T22:00:00Z'))).toEqual({
      date: '2026-09-30',
      time: '00:00',
    });
  });
});

describe('berlinOffsetMinutes', () => {
  it('is 60 in winter and 120 in summer', () => {
    expect(berlinOffsetMinutes(at('2026-01-15T12:00:00Z'))).toBe(60);
    expect(berlinOffsetMinutes(at('2026-07-15T12:00:00Z'))).toBe(120);
  });

  it('switches exactly at the transition instants', () => {
    expect(berlinOffsetMinutes(at('2026-03-29T00:59:59Z'))).toBe(60);
    expect(berlinOffsetMinutes(at('2026-03-29T01:00:00Z'))).toBe(120);
    expect(berlinOffsetMinutes(at('2026-10-25T00:59:59Z'))).toBe(120);
    expect(berlinOffsetMinutes(at('2026-10-25T01:00:00Z'))).toBe(60);
  });
});

describe('berlinToEpoch', () => {
  it('converts ordinary times', () => {
    expect(berlinToEpoch('2026-09-30', '08:15')).toEqual({
      ok: true,
      value: at('2026-09-30T06:15:00Z'),
    });
    expect(berlinToEpoch('2026-01-15', '08:15')).toEqual({
      ok: true,
      value: at('2026-01-15T07:15:00Z'),
    });
  });

  it('rejects times skipped by spring-forward (2026-03-29 02:00–02:59)', () => {
    expect(berlinToEpoch('2026-03-29', '02:00')).toEqual({ ok: false, error: 'nonexistent' });
    expect(berlinToEpoch('2026-03-29', '02:30')).toEqual({ ok: false, error: 'nonexistent' });
    expect(berlinToEpoch('2026-03-29', '02:59')).toEqual({ ok: false, error: 'nonexistent' });
  });

  it('accepts the times around spring-forward', () => {
    expect(berlinToEpoch('2026-03-29', '01:59')).toEqual({
      ok: true,
      value: at('2026-03-29T00:59:00Z'),
    });
    expect(berlinToEpoch('2026-03-29', '03:00')).toEqual({
      ok: true,
      value: at('2026-03-29T01:00:00Z'),
    });
  });

  it('resolves ambiguous fall-back times to the first occurrence', () => {
    expect(berlinToEpoch('2026-10-25', '02:30')).toEqual({
      ok: true,
      value: at('2026-10-25T00:30:00Z'),
    });
    expect(berlinToEpoch('2026-10-25', '03:00')).toEqual({
      ok: true,
      value: at('2026-10-25T02:00:00Z'),
    });
  });

  it('rejects malformed input', () => {
    expect(berlinToEpoch('2026-02-30', '08:00')).toEqual({ ok: false, error: 'invalid' });
    expect(berlinToEpoch('2026-09-30', '8:00')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('elapsedMinutes', () => {
  it('computes a normal day', () => {
    expect(elapsedMinutes('2026-09-30', '08:00', '16:30')).toEqual({ ok: true, value: 510 });
  });

  it('treats end < start as crossing midnight', () => {
    expect(elapsedMinutes('2026-09-30', '22:00', '02:00')).toEqual({ ok: true, value: 240 });
    expect(elapsedMinutes('2026-09-30', '23:30', '00:15')).toEqual({ ok: true, value: 45 });
    expect(elapsedMinutes('2026-09-30', '00:01', '00:00')).toEqual({ ok: true, value: 1439 });
  });

  it('crosses month and year boundaries', () => {
    expect(elapsedMinutes('2026-12-31', '22:00', '01:00')).toEqual({ ok: true, value: 180 });
    expect(elapsedMinutes('2026-02-28', '22:00', '06:00')).toEqual({ ok: true, value: 480 });
  });

  it('keeps day shifts unchanged on DST days', () => {
    expect(elapsedMinutes('2026-03-29', '08:00', '17:00')).toEqual({ ok: true, value: 540 });
    expect(elapsedMinutes('2026-10-25', '08:00', '17:00')).toEqual({ ok: true, value: 540 });
  });

  it('loses an hour for night shifts over spring-forward', () => {
    expect(elapsedMinutes('2026-03-28', '22:00', '06:00')).toEqual({ ok: true, value: 420 });
    expect(elapsedMinutes('2026-03-29', '01:00', '04:00')).toEqual({ ok: true, value: 120 });
  });

  it('gains an hour for night shifts over fall-back', () => {
    expect(elapsedMinutes('2026-10-24', '22:00', '06:00')).toEqual({ ok: true, value: 540 });
    expect(elapsedMinutes('2026-10-25', '01:00', '04:00')).toEqual({ ok: true, value: 240 });
  });

  it('rejects an end time that does not exist', () => {
    expect(elapsedMinutes('2026-03-28', '23:00', '02:30')).toEqual({
      ok: false,
      error: 'nonexistent',
    });
  });

  it('rejects zero-length and invalid intervals', () => {
    expect(elapsedMinutes('2026-09-30', '08:00', '08:00')).toEqual({
      ok: false,
      error: 'zero-length',
    });
    expect(elapsedMinutes('2026-09-30', '08:00', '25:00')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('elapsedSince', () => {
  it('counts whole minutes since start and never goes negative', () => {
    expect(elapsedSince('2026-09-30', '08:00', at('2026-09-30T08:30:59Z'))).toBe(150);
    expect(elapsedSince('2026-09-30', '08:00', at('2026-09-30T05:00:00Z'))).toBe(0);
  });

  it('returns null for a nonexistent start', () => {
    expect(elapsedSince('2026-03-29', '02:30', at('2026-03-29T05:00:00Z'))).toBeNull();
  });
});

describe('calendar helpers', () => {
  it('validates dates including leap years', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-9-30')).toBe(false);
    expect(isValidDate('1969-12-31')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });

  it('validates times', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('7:00')).toBe(false);
    expect(isValidTime('07:60')).toBe(false);
  });

  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-09-28', '2026-10-04')).toBe(6);
    expect(daysBetween('2026-10-04', '2026-09-28')).toBe(-6);
  });

  it('indexes weekdays from Monday', () => {
    expect(weekdayIndex('2026-09-28')).toBe(0);
    expect(weekdayIndex('2026-09-30')).toBe(2);
    expect(weekdayIndex('2026-10-04')).toBe(6);
  });

  it('parses and compares times', () => {
    expect(timeToMinutes('08:30')).toBe(510);
    expect(endsNextDay('22:00', '06:00')).toBe(true);
    expect(endsNextDay('08:00', '16:00')).toBe(false);
  });
});
