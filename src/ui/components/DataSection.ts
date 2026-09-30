import type { CsvScope, ExportFile, ImportPreview, TrackerService } from '../../app/services';
import { activeEntries } from '../../domain/entries';
import { formatMonth, formatWeekRange } from '../../domain/format';
import { berlinDateTime } from '../../domain/time';
import { monthKey, shortWeekLabel, weekKey } from '../../domain/week';
import { h, nextId, toast } from '../dom';
import { openDialog } from './Dialog';
import { Fold } from './Fold';

/** Trigger a browser download of generated text. */
export function download(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const link = h('a', { href: url, download: file.filename, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function select(
  label: string,
  options: { value: string; text: string }[],
): {
  wrapper: HTMLElement;
  select: HTMLSelectElement;
} {
  const id = nextId('sel');
  const el = h('select', { id }, ...options.map((o) => h('option', { value: o.value }, o.text)));
  return { wrapper: h('div', { class: 'field' }, h('label', { for: id }, label), el), select: el };
}

function confirmImport(service: TrackerService, preview: ImportPreview): void {
  const { plan, preferences, invalid } = preview;
  const restore = h('input', { type: 'checkbox', id: nextId('restore') });
  const lines = [
    `${plan.added} new ${plan.added === 1 ? 'day' : 'days'}`,
    `${plan.updated} updated (the file’s version is newer)`,
    `${plan.unchanged} unchanged`,
    `${plan.skipped} skipped (this device’s version is newer)`,
  ];
  if (invalid > 0) lines.push(`${invalid} invalid ${invalid === 1 ? 'entry' : 'entries'} ignored`);

  const handle = openDialog('Import backup?', [
    h('ul', null, ...lines.map((l) => h('li', null, l))),
    preferences
      ? h(
          'div',
          { class: 'field field-check' },
          restore,
          h('label', { for: restore.id }, 'Also restore preferences (break, hours, display)'),
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
            handle.close();
          },
        },
        'Cancel',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-primary',
          disabled: plan.toWrite.length === 0 && !preferences,
          onclick: () => {
            void service.applyImport(preview, restore.checked).then(() => {
              handle.close();
              toast(
                `Imported ${plan.toWrite.length} ${plan.toWrite.length === 1 ? 'day' : 'days'}.`,
              );
            });
          },
        },
        'Import',
      ),
    ),
  ]);
}

/** Settings section: CSV export, JSON backup and restore. */
export function DataSection(service: TrackerService): HTMLElement {
  const { entries } = service.store.get();
  const today = berlinDateTime(service.now()).date;
  const active = activeEntries(entries);

  const weeks = [...new Set([weekKey(today), ...active.map((e) => weekKey(e.date))])]
    .sort()
    .reverse();
  const months = [...new Set([monthKey(today), ...active.map((e) => monthKey(e.date))])]
    .sort()
    .reverse();

  const weekSelect = select(
    'Week',
    weeks.map((w) => ({ value: w, text: `${shortWeekLabel(w)} · ${formatWeekRange(w)}` })),
  );
  const monthSelect = select(
    'Month',
    months.map((m) => ({ value: m, text: formatMonth(m) })),
  );

  const exportCsv = (scope: CsvScope): void => {
    download(service.exportCsv(scope));
  };

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    id: nextId('import'),
  });
  const importError = h('p', { class: 'field-error', role: 'alert' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    importError.textContent = '';
    void file
      .text()
      .then((text) => {
        const preview = service.previewImport(text);
        if (!preview.ok) {
          importError.textContent = preview.error;
          return;
        }
        confirmImport(service, preview.value);
      })
      .catch(() => {
        importError.textContent = 'The file could not be read.';
      });
  });

  return Fold('Export and backup', 'CSV for spreadsheets, JSON backup and restore', [
    h('h4', null, 'CSV for spreadsheets'),
    weekSelect.wrapper,
    h(
      'div',
      { class: 'data-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: () => {
            exportCsv({ kind: 'week', key: weekSelect.select.value });
          },
        },
        'Export week',
      ),
    ),
    monthSelect.wrapper,
    h(
      'div',
      { class: 'data-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: () => {
            exportCsv({ kind: 'month', key: monthSelect.select.value });
          },
        },
        'Export month',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: () => {
            exportCsv({ kind: 'all' });
          },
        },
        'Export everything',
      ),
    ),
    h('h4', null, 'JSON backup'),
    h(
      'p',
      { class: 'hint' },
      'A complete copy of your entries and preferences (never your GitHub token). Keep backups somewhere safe, e.g. a cloud drive or USB stick.',
    ),
    h(
      'div',
      { class: 'data-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-primary',
          onclick: () => {
            download(service.exportBackup());
          },
        },
        'Download backup',
      ),
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { for: fileInput.id }, 'Restore from backup'),
      fileInput,
      h(
        'p',
        { class: 'hint' },
        'Merges by date: for each day, the most recently changed version wins. You will see a summary before anything is changed.',
      ),
      importError,
    ),
  ]).el;
}
