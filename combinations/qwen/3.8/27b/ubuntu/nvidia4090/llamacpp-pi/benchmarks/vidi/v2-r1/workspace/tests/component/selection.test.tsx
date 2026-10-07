// Story 7 component tests (TC-16 to TC-31): multi-selection, marquee,
// transform gesture, selection bar and keyboard commands against the full
// App (jsdom). The default component-test URL opens a board, so renderApp()
// lands on the board page; y-websocket is mocked file-wide so no real
// network traffic happens (connection state stays "connecting" → canEdit).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, render, cleanup } from '@testing-library/react';
import { act } from 'react';
import * as Y from 'yjs';

const hoisted = vi.hoisted(() => {
  const instances: Array<{
    emitClose(code: number): void;
  }> = [];
  class FakeProvider {
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    wsconnected = false;
    constructor(_url: string, _room: string, _doc: unknown, _opts: unknown) {
      instances.push(this);
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }
    destroy() {}
    emitClose(code: number) {
      (this.handlers['connection-close'] ?? []).forEach((cb) =>
        cb({ code, reason: '' }, this),
      );
    }
  }
  return { instances, FakeProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: hoisted.FakeProvider }));

// Import app modules after the mock registration above (vi.mock hoists).
import {
  renderApp,
  hooks,
  addNote,
  note as noteInfo,
  removeNote,
  click,
  dragTo,
  pointerUp,
  flushRaf,
} from './helpers';
import type { JSX } from 'react';
import { getObjectType } from '../../src/client/objects/registry';
import { createSticky } from '../../src/shared/board-model';
import {
  useSelection,
} from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { ensureTestBoxRegistered } from '../fixtures/testbox';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
} from '../../src/shared/config';

beforeEach(() => {
  ensureTestBoxRegistered();
});
afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function viewportEl(): Element {
  const el = document.querySelector('[data-testid="board-viewport"]');
  if (!el) throw new Error('viewport not found');
  return el;
}

function noteEl(id: string): Element {
  const el = document.querySelector(`[data-testid="sticky-note"][data-id="${id}"]`);
  if (!el) throw new Error('note not found: ' + id);
  return el;
}

function boxEl(id: string): Element {
  const el = document.querySelector(`[data-testid="testbox"][data-id="${id}"]`);
  if (!el) throw new Error('testbox not found: ' + id);
  return el;
}

function selectionCount(): number | null {
  const el = document.querySelector('[data-testid="selection-count"]');
  if (!el) return null;
  const m = /^(\d+) selected$/.exec(el.textContent ?? '');
  return m ? Number(m[1]) : null;
}

function selectedIds(): string[] {
  return Array.from(document.querySelectorAll('[data-selected="true"]')).map(
    (el) => el.getAttribute('data-id') ?? '',
  );
}

/** pointerdown+up with Shift held: a selection toggle (sel.interaction). */
function shiftClick(el: Element): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, shiftKey: true, bubbles: true });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 0, clientY: 0, shiftKey: true, bubbles: true });
}

/** Like the shared dragTo but with Shift held on every move (aspect resize). */
function shiftDragTo(el: Element, dx: number, dy: number, steps = 3): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, bubbles: true });
  for (let i = 1; i <= steps; i += 1) {
    fireEvent.pointerMove(el, {
      pointerId: 1,
      clientX: (dx * i) / steps,
      clientY: (dy * i) / steps,
      shiftKey: true,
      bubbles: true,
    });
  }
}

function handleEl(name: string): Element {
  const el = screen.getByRole('button', { name: `Resize ${name}` });
  return el;
}

/** Creates a testbox object (registered test type) at top-left (x, y). */
let boxSeq = 0;
function addBox(x: number, y: number, w = 100, h = 60): string {
  let id = '';
  act(() => {
    const doc = hooks().doc;
    let maxZ = 0;
    const map = doc.getMap('objects');
    map.forEach((value) => {
      const obj = value as Y.Map<unknown>;
      const z = obj.get('z');
      if (typeof z === 'number') maxZ = Math.max(maxZ, z);
    });
    id = 'box-' + (boxSeq += 1);
    const obj = new Y.Map<unknown>();
    obj.set('type', 'testbox');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('z', maxZ + 1);
    obj.set('width', w);
    obj.set('height', h);
    obj.set('text', '');
    doc.transact(() => {
      map.set(id, obj);
    });
  });
  return id;
}

function boxInfo(id: string): { x: number; y: number; width: number; height: number } {
  const o = hooks().getObjects().find((o) => o.id === id);
  if (!o || o.width == null || o.height == null) throw new Error('box not found: ' + id);
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}

// ---------------------------------------------------------------------------
// Selection state (TC-16 to TC-19)
// ---------------------------------------------------------------------------

describe('selection state (story 7)', () => {
  it('TC-16: selected ids deleted remotely leave the selection; the bar hides', async () => {
    await renderApp();
    const a = addNote(0, 0);
    const b = addNote(250, 0);
    click(noteEl(a));
    shiftClick(noteEl(b));
    expect(selectionCount()).toBe(2);
    // Remote deletes (via the model, as a colleague's change would arrive).
    removeNote(a);
    removeNote(b);
    expect(selectionCount()).toBeNull(); // bar hidden (0 selected)
    expect(selectedIds()).toEqual([]);
  });

  it('TC-17: two selected → "2 selected" + Delete selection button; aria-live announces', async () => {
    await renderApp();
    const a = addNote(0, 0);
    const b = addNote(250, 0);
    click(noteEl(a));
    shiftClick(noteEl(b));
    const count = screen.getByTestId('selection-count');
    expect(count).toHaveTextContent('2 selected');
    expect(count).toHaveAttribute('aria-live', 'polite');
    const del = screen.getByRole('button', { name: 'Delete selection' });
    expect(del).toBeTruthy();
    // The button deletes the whole selection and clears it.
    act(() => {
      fireEvent.click(del);
    });
    expect(noteInfo(a)).toBeUndefined();
    expect(noteInfo(b)).toBeUndefined();
    expect(selectionCount()).toBeNull();
  });

  it('TC-18: one selected sticky → NoteToolbar instead of the selection bar', async () => {
    await renderApp();
    const a = addNote(0, 0);
    click(noteEl(a));
    expect(screen.getByRole('toolbar', { name: 'Sticky note options' })).toBeTruthy();
    expect(selectionCount()).toBeNull(); // no bar for a single object
  });

  it('TC-19: clicking empty space without dragging clears the selection', async () => {
    await renderApp();
    const a = addNote(0, 0);
    click(noteEl(a));
    expect(selectedIds()).toEqual([a]);
    click(viewportEl(), 400, 400);
    expect(selectedIds()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Marquee selection (TC-20 to TC-22)
// ---------------------------------------------------------------------------

describe('marquee selection (story 7)', () => {
  it('TC-20: shift+drag marquee adds fully-contained ids to the existing selection', async () => {
    await renderApp();
    // World coordinates (camera: screen = world + (512, 384)):
    //   a: (−400..−100, −100..100)
    //   b: (−100..100,  −100..100)
    //   c: (100..300,   200..400)
    const a = addNote(-300, 0);
    const b = addNote(0, 0);
    const c = addNote(200, 300);
    // Pre-select a.
    click(noteEl(a));
    expect(selectedIds()).toEqual([a]);
    // Shift+drag marquee over the viewport: world (−412,−284) → (208,306).
    // Contains a and b fully; c sticks out of the right/bottom edge.
    const vp = viewportEl();
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 100, clientY: 100, shiftKey: true, bubbles: true });
    fireEvent.pointerMove(vp, { pointerId: 1, clientX: 720, clientY: 690, bubbles: true });
    fireEvent.pointerUp(vp, { pointerId: 1, clientX: 720, clientY: 690, bubbles: true });
    expect(new Set(selectedIds())).toEqual(new Set([a, b]));
    expect(selectionCount()).toBe(2); // additive: a kept, b added
  });

  it('TC-21: plain (no-shift) drag on empty space pans the camera, not a marquee', async () => {
    await renderApp();
    const before = hooks().getCamera();
    const vp = viewportEl();
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 100, clientY: 100, bubbles: true });
    fireEvent.pointerMove(vp, { pointerId: 1, clientX: 160, clientY: 130, bubbles: true });
    fireEvent.pointerUp(vp, { pointerId: 1, clientX: 160, clientY: 130, bubbles: true });
    await flushRaf();
    const after = hooks().getCamera();
    expect(after.x).toBeCloseTo(before.x - 60);
    expect(after.y).toBeCloseTo(before.y - 30);
    expect(selectedIds()).toEqual([]);
    expect(document.querySelector('[data-testid="marquee-rect"]')).toBeNull();
  });

  it('TC-22: pointercancel and Escape mid-marquee discard it (selection unchanged)', async () => {
    await renderApp();
    const a = addNote(0, 0);
    click(noteEl(a));
    const vp = viewportEl();
    // pointercancel:
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 100, clientY: 100, shiftKey: true, bubbles: true });
    fireEvent.pointerMove(vp, { pointerId: 1, clientX: 400, clientY: 400, bubbles: true });
    expect(document.querySelector('[data-testid="marquee-rect"]')).not.toBeNull();
    fireEvent.pointerCancel(vp, { pointerId: 1, clientX: 400, clientY: 400, bubbles: true });
    expect(selectedIds()).toEqual([a]); // unchanged
    expect(document.querySelector('[data-testid="marquee-rect"]')).toBeNull();
    // Escape mid-marquee:
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 100, clientY: 100, shiftKey: true, bubbles: true });
    fireEvent.pointerMove(vp, { pointerId: 1, clientX: 400, clientY: 400, bubbles: true });
    expect(document.querySelector('[data-testid="marquee-rect"]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(selectedIds()).toEqual([a]); // unchanged
    expect(document.querySelector('[data-testid="marquee-rect"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transform gesture (TC-23 to TC-26)
// ---------------------------------------------------------------------------

describe('transform gesture (story 7)', () => {
  it('TC-23: dragging unselected b with {a} selected selects {b} and moves only b; sub-threshold is a click', async () => {
    await renderApp();
    const a = addNote(-300, 0);
    const b = addNote(0, 0);
    const aStart = noteInfo(a)!;
    const bStart = noteInfo(b)!;
    click(noteEl(a));
    expect(selectedIds()).toEqual([a]);
    // Below the 3px threshold: a click, not a drag.
    dragTo(noteEl(b), 2, 0, 1);
    pointerUp(noteEl(b), 2, 0);
    expect(selectedIds()).toEqual([b]); // click replaced the selection
    expect(noteInfo(b)!.x).toBe(bStart.x); // no write below threshold
    // Exactly at/above the threshold: b moves (by the full delta), a does not.
    dragTo(noteEl(b), 10, 0, 2);
    pointerUp(noteEl(b), 10, 0);
    await flushRaf();
    expect(selectedIds()).toEqual([b]);
    expect(noteInfo(b)!.x).toBeCloseTo(bStart.x + 10);
    expect(noteInfo(b)!.y).toBeCloseTo(bStart.y);
    expect(noteInfo(a)!.x).toBe(aStart.x); // a untouched
    expect(noteInfo(a)!.y).toBe(aStart.y);
  });

  it('TC-24: testbox edge handle changes only its axis; Shift keeps the ratio; handles are labelled', async () => {
    await renderApp();
    const id = addBox(0, 0, 100, 60);
    click(boxEl(id));
    // All eight handles exist with the required aria-labels.
    for (const name of [
      'top-left',
      'top',
      'top-right',
      'right',
      'bottom-right',
      'bottom',
      'bottom-left',
      'left',
    ]) {
      expect(handleEl(name)).toBeTruthy();
    }
    // East edge: width grows, height untouched.
    dragTo(handleEl('right'), 30, 10, 2);
    pointerUp(handleEl('right'), 30, 10);
    await flushRaf();
    let r = boxInfo(id);
    expect(r.width).toBeCloseTo(130);
    expect(r.height).toBeCloseTo(60);
    // Shift + corner on the 130×60 box: the larger-scale axis
    // (y: +40 on 60 → 1.667) drives; both dimensions scale by 1.667
    // → 216.7 × 100.
    shiftDragTo(handleEl('bottom-right'), 20, 40, 2);
    pointerUp(handleEl('bottom-right'), 20, 40);
    await flushRaf();
    r = boxInfo(id);
    expect(r.width).toBeCloseTo(130 * (100 / 60), 3);
    expect(r.height).toBeCloseTo(100);
  });

  it('TC-25: canEdit=false → drags and resizes never write (negative)', async () => {
    await renderApp();
    // Force the load-failure state: the provider closes with 4500.
    // (The live provider is the most recently created one.)
    const provider = hoisted.instances[hoisted.instances.length - 1];
    act(() => {
      provider.emitClose(4500);
    });
    const a = addNote(0, 0);
    const start = noteInfo(a)!;
    click(noteEl(a));
    expect(selectedIds()).toEqual([a]); // selection is read-only state: allowed
    // Drag: no write.
    dragTo(noteEl(a), 120, 0, 3);
    pointerUp(noteEl(a), 120, 0);
    await flushRaf();
    expect(noteInfo(a)!.x).toBe(start.x);
    // Resize: no write.
    dragTo(handleEl('bottom-right'), 40, 40, 2);
    pointerUp(handleEl('bottom-right'), 40, 40);
    await flushRaf();
    expect(noteInfo(a)!.x).toBe(start.x);
    // Keyboard mutation keys: no write.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await flushRaf();
    expect(noteInfo(a)!.x).toBe(start.x);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(noteInfo(a)).toBeDefined();
  });

  it('TC-26: gesture callbacks fire exactly once per drag; pointercancel keeps the last applied position', async () => {
    const { GestureHarness, harnessDoc } = await import('./harness-gesture');
    const countsRef = { current: { start: 0, end: 0 } };
    render(<GestureHarness counts={countsRef} />);
    let id = '';
    await act(async () => {
      id = createSticky(harnessDoc(), { x: 0, y: 0 })!;
    });
    const el = () => {
      const e = document.querySelector(`[data-testid="sticky-note"][data-id="${id}"]`);
      if (!e) throw new Error('harness note not rendered');
      return e;
    };
    const start = harnessNoteXY(id);
    // A completed drag: start and end exactly once.
    dragTo(el(), 40, 0, 2);
    pointerUp(el(), 40, 0);
    await flushRaf();
    expect(countsRef.current.start).toBe(1);
    expect(countsRef.current.end).toBe(1);
    expect(harnessNoteXY(id).x).toBeCloseTo(start.x + 40);
    // A cancelled drag: start once, end once; the position holds the last
    // applied value (no rollback to the drag start, no unflushed tail).
    const e = el();
    fireEvent.pointerDown(e, { pointerId: 1, clientX: 0, clientY: 0, bubbles: true });
    fireEvent.pointerMove(e, { pointerId: 1, clientX: 10, clientY: 0, bubbles: true });
    await flushRaf(); // +10 applied
    fireEvent.pointerMove(e, { pointerId: 1, clientX: 20, clientY: 0, bubbles: true });
    await flushRaf(); // +20 applied
    fireEvent.pointerCancel(e, { pointerId: 1, clientX: 30, clientY: 0, bubbles: true });
    await flushRaf(); // the unflushed 20→30 tail is dropped
    expect(countsRef.current.start).toBe(2);
    expect(countsRef.current.end).toBe(2);
    expect(harnessNoteXY(id).x).toBeCloseTo(start.x + 40 + 20);
  }, 15000);
});

function harnessNoteXY(id: string): { x: number; y: number } {
  const doc = (globalThis as Record<string, unknown>).__harnessDoc as Y.Doc;
  const obj = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (!obj) throw new Error('harness note not found');
  return { x: obj.get('x') as number, y: obj.get('y') as number };
}

// ---------------------------------------------------------------------------
// Selection keyboard commands (TC-27 to TC-31)
// ---------------------------------------------------------------------------

describe('selection keyboard commands (story 7)', () => {
  it('TC-27: Ctrl+A selects every object and preventDefaults', async () => {
    await renderApp();
    const a = addNote(0, 0);
    const b = addNote(250, 0);
    const seen: { key: string; defaultPrevented: boolean }[] = [];
    // Same target (window) as the board's listener, which was registered at
    // mount — so this one runs after it and sees the final defaultPrevented.
    const spy = (e: Event) => {
      const ke = e as Event & { key: string };
      seen.push({ key: ke.key, defaultPrevented: e.defaultPrevented });
    };
    window.addEventListener('keydown', spy);
    try {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    } finally {
      window.removeEventListener('keydown', spy);
    }
    expect(new Set(selectedIds())).toEqual(new Set([a, b]));
    expect(seen[0]?.defaultPrevented).toBe(true);
  });

  it('TC-28: Ctrl+A on an empty board is a no-op (no error)', async () => {
    await renderApp();
    expect(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    }).not.toThrow();
    expect(selectedIds()).toEqual([]);
    expect(selectionCount()).toBeNull();
  });

  it('TC-29: ArrowRight nudges by NUDGE_STEP_WORLD; Shift+ArrowUp by NUDGE_LARGE_STEP_WORLD; preventDefault', async () => {
    await renderApp();
    const a = addNote(0, 0);
    const start = noteInfo(a)!;
    click(noteEl(a));
    const seen: { key: string; defaultPrevented: boolean }[] = [];
    const spy = (e: Event) => {
      const ke = e as Event & { key: string };
      seen.push({ key: ke.key, defaultPrevented: e.defaultPrevented });
    };
    window.addEventListener('keydown', spy);
    try {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true });
    } finally {
      window.removeEventListener('keydown', spy);
    }
    await flushRaf();
    const after = noteInfo(a)!;
    expect(after.x).toBeCloseTo(start.x + NUDGE_STEP_WORLD);
    expect(after.y).toBeCloseTo(start.y - NUDGE_LARGE_STEP_WORLD);
    expect(seen[0]?.key).toBe('ArrowRight');
    expect(seen[0]?.defaultPrevented).toBe(true);
    expect(seen[1]?.key).toBe('ArrowUp');
    expect(seen[1]?.defaultPrevented).toBe(true);
  });

  it('TC-30: Backspace while editing a note edits the text, not the note', async () => {
    await renderApp();
    const a = addNote(0, 0);
    click(noteEl(a));
    // Open the editor (double-click → startEdit).
    fireEvent.dblClick(noteEl(a));
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    editor.value = 'ab';
    fireEvent.input(editor, { target: { value: 'ab' } });
    editor.setSelectionRange(2, 2);
    // Backspace inside the textarea must NOT reach the board key handler.
    fireEvent.keyDown(editor, { key: 'Backspace' });
    expect(noteInfo(a)).toBeDefined(); // the note survived
    editor.value = 'a';
    fireEvent.input(editor, { target: { value: 'a' } });
    expect(noteInfo(a)!.text).toBe('a');
  });

  it('TC-31: Delete with a selection deletes the objects and clears the selection', async () => {
    await renderApp();
    const a = addNote(0, 0);
    const b = addNote(250, 0);
    click(noteEl(a));
    shiftClick(noteEl(b));
    expect(selectionCount()).toBe(2);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(noteInfo(a)).toBeUndefined();
    expect(noteInfo(b)).toBeUndefined();
    expect(selectedIds()).toEqual([]);
    expect(selectionCount()).toBeNull();
  });
});
