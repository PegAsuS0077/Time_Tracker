// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { h } from '../../src/ui/dom';

describe('h()', () => {
  it('renders text children as text, never as HTML', () => {
    const el = h('p', null, '<img src=x onerror="alert(1)">');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it('sets attribute values literally', () => {
    const el = h('div', { title: '"><script>alert(1)</script>' });
    expect(el.getAttribute('title')).toBe('"><script>alert(1)</script>');
    expect(el.querySelector('script')).toBeNull();
  });

  it('handles booleans, numbers and nullish props', () => {
    const el = h('input', { disabled: true, required: false, min: 0, placeholder: null });
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.hasAttribute('required')).toBe(false);
    expect(el.getAttribute('min')).toBe('0');
    expect(el.hasAttribute('placeholder')).toBe(false);
  });

  it('sets value and checked as properties', () => {
    expect(h('input', { value: 'abc' }).value).toBe('abc');
    expect(h('input', { type: 'checkbox', checked: true }).checked).toBe(true);
    expect(h('textarea', { value: 'note' }).value).toBe('note');
  });

  it('attaches event handlers', () => {
    const onclick = vi.fn();
    h('button', { onclick }).click();
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('skips empty children', () => {
    const el = h('div', null, null, undefined, false, 'a', 1);
    expect(el.textContent).toBe('a1');
  });
});
