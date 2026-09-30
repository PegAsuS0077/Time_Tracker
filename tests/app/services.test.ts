import { describe, expect, it } from 'vitest';
import { TrackerService } from '../../src/app/services';
import { DEFAULT_SETTINGS, type Entry } from '../../src/domain/types';
import { MemoryProvider, MemorySettingsStore } from '../../src/storage/MemoryProvider';

const at = (iso: string): number => Date.parse(iso);
const CRLF = String.fromCharCode(13, 10);

const e = (date: string, over: Partial<Entry> = {}): Entry => ({
  date,
  start: '08:00',
  end: '16:00',
  breakMinutes: 30,
  updatedAt: '2026-09-29T10:00:00.000Z',
  ...over,
});

async function setup(initial: Entry[] = [], nowIso = '2026-09-30T06:15:00Z') {
  let now = at(nowIso);
  const provider = new MemoryProvider(initial);
  const settings = new MemorySettingsStore();
  const service = new TrackerService(
    settings,
    () => provider,
    () => now,
  );
  await service.load();
  return {
    service,
    provider,
    settings,
    setNow: (iso: string) => {
      now = at(iso);
    },
  };
}

const input = (over: Record<string, string> = {}) => ({
  date: '2026-09-25',
  start: '08:00',
  end: '16:00',
  breakMinutes: '30',
  note: '',
  ...over,
});

describe('TrackerService', () => {
  it('loads settings and entries', async () => {
    const { service } = await setup([e('2026-09-29')]);
    const state = service.store.get();
    expect(state.ready).toBe(true);
    expect(state.entries).toHaveLength(1);
    expect(state.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('starts and ends a day', async () => {
    const { service, provider, setNow } = await setup();
    const started = await service.start();
    expect(started.ok && started.value.start).toBe('08:15');
    setNow('2026-09-30T14:45:00Z');
    const ended = await service.end('2026-09-30');
    expect(ended.ok && ended.value.end).toBe('16:45');
    expect((await provider.list())[0]?.end).toBe('16:45');
  });

  it('explains why a day cannot be started', async () => {
    const { service } = await setup([e('2026-09-29', { end: null })]);
    const result = await service.start();
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/still open/) as string });
  });

  it('explains why a day cannot be ended', async () => {
    const { service } = await setup([e('2026-09-28', { end: null })]);
    const result = await service.end('2026-09-28');
    expect(!result.ok && result.error).toMatch(/24 hours/);
  });

  it('creates entries from form input', async () => {
    const { service } = await setup();
    const result = await service.saveEntry(input());
    expect(result.ok).toBe(true);
    expect(service.store.get().entries).toHaveLength(1);
  });

  it('returns field errors for invalid input', async () => {
    const { service } = await setup();
    const result = await service.saveEntry(input({ start: 'nope' }));
    expect(!result.ok && result.error.start).toBeTruthy();
  });

  it('refuses a second entry on the same date', async () => {
    const { service } = await setup([e('2026-09-25')]);
    const result = await service.saveEntry(input());
    expect(!result.ok && result.error.date).toMatch(/already an entry/);
  });

  it('allows re-creating a deleted date', async () => {
    const { service } = await setup([e('2026-09-25', { deletedAt: '2026-09-29T10:00:00.000Z' })]);
    expect((await service.saveEntry(input())).ok).toBe(true);
  });

  it('refuses a second open day', async () => {
    const { service } = await setup([e('2026-09-29', { end: null })]);
    const result = await service.saveEntry(input({ end: '' }));
    expect(!result.ok && result.error.end).toMatch(/Only one day/);
  });

  it('moves an entry when its date is edited', async () => {
    const { service, provider } = await setup([e('2026-09-24')]);
    const result = await service.saveEntry(input(), '2026-09-24');
    expect(result.ok).toBe(true);
    const stored = await provider.list();
    expect(stored.find((x) => x.date === '2026-09-24')?.deletedAt).toBeDefined();
    expect(stored.find((x) => x.date === '2026-09-25')?.deletedAt).toBeUndefined();
  });

  it('deletes by tombstoning', async () => {
    const { service, provider } = await setup([e('2026-09-29')]);
    await service.deleteEntry('2026-09-29');
    expect((await provider.list())[0]?.deletedAt).toBe('2026-09-30T06:15:00.000Z');
  });

  it('keeps changes in memory and reports storage failures', async () => {
    const { service, provider } = await setup();
    provider.failWrites = true;
    await service.saveEntry(input());
    const state = service.store.get();
    expect(state.entries).toHaveLength(1);
    expect(state.storageError).toMatch(/Could not save/);
    provider.failWrites = false;
    await service.saveEntry(input({ date: '2026-09-26' }));
    expect(service.store.get().storageError).toBeNull();
  });

  it('saves settings', async () => {
    const { service, settings } = await setup();
    await service.saveSettings({ ...DEFAULT_SETTINGS, defaultBreakMinutes: 45 });
    expect((await settings.load()).defaultBreakMinutes).toBe(45);
    const started = await service.start();
    expect(started.ok && started.value.breakMinutes).toBe(45);
  });

  it('resolves conflicts through the provider', async () => {
    const { service, provider } = await setup();
    const local = e('2026-09-29', { end: '17:00' });
    const remote = e('2026-09-29', { end: '18:00' });
    provider.conflicts = [{ date: '2026-09-29', local, remote }];
    service.store.set({ conflicts: provider.conflicts });
    await service.resolveConflict('2026-09-29', 'remote');
    const stored = await provider.list();
    expect(stored[0]?.end).toBe('18:00');
    expect(stored[0]?.updatedAt).toBe('2026-09-30T06:15:00.000Z');
    expect(service.store.get().conflicts).toEqual([]);
  });

  it('exports CSV for a week, a month and everything', async () => {
    const { service } = await setup([e('2026-09-28'), e('2026-10-01'), e('2026-09-21')]);
    const week = service.exportCsv({ kind: 'week', key: '2026-W40' });
    expect(week.filename).toBe('time-tracker-2026-W40.csv');
    expect(week.content.split(CRLF)).toHaveLength(4);
    const month = service.exportCsv({ kind: 'month', key: '2026-09' });
    expect(month.content.split(CRLF)).toHaveLength(4);
    const all = service.exportCsv({ kind: 'all' });
    expect(all.filename).toBe('time-tracker-all-2026-09-30.csv');
    expect(all.content.split(CRLF)).toHaveLength(5);
  });

  it('round-trips a backup through preview and import', async () => {
    const source = await setup([e('2026-09-28'), e('2026-09-29')]);
    await source.service.saveSettings({ ...DEFAULT_SETTINGS, contractedWeeklyHours: 39 });
    const backup = source.service.exportBackup();
    expect(backup.filename).toBe('time-tracker-backup-2026-09-30.json');

    const target = await setup([
      e('2026-09-28', { end: '12:00', updatedAt: '2026-09-01T00:00:00.000Z' }),
    ]);
    const preview = target.service.previewImport(backup.content);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.plan).toMatchObject({ added: 1, updated: 1, skipped: 0 });
    await target.service.applyImport(preview.value, true);
    expect((await target.provider.list()).map((x) => x.end)).toEqual(['16:00', '16:00']);
    expect(target.service.store.get().settings.contractedWeeklyHours).toBe(39);
  });

  it('reports invalid backup files', async () => {
    const { service } = await setup();
    const preview = service.previewImport('{"format":"nope"}');
    expect(!preview.ok && preview.error).toMatch(/not a Time Tracker backup/);
  });

  it('restores a deleted day', async () => {
    const { service, provider } = await setup([e('2026-09-29', { note: 'x' })]);
    await service.deleteEntry('2026-09-29');
    const result = await service.restoreEntry('2026-09-29');
    expect(result.ok).toBe(true);
    const stored = (await provider.list())[0];
    expect(stored?.deletedAt).toBeUndefined();
    expect(stored?.note).toBe('x');
  });

  it('refuses to restore over a newer entry on the same date', async () => {
    const { service } = await setup([e('2026-09-25', { deletedAt: '2026-09-29T10:00:00.000Z' })]);
    await service.saveEntry(input());
    const result = await service.restoreEntry('2026-09-25');
    expect(!result.ok && result.error).toMatch(/already has an entry/);
  });

  it('reports when there is nothing to restore', async () => {
    const { service } = await setup([e('2026-09-25')]);
    expect((await service.restoreEntry('2026-09-20')).ok).toBe(false);
  });
});
