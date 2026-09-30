import type { AppState } from '../../app/services';
import { monthSummary, weekSummary, type PeriodSummary } from '../../domain/aggregate';
import { formatDuration, formatMonth, formatSignedDuration } from '../../domain/format';
import { berlinDateTime } from '../../domain/time';
import { monthKey, shortWeekLabel, weekKey } from '../../domain/week';
import { h } from '../dom';

function deltaLine(summary: PeriodSummary): HTMLElement | null {
  if (summary.deltaMinutes === null || summary.targetMinutes === null) return null;
  const over = summary.deltaMinutes >= 0;
  return h(
    'p',
    { class: `delta ${over ? 'delta-over' : 'delta-under'}` },
    `${formatSignedDuration(summary.deltaMinutes)} ${over ? 'overtime' : 'short'} of ${formatDuration(summary.targetMinutes)} h`,
  );
}

function tile(title: string, summary: PeriodSummary): HTMLElement {
  const openNote =
    summary.totals.openDays > 0 ? h('p', { class: 'muted' }, 'Open day not counted yet.') : null;
  return h(
    'div',
    { class: 'tile' },
    h('h3', null, title),
    h('p', { class: 'big' }, `${formatDuration(summary.totals.netMinutes)} h`),
    deltaLine(summary),
    openNote,
  );
}

/** Net totals for the current week and month, with contracted-hours delta. */
export function TotalsCard(state: AppState, nowMs: number): HTMLElement {
  const today = berlinDateTime(nowMs).date;
  const week = weekKey(today);
  const month = monthKey(today);
  const hours = state.settings.contractedWeeklyHours;
  return h(
    'section',
    { class: 'card totals', 'aria-label': 'Totals' },
    tile(`This week (${shortWeekLabel(week)})`, weekSummary(state.entries, week, hours)),
    tile(formatMonth(month), monthSummary(state.entries, month, hours)),
  );
}
