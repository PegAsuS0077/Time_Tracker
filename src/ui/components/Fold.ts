import { h, type Child } from '../dom';

/**
 * A collapsible settings group built on <details>/<summary>, so it is
 * keyboard and screen-reader friendly without any script.
 */
export function Fold(
  title: string,
  subtitle: Child,
  body: readonly Child[],
  open = false,
): { el: HTMLDetailsElement; subtitle: HTMLElement } {
  const sub = h('span', { class: 'fold-sub' }, subtitle);
  const el = h(
    'details',
    { class: 'sheet fold', open },
    h('summary', null, h('span', { class: 'fold-title' }, title), sub),
    h('div', { class: 'fold-body' }, ...body),
  );
  return { el, subtitle: sub };
}
