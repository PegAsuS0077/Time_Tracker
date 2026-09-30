import { describe, expect, it } from 'vitest';
import {
  cleanNote,
  parseEntry,
  validateEntryInput,
  type EntryInput,
} from '../../src/domain/validate';

const TS = '2026-09-30T12:00:00.000Z';
const input = (over: Partial<EntryInput> = {}): EntryInput => ({
  date: '2026-09-30',
  start: '08:00',
  end: '16:30',
  breakMinutes: '30',
  note: '',
  ...over,
});

describe('validateEntryInput', () => {
  it('builds a closed entry', () => {
    expect(validateEntryInput(input({ note: '  standup  ' }), TS)).toEqual({
      ok: true,
      value: {
        date: '2026-09-30',
        start: '08:00',
        end: '16:30',
        breakMinutes: 30,
        note: 'standup',
        updatedAt: TS,
      },
    });
  });

  it('builds an open entry when end is empty', () => {
    const result = validateEntryInput(input({ end: ' ' }), TS);
    expect(result.ok && result.value.end).toBeNull();
    expect(result.ok && 'note' in result.value).toBe(false);
  });

  it('accepts overnight shifts', () => {
    expect(validateEntryInput(input({ start: '22:00', end: '06:00' }), TS).ok).toBe(true);
  });

  it('accepts a numeric break', () => {
    expect(validateEntryInput(input({ breakMinutes: 0 }), TS).ok).toBe(true);
  });

  it('reports every invalid field', () => {
    const result = validateEntryInput(
      { date: '2026-02-30', start: '8', end: 'x', breakMinutes: 'abc', note: 'a'.repeat(501) },
      TS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.error).sort()).toEqual([
        'breakMinutes',
        'date',
        'end',
        'note',
        'start',
      ]);
    }
  });

  it.each(['-5', '1.5', '1441', ''])('rejects break %j', (breakMinutes) => {
    const result = validateEntryInput(input({ breakMinutes }), TS);
    expect(!result.ok && result.error.breakMinutes).toBeTruthy();
  });

  it('rejects equal start and end', () => {
    const result = validateEntryInput(input({ end: '08:00' }), TS);
    expect(!result.ok && result.error.end).toMatch(/differ/);
  });

  it('rejects a break as long as the shift', () => {
    const result = validateEntryInput(input({ end: '08:30', breakMinutes: '30' }), TS);
    expect(!result.ok && result.error.breakMinutes).toMatch(/shorter/);
  });

  it('rejects times skipped by DST', () => {
    const start = validateEntryInput(input({ date: '2026-03-29', start: '02:15' }), TS);
    expect(!start.ok && start.error.start).toMatch(/does not exist/);
    const end = validateEntryInput(input({ date: '2026-03-28', start: '23:00', end: '02:15' }), TS);
    expect(!end.ok && end.error.end).toMatch(/does not exist/);
  });
});

describe('cleanNote', () => {
  it('strips control characters but keeps newlines and tabs', () => {
    expect(cleanNote('a\u0000b\u0007c\nd\te\u007f')).toBe('abc\nd\te');
  });

  it('keeps markup as plain text (escaping happens at render time)', () => {
    expect(cleanNote('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('parseEntry', () => {
  const good = {
    date: '2026-09-30',
    start: '08:00',
    end: '16:30',
    breakMinutes: 30,
    note: 'ok',
    updatedAt: TS,
  };

  it('accepts a well-formed entry and drops unknown fields', () => {
    expect(parseEntry({ ...good, extra: 'x', __proto__: { evil: 1 } })).toEqual(good);
  });

  it('accepts open entries and tombstones', () => {
    expect(parseEntry({ ...good, end: null })?.end).toBeNull();
    expect(parseEntry({ ...good, deletedAt: TS })?.deletedAt).toBe(TS);
  });

  it.each([
    ['null', null],
    ['string', 'x'],
    ['bad date', { ...good, date: '2026-13-01' }],
    ['bad start', { ...good, start: '8:00' }],
    ['missing end', { ...good, end: undefined }],
    ['float break', { ...good, breakMinutes: 1.5 }],
    ['negative break', { ...good, breakMinutes: -1 }],
    ['string break', { ...good, breakMinutes: '30' }],
    ['numeric note', { ...good, note: 5 }],
    ['bad updatedAt', { ...good, updatedAt: 'yesterday' }],
    ['bad deletedAt', { ...good, deletedAt: 1 }],
  ])('rejects %s', (_label, value) => {
    expect(parseEntry(value)).toBeNull();
  });

  it('truncates overly long notes', () => {
    expect(parseEntry({ ...good, note: 'x'.repeat(600) })?.note).toHaveLength(500);
  });
});
