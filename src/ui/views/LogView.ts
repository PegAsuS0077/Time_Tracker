import type { AppState, TrackerService } from '../../app/services';
import { groupByWeek, weekSummary, type WeekGroup } from '../../domain/aggregate';
import { breakWarning } from '../../domain/breaks';
import { computeEntry } from '../../domain/entries';
import {
  formatDateShort,
  formatDuration,
  formatSignedDuration,
  formatTime,
  formatWeekRange,
} from '../../domain/format';
import type { Entry } from '../../domain/types';
import { shortWeekLabel } from '../../domain/week';
import { append, clear, h, toast } from '../dom';
import { confirmDialog } from '../components/Dialog';
import { openEntryForm } from '../components/EntryForm';
import type { View } from './View';

function row(service: TrackerService, entry: Entry, state: AppState): HTMLElement {
  const use24h = state.settings.use24h;
  const status = computeEntry(entry);
  const warning = state.settings.legalBreakWarning ? breakWarning(entry) : null;
  const dateLabel = formatDateShort(entry.date);
  const range = `${formatTime(entry.start, use24h)} – ${entry.end ? formatTime(entry.end, use24h) : 'open'}`;
  const net =
    status.kind === 'closed'
      ? `${formatDuration(status.netMinutes)} h`
      : status.kind === 'open'
        ? 'running'
        : 'invalid';

  const onDelete = (): void => {
    void confirmDialog(
      'Delete day?',
      `Delete the entry for ${dateLabel}? You can restore it later from Settings → Recently deleted.`,
      'Delete',
      true,
    ).then(async (confirmed) => {
      if (!confirmed) return;
      await service.deleteEntry(entry.date);
      toast(`Deleted ${dateLabel}.`, 'info', {
        label: 'Undo',
        onClick: () => {
          void service.restoreEntry(entry.date).then((result) => {
            toast(
              result.ok ? `Restored ${dateLabel}.` : result.error,
              result.ok ? 'info' : 'error',
            );
          });
        },
      });
    });
  };

  return h(
    'li',
    { class: `entry-row${status.kind === 'invalid' ? ' invalid' : ''}` },
    h(
      'div',
      { class: 'entry-main' },
      h('span', { class: 'entry-date' }, dateLabel),
      h('span', { class: 'entry-range' }, range),
      h('span', { class: 'entry-break' }, `Break ${entry.breakMinutes} min`),
      h('span', { class: 'entry-net' }, net),
    ),
    entry.note ? h('p', { class: 'note' }, entry.note) : null,
    warning
      ? h('p', { class: 'warning' }, `Break below legal minimum (${warning.requiredMinutes} min).`)
      : null,
    status.kind === 'invalid'
      ? h('p', { class: 'warning' }, 'Times are invalid for this date. Please edit.')
      : null,
    h(
      'div',
      { class: 'row-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small',
          'aria-label': `Edit ${dateLabel}`,
          onclick: () => {
            openEntryForm(service, entry);
          },
        },
        'Edit',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small btn-danger',
          'aria-label': `Delete ${dateLabel}`,
          onclick: onDelete,
        },
        'Delete',
      ),
    ),
  );
}

function weekSection(service: TrackerService, group: WeekGroup, state: AppState): HTMLElement {
  const summary = weekSummary(state.entries, group.key, state.settings.contractedWeeklyHours);
  const headingId = `week-${group.key}`;
  return h(
    'section',
    { class: 'card week', 'aria-labelledby': headingId },
    h(
      'header',
      { class: 'week-header' },
      h('h3', { id: headingId }, `${shortWeekLabel(group.key)} · ${formatWeekRange(group.key)}`),
      h(
        'p',
        { class: 'week-total' },
        `${formatDuration(group.totals.netMinutes)} h`,
        summary.deltaMinutes !== null
          ? h(
              'span',
              { class: summary.deltaMinutes >= 0 ? 'delta-over' : 'delta-under' },
              ` (${formatSignedDuration(summary.deltaMinutes)})`,
            )
          : null,
      ),
    ),
    h('ul', { class: 'entry-list' }, ...group.entries.map((e) => row(service, e, state))),
  );
}

export function LogView(service: TrackerService): View {
  const el = h('section', { class: 'view', 'aria-labelledby': 'log-title' });

  function render(state: AppState): void {
    const groups = groupByWeek(state.entries);
    clear(el);
    append(el, [
      h(
        'div',
        { class: 'view-header' },
        h('h2', { id: 'log-title', class: 'view-title', tabindex: -1 }, 'Log'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary',
            onclick: () => {
              openEntryForm(service);
            },
          },
          'Add day',
        ),
      ),
      groups.length === 0
        ? h(
            'div',
            { class: 'card empty' },
            h('p', null, 'No entries yet.'),
            h('p', { class: 'muted' }, 'Use Start on the Today screen, or add a past day by hand.'),
          )
        : null,
      ...groups.map((g) => weekSection(service, g, state)),
    ]);
  }

  render(service.store.get());
  return { el, update: render, destroy: () => undefined };
}
