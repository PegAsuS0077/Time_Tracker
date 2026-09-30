import type { AppState, TrackerService } from '../../app/services';
import { breakWarning } from '../../domain/breaks';
import {
  computeEntry,
  findEntry,
  findOpenEntry,
  isStaleOpen,
  openProgress,
} from '../../domain/entries';
import { formatClock, formatDateLong, formatDuration, formatTime } from '../../domain/format';
import { berlinDateTime } from '../../domain/time';
import type { Entry } from '../../domain/types';
import { clear, h, toast } from '../dom';
import { openEntryForm } from '../components/EntryForm';
import { TotalsCard } from '../components/TotalsCard';
import type { View } from './View';

export function TodayView(service: TrackerService): View {
  const el = h('section', { class: 'view', 'aria-labelledby': 'today-title' });
  let renderedDate = '';
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

  function openCard(entry: Entry, state: AppState, nowMs: number): HTMLElement {
    const use24h = state.settings.use24h;
    const stale = isStaleOpen(entry, nowMs);
    const progress = openProgress(entry, nowMs);
    clockEl = h(
      'p',
      { class: 'clock', role: 'timer', 'aria-label': 'Elapsed time' },
      formatClock(progress?.elapsedSeconds ?? 0),
    );
    netEl = h('span', null, formatDuration(progress?.netMinutes ?? 0));
    const startedLabel =
      entry.date === berlinDateTime(nowMs).date
        ? `Started at ${formatTime(entry.start, use24h)}`
        : `Started ${formatDateLong(entry.date)} at ${formatTime(entry.start, use24h)}`;
    return h(
      'div',
      { class: 'card status' },
      h('p', { class: 'status-label' }, startedLabel),
      clockEl,
      h(
        'p',
        { class: 'muted' },
        'Net so far (after ',
        `${entry.breakMinutes} min break): `,
        netEl,
        ' h',
      ),
      stale
        ? h(
            'p',
            { class: 'warning', role: 'alert' },
            'This day has been open for more than 16 hours. Did you forget to end it? Edit it to enter the real end time.',
          )
        : null,
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary btn-big',
            disabled: stale,
            onclick: () => {
              act(() => service.end(entry.date));
            },
          },
          'End',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => {
              openEntryForm(service, entry);
            },
          },
          'Edit',
        ),
      ),
    );
  }

  function closedCard(entry: Entry, state: AppState): HTMLElement {
    const use24h = state.settings.use24h;
    const status = computeEntry(entry);
    const warning = state.settings.legalBreakWarning ? breakWarning(entry) : null;
    return h(
      'div',
      { class: 'card status' },
      h('p', { class: 'status-label' }, 'Day complete'),
      h(
        'dl',
        { class: 'facts' },
        h('dt', null, 'Start'),
        h('dd', null, formatTime(entry.start, use24h)),
        h('dt', null, 'End'),
        h('dd', null, entry.end ? formatTime(entry.end, use24h) : '—'),
        h('dt', null, 'Break'),
        h('dd', null, `${entry.breakMinutes} min`),
        h('dt', null, 'Net'),
        h(
          'dd',
          null,
          status.kind === 'closed' ? `${formatDuration(status.netMinutes)} h` : 'invalid',
        ),
      ),
      entry.note ? h('p', { class: 'note' }, entry.note) : null,
      warning
        ? h(
            'p',
            { class: 'warning' },
            `Break is ${warning.actualMinutes} min; the legal minimum for this day is ${warning.requiredMinutes} min.`,
          )
        : null,
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => {
              openEntryForm(service, entry);
            },
          },
          'Edit',
        ),
      ),
    );
  }

  function startCard(): HTMLElement {
    return h(
      'div',
      { class: 'card status' },
      h('p', { class: 'status-label' }, 'Not started'),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary btn-big',
            onclick: () => {
              act(() => service.start());
            },
          },
          'Start',
        ),
      ),
    );
  }

  function render(state: AppState): void {
    const nowMs = service.now();
    const today = berlinDateTime(nowMs).date;
    renderedDate = today;
    clockEl = null;
    netEl = null;
    running = findOpenEntry(state.entries);
    const todays = findEntry(state.entries, today);

    let card: HTMLElement;
    if (running) card = openCard(running, state, nowMs);
    else if (todays) card = closedCard(todays, state);
    else card = startCard();

    clear(el);
    el.append(
      h('h2', { id: 'today-title', class: 'view-title', tabindex: -1 }, formatDateLong(today)),
      state.ready ? card : h('p', { class: 'muted' }, 'Loading…'),
      h(
        'p',
        { class: 'secondary-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-link',
            onclick: () => {
              openEntryForm(service);
            },
          },
          'Add or fix another day',
        ),
      ),
      TotalsCard(state, nowMs),
    );
  }

  const timer = window.setInterval(() => {
    const nowMs = service.now();
    if (berlinDateTime(nowMs).date !== renderedDate) {
      render(service.store.get());
      return;
    }
    if (running && clockEl && netEl) {
      const progress = openProgress(running, nowMs);
      clockEl.textContent = formatClock(progress?.elapsedSeconds ?? 0);
      netEl.textContent = formatDuration(progress?.netMinutes ?? 0);
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
