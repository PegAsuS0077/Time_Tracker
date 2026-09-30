import type { AppState, TrackerService } from '../../app/services';
import { groupByWeek, type WeekGroup } from '../../domain/aggregate';
import { formatWeekRange } from '../../domain/format';
import { berlinDateTime } from '../../domain/time';
import { progress, timeline } from '../../domain/timeline';
import { parseWeekKey, weekDates } from '../../domain/week';
import { append, clear, h } from '../dom';
import { openEntryForm } from '../components/EntryForm';
import { ProgressSummary } from '../components/ProgressSummary';
import { WeekTimeline } from '../components/WeekTimeline';
import type { View } from './View';

function weekSection(service: TrackerService, group: WeekGroup, state: AppState): HTMLElement {
  const nowMs = service.now();
  const today = berlinDateTime(nowMs).date;
  const headingId = `week-${group.key}`;
  const parsed = parseWeekKey(group.key);
  return h(
    'section',
    { class: 'sheet', 'aria-labelledby': headingId },
    ProgressSummary(
      progress(
        state.entries,
        weekDates(group.key),
        today,
        nowMs,
        state.settings.contractedWeeklyHours,
      ),
      headingId,
      parsed ? `Week ${parsed.week}` : group.key,
      formatWeekRange(group.key),
    ),
    WeekTimeline(
      timeline(
        state.entries,
        group.entries.map((e) => e.date),
        nowMs,
      ),
      {
        today,
        use24h: state.settings.use24h,
        legalBreakWarning: state.settings.legalBreakWarning,
        details: true,
        onSelect: (date, entry) => {
          openEntryForm(service, entry, date);
        },
      },
    ),
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
            { class: 'sheet empty' },
            h('p', { class: 'empty-title' }, 'No days recorded yet'),
            h('p', { class: 'muted' }, 'Clock in on the Today screen, or add a past day.'),
          )
        : h('p', { class: 'hint log-hint' }, 'Tap a day to edit or delete it.'),
      ...groups.map((g) => weekSection(service, g, state)),
    ]);
  }

  render(service.store.get());
  return { el, update: render, destroy: () => undefined };
}
