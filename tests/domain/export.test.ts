import { describe, expect, it } from 'vitest';
import { createBackup, parseBackup } from '../../src/domain/backup';
import { entriesToCsv, escapeCsvField } from '../../src/domain/csv';
import { DEFAULT_SETTINGS, type Entry } from '../../src/domain/types';

const TS = '2026-09-30T10:00:00.000Z';
const e = (date: string, over: Partial<Entry> = {}): Entry => ({
  date,
  start: '08:00',
  end: '16:30',
  breakMinutes: 30,
  updatedAt: TS,
  ...over,
});

describe('escapeCsvField', () => {
  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+49 123', "'+49 123"],
    ['-cmd', "'-cmd"],
    ['@here', "'@here"],
    ['=1,2', `"'=1,2"`],
    ['', ''],
  ])('%j → %j', (input, output) => {
    expect(escapeCsvField(input)).toBe(output);
  });
});

describe('entriesToCsv', () => {
  it('exports active entries sorted by date with a BOM and CRLF', () => {
    const csv = entriesToCsv([
      e('2026-09-30', { end: null }),
      e('2026-09-28', { note: 'Café, "late"' }),
      e('2026-09-29', { deletedAt: TS }),
      e('2026-10-04', { start: '22:00', end: '06:00' }),
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'week,date,weekday,start,end,break_minutes,net_minutes,net_hours,note',
      '2026-W40,2026-09-28,Mon,08:00,16:30,30,480,8.00,"Café, ""late"""',
      '2026-W40,2026-09-30,Wed,08:00,,30,,,',
      '2026-W40,2026-10-04,Sun,22:00,06:00,30,450,7.50,',
      '',
    ]);
  });

  it('exports just the header when empty', () => {
    expect(entriesToCsv([])).toBe(
      '﻿week,date,weekday,start,end,break_minutes,net_minutes,net_hours,note\r\n',
    );
  });
});

describe('backup', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    contractedWeeklyHours: 39,
    sync: { ...DEFAULT_SETTINGS.sync, token: 'github_pat_SECRET', owner: 'me' },
  };

  it('never includes the token or sync settings', () => {
    const json = createBackup([e('2026-09-30')], settings, Date.parse(TS));
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('sync');
  });

  it('round-trips entries (including tombstones) and preferences', () => {
    const entries = [e('2026-09-30'), e('2026-09-29', { deletedAt: TS, note: 'x' })];
    const parsed = parseBackup(createBackup(entries, settings, Date.parse(TS)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.entries).toEqual([entries[1], entries[0]]);
    expect(parsed.value.preferences).toEqual({
      defaultBreakMinutes: 30,
      legalBreakWarning: true,
      contractedWeeklyHours: 39,
      use24h: true,
    });
    expect(parsed.value.invalid).toBe(0);
  });

  it('skips invalid entries and counts them', () => {
    const text = JSON.stringify({
      format: 'time-tracker-backup',
      version: 1,
      entries: [e('2026-09-30'), { date: 'garbage' }, 42],
      preferences: { defaultBreakMinutes: -1 },
    });
    const parsed = parseBackup(text);
    expect(parsed.ok && parsed.value.entries).toHaveLength(1);
    expect(parsed.ok && parsed.value.invalid).toBe(2);
    expect(parsed.ok && parsed.value.preferences).toBeNull();
  });

  it.each([
    ['not json', '{', /not valid JSON/],
    [
      'wrong format',
      JSON.stringify({ format: 'x', version: 1, entries: [] }),
      /not a Time Tracker/,
    ],
    [
      'future version',
      JSON.stringify({ format: 'time-tracker-backup', version: 2, entries: [] }),
      /Unsupported backup version 2/,
    ],
    [
      'missing entries',
      JSON.stringify({ format: 'time-tracker-backup', version: 1 }),
      /no entries/,
    ],
    ['array', '[]', /not a Time Tracker/],
    ['null', 'null', /not a backup/],
  ])('rejects %s', (_label, text, message) => {
    const parsed = parseBackup(text);
    expect(!parsed.ok && parsed.error).toMatch(message);
  });
});
