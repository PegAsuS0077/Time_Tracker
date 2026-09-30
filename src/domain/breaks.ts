import { computeEntry } from './entries';
import type { Entry } from './types';

/**
 * German legal minimum break (ArbZG §4), applied to attendance time
 * (start to end): more than 6 h → 30 min, more than 9 h → 45 min.
 */
export function legalMinimumBreak(attendanceMinutes: number): number {
  if (attendanceMinutes > 9 * 60) return 45;
  if (attendanceMinutes > 6 * 60) return 30;
  return 0;
}

export interface BreakWarning {
  requiredMinutes: number;
  actualMinutes: number;
}

/** A warning when a closed entry's break is below the legal minimum. Never changes data. */
export function breakWarning(entry: Entry): BreakWarning | null {
  const status = computeEntry(entry);
  if (status.kind !== 'closed') return null;
  const required = legalMinimumBreak(status.grossMinutes);
  if (entry.breakMinutes >= required) return null;
  return { requiredMinutes: required, actualMinutes: entry.breakMinutes };
}
