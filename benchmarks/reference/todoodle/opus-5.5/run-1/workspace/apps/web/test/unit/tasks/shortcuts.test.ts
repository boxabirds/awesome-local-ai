import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchShortcut,
  isTypingTarget,
  listShortcuts,
  resetShortcutsForTests,
  shortcutStats,
  useGlobalShortcut,
} from '@/lib/shortcuts';

function key(k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const TASKS = { description: 'Add task', group: 'Tasks' } as const;

beforeEach(() => resetShortcutsForTests());
afterEach(() => resetShortcutsForTests());

describe('TC-46 isTypingTarget', () => {
  it.each([
    ['input[type=text]', () => Object.assign(document.createElement('input'), { type: 'text' })],
    ['input (default type)', () => document.createElement('input')],
    ['input[type=search]', () => Object.assign(document.createElement('input'), { type: 'search' })],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      'contenteditable',
      () => {
        const div = document.createElement('div');
        div.setAttribute('contenteditable', 'true');
        return div;
      },
    ],
  ])('true for %s', (_label, make) => {
    const el = make();
    document.body.append(el);
    expect(isTypingTarget(el)).toBe(true);
    el.remove();
  });

  it.each([
    ['body', () => document.body],
    ['button', () => document.createElement('button')],
    ['input[type=checkbox]', () => Object.assign(document.createElement('input'), { type: 'checkbox' })],
    ['a task row (li role=option)', () => Object.assign(document.createElement('li'), { role: 'option' })],
    ['null', () => null],
  ])('false for %s', (_label, make) => {
    expect(isTypingTarget(make())).toBe(false);
  });
});

describe('shortcut registry', () => {
  it('TC-99 registering 5 shortcuts from 5 hooks adds exactly one document keydown listener', () => {
    const spy = vi.spyOn(document, 'addEventListener');
    for (const k of ['q', '?', 'e', 'm', 'd']) renderHook(() => useGlobalShortcut(k, () => {}, TASKS));
    expect(spy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
  });

  it('TC-100 the most recently registered entry wins; unmounting it restores the previous one', () => {
    const a = vi.fn();
    const b = vi.fn();
    renderHook(() => useGlobalShortcut('q', a, TASKS));
    const second = renderHook(() => useGlobalShortcut('q', b, TASKS));
    key('q');
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    second.unmount();
    key('q');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a disabled entry is skipped and not listed', () => {
    const a = vi.fn();
    const b = vi.fn();
    renderHook(() => useGlobalShortcut('q', a, TASKS));
    renderHook(() => useGlobalShortcut('q', b, { ...TASKS, description: 'Other', enabled: false }));
    key('q');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(listShortcuts().filter((s) => s.keys.includes('Q'))).toEqual([{ keys: ['Q'], description: 'Add task', group: 'Tasks' }]);
  });

  it("TC-101 '?' fires with Shift held; q never fires with Ctrl, Meta or Alt (nor Shift)", () => {
    const help = vi.fn();
    const add = vi.fn();
    renderHook(() => useGlobalShortcut('?', help, { description: 'Show keyboard shortcuts', group: 'General' }));
    renderHook(() => useGlobalShortcut('q', add, TASKS));
    const shifted = key('?', { shiftKey: true });
    expect(help).toHaveBeenCalledTimes(1);
    expect(shifted.defaultPrevented).toBe(true);
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      const event = key('q', mod);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(add).not.toHaveBeenCalled();
    key('Q');
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('TC-102 a handler replaced on rerender is the one called; registration never churns', () => {
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(({ handler }) => useGlobalShortcut('q', handler, TASKS), { initialProps: { handler: first } });
    const before = shortcutStats();
    hook.rerender({ handler: second });
    hook.rerender({ handler: second });
    key('q');
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(shortcutStats()).toEqual(before);
  });

  it('ignores IME composition and typing fields (unless allowInFields), and only prevents default when a handler runs', () => {
    const add = vi.fn();
    const inField = vi.fn();
    renderHook(() => useGlobalShortcut('q', add, TASKS));
    renderHook(() => useGlobalShortcut('/', inField, { description: 'Search', group: 'General', allowInFields: true }));
    const input = document.createElement('input');
    document.body.append(input);
    expect(key('q', { isComposing: true }).defaultPrevented).toBe(false);
    expect(key('q', {}, input).defaultPrevented).toBe(false);
    expect(add).not.toHaveBeenCalled();
    key('/', {}, input);
    expect(inField).toHaveBeenCalledTimes(1);
    expect(key('x').defaultPrevented).toBe(false);
    input.remove();
  });

  it("'mod' shortcuts need Ctrl (or Meta on macOS) and no other modifier", () => {
    const find = vi.fn();
    renderHook(() => useGlobalShortcut('k', find, { description: 'Find', group: 'General', modifiers: 'mod' }));
    key('k');
    expect(find).not.toHaveBeenCalled();
    key('k', { ctrlKey: true, altKey: true });
    expect(find).not.toHaveBeenCalled();
    key('k', { ctrlKey: true });
    key('k', { metaKey: true });
    // happy-dom's platform is not macOS: Ctrl is the modifier.
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('dispatchShortcut returns false for keys with no entry', () => {
    expect(dispatchShortcut(new KeyboardEvent('keydown', { key: 'z' }))).toBe(false);
  });
});
