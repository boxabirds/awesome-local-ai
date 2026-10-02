import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import {
  createSticky,
  deleteObjects,
  allObjects,
  snapshot,
  getStickyText,
} from '../../src/shared/board-model';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
} from '../../src/shared/config';
import { registerTestBox, createTestBox } from '../fixtures/testbox';
import type { Point } from '../../src/client/canvas/camera';

installComponentMocks();
registerTestBox();

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

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

function createNote(doc: Y.Doc, at: Point): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at) as string;
  });
  return id;
}

function noteAt(id: string): Element {
  return screen.getByTestId(`sticky-note-${id}`);
}

/** Plain click (down+up) on a note at its screen position. */
function clickNote(id: string, x: number, y: number, shift = false) {
  const el = noteAt(id);
  pointer(el, 'pointerdown', x, y, { shiftKey: shift });
  pointer(el, 'pointerup', x, y, { shiftKey: shift });
}

/** Drag on a note: down at (x1,y1), move to (x2,y2), up. */
function dragNote(id: string, x1: number, y1: number, x2: number, y2: number) {
  const el = noteAt(id);
  pointer(el, 'pointerdown', x1, y1);
  pointer(el, 'pointermove', x2, y2);
  pointer(el, 'pointerup', x2, y2);
}

/** Shift+drag marquee on the viewport. `cancel` ends with pointercancel. */
function marquee(x1: number, y1: number, x2: number, y2: number, cancel = false) {
  const vp = screen.getByTestId('board-viewport');
  pointer(vp, 'pointerdown', x1, y1, { shiftKey: true });
  pointer(vp, 'pointermove', x2, y2, { shiftKey: true });
  pointer(vp, cancel ? 'pointercancel' : 'pointerup', x2, y2, { shiftKey: true });
}

function snap(doc: Y.Doc, id: string) {
  return allObjects(doc).find((o) => o.id === id)!;
}

describe('story 7 component: selection, marquee, transform, keyboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------- sel.interaction

  // TC-16
  it('TC-16: all selected ids deleted remotely → selection empty, bar hidden', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 400, y: 200 });
    clickNote(a, 200, 200);
    clickNote(b, 400, 200, true);
    expect(screen.getByTestId('selection-count').textContent).toContain('2 selected');

    // A colleague deletes both.
    act(() => {
      deleteObjects(doc, [a, b]);
    });
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  // TC-17
  it('TC-17: two selected → "2 selected" + Delete selection button; aria-live count', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 400, y: 200 });
    clickNote(a, 200, 200);
    clickNote(b, 400, 200, true);

    const bar = screen.getByTestId('selection-bar');
    expect(bar).toBeTruthy();
    const count = screen.getByTestId('selection-count');
    expect(count.textContent).toContain('2 selected');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByLabelText('Delete selection', { exact: false })).toBeTruthy();
    // Both notes show the selected outline.
    expect(noteAt(a).hasAttribute('data-selected')).toBe(true);
    expect(noteAt(b).hasAttribute('data-selected')).toBe(true);
  });

  // TC-18
  it('TC-18: one sticky selected → NoteToolbar instead of the multi-select bar', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    clickNote(a, 200, 200);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  // TC-19
  it('TC-19: empty-space click without drag clears the selection', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    clickNote(a, 200, 200);
    expect(noteAt(a).hasAttribute('data-selected')).toBe(true);

    const vp = screen.getByTestId('board-viewport');
    pointer(vp, 'pointerdown', 700, 600);
    pointer(vp, 'pointerup', 700, 600);
    expect(noteAt(a).hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  // ---------------------------------------------------------------- sel.marquee_ui

  // TC-20
  it('TC-20: Shift+drag marquee adds fully-inside ids to an existing selection (additive)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    // A spans (150..350, 150..350); B spans (800..1000, 150..350).
    const a = createNote(doc, { x: 250, y: 250 });
    const b = createNote(doc, { x: 900, y: 250 });

    // Start with B selected.
    clickNote(b, 900, 250);
    expect(noteAt(b).hasAttribute('data-selected')).toBe(true);

    // Marquee around A only: (50,140) → (450,360).
    marquee(50, 140, 450, 360);
    expect(noteAt(a).hasAttribute('data-selected')).toBe(true);
    expect(noteAt(b).hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('selection-count').textContent).toContain('2 selected');
  });

  // TC-21
  it('TC-21: plain drag on empty space pans; no marquee (negative)', () => {
    const beginPan = vi.fn();
    const panMove = vi.fn();
    renderBoard({ beginPan, panMove });
    const vp = screen.getByTestId('board-viewport');
    pointer(vp, 'pointerdown', 100, 100);
    pointer(vp, 'pointermove', 150, 120);
    pointer(vp, 'pointerup', 150, 120);
    expect(beginPan).toHaveBeenCalledTimes(1);
    expect(panMove).toHaveBeenCalled();
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  // TC-22
  it('TC-22: pointercancel mid-marquee → selection unchanged', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 250, y: 250 }); // would be inside the rect
    marquee(50, 140, 450, 360, true);
    expect(noteAt(a).hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  // ---------------------------------------------------------------- sel.transform

  // TC-23
  it('TC-23: drag unselected b while {a} selected → selection {b}, only b moves; threshold boundary', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    // A top-left (100,100); B top-left (500,100).
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 600, y: 200 });
    clickNote(a, 200, 200);

    // 2px (threshold − 1) is a plain click: selection {b}, no write.
    pointer(noteAt(b), 'pointerdown', 600, 200);
    pointer(noteAt(b), 'pointermove', 602, 200);
    flush();
    pointer(noteAt(b), 'pointerup', 602, 200);
    expect(noteAt(b).hasAttribute('data-selected')).toBe(true);
    expect(noteAt(a).hasAttribute('data-selected')).toBe(false);
    expect(snap(doc, b).x).toBe(500);

    // Exactly 3px (the threshold) starts the gesture: only b moves.
    const bBefore = snap(doc, b);
    pointer(noteAt(b), 'pointerdown', 600, 200);
    pointer(noteAt(b), 'pointermove', 603, 200);
    flush();
    pointer(noteAt(b), 'pointerup', 603, 200);
    expect(snap(doc, b).x).toBe(bBefore.x + 3);
    expect(snap(doc, a).x).toBe(100); // a untouched
  });

  // TC-24
  it('TC-24: testbox edge handle changes width only; Shift keeps ratio; handles labelled', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    let tb = '';
    act(() => {
      tb = createTestBox(doc, { x: 100, y: 100 }, { width: 200, height: 100 });
    });
    const box = screen.getByTestId(`testbox-${tb}`);
    pointer(box, 'pointerdown', 200, 150);
    pointer(box, 'pointerup', 200, 150);

    // All eight handles are present with "Resize <position>" labels.
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
      expect(screen.getByLabelText(label)).toBeTruthy();
    }

    // Drag the east handle +50: width only (testbox is not aspect-locked).
    const eHandle = screen.getByLabelText('Resize right');
    pointer(eHandle, 'pointerdown', 300, 150);
    pointer(eHandle, 'pointermove', 350, 150);
    flush();
    pointer(eHandle, 'pointerup', 350, 150);
    let o = snap(doc, tb);
    expect(o.width).toBe(250);
    expect(o.height).toBe(100);

    // Shift+drag the east handle +20: ratio kept (100/250) → 270×108.
    pointer(eHandle, 'pointerdown', 350, 150, { shiftKey: true });
    pointer(eHandle, 'pointermove', 370, 150, { shiftKey: true });
    flush();
    pointer(eHandle, 'pointerup', 370, 150, { shiftKey: true });
    o = snap(doc, tb);
    expect(o.width).toBe(270);
    expect(o.height).toBe(108);
  });

  // TC-25
  it('TC-25: canEdit false → drag and resize perform no writes (negative)', () => {
    const { getDoc } = renderBoard({ canEdit: false });
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    clickNote(a, 300, 200);

    dragNote(a, 300, 200, 350, 240);
    flush();
    expect(snap(doc, a).x).toBe(200);
    expect(snap(doc, a).y).toBe(100);

    // Resize is also ignored.
    const se = screen.getByLabelText('Resize bottom-right');
    pointer(se, 'pointerdown', 400, 300);
    pointer(se, 'pointermove', 450, 300);
    flush();
    pointer(se, 'pointerup', 450, 300);
    expect(snap(doc, a).width ?? 200).toBe(200);
  });

  // TC-26
  it('TC-26: onGestureStart/End fire exactly once per drag; pointercancel keeps last applied positions', () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const { getDoc } = renderBoard({ onGestureStart, onGestureEnd });
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 }); // top-left (200,100)
    clickNote(a, 300, 200);

    pointer(noteAt(a), 'pointerdown', 300, 200);
    pointer(noteAt(a), 'pointermove', 350, 200); // crosses the threshold
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    flush();
    expect(snap(doc, a).x).toBe(250);

    pointer(noteAt(a), 'pointermove', 360, 200); // scheduled, not applied
    pointer(noteAt(a), 'pointercancel', 360, 200);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    // The last APPLIED position is kept (350, not 360).
    expect(snap(doc, a).x).toBe(250);
  });

  // ---------------------------------------------------------------- sel.keyboard

  // TC-27
  it('TC-27: Ctrl+A selects all with preventDefault', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 400, y: 200 });
    const e = key(window, { key: 'a', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(noteAt(a).hasAttribute('data-selected')).toBe(true);
    expect(noteAt(b).hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('selection-count').textContent).toContain('2 selected');
  });

  // TC-28
  it('TC-28: Ctrl+A on an empty board → empty selection, no error (boundary)', () => {
    renderBoard();
    const e = key(window, { key: 'a', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  // TC-29
  it('TC-29: ArrowRight nudges by NUDGE_STEP_WORLD; Shift+ArrowUp by NUDGE_LARGE_STEP_WORLD; preventDefault', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 }); // top-left (200,100)
    clickNote(a, 300, 200);

    const e1 = key(window, { key: 'ArrowRight' });
    expect(e1.defaultPrevented).toBe(true);
    expect(snap(doc, a).x).toBe(200 + NUDGE_STEP_WORLD);
    expect(snap(doc, a).y).toBe(100);

    const e2 = key(window, { key: 'ArrowUp', shiftKey: true });
    expect(e2.defaultPrevented).toBe(true);
    expect(snap(doc, a).y).toBe(100 - NUDGE_LARGE_STEP_WORLD);
  });

  // TC-30
  it('TC-30: Backspace while editing → text edited, objects kept (negative)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const ytext = getStickyText(doc, a)!;
    act(() => {
      ytext.insert(0, 'ab');
    });
    clickNote(a, 300, 200);
    act(() => {
      noteAt(a).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();

    // A Backspace reaches the window while editing: it must not delete.
    key(window, { key: 'Backspace' });
    // The user's own edit (the textarea's Backspace) removes the last char.
    act(() => {
      ytext.delete(1, 1);
    });
    expect(snapshot(doc).find((o) => o.id === a)).toBeTruthy();
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();
    expect(ytext.toString()).toBe('a');
  });

  // TC-31
  it('TC-31: Delete with a selection → all removed, selection empty', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 400, y: 200 });
    clickNote(a, 200, 200);
    clickNote(b, 400, 200, true);
    expect(screen.getByTestId('selection-count').textContent).toContain('2 selected');

    key(window, { key: 'Delete' });
    expect(snapshot(doc).length).toBe(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});
