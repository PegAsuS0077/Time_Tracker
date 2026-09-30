import { describe, expect, it } from 'vitest';
import { progress, timeline } from '../../src/domain/timeline';
import type { Entry } from '../../src/domain/types';
import { monthDates, weekDates } from '../../src/domain/week';

const TS = '2026-09-29T10:00:00.000Z';
const e = (date: string, start: string, end: string | null, breakMinutes = 30): Entry => ({
  date,
  start,
  end,
  breakMinutes,
  updatedAt: TS,
});
const NOW = Date.parse('2026-09-30T08:00:00Z'); // Wed 10:00 Berlin
const W40 = weekDates('2026-W40');

describe('timeline', () => {
  it('has a row per date and a default 07–19 axis', () => {
    const t = timeline([e('2026-09-28', '08:00', '16:30')], W40, NOW);
    expect(t.rows).toHaveLength(7);
    expect(t.axisStart).toBe(7 * 60);
    expect(t.axisEnd).toBe(19 * 60);
    expect(t.rows[0]).toMatchObject({
      startMin: 480,
      endMin: 990,
      running: false,
      netMinutes: 480,
    });
    expect(t.rows[1]).toMatchObject({ startMin: null, endMin: null, netMinutes: null });
  });

  it('extends the axis for early starts, up to midnight', () => {
    const t = timeline(
      [e('2026-09-28', '05:30', '12:00'), e('2026-09-29', '22:00', '06:00')],
      W40,
      NOW,
    );
    expect(t.axisStart).toBe(5 * 60);
    // Capped at midnight so a night shift does not squash the other days.
    expect(t.axisEnd).toBe(24 * 60);
    expect(t.rows[1]).toMatchObject({
      startMin: 1320,
      endMin: 1800,
      overnight: true,
      netMinutes: 450,
    });
    expect(t.rows[0]?.overnight).toBe(false);
  });

  it('grows a running day up to now', () => {
    const t = timeline([e('2026-09-30', '08:00', null)], W40, NOW);
    expect(t.rows[2]).toMatchObject({ startMin: 480, endMin: 600, running: true, netMinutes: 90 });
  });

  it('ignores deleted entries', () => {
    const t = timeline([{ ...e('2026-09-28', '08:00', '16:00'), deletedAt: TS }], W40, NOW);
    expect(t.rows[0]?.entry).toBeUndefined();
  });
});

describe('progress', () => {
  const week = [
    e('2026-09-28', '08:00', '16:30'), // 480
    e('2026-09-29', '08:00', '17:00'), // 510
    e('2026-09-30', '08:00', null), // running, 90 at NOW
  ];

  it('counts only finished workdays toward the target to date', () => {
    const p = progress(week, W40, '2026-09-30', NOW, 40);
    expect(p).toEqual({
      closedMinutes: 990,
      runningMinutes: 90,
      targetMinutes: 2400,
      targetToDateMinutes: 960,
      deltaToDateMinutes: 30,
      countedThrough: '2026-09-29',
    });
  });

  it('includes today once it has ended', () => {
    const done = [...week.slice(0, 2), e('2026-09-30', '08:00', '12:00', 0)];
    const p = progress(done, W40, '2026-09-30', NOW, 40);
    expect(p.targetToDateMinutes).toBe(1440);
    expect(p.deltaToDateMinutes).toBe(990 + 240 - 1440);
    expect(p.countedThrough).toBe('2026-09-30');
  });

  it('counts weekend work as net but never as target', () => {
    const p = progress([e('2026-10-03', '10:00', '12:00', 0)], W40, '2026-10-04', NOW, 40);
    expect(p.closedMinutes).toBe(120);
    expect(p.targetToDateMinutes).toBe(2400);
    expect(p.countedThrough).toBe('2026-10-02');
  });

  it('has no target on Monday morning', () => {
    const p = progress([], W40, '2026-09-28', NOW, 40);
    expect(p.targetToDateMinutes).toBe(0);
    expect(p.countedThrough).toBeNull();
  });

  it('works for months and without a contract', () => {
    const month = progress(week, monthDates('2026-09'), '2026-09-30', NOW, 40);
    expect(month.targetMinutes).toBe(22 * 480);
    expect(month.targetToDateMinutes).toBe(21 * 480);
    const none = progress(week, W40, '2026-09-30', NOW, null);
    expect(none.targetMinutes).toBeNull();
    expect(none.deltaToDateMinutes).toBeNull();
    expect(none.closedMinutes).toBe(990);
  });
});
