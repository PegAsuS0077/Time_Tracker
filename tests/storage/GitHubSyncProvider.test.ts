import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Entry } from '../../src/domain/types';
import { GitHubError } from '../../src/storage/github/GitHubClient';
import { GitHubSyncProvider } from '../../src/storage/github/GitHubSyncProvider';
import { weekFilePath } from '../../src/storage/github/weekFile';
import { openTrackerDb, type TrackerDatabase } from '../../src/storage/idb';
import { LocalProvider } from '../../src/storage/LocalProvider';
import { FakeGitHub } from './FakeGitHub';

const W40 = '2026-W40';
const T0 = '2026-09-30T08:00:00.000Z';
const T1 = '2026-09-30T09:00:00.000Z';
const T2 = '2026-09-30T10:00:00.000Z';

const e = (date: string, over: Partial<Entry> = {}): Entry => ({
  date,
  start: '08:00',
  end: '16:00',
  breakMinutes: 30,
  updatedAt: T0,
  ...over,
});

let db: TrackerDatabase;
let github: FakeGitHub;
let online: boolean;
let counter = 0;

function provider(options: { allowPublicRepo?: boolean; target?: string } = {}) {
  return new GitHubSyncProvider(db, github, {
    target: options.target ?? 'me/data@main',
    allowPublicRepo: options.allowPublicRepo ?? false,
    now: () => Date.parse(T2),
    isOnline: () => online,
  });
}

beforeEach(async () => {
  counter += 1;
  db = await openTrackerDb(`sync-${counter}`);
  github = new FakeGitHub();
  online = true;
});

afterEach(() => {
  db.close();
});

describe('GitHubSyncProvider', () => {
  it('uploads existing local data on first sync', async () => {
    await new LocalProvider(db).save([e('2026-09-28'), e('2026-09-21')]);
    const report = await provider().sync();
    expect(report.state).toMatchObject({ status: 'idle', pending: 0 });
    expect([...github.files.keys()].sort()).toEqual(['2026/2026-W39.json', '2026/2026-W40.json']);
    expect(github.commits.map((c) => c.message)).toEqual([
      'W39: update Mon 2026-09-21',
      'W40: update Mon 2026-09-28',
    ]);
  });

  it('pushes a save with a descriptive commit message', async () => {
    const p = provider();
    await p.save([e('2026-09-30')]);
    expect((await p.sync()).state.pending).toBe(0);
    expect(github.commits.at(-1)?.message).toBe('W40: update Wed 2026-09-30');
    expect(github.remoteEntries(W40)).toEqual([e('2026-09-30')]);
  });

  it('pushes deletes as tombstones', async () => {
    const p = provider();
    await p.save([e('2026-09-30')]);
    await p.sync();
    await p.save([e('2026-09-30', { deletedAt: T1, updatedAt: T1 })]);
    await p.sync();
    expect(github.commits.at(-1)?.message).toBe('W40: delete Wed 2026-09-30');
    expect(github.remoteEntries(W40)[0]?.deletedAt).toBe(T1);
  });

  it('pulls weeks written by another device', async () => {
    github.writeRemote(W40, [e('2026-09-29')]);
    const p = provider();
    await p.sync();
    expect(await p.list()).toEqual([e('2026-09-29')]);
    // Nothing needed pushing.
    expect(github.commits).toHaveLength(1);
  });

  it('does not refetch unchanged weeks', async () => {
    github.writeRemote(W40, [e('2026-09-29')]);
    const p = provider();
    await p.sync();
    const callsBefore = github.calls;
    await p.sync();
    // getRepo + listFiles only
    expect(github.calls - callsBefore).toBe(2);
  });

  it('merges non-overlapping edits from both sides', async () => {
    const p = provider();
    await p.save([e('2026-09-28'), e('2026-09-29')]);
    await p.sync();
    github.writeRemote(W40, [e('2026-09-28', { end: '18:00', updatedAt: T1 }), e('2026-09-29')]);
    await p.save([e('2026-09-29', { end: '17:00', updatedAt: T1 })]);
    const report = await p.sync();
    expect(report.conflicts).toEqual([]);
    const expected = [
      e('2026-09-28', { end: '18:00', updatedAt: T1 }),
      e('2026-09-29', { end: '17:00', updatedAt: T1 }),
    ];
    expect(github.remoteEntries(W40)).toEqual(expected);
    expect((await p.list()).sort((a, b) => a.date.localeCompare(b.date))).toEqual(expected);
    expect(github.commits.at(-1)?.message).toBe('W40: update Tue 2026-09-29');
  });

  it('reports a conflict, holds the push, and resolves in favour of this device', async () => {
    const p = provider();
    await p.save([e('2026-09-30')]);
    await p.sync();
    github.writeRemote(W40, [e('2026-09-30', { end: '18:00', updatedAt: T1 })]);
    await p.save([e('2026-09-30', { end: '17:00', updatedAt: T1 })]);
    const commitsBefore = github.commits.length;

    const report = await p.sync();
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]?.local?.end).toBe('17:00');
    expect(report.conflicts[0]?.remote?.end).toBe('18:00');
    expect(report.state.pending).toBe(1);
    expect(github.commits).toHaveLength(commitsBefore);
    // Still conflicting on a second sync; nothing silently overwritten.
    expect((await p.sync()).conflicts).toHaveLength(1);

    await p.resolveConflict('2026-09-30', e('2026-09-30', { end: '17:00', updatedAt: T2 }));
    const after = await p.sync();
    expect(after.conflicts).toEqual([]);
    expect(after.state.pending).toBe(0);
    expect(github.remoteEntries(W40)[0]?.end).toBe('17:00');
  });

  it('resolves a conflict in favour of the synced copy', async () => {
    const p = provider();
    await p.save([e('2026-09-30')]);
    await p.sync();
    github.writeRemote(W40, [e('2026-09-30', { end: '18:00', updatedAt: T1 })]);
    await p.save([e('2026-09-30', { end: '17:00', updatedAt: T1 })]);
    await p.sync();
    await p.resolveConflict('2026-09-30', e('2026-09-30', { end: '18:00', updatedAt: T2 }));
    await p.sync();
    expect((await p.list())[0]?.end).toBe('18:00');
    expect(github.remoteEntries(W40)[0]?.end).toBe('18:00');
    expect(await p.pendingConflicts()).toEqual([]);
  });

  it('retries with a merge when the file changes during the push', async () => {
    const p = provider();
    await p.save([e('2026-09-28')]);
    await p.sync();
    await p.save([e('2026-09-30')]);
    github.beforePut = () => {
      github.writeRemote(W40, [e('2026-09-28'), e('2026-09-29')]);
    };
    const report = await p.sync();
    expect(report.state.status).toBe('idle');
    expect(github.remoteEntries(W40).map((x) => x.date)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
    ]);
    expect((await p.list()).map((x) => x.date).sort()).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
    ]);
  });

  it('queues writes while offline and flushes when back online', async () => {
    online = false;
    const p = provider();
    await p.save([e('2026-09-30')]);
    const offline = await p.sync();
    expect(offline.state).toMatchObject({ status: 'offline', pending: 1 });
    expect(github.calls).toBe(0);

    online = true;
    const back = await p.sync();
    expect(back.state).toMatchObject({ status: 'idle', pending: 0 });
    expect(github.remoteEntries(W40)).toHaveLength(1);
  });

  it('keeps the queue when the network fails mid-sync', async () => {
    const p = provider();
    await p.save([e('2026-09-30')]);
    github.failNext = new GitHubError('network');
    const report = await p.sync();
    expect(report.state).toMatchObject({ status: 'offline', pending: 1 });
    expect((await p.sync()).state.pending).toBe(0);
  });

  it('surfaces auth errors without losing data', async () => {
    const p = provider();
    await p.save([e('2026-09-30')]);
    github.failNext = new GitHubError('auth', 401);
    const report = await p.sync();
    expect(report.state.status).toBe('error');
    expect(report.state.message).toMatch(/rejected the token/);
    expect(await p.list()).toHaveLength(1);
  });

  it('refuses to sync to a public repository', async () => {
    github.isPrivate = false;
    const p = provider();
    await p.save([e('2026-09-30')]);
    const report = await p.sync();
    expect(report.state).toMatchObject({ status: 'error', publicRepo: true });
    expect(github.files.size).toBe(0);
  });

  it('syncs to a public repository only when explicitly allowed', async () => {
    github.isPrivate = false;
    const p = provider({ allowPublicRepo: true });
    await p.save([e('2026-09-30')]);
    expect((await p.sync()).state.status).toBe('idle');
    expect(github.files.size).toBe(1);
  });

  it('leaves malformed remote files untouched', async () => {
    github.files.set(weekFilePath(W40), { sha: 'bad', content: '{oops' });
    const p = provider();
    await p.save([e('2026-09-30')]);
    const report = await p.sync();
    expect(report.state.status).toBe('error');
    expect(report.state.message).toMatch(/malformed/);
    expect(github.files.get(weekFilePath(W40))?.content).toBe('{oops');
    expect(report.state.pending).toBe(1);
  });

  it('re-uploads a week whose file was deleted on GitHub', async () => {
    const p = provider();
    await p.save([e('2026-09-30')]);
    await p.sync();
    github.files.clear();
    await p.sync();
    expect(github.remoteEntries(W40)).toHaveLength(1);
  });

  it('keeps a save made during a sync queued', async () => {
    const p = provider();
    await p.save([e('2026-09-28')]);
    github.beforePut = () => {
      void p.save([e('2026-09-29')]);
    };
    await p.sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const report = await p.sync();
    expect(report.state.pending).toBe(0);
    expect(github.remoteEntries(W40).map((x) => x.date)).toEqual(['2026-09-28', '2026-09-29']);
  });

  it('coalesces overlapping sync calls', async () => {
    const p = provider();
    await p.save([e('2026-09-30')]);
    const [a, b, c] = await Promise.all([p.sync(), p.sync(), p.sync()]);
    expect(a.state.status).toBe('idle');
    expect(b.state.status).toBe('idle');
    expect(c.state.status).toBe('idle');
    expect(github.commits).toHaveLength(1);
  });

  it('forgets bookkeeping from a previously configured repository', async () => {
    await provider({ target: 'me/old@main' }).save([e('2026-09-30')]);
    await provider({ target: 'me/old@main' }).sync();
    github = new FakeGitHub();
    await provider({ target: 'me/new@main' }).sync();
    expect(github.remoteEntries(W40)).toHaveLength(1);
  });
});
