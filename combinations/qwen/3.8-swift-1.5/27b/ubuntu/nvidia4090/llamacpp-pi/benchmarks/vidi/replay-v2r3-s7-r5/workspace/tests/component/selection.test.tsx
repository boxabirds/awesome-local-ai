import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import { createSticky, deleteObjects, snapshot, objects } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';

import '../fixtures/testbox';

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

function key(window_: Window & typeof globalThis, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    window_.dispatchEvent(e);
  });
  return e;
}

function createNote(doc: Y.Doc, at: Point = { x: 300, y: 200 }): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at) as string;
  });
  return id;
}

function clickNote(id: string, at: Point = { x: 300, y: 200 }, extra: PointerEventInit = {}) {
  const note = screen.getByTestId(`sticky-note-${id}`);
  pointer(note, 'pointerdown', at.x, at.y, extra);
  pointer(note, 'pointerup', at.x, at.y, extra);
  return note;
}

/** Insert a raw testbox object (registered by tests/fixtures/testbox). */
function insertTestbox(
  doc: Y.Doc,
  id: string,
  rect: { x: number; y: number; width: number; height: number },
): void {
  act(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'testbox');
    m.set('x', rect.x);
    m.set('y', rect.y);
    m.set('width', rect.width);
    m.set('height', rect.height);
    m.set('z', 1);
    m.set('createdAt', 1);
    doc.getMap('objects').set(id, m);
  });
}

describe('story 7: multi-selection (sel.interaction, sel.marquee_ui, sel.transform)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-16
  it('TC-16: all selected ids deleted remotely → selection empty, bar hidden', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 600, y: 200 });
    clickNote(a, { x: 200, y: 200 });
    clickNote(b, { x: 600, y: 200 }, { shiftKey: true });
    expect(screen.getByTestId('selection-bar')).toBeTruthy();

    // A colleague deletes both notes.
    act(() => {
      deleteObjects(doc, [a, b]);
    });
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
  });

  // TC-17
  it('TC-17: two selected → "2 selected" + Delete selection button, aria-live announces', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 600, y: 200 });
    clickNote(a, { x: 200, y: 200 });
    clickNote(b, { x: 600, y: 200 }, { shiftKey: true });

    const bar = screen.getByTestId('selection-bar');
    expect(bar.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('selection-count').textContent).toBe('2 selected');
    const del = screen.getByRole('button', { name: 'Delete selection' });
    expect(del).toBeTruthy();

    // The delete button removes both and clears the selection.
    act(() => {
      del.click();
    });
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-18
  it('TC-18: one sticky selected → NoteToolbar instead of the multi-selection bar', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    clickNote(a, { x: 200, y: 200 });
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-19
  it('TC-19: empty-space click without drag → selection cleared', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 });
    const note = clickNote(a, { x: 200, y: 200 });
    expect(note.hasAttribute('data-selected')).toBe(true);
    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 900, 500);
    pointer(viewport, 'pointerup', 900, 500);
    expect(note.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  // TC-20
  it('TC-20: Shift+drag marquee adds fully-inside ids to the selection (additive)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    // A (0,0)-(200,200), B (300,0)-(500,200), C (600,0)-(800,200), x (900,0)-(1100,200)
    const a = createNote(doc, { x: 100, y: 100 });
    const b = createNote(doc, { x: 400, y: 100 });
    createNote(doc, { x: 700, y: 100 });
    const x = createNote(doc, { x: 1000, y: 100 });
    clickNote(x, { x: 1000, y: 100 }); // {x} selected

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', -10, -10, { shiftKey: true });
    pointer(viewport, 'pointermove', 560, 210, { shiftKey: true });
    expect(screen.getByTestId('marquee-rect')).toBeTruthy();
    pointer(viewport, 'pointerup', 560, 210, { shiftKey: true });

    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(screen.getByTestId(`sticky-note-${a}`).hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId(`sticky-note-${b}`).hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId(`sticky-note-${x}`).hasAttribute('data-selected')).toBe(true); // additive
    expect(screen.getByTestId('selection-count').textContent).toBe('3 selected');
  });

  // TC-21
  it('TC-21: plain drag on empty space pans; no marquee (negative)', () => {
    const beginPan = vi.fn();
    const panMove = vi.fn();
    const { getDoc } = renderBoard({ beginPan, panMove });
    const doc = getDoc();
    const a = createNote(doc, { x: 100, y: 100 });
    clickNote(a, { x: 100, y: 100 });

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 900, 500);
    pointer(viewport, 'pointermove', 1000, 560);
    flush();
    pointer(viewport, 'pointerup', 1000, 560);

    expect(beginPan).toHaveBeenCalled();
    expect(panMove).toHaveBeenCalled();
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    // Selection survived the pan.
    expect(screen.getByTestId(`sticky-note-${a}`).hasAttribute('data-selected')).toBe(true);
  });

  // TC-22
  it('TC-22: pointercancel mid-marquee → selection unchanged', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 100, y: 100 });
    const b = createNote(doc, { x: 400, y: 100 });
    clickNote(a, { x: 100, y: 100 }); // {a}

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', -10, -10, { shiftKey: true });
    pointer(viewport, 'pointermove', 560, 210, { shiftKey: true });
    pointer(viewport, 'pointercancel', 560, 210, { shiftKey: true });

    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    // b was inside the rect but the cancelled marquee must not select it.
    expect(screen.getByTestId(`sticky-note-${a}`).hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId(`sticky-note-${b}`).hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-23
  it('TC-23: drag unselected b while {a} selected → {b}, only b moves; threshold boundary', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 100, y: 100 });
    const b = createNote(doc, { x: 500, y: 100 });
    const aBefore = snapshot(doc).find((o) => o.id === a)!;
    const bBefore = snapshot(doc).find((o) => o.id === b)!;

    clickNote(a, { x: 100, y: 100 }); // {a}

    const bNote = screen.getByTestId(`sticky-note-${b}`);
    // Boundary: DRAG_THRESHOLD_PX − 1 movement is a click (no write).
    pointer(bNote, 'pointerdown', 500, 100);
    pointer(bNote, 'pointermove', 500 + DRAG_THRESHOLD_PX - 1, 100);
    flush();
    const bAfterClick = snapshot(doc).find((o) => o.id === b)!;
    expect(bAfterClick.x).toBe(bBefore.x);
    expect(bAfterClick.y).toBe(bBefore.y);
    // The click replaced the selection with {b}.
    expect(screen.getByTestId(`sticky-note-${b}`).hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId(`sticky-note-${a}`).hasAttribute('data-selected')).toBe(false);
    pointer(bNote, 'pointerup', 500 + DRAG_THRESHOLD_PX - 1, 100);

    // Exactly DRAG_THRESHOLD_PX starts the gesture.
    pointer(bNote, 'pointerdown', 500, 100);
    pointer(bNote, 'pointermove', 500 + DRAG_THRESHOLD_PX, 100);
    flush();
    const bAfterDrag = snapshot(doc).find((o) => o.id === b)!;
    expect(bAfterDrag.x).toBe(bBefore.x + DRAG_THRESHOLD_PX);
    expect(bAfterDrag.y).toBe(bBefore.y);
    pointer(bNote, 'pointerup', 500 + DRAG_THRESHOLD_PX, 100);

    // a never moved.
    const aAfter = snapshot(doc).find((o) => o.id === a)!;
    expect(aAfter.x).toBe(aBefore.x);
    expect(aAfter.y).toBe(aBefore.y);
  });

  // TC-24
  it('TC-24: testbox edge handle changes width only; Shift keeps ratio; labelled handles', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    insertTestbox(doc, 'tb1', { x: 100, y: 100, width: 100, height: 50 });
    const box = screen.getByTestId('testbox-tb1');
    pointer(box, 'pointerdown', 150, 125);
    pointer(box, 'pointerup', 150, 125);

    // All eight handles are rendered with "Resize <position>" labels.
    for (const h of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
      expect(screen.getByRole('button', { name: `Resize ${h}` })).toBeTruthy();
    }

    // Drag the east handle: width grows, height unchanged (not aspect-locked).
    const eHandle = screen.getByRole('button', { name: 'Resize e' });
    pointer(eHandle, 'pointerdown', 200, 125);
    pointer(eHandle, 'pointermove', 210, 125);
    flush();
    pointer(eHandle, 'pointerup', 210, 125);
    let s = objects(doc).find((o) => o.id === 'tb1')!;
    expect(s.width).toBe(110);
    expect(s.height).toBe(50);

    // Shift+drag the east handle: the ratio is kept.
    pointer(eHandle, 'pointerdown', 210, 125, { shiftKey: true });
    pointer(eHandle, 'pointermove', 230, 125, { shiftKey: true });
    flush();
    pointer(eHandle, 'pointerup', 230, 125, { shiftKey: true });
    s = objects(doc).find((o) => o.id === 'tb1')!;
    // 110 → 130 width; height follows the 50/110 ratio.
    expect(s.width).toBe(130);
    expect(s.height).toBeCloseTo((50 / 110) * 130, 5);
  });

  // TC-25
  it('TC-25: canEdit false → no writes (negative)', () => {
    const { getDoc } = renderBoard({ canEdit: false });
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const before = snapshot(doc).find((o) => o.id === a)!;

    const note = screen.getByTestId(`sticky-note-${a}`);
    pointer(note, 'pointerdown', 300, 200);
    // Local selection is allowed…
    expect(note.hasAttribute('data-selected')).toBe(true);
    // …but a full drag performs no writes.
    pointer(note, 'pointermove', 400, 300);
    flush();
    pointer(note, 'pointerup', 400, 300);
    const after = snapshot(doc).find((o) => o.id === a)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);

    // Keyboard nudge and delete are ignored as well.
    key(window, { key: 'ArrowRight' });
    key(window, { key: 'Delete' });
    const afterKeys = snapshot(doc).find((o) => o.id === a)!;
    expect(afterKeys.x).toBe(before.x);
  });

  // TC-26
  it('TC-26: onGestureStart/End once per drag; pointercancel keeps last applied positions', () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const { getDoc } = renderBoard({ onGestureStart, onGestureEnd });
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const b = createNote(doc, { x: 600, y: 200 });
    clickNote(a, { x: 300, y: 200 });
    clickNote(b, { x: 600, y: 200 }, { shiftKey: true });

    const note = screen.getByTestId(`sticky-note-${a}`);
    pointer(note, 'pointerdown', 300, 200);
    expect(onGestureStart).not.toHaveBeenCalled();
    pointer(note, 'pointermove', 350, 220);
    flush();
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    const midA = snapshot(doc).find((o) => o.id === a)!;
    const midB = snapshot(doc).find((o) => o.id === b)!;

    // Cancel mid-drag: the last applied positions are kept.
    pointer(note, 'pointercancel', 350, 220);
    const afterA = snapshot(doc).find((o) => o.id === a)!;
    const afterB = snapshot(doc).find((o) => o.id === b)!;
    expect(afterA.x).toBe(midA.x);
    expect(afterA.y).toBe(midA.y);
    expect(afterB.x).toBe(midB.x);
    expect(afterB.y).toBe(midB.y);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);

    // A second full drag: start/end exactly once more.
    pointer(note, 'pointerdown', afterA.x, afterA.y);
    pointer(note, 'pointermove', afterA.x + 20, afterA.y + 20);
    flush();
    pointer(note, 'pointerup', afterA.x + 20, afterA.y + 20);
    expect(onGestureStart).toHaveBeenCalledTimes(2);
    expect(onGestureEnd).toHaveBeenCalledTimes(2);
  });

  // TC-27
  it('TC-27: Ctrl/Cmd+A selects all with preventDefault', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 100, y: 100 });
    const b = createNote(doc, { x: 400, y: 100 });
    const c = createNote(doc, { x: 700, y: 100 });

    const e = key(window, { key: 'a', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    for (const id of [a, b, c]) {
      expect(screen.getByTestId(`sticky-note-${id}`).hasAttribute('data-selected')).toBe(true);
    }
    expect(screen.getByTestId('selection-count').textContent).toBe('3 selected');
  });

  // TC-28
  it('TC-28: Ctrl/Cmd+A on an empty board → empty selection, no error', () => {
    renderBoard();
    const e = key(window, { key: 'a', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
  });

  // TC-29
  it('TC-29: ArrowRight → x + NUDGE_STEP_WORLD; Shift+ArrowUp → y − NUDGE_LARGE_STEP_WORLD; preventDefault', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    clickNote(a, { x: 300, y: 200 });
    const before = snapshot(doc).find((o) => o.id === a)!;

    const e1 = key(window, { key: 'ArrowRight' });
    expect(e1.defaultPrevented).toBe(true);
    const after1 = snapshot(doc).find((o) => o.id === a)!;
    expect(after1.x).toBe(before.x + NUDGE_STEP_WORLD);
    expect(after1.y).toBe(before.y);

    const e2 = key(window, { key: 'ArrowUp', shiftKey: true });
    expect(e2.defaultPrevented).toBe(true);
    const after2 = snapshot(doc).find((o) => o.id === a)!;
    expect(after2.x).toBe(before.x + NUDGE_STEP_WORLD);
    expect(after2.y).toBe(before.y - NUDGE_LARGE_STEP_WORLD);
  });

  // TC-30
  it('TC-30: Backspace while editing → text edited, objects kept (negative)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const note = screen.getByTestId(`sticky-note-${a}`);
    act(() => {
      note.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const ta = screen.getByTestId('sticky-text-editor').querySelector('textarea')!;
    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });
    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();
  });

  // TC-31
  it('TC-31: Delete with a multi-selection → all removed, selection empty', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 100, y: 100 });
    const b = createNote(doc, { x: 400, y: 100 });
    const c = createNote(doc, { x: 700, y: 100 });
    clickNote(a, { x: 100, y: 100 });
    clickNote(b, { x: 400, y: 100 }, { shiftKey: true });
    clickNote(c, { x: 700, y: 100 }, { shiftKey: true });
    expect(screen.getByTestId('selection-count').textContent).toBe('3 selected');

    key(window, { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
  });
});
