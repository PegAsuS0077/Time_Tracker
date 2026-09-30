import { describe, expect, it } from 'vitest';
import {
  activeEntries,
  computeEntry,
  endDay,
  findEntry,
  findOpenEntry,
  isStaleOpen,
  markDeleted,
  openProgress,
  recentlyDeleted,
  restoreDeleted,
  startDay,
} from '../../src/domain/entries';
import type { Entry } from '../../src/domain/types';

const at = (iso: string): number => Date.parse(iso);
const TS = '2026-09-30T00:00:00.000Z';

const entry = (over: Partial<Entry> = {}): Entry => ({
  date: '2026-09-30',
  start: '08:00',
  end: '16:30',
  breakMinutes: 30,
  updatedAt: TS,
  ...over,
});

describe('computeEntry', () => {
  it('computes gross and net minutes', () => {
    expect(computeEntry(entry())).toEqual({ kind: 'closed', grossMinutes: 510, netMinutes: 480 });
  });

  it('clamps net at zero when the break exceeds the attendance', () => {
    expect(computeEntry(entry({ end: '08:20' }))).toEqual({
      kind: 'closed',
      grossMinutes: 20,
      netMinutes: 0,
    });
  });

  it('handles overnight shifts', () => {
    expect(computeEntry(entry({ start: '22:00', end: '06:00', breakMinutes: 45 }))).toEqual({
      kind: 'closed',
      grossMinutes: 480,
      netMinutes: 435,
    });
  });

  it('reports open entries', () => {
    expect(computeEntry(entry({ end: null }))).toEqual({ kind: 'open' });
  });

  it('reports invalid entries instead of throwing', () => {
    expect(computeEntry(entry({ date: '2026-03-29', start: '02:30' }))).toEqual({
      kind: 'invalid',
      error: 'nonexistent',
    });
  });
});

describe('openProgress / isStaleOpen', () => {
  const open = entry({ end: null });

  it('reports elapsed and net-so-far', () => {
    // 10:00 Berlin
    expect(openProgress(open, at('2026-09-30T08:00:00Z'))).toEqual({
      elapsedSeconds: 7200,
      elapsedMinutes: 120,
      netMinutes: 90,
    });
    expect(openProgress(open, at('2026-09-30T06:10:00Z'))).toEqual({
      elapsedSeconds: 600,
      elapsedMinutes: 10,
      netMinutes: 0,
    });
  });

  it('is null for closed or invalid entries', () => {
    expect(openProgress(entry(), at('2026-09-30T08:00:00Z'))).toBeNull();
    expect(
      openProgress(entry({ date: '2026-03-29', start: '02:30', end: null }), at(TS)),
    ).toBeNull();
  });

  it('flags entries open for more than 16 hours', () => {
    expect(isStaleOpen(open, at('2026-09-30T22:00:00Z'))).toBe(false);
    expect(isStaleOpen(open, at('2026-09-30T22:01:00Z'))).toBe(true);
    expect(isStaleOpen(entry(), at('2026-10-05T00:00:00Z'))).toBe(false);
  });
});

describe('lookups', () => {
  const entries = [
    entry({ date: '2026-09-28', end: null }),
    entry({ date: '2026-09-29', end: null }),
    entry({ date: '2026-09-30', end: null, deletedAt: TS }),
  ];

  it('ignores tombstones', () => {
    expect(activeEntries(entries)).toHaveLength(2);
    expect(findEntry(entries, '2026-09-30')).toBeUndefined();
  });

  it('finds the most recent open entry', () => {
    expect(findOpenEntry(entries)?.date).toBe('2026-09-29');
    expect(findOpenEntry([entry()])).toBeUndefined();
  });
});

describe('startDay', () => {
  const now = at('2026-09-30T06:15:00Z'); // 08:15 Berlin

  it('stamps the Berlin date and time with the default break', () => {
    expect(startDay([], now, 30)).toEqual({
      ok: true,
      value: {
        date: '2026-09-30',
        start: '08:15',
        end: null,
        breakMinutes: 30,
        updatedAt: '2026-09-30T06:15:00.000Z',
      },
    });
  });

  it('uses the Berlin date even when UTC is still the previous day', () => {
    const result = startDay([], at('2026-09-29T22:30:00Z'), 0);
    expect(result.ok && result.value.date).toBe('2026-09-30');
    expect(result.ok && result.value.start).toBe('00:30');
  });

  it('refuses when today already has an entry', () => {
    expect(startDay([entry()], now, 30)).toEqual({ ok: false, error: 'already-exists' });
  });

  it('allows starting over a deleted entry', () => {
    expect(startDay([entry({ deletedAt: TS })], now, 30).ok).toBe(true);
  });

  it('refuses while another day is still open', () => {
    expect(startDay([entry({ date: '2026-09-29', end: null })], now, 30)).toEqual({
      ok: false,
      error: 'other-open',
    });
  });
});

describe('endDay', () => {
  it('stamps the end time on the same day', () => {
    const result = endDay(entry({ end: null }), at('2026-09-30T14:45:00Z'));
    expect(result).toEqual({
      ok: true,
      value: entry({ end: '16:45', updatedAt: '2026-09-30T14:45:00.000Z' }),
    });
  });

  it('ends an overnight shift on the next morning', () => {
    const night = entry({ date: '2026-09-29', start: '22:00', end: null });
    const result = endDay(night, at('2026-09-30T04:00:00Z')); // 06:00 Berlin
    expect(result.ok && result.value.end).toBe('06:00');
    expect(result.ok && computeEntry(result.value)).toEqual({
      kind: 'closed',
      grossMinutes: 480,
      netMinutes: 450,
    });
  });

  it('refuses shifts of 24 hours or more', () => {
    const open = entry({ date: '2026-09-29', start: '08:00', end: null });
    expect(endDay(open, at('2026-09-30T06:30:00Z'))).toEqual({ ok: false, error: 'too-long' });
    expect(endDay(open, at('2026-10-02T06:30:00Z'))).toEqual({ ok: false, error: 'too-long' });
  });

  it('refuses a zero-length day', () => {
    expect(endDay(entry({ end: null }), at('2026-09-30T06:00:30Z'))).toEqual({
      ok: false,
      error: 'zero-length',
    });
  });

  it('refuses entries that are not open', () => {
    expect(endDay(entry(), at('2026-09-30T14:00:00Z'))).toEqual({ ok: false, error: 'not-open' });
  });
});

describe('markDeleted', () => {
  it('sets deletedAt and updatedAt to the same instant', () => {
    const deleted = markDeleted(entry(), at('2026-10-01T10:00:00Z'));
    expect(deleted.deletedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(deleted.updatedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(deleted.start).toBe('08:00');
  });
});

describe('restoreDeleted / recentlyDeleted', () => {
  it('removes the tombstone and re-stamps updatedAt', () => {
    const restored = restoreDeleted(
      entry({ deletedAt: TS, updatedAt: TS, note: 'kept' }),
      at('2026-10-01T10:00:00Z'),
    );
    expect(restored).toEqual(entry({ note: 'kept', updatedAt: '2026-10-01T10:00:00.000Z' }));
    expect('deletedAt' in restored).toBe(false);
  });

  it('lists deletions from the last 30 days, newest first', () => {
    const now = at('2026-10-10T12:00:00Z');
    const list = recentlyDeleted(
      [
        entry({ date: '2026-09-01', deletedAt: '2026-09-05T10:00:00.000Z' }),
        entry({ date: '2026-09-28', deletedAt: '2026-10-01T10:00:00.000Z' }),
        entry({ date: '2026-09-29', deletedAt: '2026-10-09T10:00:00.000Z' }),
        entry({ date: '2026-09-30' }),
      ],
      now,
    );
    expect(list.map((e) => e.date)).toEqual(['2026-09-29', '2026-09-28']);
  });
});
