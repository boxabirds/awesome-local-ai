// sel.transform (story 7): TC-23 to TC-26.
//
// Full-app tests for the shared transform gesture: moving reselects, the
// resize handles honour type rules (aspect-locked vs free ratio), a
// load-failed board refuses gestures, and the start/end callbacks fire
// exactly once per drag.

import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushRaf, installResizeObserverMock } from './helpers';
import { addTestBox } from '../fixtures/testbox';
import {
  board,
  dispatchOn,
  gestureLog,
  handleEl,
  keyedPointerEvent,
  liveNotes,
  noteAt,
  noteEls,
  screenX,
  screenY,
  selectionCount,
  setConnection,
} from './story7-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
});

/** Press on the element at (px,py), move by (dx,dy), release. */
function dragOn(el: HTMLElement, px: number, py: number, dx: number, dy: number, shiftKey = false): void {
  dispatchOn(el, keyedPointerEvent('pointerdown', px, py, shiftKey));
  dispatchOn(el, keyedPointerEvent('pointermove', px + dx, py + dy, shiftKey));
  dispatchOn(el, keyedPointerEvent('pointerup', px + dx, py + dy, shiftKey));
}

describe('sel.transform', () => {
  it('TC-23 dragging an unselected object reselects to it; only it moves', async () => {
    const { container } = await board();
    let idA = '';
    let idB = '';
    act(() => {
      idA = noteAt(0, 0);
      idB = noteAt(300, 0);
    });
    const a = noteEls(container).find((n) => n.dataset.id === idA)!;
    const b = noteEls(container).find((n) => n.dataset.id === idB)!;

    // Select a.
    dispatchOn(a, keyedPointerEvent('pointerdown', 740, 500));
    dispatchOn(a, keyedPointerEvent('pointerup', 740, 500));
    expect(a.hasAttribute('data-selected')).toBe(true);

    // Drag b (unselected): the selection moves to b and only b moves.
    dragOn(b, 1040, 500, 50, 0);
    await flushRaf();

    const byId = new Map(liveNotes().map((o) => [o.id, o]));
    expect(byId.get(idA)!.x).toBe(0); // a untouched
    expect(byId.get(idB)!.x).toBe(350); // b moved 50
    expect(b.hasAttribute('data-selected')).toBe(true);
    expect(a.hasAttribute('data-selected')).toBe(false);
  });

  it('TC-24 a non-locked type: the east handle changes width only; Shift keeps the ratio', async () => {
    const { container, doc } = await board();
    let id = '';
    act(() => {
      id = addTestBox(doc, 0, 0, 100, 50);
    });
    const el = container.querySelector<HTMLElement>(`[data-testid="testbox"][data-id="${id}"]`);
    expect(el).not.toBeNull();

    // Select the testbox (centre: world (50,25) → screen (690,425)).
    dragOn(el!, 690, 425, 0, 0);
    expect(el!.hasAttribute('data-selected')).toBe(true);

    // East handle at screen (740, 425): drag +30 in x, no Shift.
    const e = handleEl(container, 'e');
    dragOn(e, screenX(100), screenY(25), 30, 0);
    await flushRaf();
    let note = liveNotes().find((o) => o.id === id)!;
    expect(note.width).toBe(130);
    expect(note.height).toBe(50); // height untouched: width only

    // Same drag with Shift: the ratio is kept (130:50 → 160:61.54).
    dragOn(e, screenX(130), screenY(25), 30, 0, true);
    await flushRaf();
    note = liveNotes().find((o) => o.id === id)!;
    expect(note.width).toBeCloseTo(160, 0);
    expect(note.height).toBeCloseTo(61.54, 0);
    expect((note.width ?? 0) / (note.height ?? 1)).toBeCloseTo(160 / 61.54, 1);
  });

  it('TC-25 load-failed board: the gesture is refused and nothing is written', async () => {
    const { container } = await board();
    let id = '';
    act(() => {
      id = noteAt(0, 0);
    });
    setConnection('load_failed');
    const el = noteEls(container).find((n) => n.dataset.id === id)!;

    dragOn(el, 740, 500, 60, 0);
    await flushRaf();

    const note = liveNotes().find((o) => o.id === id)!;
    expect(note.x).toBe(0);
    expect(note.y).toBe(0);
    expect(gestureLog().starts).toBe(0);
    // Read-only: the note is selected (a click always selects) but the
    // multi-object bar never appears for a single selection.
    expect(el.hasAttribute('data-selected')).toBe(true);
    expect(selectionCount(container)).toBe('1 selected');
    expect(container.querySelector('[data-testid="selection-bar"]')).toBeNull();
  });

  it('TC-26 one drag → onGestureStart and onGestureEnd each exactly once', async () => {
    const { container } = await board();
    let id = '';
    act(() => {
      id = noteAt(0, 0);
    });
    const el = noteEls(container).find((n) => n.dataset.id === id)!;

    // A plain click (no movement) starts no gesture.
    dragOn(el, 740, 500, 0, 0);
    expect(gestureLog()).toEqual({ starts: 0, ends: 0 });

    // A real drag (past the 3px threshold) starts and ends exactly once.
    dragOn(el, 740, 500, 40, 0);
    await flushRaf();
    expect(gestureLog()).toEqual({ starts: 1, ends: 1 });
  });
});
