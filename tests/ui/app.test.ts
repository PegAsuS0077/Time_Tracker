// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flush } from './setup';
import { TrackerService } from '../../src/app/services';
import { DEFAULT_SETTINGS, type Entry } from '../../src/domain/types';
import { MemoryProvider, MemorySettingsStore } from '../../src/storage/MemoryProvider';
import { mountApp } from '../../src/ui/app';
import { DeletedSection } from '../../src/ui/components/DeletedSection';

let now = Date.parse('2026-09-30T06:15:00Z'); // Wed 08:15 Berlin
let unmount: () => void = () => undefined;

const e = (date: string, over: Partial<Entry> = {}): Entry => ({
  date,
  start: '08:00',
  end: '16:30',
  breakMinutes: 30,
  updatedAt: '2026-09-29T10:00:00.000Z',
  ...over,
});

async function mount(entries: Entry[] = [], contractedWeeklyHours: number | null = null) {
  const provider = new MemoryProvider(entries);
  const service = new TrackerService(
    new MemorySettingsStore({ ...structuredClone(DEFAULT_SETTINGS), contractedWeeklyHours }),
    () => provider,
    () => now,
  );
  const root = document.createElement('div');
  root.id = 'app';
  document.body.replaceChildren(root);
  unmount = mountApp(root, service, { settingsSections: [DeletedSection] });
  await service.load();
  return { root, service, provider };
}

const button = (root: ParentNode, name: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!found) throw new Error(`Button "${name}" not found`);
  return found;
};

const byLabel = (root: ParentNode, prefix: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find((b) =>
    (b.getAttribute('aria-label') ?? '').startsWith(prefix),
  );
  if (!found) throw new Error(`Button labelled "${prefix}…" not found`);
  return found;
};

const dialog = (): HTMLDialogElement => {
  const d = document.querySelector('dialog');
  if (!d) throw new Error('No dialog open');
  return d;
};

const submit = (d: HTMLDialogElement): void => {
  d.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
};

beforeEach(() => {
  now = Date.parse('2026-09-30T06:15:00Z');
  location.hash = '';
});

afterEach(() => {
  unmount();
  document.body.replaceChildren();
});

describe('Today view', () => {
  it('shows the date and a Clock in button when nothing is recorded', async () => {
    const { root } = await mount();
    expect(root.querySelector('h2')?.textContent).toBe('Wednesday 30 September');
    expect(root.textContent).toContain('Not clocked in');
    expect(button(root, 'Clock in')).toBeTruthy();
  });

  it('clocks in, shows the running clock, and clocks out', async () => {
    const { root, provider } = await mount();
    button(root, 'Clock in').click();
    await flush();
    expect(root.textContent).toContain('On the clock since 08:15');
    expect(root.querySelector('.clock')?.textContent).toBe('0:00:00');
    expect(root.querySelector('.tl-bar-running')).not.toBeNull();

    now = Date.parse('2026-09-30T14:45:00Z');
    button(root, 'Clock out').click();
    await flush();
    expect(root.textContent).toContain('Done for today');
    expect(root.querySelector('.punch-range')?.textContent).toBe('08:15–16:45');
    expect(root.textContent).toContain('8:00 h net');
    expect((await provider.list())[0]?.end).toBe('16:45');
  });

  it('draws the week with one row per day', async () => {
    const { root } = await mount([e('2026-09-28'), e('2026-09-29')]);
    const rows = root.querySelectorAll('.tl-day');
    expect(rows).toHaveLength(7);
    expect(rows[0]?.getAttribute('aria-label')).toBe(
      'Mon 28 Sep: 08:00 to 16:30, 8:00 hours net. Edit.',
    );
    expect(rows[3]?.getAttribute('aria-label')).toBe('Thu 1 Oct: no entry. Add one.');
    expect(root.querySelectorAll('.tl-bar')).toHaveLength(2);
  });

  it('compares the week against the target to date', async () => {
    const { root } = await mount([e('2026-09-28'), e('2026-09-29', { end: '17:00' })], 40);
    const week = root.querySelector('[aria-labelledby="week-sum"]')?.textContent ?? '';
    expect(week).toContain('Week 40');
    expect(week).toContain('16:30');
    expect(week).toContain('0:30 ahead through Tue');
    expect(week).toContain('of 40:00 h');
  });

  it('opens the form for a tapped empty day', async () => {
    const { root } = await mount();
    byLabel(root, 'Thu 1 Oct').click();
    expect(dialog().querySelector('h2')?.textContent).toBe('Add Thu 1 Oct 2026');
    expect(dialog().querySelector<HTMLInputElement>('[name="date"]')?.value).toBe('2026-10-01');
  });

  it('warns about a forgotten open day', async () => {
    const { root } = await mount([e('2026-09-29', { end: null })]);
    expect(root.textContent).toContain('open for more than 16 hours');
    expect(button(root, 'Clock out').disabled).toBe(true);
  });
});

describe('Log view', () => {
  it('shows an empty state', async () => {
    location.hash = '#/log';
    const { root } = await mount();
    expect(root.textContent).toContain('No days recorded yet');
  });

  it('groups entries by week and renders notes as text', async () => {
    location.hash = '#/log';
    const { root } = await mount([
      e('2026-09-28', { note: '<img src=x onerror=alert(1)>' }),
      e('2026-09-21', { breakMinutes: 0 }),
    ]);
    const titles = [...root.querySelectorAll('.sum-title')].map((x) => x.textContent);
    expect(titles).toEqual(['Week 40', 'Week 39']);
    expect(root.querySelector('.tl-note img')).toBeNull();
    expect(root.querySelector('.tl-note')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('Break under the legal 30 min');
  });

  it('opens a day for editing and deletes it with undo', async () => {
    location.hash = '#/log';
    const { root, provider } = await mount([e('2026-09-28')]);
    byLabel(root, 'Mon 28 Sep').click();
    expect(dialog().querySelector('h2')?.textContent).toBe('Mon 28 Sep 2026');
    button(dialog(), 'Delete day').click();
    await flush();
    expect((await provider.list())[0]?.deletedAt).toBeDefined();
    expect(root.textContent).toContain('No days recorded yet');

    button(root, 'Undo').click();
    await flush();
    expect((await provider.list())[0]?.deletedAt).toBeUndefined();
    expect(root.textContent).toContain('Restored Mon 28 Sep.');
  });
});

describe('Entry form', () => {
  it('shows validation errors next to fields', async () => {
    location.hash = '#/log';
    const { root } = await mount();
    button(root, 'Add day').click();
    const start = dialog().querySelector<HTMLInputElement>('input[name="start"]');
    const end = dialog().querySelector<HTMLInputElement>('input[name="end"]');
    if (!start || !end) throw new Error('fields missing');
    start.value = '08:00';
    end.value = '08:00';
    submit(dialog());
    await flush();
    expect(end.getAttribute('aria-invalid')).toBe('true');
    expect(dialog().textContent).toContain('End time must differ from start time.');
  });

  it('fills times with Now and breaks with chips', async () => {
    location.hash = '#/log';
    const { root } = await mount();
    button(root, 'Add day').click();
    byLabel(dialog(), 'Set start to now').click();
    expect(dialog().querySelector<HTMLInputElement>('[name="start"]')?.value).toBe('08:15');
    const chip = byLabel(dialog(), '45 minutes');
    chip.click();
    expect(dialog().querySelector<HTMLInputElement>('[name="breakMinutes"]')?.value).toBe('45');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('saves an overnight past day and previews its net time', async () => {
    location.hash = '#/log';
    const { root, provider } = await mount();
    button(root, 'Add day').click();
    const set = (name: string, value: string): void => {
      const el = dialog().querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('date', '2026-09-25');
    set('start', '22:00');
    set('end', '06:00');
    set('note', 'night shift');
    expect(dialog().textContent).toContain('7:30 h net');
    expect(dialog().textContent).toContain('Ends the next morning.');
    submit(dialog());
    await flush();
    const stored = await provider.list();
    expect(stored[0]).toMatchObject({ date: '2026-09-25', start: '22:00', end: '06:00' });
    expect(document.querySelector('dialog')).toBeNull();
    expect(root.textContent).toContain('Added Fri 25 Sep.');
  });
});

describe('navigation', () => {
  it('marks the current tab', async () => {
    const { root } = await mount();
    location.hash = '#/settings';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('Settings');
    expect(root.querySelector('h2')?.textContent).toBe('Settings');
  });
});

describe('sync conflicts', () => {
  it('shows a banner and lets the user keep the synced copy', async () => {
    const local = e('2026-09-28', { end: '17:00' });
    const remote = e('2026-09-28', { end: '18:00', updatedAt: '2026-09-29T12:00:00.000Z' });
    const { root, service, provider } = await mount([local]);
    provider.conflicts = [{ date: '2026-09-28', local, remote }];
    service.store.set({ conflicts: provider.conflicts });

    expect(root.textContent).toContain('1 day was changed on this device and elsewhere');
    button(root, 'Resolve').click();
    expect(dialog().textContent).toContain('Synced copy (newer)');
    button(dialog(), 'Keep synced copy').click();
    await flush();
    await flush();

    expect((await provider.list())[0]?.end).toBe('18:00');
    expect(root.textContent).not.toContain('changed on this device and elsewhere');
    expect(document.querySelector('dialog')).toBeNull();
  });
});

describe('recently deleted', () => {
  it('restores from Settings', async () => {
    location.hash = '#/settings';
    const { root, provider } = await mount([
      e('2026-09-28', { deletedAt: '2026-09-29T10:00:00.000Z' }),
    ]);
    const summary = root.querySelector('.fold summary')?.textContent ?? '';
    expect(summary).toContain('1 day can be restored');
    byLabel(root, 'Restore Mon 28 Sep').click();
    await flush();
    expect((await provider.list())[0]?.deletedAt).toBeUndefined();
    expect(root.querySelector('.fold summary')?.textContent).toContain('Nothing to restore');
  });
});
