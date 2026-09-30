import type { AppState, TrackerService } from '../../app/services';
import { breakWarning } from '../../domain/breaks';
import {
  computeEntry,
  findEntry,
  findOpenEntry,
  isStaleOpen,
  openProgress,
} from '../../domain/entries';
import {
  formatClock,
  formatDateLong,
  formatDuration,
  formatMonth,
  formatTime,
  formatWeekRange,
} from '../../domain/format';
import { berlinDateTime } from '../../domain/time';
import { progress, timeline } from '../../domain/timeline';
import type { Entry } from '../../domain/types';
import { monthDates, monthKey, parseWeekKey, weekDates, weekKey } from '../../domain/week';
import { clear, h, toast } from '../dom';
import { openEntryForm } from '../components/EntryForm';
import { ProgressSummary } from '../components/ProgressSummary';
import { WeekTimeline } from '../components/WeekTimeline';
import type { View } from './View';

const LONG_WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function longDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${LONG_WEEKDAYS[(d.getUTCDay() + 6) % 7] ?? ''} ${d.getUTCDate()} ${LONG_MONTHS[d.getUTCMonth()] ?? ''}`;
}

export function TodayView(service: TrackerService): View {
  const el = h('section', { class: 'view view-today', 'aria-labelledby': 'today-title' });
  const live = h('div', { class: 'live' });
  let renderedDate = '';
  let renderedMinute = -1;
  let clockEl: HTMLElement | null = null;
  let netEl: HTMLElement | null = null;
  let running: Entry | undefined;
  let busy = false;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>): void => {
    if (busy) return;
    busy = true;
    void fn()
      .then((result) => {
        if (!result.ok && result.error) toast(result.error, 'error');
      })
      .finally(() => {
        busy = false;
      });
  };

  const edit = (entry?: Entry, date?: string): void => {
    openEntryForm(service, entry, date);
  };

  function runningCard(entry: Entry, state: AppState, nowMs: number): HTMLElement {
    const use24h = state.settings.use24h;
    const stale = isStaleOpen(entry, nowMs);
    const p = openProgress(entry, nowMs);
    clockEl = h(
      'p',
      { class: 'clock', role: 'timer', 'aria-label': 'Time since you clocked in' },
      formatClock(p?.elapsedSeconds ?? 0),
    );
    netEl = h('span', null, formatDuration(p?.netMinutes ?? 0));
    const since =
      entry.date === berlinDateTime(nowMs).date
        ? `On the clock since ${formatTime(entry.start, use24h)}`
        : `On the clock since ${formatDateLong(entry.date)}, ${formatTime(entry.start, use24h)}`;
    return h(
      'div',
      { class: 'punch is-running' },
      h('p', { class: 'punch-state' }, h('span', { class: 'pulse', 'aria-hidden': 'true' }), since),
      clockEl,
      h(
        'p',
        { class: 'punch-net' },
        netEl,
        ' h net so far',
        h('span', { class: 'punch-break' }, `after ${entry.breakMinutes} min break`),
      ),
      stale
        ? h(
            'p',
            { class: 'notice notice-warn', role: 'alert' },
            'This day has been open for more than 16 hours. Edit it and enter the time you actually stopped.',
          )
        : null,
      h(
        'div',
        { class: 'punch-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary btn-punch',
            disabled: stale,
            onclick: () => {
              act(() => service.end(entry.date));
            },
          },
          'Clock out',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => {
              edit(entry);
            },
          },
          'Edit',
        ),
      ),
    );
  }

  function doneCard(entry: Entry, state: AppState): HTMLElement {
    const use24h = state.settings.use24h;
    const status = computeEntry(entry);
    const warning = state.settings.legalBreakWarning ? breakWarning(entry) : null;
    return h(
      'div',
      { class: 'punch is-done' },
      h('p', { class: 'punch-state' }, 'Done for today'),
      h(
        'p',
        { class: 'punch-range' },
        `${formatTime(entry.start, use24h)}–${entry.end ? formatTime(entry.end, use24h) : ''}`,
      ),
      h(
        'p',
        { class: 'punch-net' },
        status.kind === 'closed' ? `${formatDuration(status.netMinutes)} h net` : 'Invalid times',
        h('span', { class: 'punch-break' }, `after ${entry.breakMinutes} min break`),
      ),
      entry.note ? h('p', { class: 'note' }, entry.note) : null,
      warning
        ? h(
            'p',
            { class: 'notice notice-warn' },
            `The legal minimum break for this day is ${warning.requiredMinutes} min.`,
          )
        : null,
      h(
        'div',
        { class: 'punch-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => {
              edit(entry);
            },
          },
          'Edit today',
        ),
      ),
    );
  }

  function idleCard(): HTMLElement {
    return h(
      'div',
      { class: 'punch is-idle' },
      h('p', { class: 'punch-state' }, 'Not clocked in'),
      h(
        'div',
        { class: 'punch-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary btn-punch',
            onclick: () => {
              act(() => service.start());
            },
          },
          'Clock in',
        ),
      ),
    );
  }

  /** Week chart and totals; re-rendered every minute while a day is running. */
  function renderLive(state: AppState, nowMs: number): void {
    const today = berlinDateTime(nowMs).date;
    const week = weekKey(today);
    const month = monthKey(today);
    const hours = state.settings.contractedWeeklyHours;
    const weekNumber = parseWeekKey(week)?.week ?? 0;
    clear(live);
    live.append(
      h(
        'section',
        { class: 'sheet', 'aria-labelledby': 'week-sum' },
        ProgressSummary(
          progress(state.entries, weekDates(week), today, nowMs, hours),
          'week-sum',
          `Week ${weekNumber}`,
          formatWeekRange(week),
        ),
        WeekTimeline(timeline(state.entries, weekDates(week), nowMs), {
          today,
          use24h: state.settings.use24h,
          legalBreakWarning: state.settings.legalBreakWarning,
          onSelect: (date, entry) => {
            edit(entry, date);
          },
        }),
      ),
      h(
        'section',
        { class: 'sheet sheet-compact', 'aria-labelledby': 'month-sum' },
        ProgressSummary(
          progress(state.entries, monthDates(month), today, nowMs, hours),
          'month-sum',
          formatMonth(month),
          'This month',
          'month',
        ),
      ),
    );
  }

  function render(state: AppState): void {
    const nowMs = service.now();
    const today = berlinDateTime(nowMs).date;
    renderedDate = today;
    renderedMinute = Math.floor(nowMs / 60_000);
    clockEl = null;
    netEl = null;
    running = findOpenEntry(state.entries);
    const todays = findEntry(state.entries, today);

    let card: HTMLElement;
    if (!state.ready) card = h('p', { class: 'muted' }, 'Loading…');
    else if (running) card = runningCard(running, state, nowMs);
    else if (todays) card = doneCard(todays, state);
    else card = idleCard();

    renderLive(state, nowMs);
    clear(el);
    el.append(
      h('h2', { id: 'today-title', class: 'view-title', tabindex: -1 }, longDate(today)),
      card,
      live,
      h(
        'p',
        { class: 'secondary-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-link',
            onclick: () => {
              edit();
            },
          },
          'Add a past day',
        ),
      ),
    );
  }

  const timer = window.setInterval(() => {
    const nowMs = service.now();
    if (berlinDateTime(nowMs).date !== renderedDate) {
      render(service.store.get());
      return;
    }
    if (running && clockEl) {
      const p = openProgress(running, nowMs);
      clockEl.textContent = formatClock(p?.elapsedSeconds ?? 0);
      if (netEl) netEl.textContent = formatDuration(p?.netMinutes ?? 0);
      const minute = Math.floor(nowMs / 60_000);
      if (minute !== renderedMinute) {
        renderedMinute = minute;
        renderLive(service.store.get(), nowMs);
      }
    }
  }, 1000);

  render(service.store.get());
  return {
    el,
    update: render,
    destroy: () => {
      window.clearInterval(timer);
    },
  };
}
