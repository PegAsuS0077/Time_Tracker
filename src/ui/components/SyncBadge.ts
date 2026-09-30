import type { AppState, TrackerService } from '../../app/services';
import { berlinDateTime } from '../../domain/time';
import { h } from '../dom';

/** One-line, human-readable sync status. */
export function describeSync(state: AppState): string {
  const { sync } = state;
  const pending =
    sync.pending > 0 ? ` · ${sync.pending} week${sync.pending === 1 ? '' : 's'} waiting` : '';
  switch (sync.status) {
    case 'off':
      return 'Local only (sync off)';
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return `Offline${pending}`;
    case 'error':
      return `Sync problem: ${sync.message ?? 'unknown error'}${pending}`;
    case 'idle': {
      const at = sync.lastSyncedAt
        ? ` at ${berlinDateTime(Date.parse(sync.lastSyncedAt)).time}`
        : '';
      const conflicts = state.conflicts.length > 0 ? ' · conflicts to resolve' : '';
      return `Synced${at}${pending}${conflicts}`;
    }
  }
}

const SHORT: Record<AppState['sync']['status'], string> = {
  off: 'Local',
  syncing: 'Syncing…',
  offline: 'Offline',
  error: 'Sync issue',
  idle: 'Synced',
};

/** Compact status indicator for the header; links to the sync settings. */
export function SyncBadge(service: TrackerService): HTMLElement {
  const label = h('span');
  const badge = h(
    'a',
    { href: '#/settings', class: 'sync-badge' },
    h('span', { class: 'sync-dot', 'aria-hidden': 'true' }),
    label,
  );
  const render = (state: AppState): void => {
    badge.className = `sync-badge sync-${state.sync.status}`;
    label.textContent = SHORT[state.sync.status];
    badge.title = describeSync(state);
    badge.setAttribute('aria-label', `Sync status: ${describeSync(state)}`);
  };
  render(service.store.get());
  service.store.subscribe(render);
  return badge;
}
