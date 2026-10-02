import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import {
  createSticky,
  deleteObject,
  snapshot,
  objectBounds,
  getStickyText,
} from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';
import { createTestbox } from '../fixtures/testbox';

installComponentMocks();

const CAMERA = { x: 0, y: 0, zoom: 1 };
const VIEWPORT = { width: 1280, height: 800 };

function renderBoard(props: Partial<TestBoardProps> = {}) {
  let doc: Y.Doc | null = null;
  const utils = render(
    <TestBoard camera={CAMERA} viewportSize={VIEWPORT} onDocReady={(d) => (doc = d)} {...props} />,
  );
  return { ...utils, getDoc: () => doc as Y.Doc };
}

function flush() {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

function pointer(el: Element, type: string, x: number, y: number, extra: PointerEventInit = {}) {
  act(() => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        pointerId: 1,
        ...extra,
      }),
    );
  });
}

function keydown(el: Element | Window, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}

function createNote(doc: Y.Doc, at: Point = { x: 300, y: 200 }): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at) as string;
  });
  return id;
}

function noteEl(id: string): HTMLElement {
  return screen.getByTestId(`sticky-note-${id}`) as HTMLElement;
}

function selectedIds(): string[] {
  const els = Array.from(document.querySelectorAll('[data-selected]'));
  return els
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('sticky-note-', ''))
    .filter((s) => s.startsWith('') && s.length > 0)
    .sort();
}

/** Click (no drag) on an element at its given screen point. */
function clickAt(el: Element, x: number, y: number, extra: PointerEventInit = {}) {
  pointer(el, 'pointerdown', x, y, extra);
  pointer(el, 'pointerup', x, y);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// sel.interaction — SelectionBar + useSelection (TC-16 to TC-19)
// ─────────────────────────────────────────────────────────────────────────────

describe('story 7: multi-selection (component)', () => {
  // TC-16
  it('TC-16: all selected ids deleted remotely → selection empty, bar hidden', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 600, y: 200 });
    // Select both: click a, shift-click b.
    clickAt(noteEl(a), 200, 200);
    clickAt(noteEl(b), 600, 200, { shiftKey: true });
    expect(selectedIds()).toEqual([a, b].sort());
    expect(screen.getByTestId('selection-bar')).toBeTruthy();

    // Remote delete of both notes.
    act(() => {
      deleteObject(doc, a);
      deleteObject(doc, b);
    });

    // The bar is gone and nothing is selected.
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(selectedIds()).toEqual([]);
  });

  // TC-17
  it('TC-17: two selected → "2 selected" + Delete selection button; aria-live announces count', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 600, y: 200 });
    clickAt(noteEl(a), 200, 200);
    clickAt(noteEl(b), 600, 200, { shiftKey: true });

    const bar = screen.getByTestId('selection-bar');
    const count = screen.getByTestId('selection-count');
    expect(count.textContent).toBe('2 selected');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeTruthy();
    expect(bar).toBeTruthy();
  });

  // TC-18
  it('TC-18: one sticky selected → NoteToolbar instead of the multi-selection bar', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    clickAt(noteEl(a), 200, 200);

    // Story 2's note toolbar (colour buttons) is shown…
    expect(screen.getByRole('button', { name: 'Green colour' })).toBeTruthy();
    // …and the multi-selection bar is NOT.
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-19
  it('TC-19: empty-space click without drag → selection cleared', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    clickAt(noteEl(a), 200, 200);
    expect(selectedIds()).toEqual([a]);

    // Click on empty board space (no movement).
    const viewport = screen.getByTestId('board-viewport');
    clickAt(viewport, 1000, 600);

    expect(selectedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sel.marquee_ui — useMarquee (TC-20 to TC-22)
  // ─────────────────────────────────────────────────────────────────────────

  // TC-20
  it('TC-20: Shift+drag around objects with {a} selected → fully-inside ids added (additive)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    // a: (0,0,200,200); b: (400,0,200,200); c: (400,400,200,200)
    const a = createNote(doc, { x: 100, y: 100 });
    const b = createNote(doc, { x: 500, y: 100 });
    const c = createNote(doc, { x: 500, y: 500 });

    // Select a first.
    clickAt(noteEl(a), 100, 100);
    expect(selectedIds()).toEqual([a]);

    const viewport = screen.getByTestId('board-viewport');
    // Shift+drag rect (350,-50) → (650,250): contains b fully, not c, not a.
    pointer(viewport, 'pointerdown', 350, -50, { shiftKey: true });
    pointer(viewport, 'pointermove', 500, 100);
    pointer(viewport, 'pointermove', 650, 250);
    expect(screen.getByTestId('marquee-rect')).toBeTruthy();
    pointer(viewport, 'pointerup', 650, 250);

    // The marquee rect is gone and b was added to the existing selection.
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(selectedIds()).toEqual([a, b].sort());
    expect(snapshot(doc).find((o) => o.id === c)).toBeTruthy(); // c untouched
  });

  // TC-21
  it('TC-21: plain drag on empty space pans; no marquee (negative)', () => {
    const beginPan = vi.fn();
    const panMove = vi.fn();
    const { getDoc } = renderBoard({ beginPan, panMove });
    const doc = getDoc();
    createNote(doc, { x: 500, y: 100 });

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 350, 300);
    pointer(viewport, 'pointermove', 500, 400);
    pointer(viewport, 'pointerup', 500, 400);

    expect(beginPan).toHaveBeenCalled();
    expect(panMove).toHaveBeenCalled();
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    // Nothing selected by the pan.
    expect(selectedIds()).toEqual([]);
  });

  // TC-22
  it('TC-22: pointercancel mid-marquee → selection unchanged (gesture cancelled)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 100, y: 100 });
    createNote(doc, { x: 500, y: 100 });

    // Start with a selected.
    clickAt(noteEl(a), 100, 100);
    expect(selectedIds()).toEqual([a]);

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 350, -50, { shiftKey: true });
    pointer(viewport, 'pointermove', 650, 250);
    expect(screen.getByTestId('marquee-rect')).toBeTruthy();
    pointer(viewport, 'pointercancel', 650, 250);

    // Cancelled: rect gone, selection unchanged (b NOT added).
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(selectedIds()).toEqual([a]);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sel.transform — useTransformGesture + SelectionOverlay (TC-23 to TC-26)
  // ─────────────────────────────────────────────────────────────────────────

  // TC-23
  it('TC-23: dragging unselected b while {a} selected → selection {b}, only b moves; threshold boundary', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 600, y: 200 });
    const aBefore = snapshot(doc).find((o) => o.id === a)!;
    const bBefore = snapshot(doc).find((o) => o.id === b)!;

    // Select a.
    clickAt(noteEl(a), 200, 200);
    expect(selectedIds()).toEqual([a]);

    // Sub-threshold movement (DRAG_THRESHOLD_PX − 1) is a click: no write.
    pointer(noteEl(b), 'pointerdown', 600, 200);
    pointer(noteEl(b), 'pointermove', 600 + DRAG_THRESHOLD_PX - 1, 200);
    pointer(noteEl(b), 'pointerup', 600 + DRAG_THRESHOLD_PX - 1, 200);
    flush();
    expect(selectedIds()).toEqual([b]); // click selects b
    expect(snapshot(doc).find((o) => o.id === b)!.x).toBe(bBefore.x); // no write
    expect(snapshot(doc).find((o) => o.id === a)!.x).toBe(aBefore.x);

    // Exactly DRAG_THRESHOLD_PX starts the gesture: b moves, a does not.
    pointer(noteEl(b), 'pointerdown', 600, 200);
    pointer(noteEl(b), 'pointermove', 600 + DRAG_THRESHOLD_PX, 200);
    flush();
    pointer(noteEl(b), 'pointerup', 600 + DRAG_THRESHOLD_PX, 200);
    flush();
    expect(snapshot(doc).find((o) => o.id === b)!.x).toBe(bBefore.x + DRAG_THRESHOLD_PX);
    expect(snapshot(doc).find((o) => o.id === a)!.x).toBe(aBefore.x);
    expect(selectedIds()).toEqual([b]);
  });

  // TC-24
  it('TC-24: testbox edge handle changes width only; Shift keeps ratio; handles labelled', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    // testbox 100×50 centred at (400,300) → bounds (350,275,100,50).
    let box = '';
    act(() => {
      box = createTestbox(doc, { x: 400, y: 300 }, { width: 100, height: 50 });
    });
    const boxEl = screen.getByTestId(`testbox-${box}`) as HTMLElement;

    // Select it → the overlay with 8 labelled handles appears.
    clickAt(boxEl, 400, 300);
    expect(screen.getByRole('button', { name: 'Resize right' })).toBeTruthy();
    for (const label of [
      'Resize top-left',
      'Resize top',
      'Resize top-right',
      'Resize right',
      'Resize bottom-right',
      'Resize bottom',
      'Resize bottom-left',
      'Resize left',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }

    // Drag the east handle +50px: width 150, height unchanged (not aspect-locked).
    const east = screen.getByRole('button', { name: 'Resize right' });
    pointer(east, 'pointerdown', 450, 300);
    pointer(east, 'pointermove', 500, 300);
    flush();
    pointer(east, 'pointerup', 500, 300);
    flush();
    let b = objectBounds(snapshot(doc).find((o) => o.id === box)!);
    expect(b.width).toBe(150);
    expect(b.height).toBe(50);

    // Shift+drag the east handle: ratio kept — factor (150+50)/150 = 4/3 on the
    // current 150×50 box → 200×66.67.
    const east2 = screen.getByRole('button', { name: 'Resize right' });
    pointer(east2, 'pointerdown', 500, 300, { shiftKey: true });
    pointer(east2, 'pointermove', 550, 300, { shiftKey: true });
    flush();
    pointer(east2, 'pointerup', 550, 300);
    flush();
    b = objectBounds(snapshot(doc).find((o) => o.id === box)!);
    expect(b.width).toBeCloseTo(200, 6);
    expect(b.height).toBeCloseTo(50 * (4 / 3), 1);
  });

  // TC-25
  it('TC-25: canEdit false → no writes (negative)', () => {
    const { getDoc } = renderBoard({ canEdit: false });
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const before = snapshot(doc).find((o) => o.id === a)!;

    pointer(noteEl(a), 'pointerdown', 300, 200);
    pointer(noteEl(a), 'pointermove', 400, 260);
    flush();
    pointer(noteEl(a), 'pointerup', 400, 260);
    flush();

    const after = snapshot(doc).find((o) => o.id === a)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // No selection either (the press was rejected).
    expect(selectedIds()).toEqual([]);
  });

  // TC-26
  it('TC-26: onGestureStart/onGestureEnd once per drag; pointercancel keeps last applied positions', () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const { getDoc } = renderBoard({ onGestureStart, onGestureEnd });
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const before = snapshot(doc).find((o) => o.id === a)!;

    // A full drag: both callbacks exactly once.
    pointer(noteEl(a), 'pointerdown', 300, 200);
    pointer(noteEl(a), 'pointermove', 350, 230);
    flush();
    pointer(noteEl(a), 'pointerup', 350, 230);
    flush();
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    expect(snapshot(doc).find((o) => o.id === a)!.x).toBe(before.x + 50);

    // A cancelled drag: start once more, end once more, last applied kept.
    const mid = snapshot(doc).find((o) => o.id === a)!;
    pointer(noteEl(a), 'pointerdown', 350, 230);
    pointer(noteEl(a), 'pointermove', 400, 230);
    flush();
    const applied = snapshot(doc).find((o) => o.id === a)!.x;
    pointer(noteEl(a), 'pointercancel', 400, 230);
    flush();
    expect(onGestureStart).toHaveBeenCalledTimes(2);
    expect(onGestureEnd).toHaveBeenCalledTimes(2);
    expect(snapshot(doc).find((o) => o.id === a)!.x).toBe(applied);
    expect(applied).toBeGreaterThan(mid.x);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sel.keyboard — useBoardKeys (TC-27 to TC-31)
  // ─────────────────────────────────────────────────────────────────────────

  // TC-27
  it('TC-27: Ctrl+A selects all with preventDefault', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 600, y: 200 });
    const c = createNote(doc, { x: 400, y: 500 });

    let prevented = false;
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(e);
      prevented = e.defaultPrevented;
    });

    expect(prevented).toBe(true);
    expect(selectedIds()).toEqual([a, b, c].sort());
  });

  // TC-28
  it('TC-28: Ctrl+A on empty board → empty, no error (boundary)', () => {
    renderBoard();
    expect(() => {
      keydown(window, 'a', { ctrlKey: true });
    }).not.toThrow();
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-29
  it('TC-29: ArrowRight → x + NUDGE_STEP_WORLD; Shift+ArrowUp → y − NUDGE_LARGE_STEP_WORLD; preventDefault', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    clickAt(noteEl(a), 300, 200);
    const before = snapshot(doc).find((o) => o.id === a)!;

    let prevented = false;
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      window.dispatchEvent(e);
      prevented = e.defaultPrevented;
    });
    expect(prevented).toBe(true);
    expect(snapshot(doc).find((o) => o.id === a)!.x).toBe(before.x + NUDGE_STEP_WORLD);

    let prevented2 = false;
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(e);
      prevented2 = e.defaultPrevented;
    });
    expect(prevented2).toBe(true);
    expect(snapshot(doc).find((o) => o.id === a)!.y).toBe(before.y - NUDGE_LARGE_STEP_WORLD);
  });

  // TC-30
  it('TC-30: Backspace while editing → text edited, objects kept (negative)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });

    // Double-click enters editing mode.
    act(() => {
      fireEvent.doubleClick(noteEl(a));
    });
    const textarea = screen.getByLabelText('Sticky note text') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: 'ab' } });
    });

    // Backspace while editing is a text edit, never a delete.
    keydown(window, 'Backspace');
    act(() => {
      fireEvent.change(textarea, { target: { value: 'a' } });
    });
    keydown(window, 'Escape');

    // The note survived and its text is the edited value.
    const after = snapshot(doc).find((o) => o.id === a);
    expect(after).toBeTruthy();
    expect(getStickyText(doc, a)!.toString()).toBe('a');
  });

  // TC-31
  it('TC-31: Delete with selection → all removed, selection empty', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 600, y: 200 });
    clickAt(noteEl(a), 200, 200);
    clickAt(noteEl(b), 600, 200, { shiftKey: true });
    expect(selectedIds()).toEqual([a, b].sort());

    keydown(window, 'Delete');

    expect(snapshot(doc)).toHaveLength(0);
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});
