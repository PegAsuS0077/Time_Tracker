/**
 * Tiny, safe DOM builder. Text children become text nodes and attribute values
 * go through setAttribute, so user data is never parsed as HTML.
 */

export type Child = Node | string | number | null | undefined | false;

type EventHandlers = {
  [K in keyof HTMLElementEventMap as `on${K}`]?: (event: HTMLElementEventMap[K]) => void;
};

export type Props = EventHandlers & {
  [attr: string]: string | number | boolean | null | undefined | ((event: never) => void);
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (typeof value === 'function') {
        el.addEventListener(key.slice(2), value as EventListener);
      } else if (key === 'value' && 'value' in el) {
        (el as HTMLInputElement).value = String(value);
      } else if (key === 'checked' && el instanceof HTMLInputElement) {
        el.checked = value === true;
      } else {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Element | DocumentFragment, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : String(child));
  }
}

export function clear(el: Element): void {
  el.replaceChildren();
}

let uid = 0;
/** Unique id for label/aria associations. */
export function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${uid}`;
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

/**
 * Announce a message to screen readers and show it as a toast. With an
 * action (e.g. Undo) it stays longer and offers a button.
 */
export function toast(
  message: string,
  kind: 'info' | 'error' = 'info',
  action?: ToastAction,
): void {
  const region = document.getElementById('toasts');
  if (!region) return;
  const item = h(
    'div',
    {
      class: `toast toast-${kind}${action ? ' toast-action' : ''}`,
      role: kind === 'error' ? 'alert' : 'status',
    },
    h('span', null, message),
    action
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small',
            onclick: () => {
              item.remove();
              action.onClick();
            },
          },
          action.label,
        )
      : null,
  );
  region.append(item);
  const duration = action ? 10000 : kind === 'error' ? 8000 : 4000;
  window.setTimeout(() => {
    item.remove();
  }, duration);
}
