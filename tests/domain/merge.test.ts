import { describe, expect, it } from 'vitest';
import { commitMessage, describeChanges } from '../../src/domain/commitMessage';
import { planImport, sameContent, threeWayMerge } from '../../src/domain/merge';
import type { Entry } from '../../src/domain/types';

const e = (date: string, over: Partial<Entry> = {}): Entry => ({
  date,
  start: '08:00',
  end: '16:00',
  breakMinutes: 30,
  updatedAt: '2026-09-30T10:00:00.000Z',
  ...over,
});
const LATER = '2026-09-30T11:00:00.000Z';
const EARLIER = '2026-09-30T09:00:00.000Z';

describe('sameContent', () => {
  it('ignores updatedAt but not content', () => {
    expect(sameContent(e('2026-09-30'), e('2026-09-30', { updatedAt: LATER }))).toBe(true);
    expect(sameContent(e('2026-09-30'), e('2026-09-30', { end: '17:00' }))).toBe(false);
    expect(sameContent(e('2026-09-30'), e('2026-09-30', { note: '' }))).toBe(true);
    expect(sameContent(e('2026-09-30'), e('2026-09-30', { deletedAt: LATER }))).toBe(false);
    expect(sameContent(undefined, undefined)).toBe(true);
    expect(sameContent(e('2026-09-30'), undefined)).toBe(false);
  });
});

describe('planImport', () => {
  it('adds new, updates newer, skips older and counts unchanged', () => {
    const existing = [e('2026-09-28'), e('2026-09-29'), e('2026-09-30')];
    const incoming = [
      e('2026-09-27'),
      e('2026-09-28', { end: '17:00', updatedAt: LATER }),
      e('2026-09-29', { end: '17:00', updatedAt: EARLIER }),
      e('2026-09-30', { updatedAt: LATER }),
    ];
    const plan = planImport(existing, incoming);
    expect(plan).toMatchObject({ added: 1, updated: 1, unchanged: 1, skipped: 1 });
    expect(plan.toWrite.map((x) => x.date)).toEqual(['2026-09-27', '2026-09-28']);
  });

  it('uses the newest duplicate within the import', () => {
    const plan = planImport(
      [],
      [
        e('2026-09-30', { end: '17:00', updatedAt: LATER }),
        e('2026-09-30', { updatedAt: EARLIER }),
      ],
    );
    expect(plan.added).toBe(1);
    expect(plan.toWrite[0]?.end).toBe('17:00');
  });
});

describe('threeWayMerge', () => {
  const base = [e('2026-09-28'), e('2026-09-29')];

  it('takes local-only changes', () => {
    const local = [e('2026-09-28', { end: '18:00', updatedAt: LATER }), e('2026-09-29')];
    const result = threeWayMerge(base, local, base);
    expect(result.conflicts).toEqual([]);
    expect(result.merged[0]?.end).toBe('18:00');
  });

  it('takes remote-only changes, including new days', () => {
    const remote = [...base, e('2026-09-30', { end: '12:00' })];
    const result = threeWayMerge(base, base, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.merged.map((x) => x.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
  });

  it('propagates a local tombstone', () => {
    const local = [e('2026-09-28', { deletedAt: LATER, updatedAt: LATER }), e('2026-09-29')];
    const result = threeWayMerge(base, local, base);
    expect(result.merged[0]?.deletedAt).toBe(LATER);
  });

  it('drops a day removed from the remote file by hand', () => {
    const result = threeWayMerge(base, base, [e('2026-09-29')]);
    expect(result.merged.map((x) => x.date)).toEqual(['2026-09-29']);
  });

  it('accepts identical changes on both sides without conflict', () => {
    const local = [e('2026-09-28', { end: '18:00', updatedAt: EARLIER }), e('2026-09-29')];
    const remote = [e('2026-09-28', { end: '18:00', updatedAt: LATER }), e('2026-09-29')];
    const result = threeWayMerge(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.merged[0]?.updatedAt).toBe(LATER);
  });

  it('reports a conflict when both sides changed the same day differently', () => {
    const local = [e('2026-09-28', { end: '18:00', updatedAt: LATER }), e('2026-09-29')];
    const remote = [e('2026-09-28', { end: '17:00', updatedAt: EARLIER }), e('2026-09-29')];
    const result = threeWayMerge(base, local, remote);
    expect(result.conflicts).toEqual([{ date: '2026-09-28', local: local[0], remote: remote[0] }]);
    expect(result.merged[0]?.end).toBe('18:00');
  });

  it('reports a conflict when both sides created the same day differently', () => {
    const result = threeWayMerge(
      [],
      [e('2026-09-30', { end: '17:00' })],
      [e('2026-09-30', { end: '18:00' })],
    );
    expect(result.conflicts).toHaveLength(1);
  });

  it('reports a conflict when one side deletes and the other edits', () => {
    const local = [e('2026-09-28', { deletedAt: LATER, updatedAt: LATER }), e('2026-09-29')];
    const remote = [e('2026-09-28', { end: '17:00' }), e('2026-09-29')];
    expect(threeWayMerge(base, local, remote).conflicts).toHaveLength(1);
  });
});

describe('commit messages', () => {
  it('describes updates and deletes', () => {
    const before = [e('2026-09-28'), e('2026-09-29'), e('2026-09-30')];
    const after = [
      e('2026-09-28', { end: '17:00' }),
      e('2026-09-29', { deletedAt: LATER }),
      e('2026-09-30', { updatedAt: LATER }),
      e('2026-10-01'),
    ];
    expect(describeChanges(before, after)).toEqual([
      { date: '2026-09-28', kind: 'update' },
      { date: '2026-09-29', kind: 'delete' },
      { date: '2026-10-01', kind: 'update' },
    ]);
  });

  it('formats a single update like the spec', () => {
    expect(commitMessage('2026-W40', [{ date: '2026-09-30', kind: 'update' }])).toBe(
      'W40: update Wed 2026-09-30',
    );
  });

  it('formats multiple and mixed changes', () => {
    expect(
      commitMessage('2026-W40', [
        { date: '2026-09-28', kind: 'update' },
        { date: '2026-09-30', kind: 'update' },
        { date: '2026-09-29', kind: 'delete' },
      ]),
    ).toBe('W40: update Mon 2026-09-28, Wed 2026-09-30; delete Tue 2026-09-29');
  });

  it('falls back to "sync" when nothing changed', () => {
    expect(commitMessage('2026-W40', [])).toBe('W40: sync');
  });
});
