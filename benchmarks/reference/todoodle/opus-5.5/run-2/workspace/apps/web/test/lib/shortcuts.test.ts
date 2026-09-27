import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTypingTarget, listShortcuts, shortcutStatsForTests, useGlobalShortcut } from '@/lib/shortcuts';

function key(k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const els: HTMLElement[] = [];
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  document.body.append(node);
  els.push(node);
  return node;
}
afterEach(() => els.splice(0).forEach((node) => node.remove()));

describe('isTypingTarget', () => {
  it('TC-46 true for text inputs, textarea, select and contenteditable; false for body and button', () => {
    expect(isTypingTarget(el('input', { type: 'text' }))).toBe(true);
    expect(isTypingTarget(el('input'))).toBe(true);
    expect(isTypingTarget(el('input', { type: 'search' }))).toBe(true);
    expect(isTypingTarget(el('textarea'))).toBe(true);
    expect(isTypingTarget(el('select'))).toBe(true);
    expect(isTypingTarget(el('div', { contenteditable: 'true' }))).toBe(true);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(el('button'))).toBe(false);
    expect(isTypingTarget(el('input', { type: 'checkbox' }))).toBe(false);
    expect(isTypingTarget(el('div', { contenteditable: 'false' }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('shortcut registry', () => {
  it('TC-99 five shortcuts from five hooks add exactly one document keydown listener', () => {
    const spy = vi.spyOn(document, 'addEventListener');
    const hooks = ['a', 'b', 'c', 'd', 'e'].map((k) =>
      renderHook(() => useGlobalShortcut(k, () => {}, { description: k, group: 'General' })),
    );
    expect(spy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    hooks.forEach((h) => h.unmount());
  });

  it('TC-100 the most recent entry for a key wins; unmounting it restores the previous one', () => {
    const a = vi.fn();
    const b = vi.fn();
    renderHook(() => useGlobalShortcut('q', a, { description: 'A', group: 'Tasks' }));
    const hookB = renderHook(() => useGlobalShortcut('q', b, { description: 'B', group: 'Tasks' }));
    key('q');
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    hookB.unmount();
    key('q');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('TC-101 "?" runs with Shift held; q never runs with Ctrl, Meta or Alt (or Shift)', () => {
    const help = vi.fn();
    const q = vi.fn();
    renderHook(() => useGlobalShortcut('?', help, { description: 'Help', group: 'General' }));
    renderHook(() => useGlobalShortcut('q', q, { description: 'Add', group: 'Tasks' }));
    expect(key('?', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(help).toHaveBeenCalledTimes(1);
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      expect(key('q', mod).defaultPrevented).toBe(false);
      expect(key('Q', mod).defaultPrevented).toBe(false);
    }
    expect(q).not.toHaveBeenCalled();
    key('q');
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('TC-102 a handler replaced on re-render runs, without registering again', () => {
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(({ fn }) => useGlobalShortcut('q', fn, { description: 'Add', group: 'Tasks' }), { initialProps: { fn: first } });
    const before = shortcutStatsForTests();
    hook.rerender({ fn: second });
    key('q');
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(shortcutStatsForTests()).toEqual(before);
  });

  it('skips typing fields unless allowInFields, and IME composition always', () => {
    const plain = vi.fn();
    const inFields = vi.fn();
    renderHook(() => useGlobalShortcut('q', plain, { description: 'Q', group: 'Tasks' }));
    renderHook(() => useGlobalShortcut('/', inFields, { description: 'Slash', group: 'General', allowInFields: true }));
    const input = el('input', { type: 'text' });
    expect(key('q', {}, input).defaultPrevented).toBe(false);
    expect(plain).not.toHaveBeenCalled();
    key('/', {}, input);
    expect(inFields).toHaveBeenCalledTimes(1);
    key('q', { isComposing: true });
    expect(plain).not.toHaveBeenCalled();
  });

  it('a disabled entry neither runs nor lists; the earlier enabled one runs', () => {
    const a = vi.fn();
    const b = vi.fn();
    renderHook(() => useGlobalShortcut('q', a, { description: 'Enabled', group: 'Tasks' }));
    renderHook(() => useGlobalShortcut('q', b, { description: 'Disabled', group: 'Tasks', enabled: false }));
    key('q');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(listShortcuts().map((s) => s.description)).toContain('Enabled');
    expect(listShortcuts().map((s) => s.description)).not.toContain('Disabled');
  });

  it("'mod' shortcuts need Meta on macOS and Ctrl elsewhere", () => {
    const fn = vi.fn();
    renderHook(() => useGlobalShortcut('k', fn, { description: 'Find', group: 'General', modifiers: 'mod' }));
    const mac = /mac|iphone|ipad/i.test(navigator.platform);
    key('k');
    expect(fn).not.toHaveBeenCalled();
    key('k', mac ? { metaKey: true } : { ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
    key('k', mac ? { ctrlKey: true } : { metaKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
