import type { FormErrors, TrackerService } from '../../app/services';
import { breakWarning } from '../../domain/breaks';
import { computeEntry } from '../../domain/entries';
import { formatDuration } from '../../domain/format';
import { berlinDateTime } from '../../domain/time';
import type { DateStr, Entry } from '../../domain/types';
import { validateEntryInput, type EntryField, type EntryInput } from '../../domain/validate';
import { h, nextId, toast } from '../dom';
import { openDialog } from './Dialog';

interface Field {
  name: EntryField;
  label: string;
  input: HTMLInputElement | HTMLTextAreaElement;
  error: HTMLElement;
  wrapper: HTMLElement;
}

function field(
  name: EntryField,
  label: string,
  input: HTMLInputElement | HTMLTextAreaElement,
  hint?: string,
): Field {
  const id = nextId(`f-${name}`);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  input.id = id;
  input.name = name;
  input.setAttribute('aria-describedby', hint ? `${hintId} ${errorId}` : errorId);
  const error = h('p', { id: errorId, class: 'field-error', 'aria-live': 'polite' });
  const wrapper = h(
    'div',
    { class: 'field' },
    h('label', { for: id }, label),
    input,
    hint ? h('p', { id: hintId, class: 'hint' }, hint) : null,
    error,
  );
  return { name, label, input, error, wrapper };
}

/**
 * Add or edit an entry. With `entry` it edits; otherwise it creates one,
 * prefilled with `date` (default: today) and the default break.
 */
export function openEntryForm(service: TrackerService, entry?: Entry, date?: DateStr): void {
  const { settings } = service.store.get();
  const today = berlinDateTime(service.now()).date;

  const fields: Field[] = [
    field(
      'date',
      'Date',
      h('input', { type: 'date', required: true, value: entry?.date ?? date ?? today }),
    ),
    field(
      'start',
      'Start',
      h('input', { type: 'time', required: true, value: entry?.start ?? '' }),
    ),
    field(
      'end',
      'End',
      h('input', { type: 'time', value: entry?.end ?? '' }),
      'Leave empty if the day is still running. An end before the start means the next day.',
    ),
    field(
      'breakMinutes',
      'Break (minutes)',
      h('input', {
        type: 'number',
        inputmode: 'numeric',
        min: 0,
        max: 1440,
        step: 1,
        required: true,
        value: entry?.breakMinutes ?? settings.defaultBreakMinutes,
      }),
    ),
    field(
      'note',
      'Note (optional)',
      h('textarea', { rows: 2, maxlength: 500, value: entry?.note ?? '' }),
    ),
  ];

  const summary = h('p', { class: 'form-summary', 'aria-live': 'polite' });
  const formError = h('p', { class: 'field-error', role: 'alert' });

  const readInput = (): EntryInput => {
    const get = (name: EntryField): string =>
      fields.find((f) => f.name === name)?.input.value ?? '';
    return {
      date: get('date'),
      start: get('start'),
      end: get('end'),
      breakMinutes: get('breakMinutes'),
      note: get('note'),
    };
  };

  const showErrors = (errors: FormErrors): void => {
    for (const f of fields) {
      const message = errors[f.name] ?? '';
      f.error.textContent = message;
      f.input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }
    formError.textContent = errors.form ?? '';
    fields.find((f) => errors[f.name])?.input.focus();
  };

  /** Live preview of net time and the legal break warning. */
  const preview = (): void => {
    const result = validateEntryInput(readInput(), new Date(service.now()).toISOString());
    if (!result.ok || result.value.end === null) {
      summary.textContent = '';
      return;
    }
    const e = result.value;
    const warning = settings.legalBreakWarning ? breakWarning(e) : null;
    const status = computeEntry(e);
    const net = status.kind === 'closed' ? status.netMinutes : 0;
    const parts = [`Net ${formatDuration(net)} h`];
    if (warning) {
      parts.push(
        `Note: German law requires at least ${warning.requiredMinutes} min break for this day.`,
      );
    }
    summary.textContent = parts.join(' · ');
  };

  const form = h(
    'form',
    { class: 'entry-form', novalidate: true },
    ...fields.map((f) => f.wrapper),
    summary,
    formError,
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
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'),
    ),
  );
  form.addEventListener('input', preview);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void service.saveEntry(readInput(), entry?.date).then((result) => {
      if (result.ok) {
        handle.close();
        toast('Saved.');
      } else {
        showErrors(result.error);
      }
    });
  });

  const handle = openDialog(entry ? 'Edit day' : 'Add day', [form]);
  preview();
  (entry || date ? fields[1] : fields[0])?.input.focus();
}
