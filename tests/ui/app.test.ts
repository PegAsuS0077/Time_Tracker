// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flush } from './setup';
import { TrackerService } from '../../src/app/services';
import type { Entry } from '../../src/domain/types';
import { MemoryProvider, MemorySettingsStore } from '../../src/storage/MemoryProvider';
import { mountApp } from '../../src/ui/app';

let now = Date.parse('2026-09-30T06:15:00Z'); // 08:15 Berlin
let unmount: () => void = () => undefined;

const e = (date: string, over: Partial<Entry> = {}): Entry => ({
  date,
  start: '08:00',
  end: '16:30',
  breakMinutes: 30,
  updatedAt: '2026-09-29T10:00:00.000Z',
  ...over,
});

async function mount(entries: Entry[] = []) {
  const provider = new MemoryProvider(entries);
  const service = new TrackerService(
    new MemorySettingsStore(),
    () => provider,
    () => now,
  );
  const root = document.createElement('div');
  root.id = 'app';
  document.body.replaceChildren(root);
  unmount = mountApp(root, service);
  await service.load();
  return { root, service, provider };
}

const button = (root: ParentNode, name: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!found) throw new Error(`Button "${name}" not found`);
  return found;
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
  it('shows today and a Start button when nothing is recorded', async () => {
    const { root } = await mount();
    expect(root.querySelector('h2')?.textContent).toBe('Wed 30 Sep 2026');
    expect(button(root, 'Start')).toBeTruthy();
  });

  it('starts, shows the running clock, and ends the day', async () => {
    const { root, provider } = await mount();
    button(root, 'Start').click();
    await flush();
    expect(root.textContent).toContain('Started at 08:15');
    expect(root.querySelector('.clock')?.textContent).toBe('0:00:00');

    now = Date.parse('2026-09-30T14:45:00Z');
    button(root, 'End').click();
    await flush();
    expect(root.textContent).toContain('Day complete');
    expect(root.textContent).toContain('8:00 h');
    expect((await provider.list())[0]?.end).toBe('16:45');
  });

  it('shows weekly and monthly totals', async () => {
    const { root } = await mount([e('2026-09-28'), e('2026-09-29')]);
    const totals = root.querySelector('.totals')?.textContent ?? '';
    expect(totals).toContain('This week (W40)');
    expect(totals).toContain('16:00 h');
    expect(totals).toContain('September 2026');
  });

  it('warns about a forgotten open day', async () => {
    const { root } = await mount([e('2026-09-29', { end: null })]);
    expect(root.textContent).toContain('open for more than 16 hours');
    expect(button(root, 'End').disabled).toBe(true);
  });
});

describe('Log view', () => {
  it('shows an empty state', async () => {
    location.hash = '#/log';
    const { root } = await mount();
    expect(root.textContent).toContain('No entries yet.');
  });

  it('groups entries by week and renders notes as text', async () => {
    location.hash = '#/log';
    const { root } = await mount([
      e('2026-09-28', { note: '<img src=x onerror=alert(1)>' }),
      e('2026-09-21', { breakMinutes: 0 }),
    ]);
    const headings = [...root.querySelectorAll('.week h3')].map((x) => x.textContent);
    expect(headings).toEqual(['W40 · 28 Sep – 4 Oct 2026', 'W39 · 21 Sep – 27 Sep 2026']);
    expect(root.querySelector('.note img')).toBeNull();
    expect(root.querySelector('.note')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('Break below legal minimum (30 min)');
  });

  it('deletes an entry after confirmation', async () => {
    location.hash = '#/log';
    const { root, provider } = await mount([e('2026-09-28')]);
    root.querySelector<HTMLButtonElement>('[aria-label="Delete Mon 28 Sep"]')?.click();
    const dialog = document.querySelector('dialog');
    expect(dialog?.textContent).toContain('Delete the entry for Mon 28 Sep?');
    button(dialog as HTMLDialogElement, 'Delete').click();
    await flush();
    expect((await provider.list())[0]?.deletedAt).toBeDefined();
    expect(root.textContent).toContain('No entries yet.');
  });

  it('cancels a delete', async () => {
    location.hash = '#/log';
    const { provider } = await mount([e('2026-09-28')]);
    document.querySelector<HTMLButtonElement>('[aria-label="Delete Mon 28 Sep"]')?.click();
    button(document.querySelector('dialog') as HTMLDialogElement, 'Cancel').click();
    await flush();
    expect((await provider.list())[0]?.deletedAt).toBeUndefined();
  });
});

describe('Entry form', () => {
  it('shows validation errors next to fields', async () => {
    location.hash = '#/log';
    const { root } = await mount();
    button(root, 'Add day').click();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    const start = dialog.querySelector<HTMLInputElement>('input[name="start"]');
    const end = dialog.querySelector<HTMLInputElement>('input[name="end"]');
    if (!start || !end) throw new Error('fields missing');
    start.value = '08:00';
    end.value = '08:00';
    dialog.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(end.getAttribute('aria-invalid')).toBe('true');
    expect(dialog.textContent).toContain('End time must differ from start time.');
  });

  it('saves a past day', async () => {
    location.hash = '#/log';
    const { root, provider } = await mount();
    button(root, 'Add day').click();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    const set = (name: string, value: string): void => {
      const el = dialog.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (el) el.value = value;
    };
    set('date', '2026-09-25');
    set('start', '22:00');
    set('end', '06:00');
    set('note', 'night shift');
    dialog.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const stored = await provider.list();
    expect(stored[0]).toMatchObject({ date: '2026-09-25', start: '22:00', end: '06:00' });
    expect(document.querySelector('dialog')).toBeNull();
    expect(root.textContent).toContain('7:30 h');
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
