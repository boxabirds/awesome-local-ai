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
} from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';

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

function key(type: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
}

function createNote(doc: Y.Doc, at: Point = { x: 300, y: 200 }): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at) as string;
  });
  return id;
}

describe('story 7: multi-selection (component)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-16
  it('TC-16: clicking a note selects it (data-selected); clicking empty space clears', () => {
    const { getDoc } = renderBoard();
    const id = createNote(getDoc());
    const note = screen.getByTestId(`sticky-note-${id}`);

    pointer(note, 'pointerdown', 300, 200);
    pointer(note, 'pointerup', 300, 200);
    expect(note.hasAttribute('data-selected')).toBe(true);

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 5, 5);
    pointer(viewport, 'pointerup', 5, 5);
    expect(note.hasAttribute('data-selected')).toBe(false);
  });

  // TC-17
  it('TC-17: the selection shows an outline and 8 accessible resize handles', () => {
    const { getDoc } = renderBoard();
    const id = createNote(getDoc());
    const note = screen.getByTestId(`sticky-note-${id}`);
    pointer(note, 'pointerdown', 300, 200);
    pointer(note, 'pointerup', 300, 200);

    const overlay = screen.getByTestId('selection-overlay');
    expect(overlay).toBeTruthy();
    for (const label of [
      'top-left', 'top', 'top-right', 'right',
      'bottom-right', 'bottom', 'bottom-left', 'left',
    ]) {
      expect(screen.getByRole('button', { name: `Resize ${label}` })).toBeTruthy();
    }
    expect(screen.getByTestId('resize-handle-se')).toBeTruthy();

    // Deselecting removes the chrome.
    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 5, 5);
    pointer(viewport, 'pointerup', 5, 5);
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
  });

  // TC-18
  it('TC-18: shift+click adds to the selection; shift+click again removes it', () => {
    const { getDoc } = renderBoard();
    const a = createNote(getDoc(), { x: 300, y: 200 });
    const b = createNote(getDoc(), { x: 700, y: 200 });
    const na = screen.getByTestId(`sticky-note-${a}`);
    const nb = screen.getByTestId(`sticky-note-${b}`);

    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointerup', 300, 200);
    expect(na.hasAttribute('data-selected')).toBe(true);
    expect(nb.hasAttribute('data-selected')).toBe(false);

    pointer(nb, 'pointerdown', 700, 200, { shiftKey: true });
    pointer(nb, 'pointerup', 700, 200, { shiftKey: true });
    expect(na.hasAttribute('data-selected')).toBe(true);
    expect(nb.hasAttribute('data-selected')).toBe(true);

    // Shift+click on a selected note removes it.
    pointer(na, 'pointerdown', 300, 200, { shiftKey: true });
    pointer(na, 'pointerup', 300, 200, { shiftKey: true });
    expect(na.hasAttribute('data-selected')).toBe(false);
    expect(nb.hasAttribute('data-selected')).toBe(true);
  });

  // TC-19
  it('TC-19: with ≥2 selected the bar shows "N selected" + delete; delete removes them all', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const b = createNote(doc, { x: 700, y: 200 });
    const na = screen.getByTestId(`sticky-note-${a}`);
    const nb = screen.getByTestId(`sticky-note-${b}`);

    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointerup', 300, 200);
    pointer(nb, 'pointerdown', 700, 200, { shiftKey: true });
    pointer(nb, 'pointerup', 700, 200, { shiftKey: true });

    const bar = screen.getByTestId('selection-bar');
    expect(screen.getByTestId('selection-count').textContent).toBe('2 selected');
    const del = screen.getByRole('button', { name: 'Delete selection' });
    fireEvent.click(del);

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    void bar;
  });

  // TC-20
  it('TC-20: dragging one note moves the WHOLE selection; the board does not pan', () => {
    const beginPan = vi.fn();
    const panMove = vi.fn();
    const { getDoc } = renderBoard({ beginPan, panMove });
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const b = createNote(doc, { x: 700, y: 200 });
    const na = screen.getByTestId(`sticky-note-${a}`);
    const nb = screen.getByTestId(`sticky-note-${b}`);
    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointerup', 300, 200);
    pointer(nb, 'pointerdown', 700, 200, { shiftKey: true });
    pointer(nb, 'pointerup', 700, 200, { shiftKey: true });

    const beforeA = objectBounds(snapshot(doc).find((o) => o.id === a)!);
    const beforeB = objectBounds(snapshot(doc).find((o) => o.id === b)!);

    // Drag note A by +50/+20 screen px (zoom 1).
    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointermove', 305, 201); // below threshold
    flush();
    pointer(na, 'pointermove', 350, 220);
    flush();
    pointer(na, 'pointerup', 350, 220);

    const afterA = objectBounds(snapshot(doc).find((o) => o.id === a)!);
    const afterB = objectBounds(snapshot(doc).find((o) => o.id === b)!);
    expect(afterA.x).toBe(beforeA.x + 50);
    expect(afterA.y).toBe(beforeA.y + 20);
    expect(afterB.x).toBe(beforeB.x + 50);
    expect(afterB.y).toBe(beforeB.y + 20);
    // Both stay selected after the drag.
    expect(na.hasAttribute('data-selected')).toBe(true);
    expect(nb.hasAttribute('data-selected')).toBe(true);
    // The board did NOT pan.
    expect(beginPan).not.toHaveBeenCalled();
    expect(panMove).not.toHaveBeenCalled();
  });

  // TC-21
  it('TC-21: a plain drag on empty space pans and does NOT start a marquee or change selection', () => {
    const beginPan = vi.fn();
    const panMove = vi.fn();
    const { getDoc } = renderBoard({ beginPan, panMove });
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const na = screen.getByTestId(`sticky-note-${a}`);
    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointerup', 300, 200);
    expect(na.hasAttribute('data-selected')).toBe(true);

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 100, 100);
    pointer(viewport, 'pointermove', 200, 150);
    pointer(viewport, 'pointerup', 200, 150);

    expect(beginPan).toHaveBeenCalled();
    expect(panMove).toHaveBeenCalled();
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    // A pan is not a click: the selection is left untouched.
    expect(na.hasAttribute('data-selected')).toBe(true);
  });

  // TC-22
  it('TC-22: shift+drag draws a world-space marquee and selects fully-contained objects', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 }); // (200..400) × (100..300)
    const b = createNote(doc, { x: 700, y: 200 }); // (600..800) × (100..300)
    const na = screen.getByTestId(`sticky-note-${a}`);
    const nb = screen.getByTestId(`sticky-note-${b}`);

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 150, 50, { shiftKey: true });
    pointer(viewport, 'pointermove', 450, 350, { shiftKey: true });
    // The marquee rect is drawn in world space (identity camera).
    const rect = screen.getByTestId('marquee-rect');
    expect(rect.style.left).toBe('150px');
    expect(rect.style.top).toBe('50px');
    expect(rect.style.width).toBe('300px');
    expect(rect.style.height).toBe('300px');
    pointer(viewport, 'pointerup', 450, 350, { shiftKey: true });

    // A fully inside → selected; B outside → not selected.
    expect(na.hasAttribute('data-selected')).toBe(true);
    expect(nb.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  // TC-23
  it('TC-23: Escape cancels the marquee — no selection change', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const na = screen.getByTestId(`sticky-note-${a}`);

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 150, 50, { shiftKey: true });
    pointer(viewport, 'pointermove', 450, 350, { shiftKey: true });
    expect(screen.getByTestId('marquee-rect')).toBeTruthy();

    key('keydown', { key: 'Escape' });
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(na.hasAttribute('data-selected')).toBe(false);

    // Releasing afterwards selects nothing (the marquee was cancelled).
    pointer(viewport, 'pointerup', 450, 350, { shiftKey: true });
    expect(na.hasAttribute('data-selected')).toBe(false);
  });

  // TC-24
  it('TC-24: Ctrl/Cmd+A selects all objects; Escape clears the selection', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const b = createNote(doc, { x: 700, y: 200 });
    const na = screen.getByTestId(`sticky-note-${a}`);
    const nb = screen.getByTestId(`sticky-note-${b}`);

    key('keydown', { key: 'a', ctrlKey: true });
    expect(na.hasAttribute('data-selected')).toBe(true);
    expect(nb.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('selection-count').textContent).toBe('2 selected');

    key('keydown', { key: 'Escape' });
    expect(na.hasAttribute('data-selected')).toBe(false);
    expect(nb.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('Ctrl+A selects only known types (unknown doc objects are ignored)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    // An object of an unregistered type in the same doc.
    act(() => {
      const m = new Y.Map<unknown>();
      m.set('type', 'mystery');
      m.set('x', 0);
      m.set('y', 0);
      m.set('z', 99);
      doc.getMap('objects').set('mystery-1', m);
    });
    key('keydown', { key: 'a', ctrlKey: true });
    expect(screen.getByTestId(`sticky-note-${a}`).hasAttribute('data-selected')).toBe(true);
    // Exactly one object selected → the bar shows the single-note toolbar,
    // not a count (a second, unknown type must NOT have been selected).
    expect(screen.queryByTestId('selection-count')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
  });

  // TC-25
  it('TC-25: read-only board — selection works, moving and deleting do not', () => {
    const { getDoc } = renderBoard({ canEdit: false });
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const na = screen.getByTestId(`sticky-note-${a}`);

    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointerup', 300, 200);
    expect(na.hasAttribute('data-selected')).toBe(true);

    const before = objectBounds(snapshot(doc).find((o) => o.id === a)!);
    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointermove', 380, 260);
    flush();
    pointer(na, 'pointerup', 380, 260);
    const after = objectBounds(snapshot(doc).find((o) => o.id === a)!);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);

    key('keydown', { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(1);
  });

  // TC-26
  it('TC-26: onGestureStart / onGestureEnd fire around a group drag', () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const { getDoc } = renderBoard({ onGestureStart, onGestureEnd });
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const na = screen.getByTestId(`sticky-note-${a}`);
    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointerup', 300, 200);

    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointermove', 302, 200); // below threshold: no start
    flush();
    expect(onGestureStart).not.toHaveBeenCalled();
    pointer(na, 'pointermove', 350, 220);
    flush();
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).not.toHaveBeenCalled();
    pointer(na, 'pointerup', 350, 220);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);

    // A plain click (below threshold) fires neither.
    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointerup', 300, 200);
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });

  describe('group resize', () => {
    function selectAndFindHandle(doc: Y.Doc, ids: string[]) {
      for (const id of ids) {
        const note = screen.getByTestId(`sticky-note-${id}`);
        const at = objectBounds(snapshot(doc).find((o) => o.id === id)!);
        const cx = at.x + at.width / 2;
        const cy = at.y + at.height / 2;
        pointer(note, 'pointerdown', cx, cy, ids.indexOf(id) === 0 ? {} : { shiftKey: true });
        pointer(note, 'pointerup', cx, cy, ids.indexOf(id) === 0 ? {} : { shiftKey: true });
      }
      return screen.getByTestId('resize-handle-se');
    }

    it('se handle with aspect lock: 200×200 + (100, 40) → 300×300 (TC-01 at the component level)', () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();
      const a = createNote(doc, { x: 300, y: 200 }); // (200,100,200,200)
      const handle = selectAndFindHandle(doc, [a]);

      // se handle at world (400, 300) = screen (400, 300).
      pointer(handle, 'pointerdown', 400, 300);
      pointer(handle, 'pointermove', 500, 340);
      flush();
      pointer(handle, 'pointerup', 500, 340);

      const b = objectBounds(snapshot(doc).find((o) => o.id === a)!);
      expect(b).toEqual({ x: 200, y: 100, width: 300, height: 300 });
    });

    it('shrink clamps at STICKY_MIN_SIZE_WORLD', () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();
      const a = createNote(doc, { x: 300, y: 200 });
      const handle = selectAndFindHandle(doc, [a]);

      pointer(handle, 'pointerdown', 400, 300);
      pointer(handle, 'pointermove', 100, 0); // far inward
      flush();
      pointer(handle, 'pointerup', 100, 0);

      const b = objectBounds(snapshot(doc).find((o) => o.id === a)!);
      expect(b.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 5);
      expect(b.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 5);
    });

    it('grow clamps at MAX_OBJECT_SIZE_WORLD', () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();
      const a = createNote(doc, { x: 300, y: 200 });
      const handle = selectAndFindHandle(doc, [a]);

      pointer(handle, 'pointerdown', 400, 300);
      pointer(handle, 'pointermove', 40000, 40000);
      flush();
      pointer(handle, 'pointerup', 40000, 40000);

      const b = objectBounds(snapshot(doc).find((o) => o.id === a)!);
      expect(b.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 0);
      expect(b.height).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 0);
    });

    it('two notes 100 apart: box ×1.5 → each 300 wide, gap 150 (relative layout preserved)', () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();
      const a = createNote(doc, { x: 300, y: 200 }); // (200,100,200,200)
      const b = createNote(doc, { x: 600, y: 200 }); // (500,100,200,200)
      const handle = selectAndFindHandle(doc, [a, b]); // box (200,100,500,200)

      // se handle at (700, 300); +250 x → box width 750 (×1.5)
      pointer(handle, 'pointerdown', 700, 300);
      pointer(handle, 'pointermove', 950, 300);
      flush();
      pointer(handle, 'pointerup', 950, 300);

      const ra = objectBounds(snapshot(doc).find((o) => o.id === a)!);
      const rb = objectBounds(snapshot(doc).find((o) => o.id === b)!);
      expect(ra.width).toBeCloseTo(300, 5);
      expect(rb.width).toBeCloseTo(300, 5);
      const gap = rb.x - (ra.x + ra.width);
      expect(gap).toBeCloseTo(150, 5);
    });

    it('pointercancel keeps the last applied size (no rollback, no crash)', () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();
      const a = createNote(doc, { x: 300, y: 200 });
      const handle = selectAndFindHandle(doc, [a]);

      pointer(handle, 'pointerdown', 400, 300);
      pointer(handle, 'pointermove', 500, 340);
      flush();
      pointer(handle, 'pointercancel', 500, 340);

      const b = objectBounds(snapshot(doc).find((o) => o.id === a)!);
      expect(b.width).toBeCloseTo(300, 5);
      expect(b.height).toBeCloseTo(300, 5);
      // The gesture is over: a new drag works.
      const h2 = screen.getByTestId('resize-handle-se');
      pointer(h2, 'pointerdown', 500, 400);
      pointer(h2, 'pointermove', 550, 420);
      flush();
      pointer(h2, 'pointerup', 550, 420);
      const after = objectBounds(snapshot(doc).find((o) => o.id === a)!);
      expect(after.width).toBeGreaterThan(300);
    });
  });

  describe('nudge (sel.nudge)', () => {
    it('arrows nudge by 1 unit; Shift+arrows by 10; the page does not scroll', () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();
      const a = createNote(doc, { x: 300, y: 200 });
      const na = screen.getByTestId(`sticky-note-${a}`);
      pointer(na, 'pointerdown', 300, 200);
      pointer(na, 'pointerup', 300, 200);

      const before = objectBounds(snapshot(doc).find((o) => o.id === a)!);
      key('keydown', { key: 'ArrowRight' });
      key('keydown', { key: 'ArrowRight' });
      key('keydown', { key: 'ArrowRight' });
      key('keydown', { key: 'ArrowRight', shiftKey: true });
      const after = objectBounds(snapshot(doc).find((o) => o.id === a)!);
      expect(after.x).toBe(before.x + 13);
      expect(after.y).toBe(before.y);
      expect(window.scrollY).toBe(0);
    });

    it('nudging a group moves every selected object', () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();
      const a = createNote(doc, { x: 300, y: 200 });
      const b = createNote(doc, { x: 700, y: 200 });
      const na = screen.getByTestId(`sticky-note-${a}`);
      const nb = screen.getByTestId(`sticky-note-${b}`);
      pointer(na, 'pointerdown', 300, 200);
      pointer(na, 'pointerup', 300, 200);
      pointer(nb, 'pointerdown', 700, 200, { shiftKey: true });
      pointer(nb, 'pointerup', 700, 200, { shiftKey: true });

      const ba = objectBounds(snapshot(doc).find((o) => o.id === a)!);
      const bb = objectBounds(snapshot(doc).find((o) => o.id === b)!);
      key('keydown', { key: 'ArrowDown' });
      const aa = objectBounds(snapshot(doc).find((o) => o.id === a)!);
      const ab = objectBounds(snapshot(doc).find((o) => o.id === b)!);
      expect(aa.y).toBe(ba.y + 1);
      expect(ab.y).toBe(bb.y + 1);
    });
  });

  it('a note deleted remotely while selected drops out of the selection (TC-35 at component level)', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const b = createNote(doc, { x: 700, y: 200 });
    const na = screen.getByTestId(`sticky-note-${a}`);
    const nb = screen.getByTestId(`sticky-note-${b}`);
    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointerup', 300, 200);
    pointer(nb, 'pointerdown', 700, 200, { shiftKey: true });
    pointer(nb, 'pointerup', 700, 200, { shiftKey: true });
    expect(screen.getByTestId('selection-count').textContent).toBe('2 selected');

    act(() => {
      deleteObject(doc, b);
    });
    // The selection pruned to one; the note is gone; the bar shows the single note.
    expect(na.hasAttribute('data-selected')).toBe(true);
    expect(screen.queryByTestId(`sticky-note-${b}`)).toBeNull();
    expect(screen.queryByTestId('selection-count')).toBeNull(); // single → NoteToolbar, not the bar
    // The remaining note is still deletable via the (single) toolbar.
    const del = screen.getByRole('button', { name: 'Delete note' });
    fireEvent.click(del);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('delete key removes the whole selection in one go', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const b = createNote(doc, { x: 700, y: 200 });
    const na = screen.getByTestId(`sticky-note-${a}`);
    const nb = screen.getByTestId(`sticky-note-${b}`);
    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointerup', 300, 200);
    pointer(nb, 'pointerdown', 700, 200, { shiftKey: true });
    pointer(nb, 'pointerup', 700, 200, { shiftKey: true });

    key('keydown', { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('double-click starts editing the single selected note (story 2 preserved)', () => {
    const { getDoc } = renderBoard();
    const id = createNote(getDoc());
    const note = screen.getByTestId(`sticky-note-${id}`);
    pointer(note, 'pointerdown', 300, 200);
    pointer(note, 'pointerup', 300, 200);
    act(() => {
      note.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();
    // Escape ends editing, keeps it selected.
    const ta = screen.getByTestId('sticky-text-editor').querySelector('textarea')!;
    keyOn(ta, 'Escape');
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
    expect(note.hasAttribute('data-selected')).toBe(true);
  });
});

function keyOn(el: Element, keyName: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }));
  });
}
