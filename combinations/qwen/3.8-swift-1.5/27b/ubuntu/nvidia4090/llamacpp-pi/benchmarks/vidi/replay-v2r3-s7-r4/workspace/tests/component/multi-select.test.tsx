import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import {
  createSticky,
  deleteObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../src/shared/config';
import '../fixtures/testbox';
import { createTestBox } from '../fixtures/testbox';

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

function pointer(el: Element | Window, type: string, x: number, y: number, extra: PointerEventInit = {}) {
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

function boxAt(doc: Y.Doc, x: number, y: number, w = 100, h = 100): string {
  let id = '';
  act(() => {
    id = createTestBox(doc, x, y, w, h);
  });
  return id;
}

function snap(doc: Y.Doc, id: string): ObjectSnapshot {
  const o = snapshot(doc).find((s) => s.id === id);
  expect(o, `object ${id} should exist`).toBeDefined();
  return o!;
}

function clickSelect(id: string) {
  const el = screen.getByTestId(`testbox-${id}`);
  const o = (el as HTMLElement).getAttribute('style')!;
  // screen = world (camera at origin, zoom 1); click the top-left corner area
  const m = /left: ([-\d.]+)px; top: ([-\d.]+)px/.exec(o)!;
  const x = parseFloat(m[1]) + 10;
  const y = parseFloat(m[2]) + 10;
  pointer(el, 'pointerdown', x, y);
  pointer(el, 'pointerup', x, y);
}

function marquee(x1: number, y1: number, x2: number, y2: number) {
  const vp = screen.getByTestId('board-viewport');
  pointer(vp, 'pointerdown', x1, y1, { shiftKey: true });
  pointer(window, 'pointermove', x2, y2, { shiftKey: true });
  pointer(window, 'pointerup', x2, y2, { shiftKey: true });
}

function dragHandle(handle: string, x1: number, y1: number, x2: number, y2: number, extra: PointerEventInit = {}) {
  const el = screen.getByTestId(`resize-handle-${handle}`);
  pointer(el, 'pointerdown', x1, y1, extra);
  pointer(window, 'pointermove', x2, y2, extra);
  flush();
  pointer(window, 'pointerup', x2, y2, extra);
}

function key(el: Window | Element, init: KeyboardEventInit) {
  const preventDefault = vi.fn();
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  e.preventDefault = preventDefault;
  act(() => {
    el.dispatchEvent(e);
  });
  return preventDefault;
}

describe('sel.interaction / sel.marquee_ui / sel.transform / sel.keyboard (multi-selection UI)', () => {
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
    const a = boxAt(doc, 0, 0);
    const b = boxAt(doc, 200, 0);
    marquee(-10, -10, 310, 110);
    expect(screen.getByTestId('selection-count').textContent).toBe('2 selected');

    act(() => {
      deleteObjects(doc, [a, b]);
    });
    expect(screen.queryByTestId('selection-count')).toBeNull();
    expect(screen.queryByTestId('selection-outline')).toBeNull();
    expect(screen.queryByTestId(`testbox-${a}`)).toBeNull();
    expect(screen.queryByTestId(`testbox-${b}`)).toBeNull();
  });

  // TC-17
  it('TC-17: two selected → "2 selected" + Delete selection button; aria-live announces count', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    boxAt(doc, 0, 0);
    boxAt(doc, 200, 0);
    marquee(-10, -10, 310, 110);

    const count = screen.getByTestId('selection-count');
    expect(count.textContent).toBe('2 selected');
    expect(count.getAttribute('aria-live')).toBe('polite');
    const del = screen.getByRole('button', { name: 'Delete selection' });
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
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 300, y: 200 }) as string;
    });
    const note = screen.getByTestId(`sticky-note-${id}`);
    pointer(note, 'pointerdown', 310, 210);
    pointer(note, 'pointerup', 310, 210);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-19
  it('TC-19: empty-space click without drag → selection cleared', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = boxAt(doc, 0, 0);
    clickSelect(a);
    expect(screen.getByTestId(`testbox-${a}`).hasAttribute('data-selected')).toBe(true);
    const vp = screen.getByTestId('board-viewport');
    pointer(vp, 'pointerdown', 640, 400);
    pointer(vp, 'pointerup', 640, 400);
    expect(screen.getByTestId(`testbox-${a}`).hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-20
  it('TC-20: Shift+drag with {x} selected adds the fully-inside ids (additive)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const x = boxAt(doc, 0, 0); // 0..100 × 0..100 (pre-selected)
    const a = boxAt(doc, 200, 0); // 200..300 × 0..100 (fully in)
    const b = boxAt(doc, 200, 150); // 200..300 × 150..250 (fully in)
    const c = boxAt(doc, 400, 0); // 400..500 × 0..100 (partly in → excluded)
    clickSelect(x);
    expect(screen.queryByTestId('selection-count')).toBeNull(); // single selection → toolbar

    marquee(190, -10, 450, 260);
    const count = screen.getByTestId('selection-count');
    expect(count.textContent).toBe('3 selected'); // x + a + b
    expect(screen.getByTestId(`testbox-${a}`).hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId(`testbox-${b}`).hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId(`testbox-${c}`).hasAttribute('data-selected')).toBe(false);
    expect(screen.getByTestId(`testbox-${x}`).hasAttribute('data-selected')).toBe(true);
  });

  // TC-21
  it('TC-21: plain drag on empty space pans; no marquee (negative)', () => {
    const beginPan = vi.fn();
    const panMove = vi.fn();
    const { getDoc } = renderBoard({ beginPan, panMove });
    const doc = getDoc();
    const a = boxAt(doc, 0, 0);
    const vp = screen.getByTestId('board-viewport');
    pointer(vp, 'pointerdown', 600, 400);
    pointer(vp, 'pointermove', 650, 420);
    pointer(vp, 'pointerup', 650, 420);
    expect(beginPan).toHaveBeenCalled();
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(screen.getByTestId(`testbox-${a}`).hasAttribute('data-selected')).toBe(false);
  });

  // TC-22
  it('TC-22: pointercancel mid-marquee → selection unchanged', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = boxAt(doc, 0, 0);
    const b = boxAt(doc, 200, 0);
    const vp = screen.getByTestId('board-viewport');
    pointer(vp, 'pointerdown', -10, -10, { shiftKey: true });
    pointer(window, 'pointermove', 310, 110, { shiftKey: true });
    pointer(window, 'pointercancel', 310, 110, { shiftKey: true });
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.getByTestId(`testbox-${a}`).hasAttribute('data-selected')).toBe(false);
    expect(screen.getByTestId(`testbox-${b}`).hasAttribute('data-selected')).toBe(false);
  });

  // TC-23
  it('TC-23: drag unselected b while {a} selected → selection {b}, only b moves; threshold boundary', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = boxAt(doc, 0, 0);
    const b = boxAt(doc, 200, 0);
    clickSelect(a);

    // 2px (< DRAG_THRESHOLD_PX=3): a click, no write.
    const elB = screen.getByTestId(`testbox-${b}`);
    pointer(elB, 'pointerdown', 250, 50);
    pointer(elB, 'pointermove', 252, 50);
    flush();
    pointer(elB, 'pointerup', 252, 50);
    expect(snap(doc, b).x).toBe(200); // no write
    expect(screen.getByTestId(`testbox-${b}`).hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId(`testbox-${a}`).hasAttribute('data-selected')).toBe(false);

    // 3px (= DRAG_THRESHOLD_PX): the gesture starts and b moves.
    pointer(elB, 'pointerdown', 250, 50);
    pointer(elB, 'pointermove', 253, 50);
    flush();
    pointer(elB, 'pointerup', 253, 50);
    expect(snap(doc, b).x).toBe(203);
    expect(snap(doc, a).x).toBe(0); // a untouched
  });

  // TC-24
  it('TC-24: testbox edge handle changes width only; Shift keeps ratio; handles labelled "Resize <position>"', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const t = boxAt(doc, 0, 0, 100, 100);
    clickSelect(t);

    // Handles exist with the expected labels.
    expect(screen.getByRole('button', { name: 'Resize east' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resize northwest' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resize south' })).toBeTruthy();

    // East handle: +50 in x → width 150, height unchanged.
    dragHandle('e', 100, 50, 150, 50);
    const after = snap(doc, t);
    expect(after.width).toBe(150);
    expect(after.height).toBe(100);
    expect(after.x).toBe(0);

    // Shift + east handle: ratio kept (dominant axis wins): 150×100 → 180×120.
    dragHandle('e', 150, 50, 180, 60, { shiftKey: true }); // delta (30, 10)
    const afterShift = snap(doc, t);
    expect(afterShift.width).toBe(180);
    expect(afterShift.height).toBe(120);
  });

  // TC-25
  it('TC-25: canEdit false → no writes (negative)', () => {
    const { getDoc } = renderBoard({ canEdit: false });
    const doc = getDoc();
    const a = boxAt(doc, 0, 0);
    clickSelect(a);

    // Drag: no move writes.
    const el = screen.getByTestId(`testbox-${a}`);
    pointer(el, 'pointerdown', 50, 50);
    pointer(el, 'pointermove', 100, 60);
    flush();
    pointer(el, 'pointerup', 100, 60);
    expect(snap(doc, a).x).toBe(0);
    expect(snap(doc, a).y).toBe(0);

    // Resize: handles are interactive but the gesture is gated.
    const handle = screen.getByTestId('resize-handle-se');
    pointer(handle, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 150, 150);
    flush();
    pointer(window, 'pointerup', 150, 150);
    expect(snap(doc, a).width).toBe(100);

    // Delete key: no delete.
    key(window, { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(1);
  });

  // TC-26
  it('TC-26: onGestureStart/onGestureEnd each called exactly once per drag; pointercancel keeps last position', () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const { getDoc } = renderBoard({ onGestureStart, onGestureEnd });
    const doc = getDoc();
    const a = boxAt(doc, 0, 0);
    const el = screen.getByTestId(`testbox-${a}`);

    // A plain click is not a drag: no callbacks.
    pointer(el, 'pointerdown', 50, 50);
    pointer(el, 'pointerup', 50, 50);
    expect(onGestureStart).not.toHaveBeenCalled();
    expect(onGestureEnd).not.toHaveBeenCalled();

    // A real drag: start and end exactly once.
    pointer(el, 'pointerdown', 50, 50);
    pointer(el, 'pointermove', 100, 60);
    flush();
    pointer(el, 'pointerup', 100, 60);
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);

    // pointercancel mid-drag: end called once, last applied position kept.
    pointer(el, 'pointerdown', 50, 50);
    pointer(el, 'pointermove', 150, 100);
    flush();
    const pos = snap(doc, a);
    pointer(window, 'pointercancel', 150, 100);
    const after = snap(doc, a);
    expect(after.x).toBe(pos.x);
    expect(after.y).toBe(pos.y);
    expect(onGestureStart).toHaveBeenCalledTimes(2);
    expect(onGestureEnd).toHaveBeenCalledTimes(2);
  });

  // TC-27
  it('TC-27: Ctrl/Cmd+A selects all with preventDefault', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = boxAt(doc, 0, 0);
    const b = boxAt(doc, 200, 0);
    const c = boxAt(doc, 400, 0);
    const preventDefault = key(window, { key: 'a', ctrlKey: true });
    expect(preventDefault).toHaveBeenCalled();
    expect(screen.getByTestId('selection-count').textContent).toBe('3 selected');
    for (const id of [a, b, c]) {
      expect(screen.getByTestId(`testbox-${id}`).hasAttribute('data-selected')).toBe(true);
    }
  });

  // TC-28
  it('TC-28: Ctrl/Cmd+A on empty board → empty, no error', () => {
    renderBoard();
    expect(() => key(window, { key: 'a', ctrlKey: true })).not.toThrow();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('selection-outline')).toBeNull();
  });

  // TC-29
  it('TC-29: ArrowRight → x + NUDGE_STEP_WORLD; Shift+ArrowUp → y − NUDGE_LARGE_STEP_WORLD; preventDefault', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = boxAt(doc, 0, 0);
    clickSelect(a);

    const pd1 = key(window, { key: 'ArrowRight' });
    expect(pd1).toHaveBeenCalled();
    expect(snap(doc, a).x).toBe(NUDGE_STEP_WORLD);
    expect(snap(doc, a).y).toBe(0);

    const pd2 = key(window, { key: 'ArrowUp', shiftKey: true });
    expect(pd2).toHaveBeenCalled();
    expect(snap(doc, a).x).toBe(NUDGE_STEP_WORLD);
    expect(snap(doc, a).y).toBe(-NUDGE_LARGE_STEP_WORLD);
  });

  // TC-30
  it('TC-30: Backspace while editing → text edited, objects kept (negative)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 300, y: 200 }) as string;
    });
    const note = screen.getByTestId(`sticky-note-${id}`);
    act(() => {
      note.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const editor = screen.getByTestId('sticky-text-editor');
    const textarea = editor.querySelector('textarea')!;
    // Type a character, then Backspace inside the editor.
    act(() => {
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(textarea, { key: 'Backspace' });
    expect(snapshot(doc)).toHaveLength(1); // the note survives
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy(); // still editing
  });

  // TC-31
  it('TC-31: Delete with selection → all removed, selection empty', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    boxAt(doc, 0, 0);
    boxAt(doc, 200, 0);
    const c = boxAt(doc, 400, 0);
    marquee(-10, -10, 310, 110); // selects the two left boxes
    expect(screen.getByTestId('selection-count').textContent).toBe('2 selected');
    key(window, { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.getByTestId(`testbox-${c}`)).toBeTruthy();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('selection-outline')).toBeNull();
  });
});
