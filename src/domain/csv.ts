import { activeEntries, computeEntry } from './entries';
import { formatHoursDecimal, weekdayShort } from './format';
import { weekKey } from './week';
import type { Entry } from './types';

export const CSV_HEADER = [
  'week',
  'date',
  'weekday',
  'start',
  'end',
  'break_minutes',
  'net_minutes',
  'net_hours',
  'note',
] as const;

/**
 * Quote a CSV field (RFC 4180) and neutralise spreadsheet formula injection:
 * values starting with = + - @ tab or CR get a leading apostrophe.
 */
export function escapeCsvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV of active entries sorted by date, with a UTF-8 BOM so Excel reads umlauts correctly. */
export function entriesToCsv(entries: readonly Entry[]): string {
  const rows = activeEntries(entries)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => {
      const status = computeEntry(entry);
      const net = status.kind === 'closed' ? status.netMinutes : null;
      return [
        weekKey(entry.date),
        entry.date,
        weekdayShort(entry.date),
        entry.start,
        entry.end ?? '',
        String(entry.breakMinutes),
        net === null ? '' : String(net),
        net === null ? '' : formatHoursDecimal(net),
        entry.note ?? '',
      ];
    });
  const lines = [CSV_HEADER, ...rows].map((cols) => cols.map(escapeCsvField).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
