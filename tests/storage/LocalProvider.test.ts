import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Entry } from '../../src/domain/types';
import { openTrackerDb, type TrackerDatabase } from '../../src/storage/idb';
import { IdbSettingsStore, LocalProvider, withDefaults } from '../../src/storage/LocalProvider';

const e = (date: string, over: Partial<Entry> = {}): Entry => ({
  date,
  start: '08:00',
  end: '16:00',
  breakMinutes: 30,
  updatedAt: '2026-09-30T10:00:00.000Z',
  ...over,
});

let db: TrackerDatabase;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  db = await openTrackerDb(`test-${counter}`);
});

afterEach(() => {
  db.close();
});

describe('LocalProvider', () => {
  it('starts empty', async () => {
    expect(await new LocalProvider(db).list()).toEqual([]);
  });

  it('saves and lists entries keyed by date', async () => {
    const provider = new LocalProvider(db);
    await provider.save([e('2026-09-29'), e('2026-09-30')]);
    await provider.save([e('2026-09-30', { end: '17:00' })]);
    const list = await provider.list();
    expect(list.map((x) => [x.date, x.end])).toEqual([
      ['2026-09-29', '16:00'],
      ['2026-09-30', '17:00'],
    ]);
  });

  it('keeps tombstones', async () => {
    const provider = new LocalProvider(db);
    await provider.save([e('2026-09-30', { deletedAt: '2026-09-30T11:00:00.000Z' })]);
    expect((await provider.list())[0]?.deletedAt).toBe('2026-09-30T11:00:00.000Z');
  });

  it('persists across database connections', async () => {
    await new LocalProvider(db).save([e('2026-09-30')]);
    db.close();
    db = await openTrackerDb(`test-${counter}`);
    expect(await new LocalProvider(db).list()).toHaveLength(1);
  });

  it('reports sync as off', async () => {
    expect((await new LocalProvider(db).sync()).state.status).toBe('off');
  });
});

describe('IdbSettingsStore', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await new IdbSettingsStore(db).load()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips settings', async () => {
    const store = new IdbSettingsStore(db);
    const settings = { ...DEFAULT_SETTINGS, defaultBreakMinutes: 45, contractedWeeklyHours: 39 };
    await store.save(settings);
    expect(await store.load()).toEqual(settings);
  });

  it('fills in missing fields from defaults', () => {
    expect(withDefaults({ use24h: false, sync: { owner: 'me' } as never })).toEqual({
      ...DEFAULT_SETTINGS,
      use24h: false,
      sync: { ...DEFAULT_SETTINGS.sync, owner: 'me' },
    });
  });
});
