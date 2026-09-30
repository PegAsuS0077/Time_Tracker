import { describe, expect, it, vi } from 'vitest';
import { base64ToUtf8, utf8ToBase64 } from '../../src/storage/github/encoding';
import { GitHubClient, GitHubError } from '../../src/storage/github/GitHubClient';
import {
  parseWeekFile,
  serializeWeek,
  weekFilePath,
  weekFromPath,
} from '../../src/storage/github/weekFile';

const TOKEN = 'github_pat_TOPSECRET123';
const config = { owner: 'me', repo: 'work data', branch: 'main', token: TOKEN };

function mockFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), { status, headers }),
    ),
  );
}

const requestOf = (fn: ReturnType<typeof vi.fn<typeof fetch>>, i = 0) => {
  const call = fn.mock.calls[i];
  if (!call) throw new Error('no call');
  const [url, init] = call;
  return { url: url as string, init: init ?? {} };
};

describe('encoding', () => {
  it('round-trips UTF-8 text', () => {
    const text = 'Überstunden – Café ☕ 日本';
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
  });

  it('decodes GitHub-style wrapped base64', () => {
    const wrapped = utf8ToBase64('x'.repeat(100)).replace(/(.{60})/g, '$1\n');
    expect(base64ToUtf8(wrapped)).toBe('x'.repeat(100));
  });
});

describe('weekFile', () => {
  it('maps weeks to paths and back', () => {
    expect(weekFilePath('2026-W40')).toBe('2026/2026-W40.json');
    expect(weekFromPath('2026/2026-W40.json')).toBe('2026-W40');
    expect(weekFromPath('2027/2026-W53.json')).toBeNull();
    expect(weekFromPath('2025/2025-W53.json')).toBeNull();
    expect(weekFromPath('README.md')).toBeNull();
  });

  const entry = {
    date: '2026-09-30',
    start: '08:00',
    end: null,
    breakMinutes: 30,
    updatedAt: '2026-09-30T10:00:00.000Z',
  };

  it('serialises stably and parses back', () => {
    const text = serializeWeek('2026-W40', [entry]);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseWeekFile(text, '2026-W40')).toEqual({ ok: true, value: [entry] });
  });

  it('rejects entries that belong to another week', () => {
    const text = serializeWeek('2026-W40', [{ ...entry, date: '2026-10-05' }]);
    expect(parseWeekFile(text, '2026-W40').ok).toBe(false);
  });

  it('rejects malformed files', () => {
    expect(parseWeekFile('{', '2026-W40').ok).toBe(false);
    expect(parseWeekFile('{"format":"x"}', '2026-W40').ok).toBe(false);
    expect(parseWeekFile(serializeWeek('2026-W41', []), '2026-W40').ok).toBe(false);
  });
});

describe('GitHubClient', () => {
  it('reads repository visibility with the right request', async () => {
    const fetchFn = mockFetch(200, {
      full_name: 'me/work data',
      private: true,
      permissions: { push: true },
    });
    const info = await new GitHubClient(config, fetchFn).getRepo();
    expect(info).toEqual({ fullName: 'me/work data', private: true, canPush: true });
    const { url, init } = requestOf(fetchFn);
    expect(url).toBe('https://api.github.com/repos/me/work%20data');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('omit');
  });

  it.each([
    [401, {}, 'auth'],
    [403, { 'x-ratelimit-remaining': '0' }, 'rate-limit'],
    [403, {}, 'forbidden'],
    [429, {}, 'rate-limit'],
    [404, {}, 'not-found'],
    [409, {}, 'conflict'],
    [422, {}, 'conflict'],
    [502, {}, 'server'],
    [418, {}, 'invalid'],
  ])('maps HTTP %i to %s without leaking the token', async (status, headers, kind) => {
    const client = new GitHubClient(config, mockFetch(status, { message: TOKEN }, headers));
    const error = await client.getRepo().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe(kind);
    expect((error as GitHubError).message).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it('maps fetch failures to network errors', async () => {
    const client = new GitHubClient(
      config,
      vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(client.listFiles()).rejects.toMatchObject({ kind: 'network' });
  });

  it('lists blobs in the branch tree', async () => {
    const fetchFn = mockFetch(200, {
      tree: [
        { path: '2026', type: 'tree', sha: 't1' },
        { path: '2026/2026-W40.json', type: 'blob', sha: 'b1' },
        { path: 'README.md', type: 'blob', sha: 'b2' },
      ],
    });
    const files = await new GitHubClient(config, fetchFn).listFiles();
    expect([...files]).toEqual([
      ['2026/2026-W40.json', 'b1'],
      ['README.md', 'b2'],
    ]);
    expect(requestOf(fetchFn).url).toBe(
      'https://api.github.com/repos/me/work%20data/git/trees/main?recursive=1',
    );
  });

  it('treats an empty repository as having no files', async () => {
    const files = await new GitHubClient(config, mockFetch(409, {})).listFiles();
    expect(files.size).toBe(0);
  });

  it('fetches and decodes a file', async () => {
    const fetchFn = mockFetch(200, {
      sha: 'abc',
      encoding: 'base64',
      content: utf8ToBase64('{"a":"ü"}'),
    });
    const file = await new GitHubClient(config, fetchFn).getFile('2026/2026-W40.json');
    expect(file).toEqual({ sha: 'abc', content: '{"a":"ü"}' });
    expect(requestOf(fetchFn).url).toBe(
      'https://api.github.com/repos/me/work%20data/contents/2026/2026-W40.json?ref=main',
    );
  });

  it('returns null for a missing file', async () => {
    expect(await new GitHubClient(config, mockFetch(404, {})).getFile('x.json')).toBeNull();
  });

  it('creates and updates files with sha and message', async () => {
    const fetchFn = mockFetch(200, { content: { sha: 'new-sha' } });
    const client = new GitHubClient(config, fetchFn);
    expect(await client.putFile('2026/2026-W40.json', 'ü', 'W40: update', 'old-sha')).toBe(
      'new-sha',
    );
    const { init } = requestOf(fetchFn);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      message: 'W40: update',
      content: utf8ToBase64('ü'),
      branch: 'main',
      sha: 'old-sha',
    });

    await client.putFile('2026/2026-W41.json', '{}', 'W41: update', null);
    expect(JSON.parse(requestOf(fetchFn, 1).init.body as string)).not.toHaveProperty('sha');
  });
});
