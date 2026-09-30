import { commitMessage, describeChanges } from '../../domain/commitMessage';
import { markDeleted } from '../../domain/entries';
import { sameContent, threeWayMerge, type Conflict } from '../../domain/merge';
import type { DateStr, Entry, WeekKey } from '../../domain/types';
import { weekKey } from '../../domain/week';
import type { TrackerDatabase, WeekSyncMeta } from '../idb';
import { LocalProvider } from '../LocalProvider';
import type { StorageProvider, SyncReport, SyncState } from '../StorageProvider';
import { GitHubError, type GitHubApi } from './GitHubClient';
import { parseWeekFile, serializeWeek, weekFilePath, weekFromPath } from './weekFile';

export interface GitHubSyncOptions {
  /** Identifies owner/repo/branch; bookkeeping for another target is discarded. */
  target: string;
  allowPublicRepo: boolean;
  now?: () => number;
  isOnline?: () => boolean;
}

const MAX_ATTEMPTS = 3;

const PUBLIC_REPO_MESSAGE = 'The data repository is public. Sync is paused to protect your data.';

function sameEntries(a: readonly Entry[], b: readonly Entry[]): boolean {
  if (a.length !== b.length) return false;
  const byDate = new Map(b.map((e) => [e.date, e]));
  return a.every((e) => {
    const other = byDate.get(e.date);
    return other !== undefined && sameContent(e, other) && other.updatedAt === e.updatedAt;
  });
}

/**
 * IndexedDB working copy mirrored to one JSON file per ISO week in a GitHub
 * repository. Writes are queued per week and flushed on sync; the file sha is
 * used for optimistic concurrency and a three-way merge settles concurrent edits.
 */
export class GitHubSyncProvider implements StorageProvider {
  readonly kind = 'github' as const;
  private readonly local: LocalProvider;
  private readonly now: () => number;
  private readonly isOnline: () => boolean;
  private current: Promise<unknown> = Promise.resolve();
  private queued: Promise<SyncReport> | null = null;
  private disposed = false;

  constructor(
    private readonly db: TrackerDatabase,
    private readonly api: GitHubApi,
    private readonly options: GitHubSyncOptions,
  ) {
    this.local = new LocalProvider(db);
    this.now = options.now ?? Date.now;
    this.isOnline = options.isOnline ?? (() => navigator.onLine);
  }

  list(): Promise<Entry[]> {
    return this.local.list();
  }

  async save(entries: readonly Entry[]): Promise<void> {
    await this.local.save(entries);
    await this.enqueue(entries.map((e) => weekKey(e.date)));
  }

  private async enqueue(weeks: readonly WeekKey[]): Promise<void> {
    const queuedAt = new Date(this.now()).toISOString();
    const tx = this.db.transaction('queue', 'readwrite');
    await Promise.all(
      [...new Set(weeks)].map((week) => tx.store.put({ week, queuedAt, id: crypto.randomUUID() })),
    );
    await tx.done;
  }

  pendingConflicts(): Promise<Conflict[]> {
    return this.db.getAll('conflicts');
  }

  async resolveConflict(date: DateStr, chosen: Entry | null): Promise<void> {
    const conflict = await this.db.get('conflicts', date);
    if (!conflict) return;
    const week = weekKey(date);
    // Record the remote version as the merge base, so the choice counts as a
    // local change and wins on the next sync.
    const meta = await this.meta(week);
    const base = meta.base.filter((e) => e.date !== date);
    if (conflict.remote) base.push(conflict.remote);
    await this.db.put('syncMeta', { ...meta, base });

    if (chosen) {
      await this.local.save([chosen]);
    } else {
      const current = (await this.local.list()).find((e) => e.date === date);
      if (current && !current.deletedAt) await this.local.save([markDeleted(current, this.now())]);
    }
    await this.db.delete('conflicts', date);
    await this.enqueue([week]);
  }

  /** Coalesces overlapping calls: at most one run active and one waiting. */
  sync(): Promise<SyncReport> {
    if (this.queued) return this.queued;
    const run = this.current.then(() => {
      this.queued = null;
      return this.run();
    });
    this.queued = run;
    this.current = run.catch(() => undefined);
    return run;
  }

  dispose(): void {
    this.disposed = true;
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  private async state(
    status: SyncState['status'],
    extra: Partial<SyncState> = {},
  ): Promise<SyncReport> {
    return {
      state: { status, pending: await this.db.count('queue'), ...extra },
      conflicts: await this.db.getAll('conflicts'),
    };
  }

  private async meta(week: WeekKey): Promise<WeekSyncMeta> {
    return (
      (await this.db.get('syncMeta', week)) ?? {
        week,
        sha: null,
        base: [],
        target: this.options.target,
      }
    );
  }

  private async run(): Promise<SyncReport> {
    if (this.disposed) return this.state('idle');
    if (!this.isOnline())
      return this.state('offline', {
        message: 'Offline. Changes will sync when you are back online.',
      });
    try {
      const repo = await this.api.getRepo();
      if (!repo.private && !this.options.allowPublicRepo) {
        return await this.state('error', { publicRepo: true, message: PUBLIC_REPO_MESSAGE });
      }
      await this.forgetOtherTargets();

      const remoteFiles = new Map<WeekKey, string>();
      for (const [path, sha] of await this.api.listFiles()) {
        const week = weekFromPath(path);
        if (week) remoteFiles.set(week, sha);
      }
      const metas = new Map((await this.db.getAll('syncMeta')).map((m) => [m.week, m]));
      const queue = new Map((await this.db.getAll('queue')).map((q) => [q.week, q.id]));
      const localWeeks = new Set((await this.local.list()).map((e) => weekKey(e.date)));

      const weeks = new Set<WeekKey>(queue.keys());
      for (const [week, sha] of remoteFiles) if (metas.get(week)?.sha !== sha) weeks.add(week);
      for (const week of localWeeks) if (!metas.has(week)) weeks.add(week);
      for (const [week, meta] of metas) {
        if (meta.sha !== null && !remoteFiles.has(week)) weeks.add(week);
      }

      const errors: string[] = [];
      for (const week of [...weeks].sort()) {
        // A settings change may have replaced this provider while awaiting.
        if (this.isDisposed()) break;
        const problem = await this.syncWeek(week, remoteFiles.get(week) ?? null, queue.get(week));
        if (problem) errors.push(problem);
      }
      const lastSyncedAt = new Date(this.now()).toISOString();
      if (errors.length > 0) {
        return await this.state('error', { message: errors.join(' '), lastSyncedAt });
      }
      return await this.state('idle', { lastSyncedAt });
    } catch (error) {
      if (error instanceof GitHubError) {
        return this.state(error.kind === 'network' ? 'offline' : 'error', {
          message: error.message,
        });
      }
      return this.state('error', {
        message: 'Sync failed unexpectedly. Your data is safe on this device.',
      });
    }
  }

  /** Drop bookkeeping that belongs to a previously configured repository. */
  private async forgetOtherTargets(): Promise<void> {
    const stale = (await this.db.getAll('syncMeta')).filter(
      (m) => m.target !== this.options.target,
    );
    if (stale.length === 0) return;
    const tx = this.db.transaction(['syncMeta', 'conflicts'], 'readwrite');
    await Promise.all([
      ...stale.map((m) => tx.objectStore('syncMeta').delete(m.week)),
      tx.objectStore('conflicts').clear(),
      tx.done,
    ]);
  }

  /** Returns a user-facing problem description, or null on success. */
  private async syncWeek(
    week: WeekKey,
    listedSha: string | null,
    queueId: string | undefined,
  ): Promise<string | null> {
    const path = weekFilePath(week);
    let remoteSha = listedSha;
    let fetchFresh = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const meta = await this.meta(week);

      let remote: Entry[];
      let base: Entry[];
      if (!fetchFresh && remoteSha === null) {
        // No file on GitHub (new week, or deleted by hand): treat as fresh and re-upload.
        remote = [];
        base = [];
      } else if (!fetchFresh && remoteSha === meta.sha) {
        remote = meta.base;
        base = meta.base;
      } else {
        const file = await this.api.getFile(path);
        remoteSha = file?.sha ?? null;
        const parsed = file ? parseWeekFile(file.content, week) : null;
        if (parsed && !parsed.ok) {
          return `${path} on GitHub is malformed (${parsed.error}); it was left untouched.`;
        }
        remote = parsed?.value ?? [];
        base = file ? meta.base : [];
      }

      const local = (await this.local.list()).filter((e) => weekKey(e.date) === week);
      const { merged, conflicts } = threeWayMerge(base, local, remote);

      // Bring the working copy up to date with non-conflicting remote changes.
      const localByDate = new Map(local.map((e) => [e.date, e]));
      const toStore = merged.filter((e) => {
        const current = localByDate.get(e.date);
        return !current || !sameContent(current, e) || current.updatedAt !== e.updatedAt;
      });
      if (toStore.length > 0) await this.local.save(toStore);
      const mergedDates = new Set(merged.map((e) => e.date));
      const removed = local.filter((e) => !mergedDates.has(e.date));
      if (removed.length > 0) {
        const tx = this.db.transaction('entries', 'readwrite');
        await Promise.all([...removed.map((e) => tx.store.delete(e.date)), tx.done]);
      }

      await this.replaceConflicts(week, conflicts);
      if (conflicts.length > 0) {
        // Keep the week queued; nothing is pushed until the user decides.
        return null;
      }

      if (sameEntries(merged, remote)) {
        await this.db.put('syncMeta', {
          week,
          sha: remoteSha,
          base: remote,
          target: this.options.target,
        });
        await this.dequeue(week, queueId);
        return null;
      }

      const message = commitMessage(week, describeChanges(remote, merged));
      try {
        const newSha = await this.api.putFile(
          path,
          serializeWeek(week, merged),
          message,
          remoteSha,
        );
        await this.db.put('syncMeta', {
          week,
          sha: newSha,
          base: merged,
          target: this.options.target,
        });
        await this.dequeue(week, queueId);
        return null;
      } catch (error) {
        if (error instanceof GitHubError && error.kind === 'conflict' && attempt < MAX_ATTEMPTS) {
          fetchFresh = true;
          continue;
        }
        throw error;
      }
    }
    return `${path} kept changing on GitHub; will retry.`;
  }

  private async replaceConflicts(week: WeekKey, conflicts: readonly Conflict[]): Promise<void> {
    const existing = (await this.db.getAll('conflicts')).filter((c) => weekKey(c.date) === week);
    const tx = this.db.transaction('conflicts', 'readwrite');
    await Promise.all([
      ...existing.map((c) => tx.store.delete(c.date)),
      ...conflicts.map((c) => tx.store.put(c)),
      tx.done,
    ]);
  }

  /** Remove a queue item unless it was re-queued by a save during this sync. */
  private async dequeue(week: WeekKey, queueId: string | undefined): Promise<void> {
    const tx = this.db.transaction('queue', 'readwrite');
    const item = await tx.store.get(week);
    if (item && item.id === queueId) await tx.store.delete(week);
    await tx.done;
  }
}
