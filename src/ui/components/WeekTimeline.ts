import { breakWarning } from '../../domain/breaks';
import { formatDateShort, formatDuration, formatTime, weekdayShort } from '../../domain/format';
import type { Timeline, TimelineRow } from '../../domain/timeline';
import { weekdayIndex } from '../../domain/time';
import type { DateStr, Entry } from '../../domain/types';
import { h } from '../dom';

export interface TimelineOptions {
  today: DateStr;
  use24h: boolean;
  legalBreakWarning: boolean;
  /** Tap a day: edit it, or add an entry for an empty day. */
  onSelect: (date: DateStr, entry: Entry | undefined) => void;
  /** Show notes and warnings under each day (Log). */
  details?: boolean;
}

const pct = (value: number, t: Timeline): string =>
  `${(((value - t.axisStart) / (t.axisEnd - t.axisStart)) * 100).toFixed(3)}%`;

function hourLabel(minutes: number, use24h: boolean): string {
  const hour = Math.round(minutes / 60) % 24;
  if (use24h) return String(hour).padStart(2, '0');
  return `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? 'a' : 'p'}`;
}

function axis(t: Timeline, use24h: boolean): HTMLElement {
  const hours = (t.axisEnd - t.axisStart) / 60;
  const step = hours > 16 ? 6 : 3;
  const ticks: HTMLElement[] = [];
  for (let m = t.axisStart; m <= t.axisEnd; m += step * 60) {
    const tick = h('span', { class: 'axis-tick' }, hourLabel(m, use24h));
    tick.style.setProperty('--at', pct(m, t));
    ticks.push(tick);
  }
  return h(
    'div',
    { class: 'tl-row tl-axis', 'aria-hidden': 'true' },
    h('span'),
    h('span', { class: 'tl-track' }, ...ticks),
    h('span'),
  );
}

function describeRow(row: TimelineRow, use24h: boolean): string {
  const day = formatDateShort(row.date);
  if (!row.entry) return `${day}: no entry. Add one.`;
  const end = row.entry.end ? formatTime(row.entry.end, use24h) : 'now';
  const net = row.netMinutes === null ? '' : `, ${formatDuration(row.netMinutes)} hours net`;
  return `${day}: ${formatTime(row.entry.start, use24h)} to ${end}${net}${row.running ? ', running' : ''}. Edit.`;
}

function bar(row: TimelineRow, t: Timeline): HTMLElement | null {
  if (row.startMin === null || row.endMin === null) return null;
  const classes = ['tl-bar'];
  if (row.running) classes.push('tl-bar-running');
  if (row.overnight) classes.push('tl-bar-overnight');
  const el = h('span', { class: classes.join(' ') });
  const end = Math.min(t.axisEnd, Math.max(row.endMin, row.startMin + 5));
  el.style.setProperty('--from', pct(row.startMin, t));
  el.style.setProperty('--to', pct(end, t));
  return el;
}

function rowElement(row: TimelineRow, t: Timeline, options: TimelineOptions): HTMLElement {
  const isToday = row.date === options.today;
  const weekend = weekdayIndex(row.date) >= 5;
  const net = row.netMinutes === null ? (row.entry ? '?' : '') : formatDuration(row.netMinutes);
  const classes = ['tl-row', 'tl-day'];
  if (isToday) classes.push('is-today');
  if (weekend) classes.push('is-weekend');
  if (!row.entry) classes.push('is-empty');

  const button = h(
    'button',
    {
      type: 'button',
      class: classes.join(' '),
      'aria-label': describeRow(row, options.use24h),
      onclick: () => {
        options.onSelect(row.date, row.entry);
      },
    },
    h(
      'span',
      { class: 'tl-label' },
      weekdayShort(row.date),
      h('span', { class: 'tl-date' }, String(Number(row.date.slice(8)))),
    ),
    h('span', { class: 'tl-track' }, bar(row, t)),
    h('span', { class: row.running ? 'tl-net is-running' : 'tl-net' }, net),
  );

  if (!options.details || !row.entry) return button;
  const extras: HTMLElement[] = [];
  const entry = row.entry;
  extras.push(
    h(
      'span',
      { class: 'tl-times' },
      `${formatTime(entry.start, options.use24h)}–${entry.end ? formatTime(entry.end, options.use24h) : 'now'}`,
      h('span', { class: 'tl-break' }, `${entry.breakMinutes} min break`),
    ),
  );
  if (entry.note) extras.push(h('span', { class: 'tl-note' }, entry.note));
  const warning = options.legalBreakWarning ? breakWarning(entry) : null;
  if (warning) {
    extras.push(
      h('span', { class: 'tl-warn' }, `Break under the legal ${warning.requiredMinutes} min`),
    );
  }
  if (row.netMinutes === null && !row.running) {
    extras.push(h('span', { class: 'tl-warn' }, 'Times are invalid for this date'));
  }
  button.append(h('span', { class: 'tl-extra' }, ...extras));
  return button;
}

/** A timesheet-style chart: one bar per day on a shared hour axis. Every day is tappable. */
export function WeekTimeline(t: Timeline, options: TimelineOptions): HTMLElement {
  const hours = (t.axisEnd - t.axisStart) / 60;
  const list = h(
    'div',
    { class: options.details ? 'timeline timeline-detailed' : 'timeline' },
    axis(t, options.use24h),
    ...t.rows.map((row) => rowElement(row, t, options)),
  );
  list.style.setProperty('--hours', String(hours));
  return list;
}
