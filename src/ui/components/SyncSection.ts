import type { AppState, TrackerService } from '../../app/services';
import type { SyncSettings } from '../../domain/types';
import { h, nextId, toast } from '../dom';
import { confirmDialog } from './Dialog';
import { Fold } from './Fold';
import { describeSync } from './SyncBadge';

function textField(
  label: string,
  input: HTMLInputElement,
  hint?: string,
): { wrapper: HTMLElement; input: HTMLInputElement } {
  input.id = nextId('sync');
  const hintEl = hint ? h('p', { id: `${input.id}-hint`, class: 'hint' }, hint) : null;
  if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
  return {
    wrapper: h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hintEl),
    input,
  };
}

function tokenHelp(): HTMLElement {
  return h(
    'details',
    { class: 'token-help' },
    h('summary', null, 'How to create the token'),
    h(
      'ol',
      null,
      h(
        'li',
        null,
        'Create a private repository on GitHub for your data (e.g. “work-hours-data”), with a README so it has a main branch.',
      ),
      h(
        'li',
        null,
        'GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.',
      ),
      h('li', null, 'Expiration: 90 days (set a reminder to renew it).'),
      h(
        'li',
        null,
        'Repository access: “Only select repositories” → choose only your data repository.',
      ),
      h(
        'li',
        null,
        'Permissions → Repository permissions → Contents: “Read and write”. Metadata: read-only is added automatically. Nothing else.',
      ),
      h('li', null, 'Copy the token and paste it here. GitHub shows it only once.'),
    ),
  );
}

/** Settings section: GitHub sync configuration and status. */
export function SyncSection(service: TrackerService): HTMLElement {
  const { sync } = service.store.get().settings;

  const enabled = h('input', { type: 'checkbox', checked: sync.enabled, id: nextId('sync') });
  const owner = textField(
    'GitHub owner',
    h('input', {
      type: 'text',
      value: sync.owner,
      autocomplete: 'off',
      spellcheck: 'false',
      autocapitalize: 'off',
    }),
    'Your GitHub username (or organisation).',
  );
  const repo = textField(
    'Data repository',
    h('input', {
      type: 'text',
      value: sync.repo,
      autocomplete: 'off',
      spellcheck: 'false',
      autocapitalize: 'off',
    }),
    'Must be private. One file per ISO week, e.g. 2026/2026-W40.json.',
  );
  const branch = textField(
    'Branch',
    h('input', {
      type: 'text',
      value: sync.branch,
      autocomplete: 'off',
      spellcheck: 'false',
      autocapitalize: 'off',
    }),
  );
  const token = textField(
    'Fine-grained personal access token',
    h('input', {
      type: 'password',
      value: sync.token,
      autocomplete: 'off',
      spellcheck: 'false',
      autocapitalize: 'off',
      placeholder: 'github_pat_…',
    }),
    'Stored only in this browser on this device. It is never exported, logged or sent anywhere except api.github.com.',
  );
  const allowPublic = h('input', {
    type: 'checkbox',
    checked: sync.allowPublicRepo,
    id: nextId('sync'),
  });
  const result = h('p', { class: 'hint', role: 'status' });
  const status = h('p', { class: 'sync-status', role: 'status' });

  const readForm = (): SyncSettings => ({
    enabled: enabled.checked,
    owner: owner.input.value.trim(),
    repo: repo.input.value.trim(),
    branch: branch.input.value.trim() || 'main',
    token: token.input.value.trim(),
    allowPublicRepo: allowPublic.checked,
  });

  const save = async (next: SyncSettings, message: string): Promise<void> => {
    await service.saveSettings({ ...service.store.get().settings, sync: next });
    toast(message);
  };

  const form = h(
    'form',
    { novalidate: true },
    h(
      'div',
      { class: 'field field-check' },
      enabled,
      h('label', { for: enabled.id }, 'Sync with a private GitHub repository'),
    ),
    owner.wrapper,
    repo.wrapper,
    branch.wrapper,
    token.wrapper,
    tokenHelp(),
    h(
      'div',
      { class: 'field field-check' },
      allowPublic,
      h(
        'label',
        { for: allowPublic.id },
        'Allow syncing even if the repository is public (not recommended)',
      ),
    ),
    result,
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: () => {
            result.textContent = 'Testing…';
            void service.testConnection(readForm()).then((r) => {
              if (!r.ok) {
                result.textContent = r.error;
              } else if (!r.value.private) {
                result.textContent = `Connected to ${r.value.fullName}, but it is PUBLIC. Make it private before syncing.`;
              } else if (!r.value.canPush) {
                result.textContent = `Connected to ${r.value.fullName} (private), but the token cannot write to it.`;
              } else {
                result.textContent = `Connected to ${r.value.fullName} (private). Ready to sync.`;
              }
            });
          },
        },
        'Test connection',
      ),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save sync settings'),
    ),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save(readForm(), 'Sync settings saved.');
  });

  const removeToken = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-danger',
      onclick: () => {
        void confirmDialog(
          'Remove token?',
          'The token will be deleted from this device and sync switched off. Your entries stay here. Also revoke the token on GitHub if you no longer need it.',
          'Remove token',
          true,
        ).then((confirmed) => {
          if (!confirmed) return;
          token.input.value = '';
          enabled.checked = false;
          void save(
            { ...readForm(), token: '', enabled: false },
            'Token removed from this device.',
          );
        });
      },
    },
    'Remove token',
  );

  const syncNow = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      onclick: () => {
        void service.sync();
      },
    },
    'Sync now',
  );

  const renderStatus = (state: AppState): void => {
    status.textContent = describeSync(state);
    syncNow.disabled = state.sync.status === 'off' || state.sync.status === 'syncing';
  };
  renderStatus(service.store.get());
  const unsubscribe = service.store.subscribe((state) => {
    if (!status.isConnected) {
      unsubscribe();
      return;
    }
    renderStatus(state);
  });

  const configured = sync.enabled && sync.token !== '';
  return Fold(
    'GitHub sync',
    configured ? `${sync.owner}/${sync.repo}` : 'Off. Your data stays on this device.',
    [
      configured
        ? null
        : h(
            'p',
            { class: 'hint' },
            'Optional. Keeps a tamper-evident history of your hours in your own private repository: every change is a commit. The app works fully offline without it.',
          ),
      configured ? status : null,
      configured || sync.token
        ? h(
            'div',
            { class: 'data-actions' },
            configured ? syncNow : null,
            sync.token ? removeToken : null,
          )
        : null,
      configured
        ? h('details', { class: 'subfold' }, h('summary', null, 'Change sync settings'), form)
        : form,
    ],
    !configured,
  ).el;
}
