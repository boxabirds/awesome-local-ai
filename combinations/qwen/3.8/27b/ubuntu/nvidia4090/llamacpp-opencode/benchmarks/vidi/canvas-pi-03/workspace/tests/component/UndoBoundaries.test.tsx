import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  renderFullApp,
  hooks,
  makeNote,
  firePointer,
  fireWindowPointer,
  pressKey,
  typeText,
} from './story2';
import { objectBounds, getStickyText, type ObjectSnapshot } from '@/shared/board-model';

// Story 8 component tests TC-14..TC-17: gesture and typing step boundaries.
//
// These drive the REAL wiring (useTransformGesture onGestureStart/onGestureEnd
// -> UndoController.boundary, and StickyTextEditor mount/end + in-editor
// Ctrl+Z -> the controller) in jsdom, then read the local per-user controller
// through the story-2 test hooks to confirm how many steps a user action
// produced and that one undo reverts exactly that action (and nothing before
// it). The controller only tracks LOCAL_ORIGIN, so makeNote/create/drag/type
// all land on the same per-user stack and can be stepped back in order.
//
// Note on timing: jsdom has no fake clock for Yjs (Yjs captures Date.now at
// import time via lib0/time), so these tests use REAL time. A gesture's frames
// and a typing burst are dispatched synchronously, i.e. microseconds apart,
// which is comfortably inside UNDO_CAPTURE_TIMEOUT_MS (500 ms) — so any merge
// comes from the capture timeout, and any separation comes from the boundary()
// calls under test. That is exactly the property these TCs assert.

// Story 5: the board page checks existence before rendering the board.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

// jsdom window 1024x768, initial camera (-512,-384), zoom 1.
const CAM = { x: -512, y: -384 };

function screenOf(w: { x: number; y: number }): { x: number; y: number } {
  return { x: w.x - CAM.x, y: w.y - CAM.y };
}

function snapOf(id: string): ObjectSnapshot {
  const m = hooks().getDoc().getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (!m) throw new Error(`object ${id} not found in doc`);
  const snap: ObjectSnapshot = {
    id,
    type: m.get('type') as string,
    x: m.get('x') as number,
    y: m.get('y') as number,
    z: m.get('z') as number,
    createdAt: m.get('createdAt') as number,
  };
  const w = m.get('width');
  const h = m.get('height');
  if (typeof w === 'number') snap.width = w;
  if (typeof h === 'number') snap.height = h;
  return snap;
}

function centreOf(id: string): { x: number; y: number } {
  const b = objectBounds(snapOf(id));
  return screenOf({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
}

function boundsOf(id: string): { x: number; y: number; width: number; height: number } {
  return objectBounds(snapOf(id));
}

function noteExists(id: string): boolean {
  return hooks().getDoc().getMap('objects').get(id) !== undefined;
}

function noteColor(id: string): string {
  const n = hooks().getNotes().find((x) => x.id === id);
  if (!n) throw new Error(`note ${id} not found`);
  return n.color;
}

function selectNote(id: string): void {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) throw new Error(`element for ${id} not found`);
  const c = centreOf(id);
  firePointer(el, 'pointerdown', c.x, c.y);
  firePointer(el, 'pointerup', c.x, c.y);
}

/**
 * Drags a selected note by (dx, dy) world px over `frames` pointermove events,
 * ending with pointerup (or pointercancel when `cancel`). World and screen
 * deltas are equal at the initial zoom 1 camera.
 */
function drag(id: string, frames: number, dx: number, dy: number, cancel = false): void {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) throw new Error(`element for ${id} not found`);
  const c = centreOf(id);
  firePointer(el, 'pointerdown', c.x, c.y);
  for (let i = 1; i <= frames; i += 1) {
    fireWindowPointer('pointermove', c.x + (dx * i) / frames, c.y + (dy * i) / frames);
  }
  if (cancel) fireWindowPointer('pointercancel', c.x + dx, c.y + dy);
  else fireWindowPointer('pointerup', c.x + dx, c.y + dy);
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('story 8: gesture and typing boundaries', () => {
  it('TC-14 a 30-frame drag is ONE undo step that restores the start position', async () => {
    await renderFullApp();
    const id = makeNote(100, 100); // top-left (0,0)
    expect(boundsOf(id).x).toBe(0);

    selectNote(id);
    drag(id, 30, 100, 0);
    // The whole 30-frame drag landed the note at +100.
    expect(boundsOf(id).x).toBe(100);

    // ONE undo reverts the entire drag to the start position — proving the 30
    // frames were merged into a single step (not 30).
    act(() => {
      expect(hooks().undo()).toBe(true);
    });
    expect(boundsOf(id).x).toBe(0);

    // The drag was a single step on top of the create step: one more undo
    // removes the note (its creation), nothing is left in between.
    act(() => {
      expect(hooks().undo()).toBe(true);
    });
    expect(noteExists(id)).toBe(false);
  });

  it('TC-15 a move then a colour change within 200 ms are TWO separate steps', async () => {
    await renderFullApp();
    const id = makeNote(100, 100);
    selectNote(id);

    // A short move gesture (ends with boundary()).
    drag(id, 8, 100, 0);
    expect(boundsOf(id).x).toBe(100);

    // Recolour immediately afterwards (well inside the 500 ms capture window
    // and within 200 ms of the gesture end) via the real single-sticky toolbar.
    fireEvent.click(screen.getByRole('button', { name: 'Blue colour' }));
    expect(noteColor(id)).toBe('blue');

    // ONE undo reverts ONLY the colour; the move is a separate step and is NOT
    // touched — the boundary at gesture end kept them apart.
    act(() => {
      expect(hooks().undo()).toBe(true);
    });
    expect(noteColor(id)).toBe('yellow');
    expect(boundsOf(id).x).toBe(100);

    // A second undo reverts the move.
    act(() => {
      expect(hooks().undo()).toBe(true);
    });
    expect(boundsOf(id).x).toBe(0);
  });

  it('TC-16 typing in the editor is its own step; in-editor Ctrl+Z undoes typing, not the earlier move', async () => {
    await renderFullApp();
    const id = makeNote(100, 100);
    selectNote(id);

    // An earlier move step.
    drag(id, 8, 100, 0);
    expect(boundsOf(id).x).toBe(100);

    // Start editing (single selected sticky + Enter) and type a word.
    pressKey(window, 'Enter');
    const ta = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    typeText(ta, 'hello');
    expect(getStickyText(hooks().getDoc(), id)?.toString()).toBe('hello');

    // Ctrl+Z inside the editor is routed to the controller and undoes the
    // typing burst only.
    pressKey(ta, 'z', { ctrlKey: true });
    expect(getStickyText(hooks().getDoc(), id)?.toString()).toBe('');

    // ...while the earlier move is NOT undone (the move is a separate step).
    expect(boundsOf(id).x).toBe(100);
  });

  it('TC-17 a drag cancelled by pointercancel is still ONE step restoring the start position', async () => {
    await renderFullApp();
    const id = makeNote(100, 100);
    selectNote(id);

    // Move part of the way, then cancel (no pointerup).
    drag(id, 12, 100, 0, true);
    expect(boundsOf(id).x).toBe(100);

    // The partial drag is one step: one undo restores the start position.
    act(() => {
      expect(hooks().undo()).toBe(true);
    });
    expect(boundsOf(id).x).toBe(0);

    // And the create is the only remaining step.
    act(() => {
      expect(hooks().undo()).toBe(true);
    });
    expect(noteExists(id)).toBe(false);
  });
});
