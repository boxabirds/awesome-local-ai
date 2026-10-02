import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { registerTestbox } from '../fixtures/testbox';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';

installComponentMocks();
registerTestbox();

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

function createNote(doc: Y.Doc, at: Point): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at) as string;
  });
  return id;
}

/** Test-only `testbox` object (resizable, not aspect-locked). */
function createTestbox(doc: Y.Doc, at: Point, size = { w: 100, h: 50 }): string {
  let id = '';
  act(() => {
    id = crypto.randomUUID();
    const m = new Y.Map();
    m.set('type', 'testbox');
    m.set('x', at.x);
    m.set('y', at.y);
    m.set('z', 1);
    m.set('width', size.w);
    m.set('height', size.h);
    m.set('createdAt', Date.now());
    doc.getMap('objects').set(id, m);
  });
  return id;
}

function clickNote(id: string, at: Point) {
  const note = screen.getByTestId(`sticky-note-${id}`);
  pointer(note, 'pointerdown', at.x, at.y);
  pointer(note, 'pointerup', at.x, at.y);
}

function stickyX(doc: Y.Doc, id: string): number {
  return (doc.getMap('objects').get(id)! as Y.Map<unknown>).get('x') as number;
}

describe('sel.transform (useTransformGesture, SelectionOverlay)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-23
  it('TC-23: drag unselected b while {a} selected → selection {b}, only b moves', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    // createSticky centres on `at`: a → top-left (100,100), b → top-left (400,200)
    const a = createNote(doc, { x: 200, y: 200 });
    const b = createNote(doc, { x: 500, y: 300 });
    clickNote(a, { x: 200, y: 200 });
    expect(screen.getByTestId(`sticky-note-${a}`).hasAttribute('data-selected')).toBe(true);

    // Pointer-down on unselected b replaces the selection and starts the drag.
    const noteB = screen.getByTestId(`sticky-note-${b}`);
    pointer(noteB, 'pointerdown', 500, 300);
    expect(screen.getByTestId(`sticky-note-${a}`).hasAttribute('data-selected')).toBe(false);
    expect(noteB.hasAttribute('data-selected')).toBe(true);

    pointer(window, 'pointermove', 500 + DRAG_THRESHOLD_PX, 300);
    flush();
    pointer(window, 'pointerup', 500 + DRAG_THRESHOLD_PX, 300);

    expect(stickyX(doc, b)).toBe(400 + DRAG_THRESHOLD_PX);
    expect(stickyX(doc, a)).toBe(100); // untouched
  });

  // TC-23 boundary
  it('TC-23: movement of DRAG_THRESHOLD_PX − 1 is a click (no write)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const b = createNote(doc, { x: 500, y: 300 }); // top-left (400,200)
    const noteB = screen.getByTestId(`sticky-note-${b}`);
    pointer(noteB, 'pointerdown', 500, 300);
    pointer(window, 'pointermove', 500 + DRAG_THRESHOLD_PX - 1, 300);
    flush();
    pointer(window, 'pointerup', 500 + DRAG_THRESHOLD_PX - 1, 300);
    expect(stickyX(doc, b)).toBe(400); // no transaction at all
  });

  // TC-24
  it('TC-24: testbox edge handle changes width only; Shift keeps ratio; handles are labelled', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const id = createTestbox(doc, { x: 100, y: 100 });
    const box = screen.getByTestId(`testbox-${id}`);
    pointer(box, 'pointerdown', 150, 125);
    pointer(box, 'pointerup', 150, 125);
    expect(box.hasAttribute('data-selected')).toBe(true);

    // All 8 handles exist with "Resize <position>" labels.
    for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      expect(screen.getByRole('button', { name: `Resize ${h}` })).toBeTruthy();
    }

    // East edge handle: width grows, height unchanged (testbox is not locked).
    const east = screen.getByTestId('sel-handle-e');
    pointer(east, 'pointerdown', 200, 125);
    pointer(window, 'pointermove', 250, 125);
    flush();
    pointer(window, 'pointerup', 250, 125);
    let m = doc.getMap('objects').get(id)! as Y.Map<unknown>;
    expect(m.get('width')).toBe(150);
    expect(m.get('height')).toBe(50);
    expect(m.get('x')).toBe(100); // west edge anchored

    // Shift + se corner: both axes scale (aspect ratio kept).
    const se = screen.getByTestId('sel-handle-se');
    pointer(se, 'pointerdown', 250, 150, { shiftKey: true });
    pointer(window, 'pointermove', 300, 175, { shiftKey: true });
    flush();
    pointer(window, 'pointerup', 300, 175, { shiftKey: true });
    m = doc.getMap('objects').get(id)! as Y.Map<unknown>;
    // Aspect lock: sx = 200/150 = 4/3, sy = 75/50 = 1.5; both ≥ 1 → max = 1.5
    expect(m.get('width')).toBe(225); // 150 × 1.5
    expect(m.get('height')).toBe(75); // 50 × 1.5
  });

  // TC-25
  it('TC-25: canEdit false → no writes (negative)', () => {
    const { getDoc } = renderBoard({ canEdit: false });
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 }); // top-left (100,100)
    const x0 = stickyX(doc, a);
    const note = screen.getByTestId(`sticky-note-${a}`);
    pointer(note, 'pointerdown', 200, 200);
    pointer(window, 'pointermove', 400, 350);
    flush();
    pointer(window, 'pointerup', 400, 350);
    expect(stickyX(doc, a)).toBe(x0); // no write
  });

  // TC-26
  it('TC-26: onGestureStart/onGestureEnd once per drag; pointercancel keeps last applied positions', () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const { getDoc } = renderBoard({ onGestureStart, onGestureEnd });
    const doc = getDoc();
    const a = createNote(doc, { x: 200, y: 200 }); // top-left (100,100), centre (200,200)
    const note = screen.getByTestId(`sticky-note-${a}`);

    // Drag 1: +50 px.
    pointer(note, 'pointerdown', 200, 200);
    pointer(window, 'pointermove', 250, 200);
    flush();
    pointer(window, 'pointerup', 250, 200);
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    expect(stickyX(doc, a)).toBe(150);

    // Drag 2 with a pointercancel mid-drag: the last applied state is kept.
    pointer(note, 'pointerdown', 250, 200); // new centre after drag 1
    pointer(window, 'pointermove', 300, 200);
    flush();
    pointer(window, 'pointermove', 350, 200);
    flush();
    pointer(window, 'pointercancel', 350, 200);
    expect(onGestureStart).toHaveBeenCalledTimes(2);
    expect(onGestureEnd).toHaveBeenCalledTimes(2);
    expect(stickyX(doc, a)).toBe(250); // last applied (150 + 50 + 50), no extra write
    expect(snapshot(doc)).toHaveLength(1);
  });
});
