/**
 * Story 8 component tests: undo step boundaries for gestures and typing
 * (TC-14 to TC-17) — real Y.Doc, real controller (created by the Board),
 * story 7 gesture hook and text editor, jsdom.
 *
 * Camera fixture: origin centred, 100% zoom, 1280x800 viewport (setup.ts),
 * so world (0,0) sits at screen (640,400) and 1 world unit = 1 px.
 *
 * Step separation in these tests comes from the boundaries the app wires
 * (gesture start/end, edit start/end, per-command boundaries); the capture
 * timeout only merges transactions inside one action, so the assertions are
 * deterministic regardless of wall-clock gaps between actions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, snapshotAll } from '../../src/shared/board-model';
import { renderStickyBoard } from './harness';
import type { ObjectSnapshot } from '../../src/shared/board-model';

afterEach(() => {
  vi.useRealTimers();
});

/** Flush one animation frame (the rAF polyfill is a 16ms timeout). */
function flushFrame(): void {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

type Utils = ReturnType<typeof renderStickyBoard>;

function createNote(utils: { doc: Y.Doc }, at: { x: number; y: number }): string {
  let id = '';
  act(() => {
    id = createSticky(utils.doc, at);
  });
  return id;
}

function objectEl(utils: Utils, id: string): HTMLElement {
  const el = utils.container.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (el === null) {
    throw new Error(`no element for object ${id}`);
  }
  return el;
}

function clickOn(utils: Utils, id: string, x: number, y: number): void {
  const el = objectEl(utils, id);
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });
}

function findDoc(utils: { doc: Y.Doc }, id: string): ObjectSnapshot {
  const obj = snapshotAll(utils.doc).find((o) => o.id === id);
  if (obj === undefined) {
    throw new Error(`object ${id} not in document`);
  }
  return obj;
}

/** Drags the object `frames` frames, `px` screen px per frame, ending with `end`. */
function drag(
  utils: Utils,
  id: string,
  frames: number,
  px: number,
  end: 'up' | 'cancel',
): void {
  const el = objectEl(utils, id);
  let pointerId = 10;
  const startX = 640;
  const startY = 400;
  fireEvent.pointerDown(el, { clientX: startX, clientY: startY, pointerId: pointerId });
  for (let i = 1; i <= frames; i++) {
    const x = startX + px * i;
    fireEvent.pointerMove(el, { clientX: x, clientY: startY, pointerId: pointerId });
    flushFrame();
  }
  const lastX = startX + px * frames;
  if (end === 'up') {
    fireEvent.pointerUp(el, { clientX: lastX, clientY: startY, pointerId: pointerId });
  } else {
    fireEvent.pointerCancel(el, { clientX: lastX, clientY: startY, pointerId: pointerId });
  }
}

/** One Ctrl/Cmd+Z keydown on window (the board shortcut path). */
function undoKey(): void {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true, bubbles: true }),
    );
  });
}

describe('undo.boundaries: gesture and typing boundaries (TC-14 to TC-17)', () => {
  it('TC-14: a 30-frame drag is one undo step restoring every object to its start', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const a = createNote(utils, { x: 0, y: 0 }); // centre (0,0) → top-left (-100,-100)
    const b = createNote(utils, { x: 300, y: 0 });

    // Select both: press a, shift-press b.
    clickOn(utils, a, 640, 400);
    fireEvent.pointerDown(objectEl(utils, b), { clientX: 940, clientY: 400, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(objectEl(utils, b), { clientX: 940, clientY: 400, pointerId: 1, shiftKey: true });

    const startA = { ...findDoc(utils, a) };
    const startB = { ...findDoc(utils, b) };

    // Drag the selection 30 frames, 5px per frame (+150px world).
    drag(utils, a, 30, 5, 'up');
    expect(findDoc(utils, a).x).toBe(startA.x + 150);
    expect(findDoc(utils, b).x).toBe(startB.x + 150);

    // One undo restores both objects exactly to their start.
    undoKey();
    expect(findDoc(utils, a).x).toBe(startA.x);
    expect(findDoc(utils, a).y).toBe(startA.y);
    expect(findDoc(utils, b).x).toBe(startB.x);
    expect(findDoc(utils, b).y).toBe(startB.y);
  });

  it('TC-15: a drag and a colour change 200 ms apart are two separate steps', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createNote(utils, { x: 0, y: 0 });
    clickOn(utils, id, 640, 400);

    drag(utils, id, 10, 4, 'up'); // +40px
    const moved = findDoc(utils, id);
    expect(moved.x).toBe(-100 + 40);

    // 200 ms later (inside the 500 ms capture timeout) recolour via the
    // note toolbar.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      fireEvent.click(utils.getByTestId('note-swatch-orange'));
    });
    expect(findDoc(utils, id).color).toBe('orange');

    // One undo: the colour is reverted, the move stays.
    undoKey();
    expect(findDoc(utils, id).color).toBe('yellow');
    expect(findDoc(utils, id).x).toBe(-100 + 40);

    // The next undo: the move is reverted (two steps total).
    undoKey();
    expect(findDoc(utils, id).x).toBe(-100);
  });

  it('TC-16: Ctrl+Z inside the editor undoes the typing, not the earlier move', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createNote(utils, { x: 0, y: 0 });
    clickOn(utils, id, 640, 400);

    // Move the note (its own step).
    drag(utils, id, 10, 4, 'up');
    const movedX = -100 + 40;
    expect(findDoc(utils, id).x).toBe(movedX);

    // Start editing (Enter on the selected note) and type "hello" as a
    // burst: each character is one commit, all inside one capture window.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));
    });
    const ta = utils.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    for (const ch of 'hello') {
      act(() => {
        ta.value += ch;
      });
      fireEvent.input(ta);
    }
    expect(ta.value).toBe('hello');

    // Ctrl+Z inside the editor: the whole burst is one step → all gone;
    // the earlier move is untouched.
    act(() => {
      fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
    });
    expect(ta.value).toBe('');
    expect(findDoc(utils, id).x).toBe(movedX); // negative: the move was not undone
  });

  it('TC-17: pointercancel mid-drag → one step restoring the start position', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createNote(utils, { x: 0, y: 0 });
    clickOn(utils, id, 640, 400);

    drag(utils, id, 10, 4, 'cancel'); // cancelled: last applied positions stay
    const partialX = findDoc(utils, id).x;
    expect(partialX).toBeGreaterThan(-100); // the drag partially applied

    // One undo restores the start position (the partial drag is one step).
    undoKey();
    expect(findDoc(utils, id).x).toBe(-100);
    expect(findDoc(utils, id).y).toBe(-100);
  });
});
