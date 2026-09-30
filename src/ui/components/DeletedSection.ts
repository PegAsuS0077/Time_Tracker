import type { AppState, TrackerService } from '../../app/services';
import { recentlyDeleted } from '../../domain/entries';
import { formatDateLong, formatDateShort, formatTime } from '../../domain/format';
import { berlinDateTime } from '../../domain/time';
import type { Entry } from '../../domain/types';
import { h, toast } from '../dom';

function item(service: TrackerService, entry: Entry, state: AppState): HTMLElement {
  const use24h = state.settings.use24h;
  const label = formatDateShort(entry.date);
  const range = `${formatTime(entry.start, use24h)} – ${entry.end ? formatTime(entry.end, use24h) : 'open'}`;
  const deletedOn = entry.deletedAt
    ? formatDateLong(berlinDateTime(Date.parse(entry.deletedAt)).date)
    : '';
  return h(
    'li',
    { class: 'deleted-item' },
    h(
      'div',
      null,
      h('strong', null, formatDateLong(entry.date)),
      h('div', { class: 'muted' }, `${range} · deleted ${deletedOn}`),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-small',
        'aria-label': `Restore ${label}`,
        onclick: () => {
          void service.restoreEntry(entry.date).then((result) => {
            toast(result.ok ? `Restored ${label}.` : result.error, result.ok ? 'info' : 'error');
          });
        },
      },
      'Restore',
    ),
  );
}

/** Settings section: days deleted in the last 30 days, with one-tap restore. */
export function DeletedSection(service: TrackerService): HTMLElement {
  const body = h('div');
  let renderedEntries: Entry[] | null = null;

  const render = (state: AppState): void => {
    if (state.entries === renderedEntries) return;
    renderedEntries = state.entries;
    const deleted = recentlyDeleted(state.entries, service.now());
    body.replaceChildren(
      deleted.length === 0
        ? h('p', { class: 'muted' }, 'Nothing deleted in the last 30 days.')
        : h('ul', { class: 'deleted-list' }, ...deleted.map((e) => item(service, e, state))),
    );
  };

  const section = h(
    'section',
    { class: 'card', 'aria-labelledby': 'deleted-title' },
    h('h3', { id: 'deleted-title' }, 'Recently deleted'),
    h(
      'p',
      { class: 'hint' },
      'Days deleted in the last 30 days. Older deletions stay visible in your GitHub history.',
    ),
    body,
  );

  render(service.store.get());
  const unsubscribe = service.store.subscribe((state) => {
    if (!section.isConnected) {
      unsubscribe();
      return;
    }
    render(state);
  });
  return section;
}
