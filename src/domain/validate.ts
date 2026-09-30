import { berlinToEpoch, elapsedMinutes, isValidDate, isValidTime } from './time';
import { err, ok, type Entry, type Result } from './types';

export const MAX_NOTE_LENGTH = 500;
export const MAX_BREAK_MINUTES = 24 * 60;

/** Raw values as they come from a form. */
export interface EntryInput {
  date: string;
  start: string;
  /** Empty string means the day is still open. */
  end: string;
  breakMinutes: string | number;
  note: string;
}

export type EntryField = 'date' | 'start' | 'end' | 'breakMinutes' | 'note';
export type FieldErrors = Partial<Record<EntryField, string>>;

const NONEXISTENT_MSG = 'This time does not exist on this date (clocks jump from 02:00 to 03:00).';

/** Remove control characters except tab and newline. */
export function cleanNote(note: string): string {
  let out = '';
  for (const ch of note) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = (code < 0x20 && ch !== '\n' && ch !== '\t') || code === 0x7f;
    if (!isControl) out += ch;
  }
  return out.trim();
}

function parseBreak(value: string | number): number | null {
  const text = String(value).trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  const n = Number(text);
  return n <= MAX_BREAK_MINUTES ? n : null;
}

/** Validate form input and build an Entry stamped with `updatedAt`. */
export function validateEntryInput(
  input: EntryInput,
  updatedAt: string,
): Result<Entry, FieldErrors> {
  const errors: FieldErrors = {};
  const date = input.date.trim();
  const start = input.start.trim();
  const end = input.end.trim();

  if (!isValidDate(date)) errors.date = 'Enter a valid date.';

  if (!isValidTime(start)) errors.start = 'Enter a start time as HH:mm.';
  else if (!errors.date && !berlinToEpoch(date, start).ok) errors.start = NONEXISTENT_MSG;

  if (end !== '' && !isValidTime(end))
    errors.end = 'Enter an end time as HH:mm, or leave it empty.';

  const breakMinutes = parseBreak(input.breakMinutes);
  if (breakMinutes === null) {
    errors.breakMinutes = `Break must be a whole number of minutes between 0 and ${MAX_BREAK_MINUTES}.`;
  }

  const note = cleanNote(input.note);
  if (note.length > MAX_NOTE_LENGTH) {
    errors.note = `Note must be at most ${MAX_NOTE_LENGTH} characters.`;
  }

  if (!errors.date && !errors.start && end !== '' && !errors.end) {
    const elapsed = elapsedMinutes(date, start, end);
    if (!elapsed.ok) {
      errors.end =
        elapsed.error === 'zero-length'
          ? 'End time must differ from start time.'
          : elapsed.error === 'nonexistent'
            ? NONEXISTENT_MSG
            : 'Enter a valid end time.';
    } else if (breakMinutes !== null && breakMinutes >= elapsed.value) {
      errors.breakMinutes = 'Break must be shorter than the time between start and end.';
    }
  }

  if (Object.keys(errors).length > 0 || breakMinutes === null) return err(errors);

  const entry: Entry = { date, start, end: end === '' ? null : end, breakMinutes, updatedAt };
  if (note !== '') entry.note = note;
  return ok(entry);
}

const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TS_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Validate an untrusted value (from an import file or the remote repo) and
 * return a clean Entry with only known fields, or null if it is malformed.
 */
export function parseEntry(value: unknown): Entry | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const { date, start, end, breakMinutes, note, updatedAt, deletedAt } = v;
  if (typeof date !== 'string' || !isValidDate(date)) return null;
  if (typeof start !== 'string' || !isValidTime(start)) return null;
  if (end !== null && (typeof end !== 'string' || !isValidTime(end))) return null;
  if (
    typeof breakMinutes !== 'number' ||
    !Number.isInteger(breakMinutes) ||
    breakMinutes < 0 ||
    breakMinutes > MAX_BREAK_MINUTES
  ) {
    return null;
  }
  if (note !== undefined && typeof note !== 'string') return null;
  if (!isIsoTimestamp(updatedAt)) return null;
  if (deletedAt !== undefined && !isIsoTimestamp(deletedAt)) return null;

  const entry: Entry = { date, start, end, breakMinutes, updatedAt };
  if (note !== undefined) {
    const cleaned = cleanNote(note).slice(0, MAX_NOTE_LENGTH);
    if (cleaned !== '') entry.note = cleaned;
  }
  if (deletedAt !== undefined) entry.deletedAt = deletedAt;
  return entry;
}
