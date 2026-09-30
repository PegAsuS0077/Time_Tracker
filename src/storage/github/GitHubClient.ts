import { base64ToUtf8, utf8ToBase64 } from './encoding';

export const GITHUB_API = 'https://api.github.com';

export type GitHubErrorKind =
  'auth' | 'forbidden' | 'not-found' | 'conflict' | 'rate-limit' | 'network' | 'server' | 'invalid';

const MESSAGES: Record<GitHubErrorKind, string> = {
  auth: 'GitHub rejected the token. It may have expired or been revoked — create a new one and paste it in Settings.',
  forbidden:
    'The token is not allowed to do this. It needs access to the data repository with “Contents: Read and write”.',
  'not-found':
    'Repository or branch not found. Check owner, name and branch, and that the token has access to this repository.',
  conflict: 'The file changed on GitHub while saving.',
  'rate-limit': 'GitHub rate limit reached. Sync will retry later.',
  network:
    'Cannot reach GitHub. Changes are kept on this device and will sync when you are online.',
  server: 'GitHub had a problem. Sync will retry later.',
  invalid: 'GitHub returned an unexpected response.',
};

/** Errors never include the token or request headers. */
export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    readonly status?: number,
  ) {
    super(MESSAGES[kind]);
    this.name = 'GitHubError';
  }
}

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export interface RepoInfo {
  fullName: string;
  private: boolean;
  canPush: boolean;
}

export interface RemoteFile {
  sha: string;
  content: string;
}

/** The subset of the GitHub API the sync engine needs (mockable in tests). */
export interface GitHubApi {
  getRepo(): Promise<RepoInfo>;
  /** Map of file path → blob sha for the whole branch (empty for an empty repo). */
  listFiles(): Promise<Map<string, string>>;
  getFile(path: string): Promise<RemoteFile | null>;
  /** Create or update a file; `sha` is required when updating. Returns the new blob sha. */
  putFile(path: string, content: string, message: string, sha: string | null): Promise<string>;
}

type FetchFn = typeof fetch;

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class GitHubClient implements GitHubApi {
  private readonly base: string;

  constructor(
    private readonly config: RepoConfig,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {
    this.base = `${GITHUB_API}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        ...init,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.config.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch {
      throw new GitHubError('network');
    }
    return response;
  }

  private static errorFor(response: Response): GitHubError {
    const { status } = response;
    if (status === 401) return new GitHubError('auth', status);
    if (status === 403 || status === 429) {
      return response.headers.get('x-ratelimit-remaining') === '0' || status === 429
        ? new GitHubError('rate-limit', status)
        : new GitHubError('forbidden', status);
    }
    if (status === 404) return new GitHubError('not-found', status);
    if (status === 409 || status === 422) return new GitHubError('conflict', status);
    if (status >= 500) return new GitHubError('server', status);
    return new GitHubError('invalid', status);
  }

  private static async json(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new GitHubError('invalid', response.status);
    }
  }

  async getRepo(): Promise<RepoInfo> {
    const response = await this.request(this.base);
    if (!response.ok) throw GitHubClient.errorFor(response);
    const data = await GitHubClient.json(response);
    if (!isRecord(data) || typeof data.private !== 'boolean') throw new GitHubError('invalid');
    const permissions = isRecord(data.permissions) ? data.permissions : {};
    return {
      fullName: typeof data.full_name === 'string' ? data.full_name : '',
      private: data.private,
      canPush: permissions.push === true,
    };
  }

  async listFiles(): Promise<Map<string, string>> {
    const url = `${this.base}/git/trees/${encodeURIComponent(this.config.branch)}?recursive=1`;
    const response = await this.request(url);
    // 409: repository is empty. 404: branch does not exist yet (only if the repo is empty).
    if (response.status === 409) return new Map();
    if (!response.ok) throw GitHubClient.errorFor(response);
    const data = await GitHubClient.json(response);
    if (!isRecord(data) || !Array.isArray(data.tree)) throw new GitHubError('invalid');
    const files = new Map<string, string>();
    for (const item of data.tree as unknown[]) {
      if (
        isRecord(item) &&
        item.type === 'blob' &&
        typeof item.path === 'string' &&
        typeof item.sha === 'string'
      ) {
        files.set(item.path, item.sha);
      }
    }
    return files;
  }

  async getFile(path: string): Promise<RemoteFile | null> {
    const url = `${this.base}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.config.branch)}`;
    const response = await this.request(url);
    if (response.status === 404) return null;
    if (!response.ok) throw GitHubClient.errorFor(response);
    const data = await GitHubClient.json(response);
    if (
      !isRecord(data) ||
      typeof data.sha !== 'string' ||
      typeof data.content !== 'string' ||
      data.encoding !== 'base64'
    ) {
      throw new GitHubError('invalid');
    }
    try {
      return { sha: data.sha, content: base64ToUtf8(data.content) };
    } catch {
      throw new GitHubError('invalid');
    }
  }

  async putFile(
    path: string,
    content: string,
    message: string,
    sha: string | null,
  ): Promise<string> {
    const body: Record<string, string> = {
      message,
      content: utf8ToBase64(content),
      branch: this.config.branch,
    };
    if (sha) body.sha = sha;
    const response = await this.request(`${this.base}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (!response.ok) throw GitHubClient.errorFor(response);
    const data = await GitHubClient.json(response);
    if (!isRecord(data) || !isRecord(data.content) || typeof data.content.sha !== 'string') {
      throw new GitHubError('invalid');
    }
    return data.content.sha;
  }
}
