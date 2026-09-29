// Story 7 `sel.keyboard` component cases (TC-27 to TC-31), plus the boundaries that
// decide who owns a keystroke: the board, or the text being edited.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  objectBounds,
  objectSnapshots,
  snapshot,
} from '../../src/shared/board-model.ts';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
} from '../../src/shared/config.ts';
import { createTestBox } from '../fixtures/testbox.tsx';

function firePointer(
  el: Element,
  type: string,
  x: number,
  y: number,
  opts: { shift?: boolean } = {},
) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        shiftKey: !!opts.shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
function fireKey(
  key: string,
  target: Element | Window = window,
  mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
) {
  const ev = new KeyboardEvent('keydown', {
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    (target as Window).dispatchEvent(ev);
  });
  return ev;
}
function fireInput(ta: HTMLElement) {
  act(() => {
    ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}
function type(ta: HTMLTextAreaElement, s: string) {
  act(() => {
    ta.value = ta.value + s;
  });
  fireInput(ta);
}
function flush() {
  act(() => {
    vi.advanceTimersByTime(48);
  });
}

let doc: Y.Doc;
let a: string;
let b: string;
let box: string;

function setup(count = 2) {
  doc = new Y.Doc();
  initDoc(doc);
  if (count > 0) a = createSticky(doc, { x: 300, y: 300 });
  if (count > 1) b = createSticky(doc, { x: 700, y: 300 });
  render(<BoardApp doc={doc} />);
}
/** A board holding a second object type as well, to prove select-all is generic. */
function setupMixed() {
  doc = new Y.Doc();
  initDoc(doc);
  a = createSticky(doc, { x: 300, y: 300 });
  b = createSticky(doc, { x: 700, y: 300 });
  box = createTestBox(doc, 900, 500, 200, 120);
  render(<BoardApp doc={doc} />);
}

const el = (id: string) => document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
const boxEl = (id: string) => document.querySelector(`[data-object-id="${id}"]`) as HTMLElement;
const bounds = (id: string) => objectBounds(objectSnapshots(doc).find((o) => o.id === id)!);
const selectedCount = () =>
  document.querySelectorAll('[data-selected="true"]').length;
const live = () => screen.getByTestId('selection-live').textContent ?? '';

function clickOn(target: Element, x = 20, y = 20) {
  firePointer(target, 'pointerdown', x, y);
  firePointer(target, 'pointerup', x, y);
}
function shiftClickOn(target: Element, x = 20, y = 20) {
  firePointer(target, 'pointerdown', x, y, { shift: true });
  firePointer(target, 'pointerup', x, y);
}
function editor(): HTMLTextAreaElement {
  return screen.getByTestId('sticky-text-editor') as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('story 7 sel.keyboard (TC-27..TC-31)', () => {
  it('TC-27 Ctrl+A selects every object and is not the browser select-all', () => {
    setupMixed();
    const ev = fireKey('a', window, { ctrl: true });
    flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(selectedCount()).toBe(3);
    expect(boxEl(box).getAttribute('data-selected')).toBe('true');
    expect(live()).toBe('3 selected');
  });

  it('TC-27 Cmd+A does the same on macOS, upper-case A included', () => {
    setupMixed();
    expect(fireKey('a', window, { meta: true }).defaultPrevented).toBe(true);
    flush();
    expect(selectedCount()).toBe(3);
    fireKey('Escape');
    expect(fireKey('A', window, { meta: true }).defaultPrevented).toBe(true);
    flush();
    expect(selectedCount()).toBe(3);
  });

  it('TC-28 boundary: Ctrl+A on an empty board selects nothing and breaks nothing', () => {
    setup(0);
    const ev = fireKey('a', window, { ctrl: true });
    flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(selectedCount()).toBe(0);
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    expect(live()).toBe('');
    // and the board still works afterwards
    expect(() => fireKey('Delete')).not.toThrow();
  });

  it('TC-27 objects of an unknown type are left out of select-all', () => {
    setup();
    // A note of a type this build does not know about: nobody renders it, so nobody
    // may select it (it would be invisible and undeletable).
    act(() => {
      doc.transact(() => {
        const objects = doc.getMap<Y.Map<unknown>>('objects');
        objects.set('future-thing', new Y.Map<unknown>());
        const future = objects.get('future-thing') as Y.Map<unknown>;
        future.set('type', 'frame');
        future.set('x', 10);
        future.set('y', 10);
        future.set('z', 9);
      });
    });
    flush();
    fireKey('a', window, { ctrl: true });
    flush();
    expect(selectedCount()).toBe(2);
    expect(document.querySelector('[data-object-id="future-thing"]')).toBeNull();
  });

  it('TC-29 arrows nudge the whole selection, one step and a large step', () => {
    setup();
    clickOn(el(a));
    shiftClickOn(el(b));
    const before = [bounds(a), bounds(b)];
    const right = fireKey('ArrowRight');
    flush();
    expect(right.defaultPrevented).toBe(true);
    expect(bounds(a).x).toBeCloseTo(before[0]!.x + NUDGE_STEP_WORLD, 6);
    expect(bounds(b).x).toBeCloseTo(before[1]!.x + NUDGE_STEP_WORLD, 6);
    const up = fireKey('ArrowUp', window, { shift: true });
    flush();
    expect(up.defaultPrevented).toBe(true);
    expect(bounds(a).y).toBeCloseTo(before[0]!.y - NUDGE_LARGE_STEP_WORLD, 6);
    expect(bounds(b).y).toBeCloseTo(before[1]!.y - NUDGE_LARGE_STEP_WORLD, 6);
    // Nudging never moves the camera: the world layer is where it started.
    const t = screen.getByTestId('world-layer').style.transform;
    expect(t).toBe('scale(1) translate(0px, 0px)');
  });

  it('TC-29 boundary: without a selection the arrow keys belong to the page', () => {
    setup();
    const ev = fireKey('ArrowRight');
    expect(ev.defaultPrevented).toBe(false);
    const shifted = fireKey('ArrowDown', window, { shift: true });
    expect(shifted.defaultPrevented).toBe(false);
    expect(bounds(a).x).toBe(200);
  });

  it('TC-29 nudging is an edit: a board that failed to load does not move', () => {
    cleanup();
    doc = new Y.Doc();
    initDoc(doc);
    a = createSticky(doc, { x: 300, y: 300 });
    render(<BoardApp doc={doc} connection="load_failed" />);
    clickOn(el(a));
    const before = bounds(a);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    fireKey('ArrowRight');
    fireKey('ArrowUp', window, { shift: true });
    flush();
    expect(bounds(a)).toEqual(before);
    expect(updates).toBe(0);
  });

  it('TC-30 Backspace while editing text edits the text and keeps the objects', () => {
    setup();
    act(() => {
      getStickyText(doc, a)!.insert(0, 'hello');
    });
    flush();
    clickOn(el(a));
    fireKey('Enter');
    flush();
    const ta = editor();
    type(ta, 'x');
    expect(snapshot(doc).find((n) => n.id === a)!.text).toBe('hellox');
    const ev = fireKey('Backspace', ta);
    flush();
    // The keystroke went to the text, not to the board.
    expect(ev.defaultPrevented).toBe(false);
    expect(snapshot(doc)).toHaveLength(2);
    expect(screen.getByTestId('sticky-text-editor')).toBeInTheDocument();
    // A whole selection of objects also survives a Backspace aimed at the text.
    const before = snapshot(doc).map((n) => ({ id: n.id, x: n.x }));
    const shifted = fireKey('ArrowRight', editor(), { shift: true });
    flush();
    expect(shifted.defaultPrevented).toBe(false);
    expect(snapshot(doc).map((n) => ({ id: n.id, x: n.x }))).toEqual(before);
  });

  it('TC-30 board keys are also silent while focus is in an unrelated field', () => {
    setup();
    // The board's own search-like field, as any host page could add.
    const input = document.createElement('input');
    document.body.appendChild(input);
    clickOn(el(a));
    fireKey('Delete', input);
    fireKey('ArrowRight', input);
    flush();
    expect(snapshot(doc)).toHaveLength(2);
    expect(bounds(a).x).toBe(200);
    input.remove();
  });

  it('TC-31 Delete removes every selected object and empties the selection', () => {
    setupMixed();
    fireKey('a', window, { ctrl: true });
    flush();
    expect(live()).toBe('3 selected');
    const ev = fireKey('Delete');
    flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(objectSnapshots(doc)).toHaveLength(0);
    expect(selectedCount()).toBe(0);
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    expect(live()).toBe('');
  });

  it('TC-31 Backspace deletes too, and a second press with nothing selected does nothing', () => {
    setup();
    clickOn(el(a));
    shiftClickOn(el(b));
    fireKey('Backspace');
    flush();
    expect(snapshot(doc)).toHaveLength(0);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    const again = fireKey('Backspace');
    flush();
    // The key is swallowed: a stray Backspace must not walk the browser back out
    // of the board, and swallowing it still changes nothing in the document.
    expect(again.defaultPrevented).toBe(true);
    expect(updates).toBe(0);
  });

  it('deleting the selection remotely and then pressing Delete changes nothing', () => {
    setup();
    clickOn(el(a));
    shiftClickOn(el(b));
    act(() => {
      deleteObjects(doc, [a, b]);
    });
    flush();
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    fireKey('Delete');
    flush();
    expect(updates).toBe(0);
    expect(selectedCount()).toBe(0);
  });
});
