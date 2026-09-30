import type { TrackerService } from '../../app/services';
import { computeEntry } from '../../domain/entries';
import { formatDateLong, formatDuration, formatTime } from '../../domain/format';
import type { Conflict } from '../../domain/merge';
import type { Entry } from '../../domain/types';
import { h, toast } from '../dom';
import { openDialog } from './Dialog';

function describe(entry: Entry | undefined, use24h: boolean): HTMLElement {
  if (!entry || entry.deletedAt) return h('p', { class: 'muted' }, 'Deleted');
  const status = computeEntry(entry);
  return h(
    'dl',
    { class: 'facts' },
    h('dt', null, 'Time'),
    h(
      'dd',
      null,
      `${formatTime(entry.start, use24h)} – ${entry.end ? formatTime(entry.end, use24h) : 'open'}`,
    ),
    h('dt', null, 'Break'),
    h('dd', null, `${entry.breakMinutes} min`),
    h('dt', null, 'Net'),
    h('dd', null, status.kind === 'closed' ? `${formatDuration(status.netMinutes)} h` : '—'),
    h('dt', null, 'Note'),
    h('dd', null, entry.note ?? '—'),
    h('dt', null, 'Changed'),
    h('dd', null, new Date(entry.updatedAt).toLocaleString()),
  );
}

function conflictBlock(
  service: TrackerService,
  conflict: Conflict,
  onDone: () => void,
): HTMLElement {
  const use24h = service.store.get().settings.use24h;
  const newer =
    (conflict.remote?.updatedAt ?? '') > (conflict.local?.updatedAt ?? '') ? 'remote' : 'local';
  const choose = (choice: 'local' | 'remote'): void => {
    void service.resolveConflict(conflict.date, choice).then(() => {
      toast(
        `Kept the ${choice === 'local' ? 'version from this device' : 'synced version'} for ${formatDateLong(conflict.date)}.`,
      );
      onDone();
    });
  };
  return h(
    'section',
    { class: 'conflict' },
    h('h3', null, formatDateLong(conflict.date)),
    h(
      'div',
      { class: 'conflict-sides' },
      h(
        'div',
        { class: 'conflict-side' },
        h('h4', null, 'This device', newer === 'local' ? ' (newer)' : ''),
        describe(conflict.local, use24h),
        h(
          'button',
          {
            type: 'button',
            class: newer === 'local' ? 'btn btn-primary' : 'btn',
            onclick: () => {
              choose('local');
            },
          },
          'Keep this device',
        ),
      ),
      h(
        'div',
        { class: 'conflict-side' },
        h('h4', null, 'Synced copy', newer === 'remote' ? ' (newer)' : ''),
        describe(conflict.remote, use24h),
        h(
          'button',
          {
            type: 'button',
            class: newer === 'remote' ? 'btn btn-primary' : 'btn',
            onclick: () => {
              choose('remote');
            },
          },
          'Keep synced copy',
        ),
      ),
    ),
  );
}

/** Let the user pick a version for each conflicting day. */
export function openConflictDialog(service: TrackerService): void {
  const container = h('div', { class: 'conflicts' });
  const handle = openDialog('Resolve sync conflicts', [
    h(
      'p',
      null,
      'These days were edited on this device and somewhere else since the last sync. Nothing has been overwritten yet.',
    ),
    container,
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: () => {
            handle.close();
          },
        },
        'Decide later',
      ),
    ),
  ]);
  const render = (): void => {
    const conflicts = service.store.get().conflicts;
    if (conflicts.length === 0) {
      handle.close();
      return;
    }
    container.replaceChildren(...conflicts.map((c) => conflictBlock(service, c, render)));
  };
  render();
}
