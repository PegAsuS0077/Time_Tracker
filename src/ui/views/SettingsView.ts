import type { AppState, TrackerService } from '../../app/services';
import type { Settings } from '../../domain/types';
import { h, nextId, toast } from '../dom';
import type { View } from './View';

function labelled(label: string, input: HTMLInputElement, hint?: string): HTMLElement {
  const id = nextId('s');
  input.id = id;
  const hintEl = hint ? h('p', { id: `${id}-hint`, class: 'hint' }, hint) : null;
  if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
  const isCheck = input.type === 'checkbox';
  return h(
    'div',
    { class: isCheck ? 'field field-check' : 'field' },
    isCheck ? input : null,
    h('label', { for: id }, label),
    isCheck ? null : input,
    hintEl,
  );
}

function workSection(service: TrackerService, settings: Settings): HTMLElement {
  const defaultBreak = h('input', {
    type: 'number',
    min: 0,
    max: 600,
    step: 1,
    inputmode: 'numeric',
    required: true,
    value: settings.defaultBreakMinutes,
  });
  const legal = h('input', { type: 'checkbox', checked: settings.legalBreakWarning });
  const contractedOn = h('input', {
    type: 'checkbox',
    checked: settings.contractedWeeklyHours !== null,
  });
  const contracted = h('input', {
    type: 'number',
    min: 0,
    max: 100,
    step: 0.25,
    inputmode: 'decimal',
    value: settings.contractedWeeklyHours ?? 40,
    disabled: settings.contractedWeeklyHours === null,
  });
  const use24h = h('input', { type: 'checkbox', checked: settings.use24h });
  const error = h('p', { class: 'field-error', role: 'alert' });
  contractedOn.addEventListener('change', () => {
    contracted.disabled = !contractedOn.checked;
  });

  const form = h(
    'form',
    { novalidate: true },
    labelled(
      'Default break (minutes)',
      defaultBreak,
      'Pre-filled when you start a day or add one.',
    ),
    labelled(
      'Warn when a break is below the German legal minimum',
      legal,
      '30 min for more than 6 h, 45 min for more than 9 h (ArbZG §4). Warning only; your numbers are never changed.',
    ),
    labelled('Track contracted weekly hours', contractedOn),
    labelled(
      'Contracted hours per week',
      contracted,
      'Shows overtime or shortfall. The month target assumes Mon–Fri and ignores public holidays.',
    ),
    labelled('24-hour time display', use24h),
    error,
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save preferences'),
    ),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const breakValue = Number(defaultBreak.value);
    const hoursValue = Number(contracted.value);
    if (!Number.isInteger(breakValue) || breakValue < 0 || breakValue > 600) {
      error.textContent = 'Default break must be a whole number between 0 and 600.';
      defaultBreak.focus();
      return;
    }
    if (
      contractedOn.checked &&
      (!Number.isFinite(hoursValue) || hoursValue <= 0 || hoursValue > 100)
    ) {
      error.textContent = 'Contracted hours must be between 0 and 100.';
      contracted.focus();
      return;
    }
    error.textContent = '';
    const current = service.store.get().settings;
    void service
      .saveSettings({
        ...current,
        defaultBreakMinutes: breakValue,
        legalBreakWarning: legal.checked,
        contractedWeeklyHours: contractedOn.checked ? hoursValue : null,
        use24h: use24h.checked,
      })
      .then(() => {
        toast('Preferences saved.');
      });
  });

  return h(
    'section',
    { class: 'sheet', 'aria-labelledby': 'work-title' },
    h('h3', { id: 'work-title', class: 'sheet-title' }, 'Work preferences'),
    form,
  );
}

function storageSection(): HTMLElement {
  const status = h('p', { class: 'muted' }, 'Checking storage…');
  const persist = navigator.storage as StorageManager | undefined;
  if (persist?.persisted) {
    void persist.persisted().then((isPersisted) => {
      status.textContent = isPersisted
        ? 'This browser will keep your data (persistent storage granted).'
        : 'The browser may clear data under storage pressure. Install the app and export backups regularly.';
    });
  } else {
    status.textContent = 'Persistent storage status is unavailable in this browser.';
  }
  return h(
    'section',
    { class: 'sheet sheet-compact', 'aria-labelledby': 'storage-title' },
    h('h3', { id: 'storage-title', class: 'sheet-title' }, 'On this device'),
    status,
  );
}

/** Additional settings sections (export/import, sync), rendered after preferences. */
export type SettingsSection = (service: TrackerService) => HTMLElement;

export function SettingsView(
  service: TrackerService,
  sections: readonly SettingsSection[] = [],
): View {
  const el = h('section', { class: 'view', 'aria-labelledby': 'settings-title' });
  let renderedSettings: Settings | null = null;

  function render(state: AppState): void {
    // Forms keep user input, so only rebuild when the settings themselves change.
    if (renderedSettings === state.settings) return;
    renderedSettings = state.settings;
    el.replaceChildren(
      h('h2', { id: 'settings-title', class: 'view-title', tabindex: -1 }, 'Settings'),
      workSection(service, state.settings),
      ...sections.map((section) => section(service)),
      storageSection(),
    );
  }

  render(service.store.get());
  return { el, update: render, destroy: () => undefined };
}
