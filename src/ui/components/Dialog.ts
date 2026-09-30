import { h, nextId, type Child } from '../dom';

export interface DialogHandle {
  dialog: HTMLDialogElement;
  close: () => void;
}

/**
 * Modal built on <dialog>, attached to <body> so views can re-render underneath.
 * Escape closes it; focus returns to the previously focused element.
 */
export function openDialog(title: string, body: Child[], onClose?: () => void): DialogHandle {
  const titleId = nextId('dialog-title');
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = h(
    'dialog',
    { class: 'dialog', 'aria-labelledby': titleId },
    h('h2', { id: titleId }, title),
    ...body,
  );
  const close = (): void => {
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener('close', () => {
    dialog.remove();
    previous?.focus();
    onClose?.();
  });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close };
}

/** Yes/no confirmation. Resolves true when confirmed. */
export function confirmDialog(
  title: string,
  message: string,
  confirmLabel: string,
  danger = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    const { close } = openDialog(
      title,
      [
        h('p', null, message),
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onclick: () => {
                close();
              },
            },
            'Cancel',
          ),
          h(
            'button',
            {
              type: 'button',
              class: danger ? 'btn btn-danger' : 'btn btn-primary',
              onclick: () => {
                confirmed = true;
                close();
              },
            },
            confirmLabel,
          ),
        ),
      ],
      () => {
        resolve(confirmed);
      },
    );
  });
}
