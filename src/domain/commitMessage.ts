import { weekdayShort } from './format';
import { sameContent } from './merge';
import { shortWeekLabel } from './week';
import type { DateStr, Entry, WeekKey } from './types';

export interface Change {
  date: DateStr;
  kind: 'update' | 'delete';
}

/** Dates whose content differs between two versions of a week. */
export function describeChanges(before: readonly Entry[], after: readonly Entry[]): Change[] {
  const prev = new Map(before.map((e) => [e.date, e]));
  const next = new Map(after.map((e) => [e.date, e]));
  const dates = [...new Set([...prev.keys(), ...next.keys()])].sort();
  const changes: Change[] = [];
  for (const date of dates) {
    const p = prev.get(date);
    const n = next.get(date);
    if (sameContent(p, n)) continue;
    const deleted = n === undefined || n.deletedAt !== undefined;
    changes.push({ date, kind: deleted ? 'delete' : 'update' });
  }
  return changes;
}

const label = (date: DateStr): string => `${weekdayShort(date)} ${date}`;

/** e.g. `W40: update Wed 2026-09-30` or `W40: update Mon 2026-09-28; delete Tue 2026-09-29`. */
export function commitMessage(week: WeekKey, changes: readonly Change[]): string {
  const prefix = shortWeekLabel(week);
  const updates = changes.filter((c) => c.kind === 'update').map((c) => label(c.date));
  const deletes = changes.filter((c) => c.kind === 'delete').map((c) => label(c.date));
  const parts: string[] = [];
  if (updates.length > 0) parts.push(`update ${updates.join(', ')}`);
  if (deletes.length > 0) parts.push(`delete ${deletes.join(', ')}`);
  return `${prefix}: ${parts.length > 0 ? parts.join('; ') : 'sync'}`;
}
