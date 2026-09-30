import { describe, expect, it } from 'vitest';
import { breakWarning, legalMinimumBreak } from '../../src/domain/breaks';
import type { Entry } from '../../src/domain/types';

const entry = (over: Partial<Entry> = {}): Entry => ({
  date: '2026-09-30',
  start: '08:00',
  end: '15:00',
  breakMinutes: 30,
  updatedAt: '2026-09-30T00:00:00.000Z',
  ...over,
});

describe('legalMinimumBreak', () => {
  it.each([
    [0, 0],
    [360, 0],
    [361, 30],
    [540, 30],
    [541, 45],
    [720, 45],
  ])('%i minutes attendance → %i minutes break', (attendance, required) => {
    expect(legalMinimumBreak(attendance)).toBe(required);
  });
});

describe('breakWarning', () => {
  it('warns when a >6h day has less than 30 minutes', () => {
    expect(breakWarning(entry({ breakMinutes: 15 }))).toEqual({
      requiredMinutes: 30,
      actualMinutes: 15,
    });
  });

  it('is silent when the break is sufficient', () => {
    expect(breakWarning(entry())).toBeNull();
    expect(breakWarning(entry({ end: '14:00', breakMinutes: 0 }))).toBeNull();
  });

  it('warns when a >9h day has less than 45 minutes', () => {
    expect(breakWarning(entry({ end: '18:00' }))).toEqual({
      requiredMinutes: 45,
      actualMinutes: 30,
    });
  });

  it('uses real elapsed time across midnight', () => {
    expect(breakWarning(entry({ start: '22:00', end: '06:00', breakMinutes: 0 }))).toEqual({
      requiredMinutes: 30,
      actualMinutes: 0,
    });
  });

  it('ignores open entries', () => {
    expect(breakWarning(entry({ end: null, breakMinutes: 0 }))).toBeNull();
  });
});
