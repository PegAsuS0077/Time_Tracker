import type { Entry, WeekKey } from '../../src/domain/types';
import {
  GitHubError,
  type GitHubApi,
  type RemoteFile,
  type RepoInfo,
} from '../../src/storage/github/GitHubClient';
import { parseWeekFile, serializeWeek, weekFilePath } from '../../src/storage/github/weekFile';

/** In-memory stand-in for a GitHub repository, with sha-based concurrency. */
export class FakeGitHub implements GitHubApi {
  files = new Map<string, RemoteFile>();
  commits: { path: string; message: string }[] = [];
  isPrivate = true;
  /** Thrown by the next API call, then cleared. */
  failNext: Error | null = null;
  /** Runs once before the next putFile, e.g. to simulate a concurrent writer. */
  beforePut: (() => void) | null = null;
  calls = 0;
  private counter = 0;

  private check(): void {
    this.calls += 1;
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
  }

  private nextSha(): string {
    this.counter += 1;
    return `sha-${this.counter}`;
  }

  getRepo(): Promise<RepoInfo> {
    this.check();
    return Promise.resolve({ fullName: 'me/data', private: this.isPrivate, canPush: true });
  }

  listFiles(): Promise<Map<string, string>> {
    this.check();
    return Promise.resolve(new Map([...this.files].map(([path, f]) => [path, f.sha])));
  }

  getFile(path: string): Promise<RemoteFile | null> {
    this.check();
    const file = this.files.get(path);
    return Promise.resolve(file ? { ...file } : null);
  }

  putFile(path: string, content: string, message: string, sha: string | null): Promise<string> {
    this.check();
    if (this.beforePut) {
      const hook = this.beforePut;
      this.beforePut = null;
      hook();
    }
    const current = this.files.get(path);
    if ((current?.sha ?? null) !== sha) return Promise.reject(new GitHubError('conflict', 409));
    const newSha = this.nextSha();
    this.files.set(path, { sha: newSha, content });
    this.commits.push({ path, message });
    return Promise.resolve(newSha);
  }

  /** Simulate another device writing a week file. */
  writeRemote(week: WeekKey, entries: Entry[], message = 'other device'): void {
    const path = weekFilePath(week);
    this.files.set(path, { sha: this.nextSha(), content: serializeWeek(week, entries) });
    this.commits.push({ path, message });
  }

  remoteEntries(week: WeekKey): Entry[] {
    const file = this.files.get(weekFilePath(week));
    if (!file) return [];
    const parsed = parseWeekFile(file.content, week);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }
}
