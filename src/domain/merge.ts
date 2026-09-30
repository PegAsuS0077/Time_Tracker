import type { DateStr, Entry } from './types';

/** Equality of the user-visible content, ignoring `updatedAt`. */
export function sameContent(a: Entry | undefined, b: Entry | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.date === b.date &&
    a.start === b.start &&
    a.end === b.end &&
    a.breakMinutes === b.breakMinutes &&
    (a.note ?? '') === (b.note ?? '') &&
    (a.deletedAt === undefined) === (b.deletedAt === undefined)
  );
}

const newer = (a: Entry, b: Entry): Entry => (b.updatedAt > a.updatedAt ? b : a);

export interface ImportPlan {
  /** Entries to write (new or newer than the existing one). */
  toWrite: Entry[];
  added: number;
  updated: number;
  unchanged: number;
  /** Incoming entries that are older than what is stored. */
  skipped: number;
}

/** Two-way merge for imports: per date, the newer `updatedAt` wins. */
export function planImport(existing: readonly Entry[], incoming: readonly Entry[]): ImportPlan {
  const byDate = new Map(existing.map((e) => [e.date, e]));
  // If a file lists the same date twice, only its newest version counts.
  const latestIncoming = new Map<DateStr, Entry>();
  for (const entry of incoming) {
    const seen = latestIncoming.get(entry.date);
    latestIncoming.set(entry.date, seen ? newer(seen, entry) : entry);
  }
  const plan: ImportPlan = { toWrite: [], added: 0, updated: 0, unchanged: 0, skipped: 0 };
  for (const entry of latestIncoming.values()) {
    const current = byDate.get(entry.date);
    if (!current) {
      plan.toWrite.push(entry);
      plan.added += 1;
    } else if (sameContent(current, entry)) {
      plan.unchanged += 1;
    } else if (entry.updatedAt > current.updatedAt) {
      plan.toWrite.push(entry);
      plan.updated += 1;
    } else {
      plan.skipped += 1;
    }
  }
  return plan;
}

export interface Conflict {
  date: DateStr;
  local: Entry | undefined;
  remote: Entry | undefined;
}

export interface MergeResult {
  /** The merged set. For conflicting dates it holds the local version for now. */
  merged: Entry[];
  conflicts: Conflict[];
}

/**
 * Three-way merge of one week, by date, against the last-synced base.
 * - Only one side changed → take that side.
 * - Both changed to the same content → take the newer one.
 * - Both changed differently → conflict; the user decides.
 */
export function threeWayMerge(
  base: readonly Entry[],
  local: readonly Entry[],
  remote: readonly Entry[],
): MergeResult {
  const b = new Map(base.map((e) => [e.date, e]));
  const l = new Map(local.map((e) => [e.date, e]));
  const r = new Map(remote.map((e) => [e.date, e]));
  const dates = [...new Set([...b.keys(), ...l.keys(), ...r.keys()])].sort();

  const merged: Entry[] = [];
  const conflicts: Conflict[] = [];
  for (const date of dates) {
    const be = b.get(date);
    const le = l.get(date);
    const re = r.get(date);
    let pick: Entry | undefined;
    if (sameContent(le, re)) {
      pick = le && re ? newer(le, re) : (le ?? re);
    } else if (sameContent(le, be)) {
      pick = re;
    } else if (sameContent(re, be)) {
      pick = le;
    } else {
      conflicts.push({ date, local: le, remote: re });
      pick = le;
    }
    if (pick) merged.push(pick);
  }
  return { merged, conflicts };
}
