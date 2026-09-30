import type { ConnectionTester } from '../../app/services';
import { err, ok, type SyncSettings } from '../../domain/types';
import type { TrackerDatabase } from '../idb';
import { GitHubClient, GitHubError } from './GitHubClient';
import { GitHubSyncProvider } from './GitHubSyncProvider';

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;

/** Whether sync settings are complete and well-formed enough to try syncing. */
export function isSyncConfigured(sync: SyncSettings): boolean {
  return (
    sync.enabled &&
    sync.token.trim() !== '' &&
    NAME_RE.test(sync.owner) &&
    NAME_RE.test(sync.repo) &&
    BRANCH_RE.test(sync.branch)
  );
}

export const syncTarget = (sync: SyncSettings): string =>
  `${sync.owner}/${sync.repo}@${sync.branch}`;

function clientFor(sync: SyncSettings): GitHubClient {
  return new GitHubClient({
    owner: sync.owner,
    repo: sync.repo,
    branch: sync.branch,
    token: sync.token.trim(),
  });
}

export function createGitHubProvider(db: TrackerDatabase, sync: SyncSettings): GitHubSyncProvider {
  return new GitHubSyncProvider(db, clientFor(sync), {
    target: syncTarget(sync),
    allowPublicRepo: sync.allowPublicRepo,
  });
}

export const testGitHubConnection: ConnectionTester = async (sync) => {
  if (!NAME_RE.test(sync.owner) || !NAME_RE.test(sync.repo)) {
    return err('Enter a valid owner and repository name.');
  }
  if (!BRANCH_RE.test(sync.branch)) return err('Enter a valid branch name.');
  if (sync.token.trim() === '') return err('Paste a personal access token.');
  try {
    const repo = await clientFor(sync).getRepo();
    return ok(repo);
  } catch (error) {
    return err(error instanceof GitHubError ? error.message : 'Connection failed.');
  }
};
