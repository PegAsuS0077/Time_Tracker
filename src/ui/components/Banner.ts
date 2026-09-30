import type { AppState, TrackerService } from '../../app/services';
import { h } from '../dom';
import { openConflictDialog } from './ConflictDialog';

/** Persistent, page-level alerts: storage failures, sync conflicts, public repo. */
export function Banner(service: TrackerService): {
  el: HTMLElement;
  update(state: AppState): void;
} {
  const el = h('div', { class: 'banners' });

  const update = (state: AppState): void => {
    const items: HTMLElement[] = [];
    if (state.storageError) {
      items.push(h('p', { class: 'banner banner-error', role: 'alert' }, state.storageError));
    }
    if (state.sync.publicRepo) {
      items.push(
        h(
          'p',
          { class: 'banner banner-error', role: 'alert' },
          'Your data repository is PUBLIC. Anyone can read your working hours. Make it private on GitHub. Sync is paused until you do, or until you explicitly allow it in Settings.',
        ),
      );
    }
    if (state.conflicts.length > 0) {
      const n = state.conflicts.length;
      items.push(
        h(
          'div',
          { class: 'banner banner-warning', role: 'status' },
          h(
            'span',
            null,
            `${n} ${n === 1 ? 'day was' : 'days were'} changed on this device and elsewhere. Choose which version to keep.`,
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small',
              onclick: () => {
                openConflictDialog(service);
              },
            },
            'Resolve',
          ),
        ),
      );
    }
    el.replaceChildren(...items);
  };

  update(service.store.get());
  return { el, update };
}
