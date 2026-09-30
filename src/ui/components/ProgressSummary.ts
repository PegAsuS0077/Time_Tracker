import { formatDuration, weekdayShort } from '../../domain/format';
import type { Progress } from '../../domain/timeline';
import { h } from '../dom';

/** "Ahead / behind" line, phrased against the workdays that are already over. */
export function deltaText(p: Progress, period: 'week' | 'month'): string | null {
  if (p.deltaToDateMinutes === null) return null;
  if (p.countedThrough === null) return 'Target starts after the first workday';
  const through =
    period === 'week'
      ? weekdayShort(p.countedThrough)
      : `the ${ordinal(Number(p.countedThrough.slice(8)))}`;
  const d = p.deltaToDateMinutes;
  if (d === 0) return `On target through ${through}`;
  return d > 0
    ? `${formatDuration(d)} ahead through ${through}`
    : `${formatDuration(-d)} behind through ${through}`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** Total with an optional progress bar toward the contracted hours. */
export function ProgressSummary(
  p: Progress,
  headingId: string,
  title: string,
  subtitle: string,
  period: 'week' | 'month' = 'week',
): HTMLElement {
  const total = p.closedMinutes + p.runningMinutes;
  const header = h(
    'div',
    { class: 'sum-head' },
    h(
      'div',
      null,
      h('h3', { id: headingId, class: 'sum-title' }, title),
      h('p', { class: 'sum-sub' }, subtitle),
    ),
    h('p', { class: 'sum-total' }, formatDuration(total), h('span', { class: 'unit' }, ' h')),
  );
  const parts: HTMLElement[] = [header];

  if (p.targetMinutes !== null && p.targetMinutes > 0) {
    const meter = h('div', { class: 'meter', 'aria-hidden': 'true' });
    const done = h('span', { class: 'meter-done' });
    done.style.setProperty(
      '--w',
      `${Math.min(100, (p.closedMinutes / p.targetMinutes) * 100).toFixed(2)}%`,
    );
    const running = h('span', { class: 'meter-running' });
    running.style.setProperty(
      '--w',
      `${Math.min(100, (p.runningMinutes / p.targetMinutes) * 100).toFixed(2)}%`,
    );
    const mark = h('span', { class: 'meter-mark' });
    mark.style.setProperty(
      '--at',
      `${Math.min(100, ((p.targetToDateMinutes ?? 0) / p.targetMinutes) * 100).toFixed(2)}%`,
    );
    meter.append(done, running, mark);
    const delta = p.deltaToDateMinutes ?? 0;
    parts.push(
      meter,
      h(
        'p',
        { class: 'sum-foot' },
        h('span', { class: delta >= 0 ? 'ahead' : 'behind' }, deltaText(p, period) ?? ''),
        h('span', { class: 'sum-target' }, `of ${formatDuration(p.targetMinutes)} h`),
      ),
    );
  } else if (p.runningMinutes > 0) {
    parts.push(
      h(
        'p',
        { class: 'sum-foot' },
        `Includes ${formatDuration(p.runningMinutes)} h from the running day`,
      ),
    );
  }
  return h('div', { class: 'summary' }, ...parts);
}
