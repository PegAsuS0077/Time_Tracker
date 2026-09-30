import type { FormErrors, TrackerService } from '../../app/services';
import { breakWarning } from '../../domain/breaks';
import { computeEntry } from '../../domain/entries';
import { formatDateLong, formatDateShort, formatDuration } from '../../domain/format';
import { berlinDateTime } from '../../domain/time';
import type { DateStr, Entry } from '../../domain/types';
import { validateEntryInput, type EntryField, type EntryInput } from '../../domain/validate';
import { append, h, nextId, toast, type Child } from '../dom';
import { openDialog } from './Dialog';

const BREAK_PRESETS = [0, 15, 30, 45, 60];

interface Field {
  name: EntryField;
  input: HTMLInputElement | HTMLTextAreaElement;
  error: HTMLElement;
  wrapper: HTMLElement;
}

function field(
  name: EntryField,
  label: string,
  input: HTMLInputElement | HTMLTextAreaElement,
  options: { hint?: string; extra?: Child; className?: string } = {},
): Field {
  const id = nextId(`f-${name}`);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  input.id = id;
  input.name = name;
  input.setAttribute('aria-describedby', options.hint ? `${hintId} ${errorId}` : errorId);
  const error = h('p', { id: errorId, class: 'field-error', 'aria-live': 'polite' });
  const wrapper = h(
    'div',
    { class: options.className ? `field ${options.className}` : 'field' },
    h('label', { for: id }, label),
    options.extra ? h('div', { class: 'input-row' }, input, options.extra) : input,
    options.hint ? h('p', { id: hintId, class: 'hint' }, options.hint) : null,
    error,
  );
  return { name, input, error, wrapper };
}

/** Delete a day and offer Undo. */
export function deleteWithUndo(service: TrackerService, date: DateStr): Promise<void> {
  const label = formatDateShort(date);
  return service.deleteEntry(date).then(() => {
    toast(`Deleted ${label}.`, 'info', {
      label: 'Undo',
      onClick: () => {
        void service.restoreEntry(date).then((result) => {
          toast(result.ok ? `Restored ${label}.` : result.error, result.ok ? 'info' : 'error');
        });
      },
    });
  });
}

/**
 * Add or edit an entry. With `entry` it edits; otherwise it creates one,
 * prefilled with `date` (default: today) and the default break.
 */
export function openEntryForm(service: TrackerService, entry?: Entry, date?: DateStr): void {
  const { settings } = service.store.get();
  const today = berlinDateTime(service.now()).date;

  const nowButton = (
    target: () => HTMLInputElement | HTMLTextAreaElement | undefined,
    label: string,
  ) =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-small btn-now',
        'aria-label': label,
        onclick: () => {
          const input = target();
          if (!input) return;
          input.value = berlinDateTime(service.now()).time;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        },
      },
      'Now',
    );

  const breakInput = h('input', {
    type: 'number',
    inputmode: 'numeric',
    min: 0,
    max: 1440,
    step: 1,
    required: true,
    value: entry?.breakMinutes ?? settings.defaultBreakMinutes,
  });
  const chips = BREAK_PRESETS.map((minutes) =>
    h(
      'button',
      {
        type: 'button',
        class: 'chip',
        'aria-label': `${minutes} minutes break`,
        onclick: () => {
          breakInput.value = String(minutes);
          breakInput.dispatchEvent(new Event('input', { bubbles: true }));
        },
      },
      String(minutes),
    ),
  );
  const syncChips = (): void => {
    for (const [i, chip] of chips.entries()) {
      chip.setAttribute('aria-pressed', String(breakInput.value === String(BREAK_PRESETS[i])));
    }
  };

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
      {
        className: 'field-half',
        extra: nowButton(() => fields[1]?.input, 'Set start to now'),
      },
    ),
    field('end', 'End', h('input', { type: 'time', value: entry?.end ?? '' }), {
      className: 'field-half',
      extra: nowButton(() => fields[2]?.input, 'Set end to now'),
    }),
    field('breakMinutes', 'Break in minutes', breakInput, {
      extra: h('div', { class: 'chips', role: 'group', 'aria-label': 'Common breaks' }, ...chips),
    }),
    field('note', 'Note', h('textarea', { rows: 2, maxlength: 500, value: entry?.note ?? '' }), {
      hint: 'Optional, e.g. what you worked on or why the day was different.',
    }),
  ];

  const summary = h('div', { class: 'form-summary', 'aria-live': 'polite' });
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
    syncChips();
    const result = validateEntryInput(readInput(), new Date(service.now()).toISOString());
    if (!result.ok) {
      summary.replaceChildren();
      return;
    }
    const e = result.value;
    if (e.end === null) {
      summary.replaceChildren(h('p', null, 'No end time: the day stays open and keeps running.'));
      return;
    }
    const status = computeEntry(e);
    const net = status.kind === 'closed' ? status.netMinutes : 0;
    const warning = settings.legalBreakWarning ? breakWarning(e) : null;
    summary.replaceChildren();
    append(summary, [
      h('p', { class: 'preview-net' }, `${formatDuration(net)} h net`),
      e.end < e.start ? h('p', { class: 'hint' }, 'Ends the next morning.') : null,
      warning
        ? h(
            'p',
            { class: 'notice notice-warn' },
            `German law requires at least ${warning.requiredMinutes} min break for this day.`,
          )
        : null,
    ]);
  };

  const deleteButton = entry
    ? h(
        'button',
        {
          type: 'button',
          class: 'btn btn-danger-text',
          onclick: () => {
            handle.close();
            void deleteWithUndo(service, entry.date);
          },
        },
        'Delete day',
      )
    : null;

  const form = h(
    'form',
    { class: 'entry-form', novalidate: true },
    ...fields.map((f) => f.wrapper),
    summary,
    formError,
    h(
      'div',
      { class: 'actions' },
      deleteButton,
      h('span', { class: 'actions-spacer' }),
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
      h('button', { type: 'submit', class: 'btn btn-primary' }, entry ? 'Save changes' : 'Add day'),
    ),
  );
  form.addEventListener('input', preview);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void service.saveEntry(readInput(), entry?.date).then((result) => {
      if (result.ok) {
        handle.close();
        toast(entry ? 'Changes saved.' : `Added ${formatDateShort(result.value.date)}.`);
      } else {
        showErrors(result.error);
      }
    });
  });

  const title = entry
    ? formatDateLong(entry.date)
    : date
      ? `Add ${formatDateLong(date)}`
      : 'Add day';
  const handle = openDialog(title, [form]);
  preview();
  (entry || date ? fields[1] : fields[0])?.input.focus();
}
