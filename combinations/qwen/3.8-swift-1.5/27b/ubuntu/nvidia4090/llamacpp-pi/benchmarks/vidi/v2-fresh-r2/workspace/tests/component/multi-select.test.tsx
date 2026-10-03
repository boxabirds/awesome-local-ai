/**
 * Component tests for the story 7 board: multi-selection, marquee, transform
 * gesture and keyboard commands (TC-16 to TC-31).
 *
 * The real `BoardView` renders against a local Y.Doc (fake provider). In
 * jsdom the camera is {0, 0, zoom 1}, so screen coordinates equal world
 * coordinates. Gesture writes are rAF-throttled → fake timers + `advance()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, within, fireEvent } from '@testing-library/react';
import { deleteObjects } from '../../src/shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { renderBoard, insertSticky, insertTestBox, advance, hook } from './harness';

function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} not found`);
  return el;
}

function notePos(id: string): { x: number; y: number } {
  const el = noteEl(id);
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
}

function noteSize(id: string): { w: number; h: number } {
  const el = noteEl(id);
  return { w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
}

function selectedIds(): string[] {
  return [...document.querySelectorAll('[data-selected]')].map(
    (el) => el.getAttribute('data-note-id') as string,
  );
}

function viewport(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

/** Drag an object: pointerdown on it, move, up (window-level moves). */
function dragObject(id: string, from: { x: number; y: number }, to: { x: number; y: number }): void {
  act(() => {
    fireEvent.pointerDown(noteEl(id), { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: to.x, clientY: to.y });
    vi.advanceTimersByTime(32); // flush the rAF write
    fireEvent.pointerUp(window, { pointerId: 1 });
  });
}

/** Shift-drag a marquee on empty space, screen coordinates. */
function marqueeDrag(from: { x: number; y: number }, to: { x: number; y: number }): void {
  act(() => {
    fireEvent.pointerDown(viewport(), { button: 0, pointerId: 1, shiftKey: true, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: to.x, clientY: to.y });
    fireEvent.pointerUp(viewport(), { pointerId: 1 });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sel.interaction (board)', () => {
  // TC-16: all selected objects deleted remotely → Empty, bar hidden.
  it('TC-16: remote deletion of the whole selection empties it and hides the bar', () => {
    renderBoard();
    const a = insertSticky(100, 100);
    const b = insertSticky(400, 100);
    const c = insertSticky(700, 100);

    act(() => fireEvent.keyDown(window, { key: 'a', ctrlKey: true }));
    expect(selectedIds().sort()).toEqual([a, b, c].sort());
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();

    // Remote deletion of all three.
    act(() => {
      deleteObjects(hook().getDoc!(), [a, b, c]);
    });

    expect(selectedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
  });

  // TC-17: two selected → "2 selected" + Delete, aria-live announcement.
  it('TC-17: the bar shows a live "2 selected" count and a Delete button', () => {
    renderBoard();
    const a = insertSticky(100, 100);
    const b = insertSticky(400, 100);

    act(() => {
      fireEvent.pointerDown(noteEl(a), { button: 0, pointerId: 1, clientX: 150, clientY: 150 });
      fireEvent.pointerUp(window, { pointerId: 1 });
    });
    act(() => {
      fireEvent.pointerDown(noteEl(b), { button: 0, pointerId: 1, shiftKey: true, clientX: 450, clientY: 150 });
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    const bar = screen.getByTestId('selection-bar');
    const count = screen.getByTestId('selection-count');
    expect(count).toHaveTextContent('2 selected');
    expect(count).toHaveAttribute('aria-live', 'polite');
    expect(within(bar).getByRole('button', { name: 'Delete selection' })).toBeInTheDocument();
  });

  // TC-18: one sticky selected → NoteToolbar instead of the multi bar.
  it('TC-18: a single sticky shows the note toolbar, not the multi-selection bar', () => {
    renderBoard();
    const a = insertSticky(100, 100);

    act(() => {
      fireEvent.pointerDown(noteEl(a), { button: 0, pointerId: 1, clientX: 150, clientY: 150 });
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-19: empty-space click without drag → Empty.
  it('TC-19: clicking empty space without dragging clears the selection', () => {
    renderBoard();
    const a = insertSticky(100, 100);

    act(() => {
      fireEvent.pointerDown(noteEl(a), { button: 0, pointerId: 1, clientX: 150, clientY: 150 });
      fireEvent.pointerUp(window, { pointerId: 1 });
    });
    expect(selectedIds()).toEqual([a]);

    act(() => {
      fireEvent.click(viewport());
    });
    expect(selectedIds()).toEqual([]);
  });
});

describe('sel.marquee_ui (board)', () => {
  // TC-20: Shift+drag adds fully-inside ids to the existing selection.
  it('TC-20: a marquee adds fully-contained objects to the existing selection', () => {
    renderBoard();
    const a = insertSticky(100, 100); // [0,0]-[200,200]
    const b = insertSticky(600, 100); // [500,0]-[700,200]
    insertSticky(1100, 100); // [1000,0]-[1200,200] outside

    // Select A first, then marquee over A and B (not C).
    act(() => {
      fireEvent.pointerDown(noteEl(a), { button: 0, pointerId: 2, clientX: 150, clientY: 150 });
      fireEvent.pointerUp(window, { pointerId: 2 });
    });

    marqueeDrag({ x: -50, y: -50 }, { x: 750, y: 250 });

    expect(selectedIds().sort()).toEqual([a, b].sort());
  });

  // TC-21: plain drag (no Shift) pans; no marquee (negative).
  it('TC-21: a plain drag on empty space pans and never starts a marquee', () => {
    renderBoard();
    const a = insertSticky(100, 100);

    act(() => {
      fireEvent.pointerDown(noteEl(a), { button: 0, pointerId: 1, clientX: 150, clientY: 150 });
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    act(() => {
      fireEvent.pointerDown(viewport(), { button: 0, pointerId: 1, clientX: 900, clientY: 400 });
      fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 950, clientY: 420 });
      vi.advanceTimersByTime(32);
      fireEvent.pointerUp(viewport(), { pointerId: 1 });
    });

    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    // Selection untouched by the pan.
    expect(selectedIds()).toEqual([a]);
    // The board panned: the world layer moved.
    const world = screen.getByTestId('world-layer');
    expect(world.style.transform).not.toBe('');
  });

  // TC-22: pointercancel mid-marquee → selection unchanged.
  it('TC-22: cancelling a marquee keeps the selection unchanged', () => {
    renderBoard();
    const a = insertSticky(100, 100);
    const b = insertSticky(600, 100);

    act(() => {
      fireEvent.pointerDown(noteEl(a), { button: 0, pointerId: 1, clientX: 150, clientY: 150 });
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    act(() => {
      fireEvent.pointerDown(viewport(), { button: 0, pointerId: 1, shiftKey: true, clientX: -50, clientY: -50 });
      fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 750, clientY: 250 });
      fireEvent.pointerCancel(viewport(), { pointerId: 1 });
    });

    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(selectedIds()).toEqual([a]);
    expect(noteEl(b).hasAttribute('data-selected')).toBe(false);
  });
});

describe('sel.transform (board)', () => {
  // TC-23: drag unselected b while {a} selected → selection {b}; only b moves.
  it('TC-23: dragging an unselected object selects it alone and moves only it', () => {
    renderBoard();
    const a = insertSticky(100, 100);
    const b = insertSticky(600, 100);

    act(() => {
      fireEvent.pointerDown(noteEl(a), { button: 0, pointerId: 1, clientX: 150, clientY: 150 });
      fireEvent.pointerUp(window, { pointerId: 1 });
    });
    expect(selectedIds()).toEqual([a]);

    const beforeA = notePos(a);
    const beforeB = notePos(b);
    dragObject(b, { x: 650, y: 150 }, { x: 700, y: 170 });

    expect(selectedIds()).toEqual([b]);
    expect(notePos(b)).toEqual({ x: beforeB.x + 50, y: beforeB.y + 20 });
    expect(notePos(a)).toEqual(beforeA);
  });

  // TC-24: edge handle changes width only; Shift keeps the ratio (testbox).
  it('TC-24: an edge handle resizes width only; Shift keeps the ratio', () => {
    renderBoard();
    const t1 = insertTestBox(0, 0, 100, 60);
    const t2 = insertTestBox(300, 0, 100, 60);

    // Select both.
    act(() => {
      fireEvent.pointerDown(noteEl(t1), { button: 0, pointerId: 1, clientX: 50, clientY: 30 });
      fireEvent.pointerUp(window, { pointerId: 1 });
      fireEvent.pointerDown(noteEl(t2), { button: 0, pointerId: 1, shiftKey: true, clientX: 350, clientY: 30 });
      fireEvent.pointerUp(window, { pointerId: 1 });
    });
    expect(selectedIds().sort()).toEqual([t1, t2].sort());

    // Drag the east handle 50 units right (no Shift): width only.
    const east = screen.getByTestId('resize-handle-e');
    act(() => {
      fireEvent.pointerDown(east, { button: 0, pointerId: 1, clientX: 400, clientY: 30 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 450, clientY: 30 });
      vi.advanceTimersByTime(32);
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    const w1 = noteSize(t1);
    expect(w1.h).toBe(60); // height unchanged
    expect(w1.w).toBeCloseTo(112.5, 5); // 100 * 450/400

    // Reset the selection, then select both again for the ratio check.
    act(() => {
      fireEvent.click(viewport());
    });
    expect(selectedIds()).toEqual([]);
    act(() => {
      fireEvent.pointerDown(noteEl(t1), { button: 0, pointerId: 1, clientX: 50, clientY: 30 });
      fireEvent.pointerUp(window, { pointerId: 1 });
      fireEvent.pointerDown(noteEl(t2), { button: 0, pointerId: 1, shiftKey: true, clientX: 380, clientY: 30 });
      fireEvent.pointerUp(window, { pointerId: 1 });
    });
    expect(selectedIds().sort()).toEqual([t1, t2].sort());
    const east2 = screen.getByTestId('resize-handle-e');
    act(() => {
      fireEvent.pointerDown(east2, { button: 0, pointerId: 1, shiftKey: true, clientX: 450, clientY: 30 });
      fireEvent.pointerMove(window, { pointerId: 1, shiftKey: true, clientX: 500, clientY: 30 });
      vi.advanceTimersByTime(32);
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    const w2 = noteSize(t1);
    // Box was 450×60 (ratio 7.5); +50 x with ratio → 500 × 66.67.
    expect(w2.w).toBeCloseTo(125, 5);
    expect(w2.h).toBeCloseTo(66.667, 1);
  });

  // TC-25: load-failed board refuses gestures (no writes).
  it('TC-25: a load-failed board refuses moves (no writes)', () => {
    const board = renderBoard();
    const a = insertSticky(100, 100);
    board.forceLoadFailed();

    const before = notePos(a);
    dragObject(a, { x: 150, y: 150 }, { x: 250, y: 200 });

    expect(notePos(a)).toEqual(before);
  });

  // TC-26: onGestureStart/End each called once per drag.
  it('TC-26: each drag logs exactly one gesture start and one end', () => {
    renderBoard();
    const a = insertSticky(100, 100);
    const b = insertSticky(600, 100);
    hook().gestureLog!.length = 0;

    dragObject(a, { x: 150, y: 150 }, { x: 200, y: 150 });
    dragObject(b, { x: 650, y: 150 }, { x: 700, y: 150 });

    expect(hook().gestureLog).toEqual(['start', 'end', 'start', 'end']);
  });
});

describe('sel.keyboard (board)', () => {
  // TC-27: Ctrl/Cmd+A selects all; preventDefault.
  it('TC-27: Ctrl+A selects every object and prevents the default', () => {
    renderBoard();
    const a = insertSticky(100, 100);
    const b = insertSticky(400, 100);
    const c = insertSticky(700, 100);

    const ev = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, cancelable: true, bubbles: true });
    act(() => {
      window.dispatchEvent(ev);
    });

    expect(ev.defaultPrevented).toBe(true);
    expect(selectedIds().sort()).toEqual([a, b, c].sort());
  });

  // TC-28: Ctrl+A on an empty board → Empty, no error (boundary).
  it('TC-28: Ctrl+A on an empty board selects nothing and does not throw', () => {
    renderBoard();

    expect(() => {
      act(() => {
        fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
      });
    }).not.toThrow();

    expect(selectedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-29: arrows nudge; Shift+arrow nudges large; preventDefault.
  it('TC-29: ArrowRight nudges by 1 and Shift+ArrowUp by 10, preventing default', () => {
    renderBoard();
    const a = insertSticky(100, 100);

    act(() => {
      fireEvent.pointerDown(noteEl(a), { button: 0, pointerId: 1, clientX: 150, clientY: 150 });
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    const before = notePos(a);

    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, bubbles: true });
    act(() => window.dispatchEvent(right));
    expect(right.defaultPrevented).toBe(true);
    expect(notePos(a).x).toBe(before.x + NUDGE_STEP_WORLD);

    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, cancelable: true, bubbles: true });
    act(() => window.dispatchEvent(up));
    expect(up.defaultPrevented).toBe(true);
    expect(notePos(a).y).toBe(before.y - NUDGE_LARGE_STEP_WORLD);
  });

  // TC-30: Backspace while editing text does not delete objects (negative).
  it('TC-30: Backspace while editing text keeps the object', () => {
    renderBoard();
    const a = insertSticky(100, 100);

    // Select and start editing.
    act(() => {
      fireEvent.pointerDown(noteEl(a), { button: 0, pointerId: 1, clientX: 150, clientY: 150 });
      fireEvent.pointerUp(window, { pointerId: 1 });
      fireEvent.doubleClick(noteEl(a));
    });

    const editor = noteEl(a).querySelector('[data-testid="sticky-textarea"]');
    expect(editor).not.toBeNull();

    act(() => {
      fireEvent.keyDown(editor!, { key: 'Backspace' });
    });

    // The object is still there.
    expect(noteEl(a)).toBeInTheDocument();
    expect(hook().noteCount!()).toBe(1);
  });

  // TC-31: Delete removes all selected, selection Empty.
  it('TC-31: Delete removes the whole selection and empties it', () => {
    renderBoard();
    const a = insertSticky(100, 100);
    const b = insertSticky(400, 100);
    const c = insertSticky(700, 100);

    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    });
    expect(selectedIds().sort()).toEqual([a, b, c].sort());

    act(() => {
      fireEvent.keyDown(window, { key: 'Delete' });
    });

    expect(hook().noteCount!()).toBe(0);
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});
