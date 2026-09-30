import { registerSW } from 'virtual:pwa-register';
import { h, toast } from '../ui/dom';

/**
 * Register the service worker. New versions wait until the user chooses to
 * reload, so nothing is interrupted mid-edit.
 */
export function setupPwa(): void {
  if (!('serviceWorker' in navigator)) return;

  const updateSW = registerSW({
    onNeedRefresh() {
      const region = document.getElementById('toasts');
      if (!region) return;
      const prompt = h(
        'div',
        { class: 'toast toast-update', role: 'status' },
        h('span', null, 'A new version is available.'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small',
            onclick: () => {
              void updateSW(true);
            },
          },
          'Reload',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small',
            onclick: () => {
              prompt.remove();
            },
          },
          'Later',
        ),
      );
      region.append(prompt);
    },
    onOfflineReady() {
      toast('Ready to work offline.');
    },
    onRegisterError(error: unknown) {
      console.error('Service worker registration failed', error);
    },
  });
}
