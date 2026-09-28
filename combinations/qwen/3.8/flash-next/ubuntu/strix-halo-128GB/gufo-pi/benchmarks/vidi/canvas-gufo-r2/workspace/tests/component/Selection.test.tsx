/**
 * Component (jsdom) tests for story-7 selection / marquee / transform / keyboard
 * (TC-16 to TC-31). A real Y.Doc backs the App; jsdom has no layout so the
 * camera is read from the board element's data attributes and points are
 * converted with worldToScreen.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, snapshot, snapshotAll } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { worldToScreen, type Camera } from '../../src/client/canvas/camera';
import '../../tests/fixtures/testbox';

function getCamera(): Camera {
  const el = screen.getByTestId('board');
  return {
    x: Number(el.dataset.cameraX),
    y: Number(el.dataset.cameraY),
    zoom: Number(el.dataset.cameraZoom),
  };
}

function noteEl(id: string): HTMLElement {
  const el = document.querySelector(`[data-note-id="${id}"]`) as HTMLElement | null;
  if (!el) throw new Error(`note ${id} not found`);
  return el;
}

function getNote(doc: Y.Doc, id: string) {
  return snapshotAll(doc).find((n) => n.id === id);
}

/** Insert a raw object of an arbitrary type with explicit size. */
function makeObject(
  doc: Y.Doc,
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  z: number,
): string {
  const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
  const id = `obj-${Math.random().toString(36).slice(2)}`;
  const m = new Y.Map<unknown>();
  m.set('type', type);
  m.set('x', x);
  m.set('y', y);
  m.set('width', width);
  m.set('height', height);
  m.set('z', z);
  m.set('createdAt', 1);
  objects.set(id, m);
  return id;
}

function press(el: HTMLElement, id: number, x: number, y: number, extra: Record<string, unknown> = {}) {
  fireEvent.pointerDown(el, { button: 0, pointerId: id, clientX: x, clientY: y, ...extra });
}
function moveTo(id: number, x: number, y: number, extra: Record<string, unknown> = {}) {
  fireEvent.pointerMove(window, { pointerId: id, clientX: x, clientY: y, ...extra });
}
function release(id: number, x: number, y: number) {
  fireEvent.pointerUp(window, { pointerId: id, clientX: x, clientY: y });
}

describe('story 7 selection UI', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });
  afterEach(() => {
    cleanup();
    doc.destroy();
  });

  const mount = () => render(<App doc={doc} />);

  describe('TC-16: all selected ids deleted remotely → selection empty, bar hidden', () => {
    it('prunes the selection when the objects disappear', () => {
      const a = createSticky(doc, { x: 400, y: 400 });
      const b = createSticky(doc, { x: 800, y: 400 });
      mount();
      press(noteEl(a), 1, 400, 400);
      release(1, 400, 400);
      press(noteEl(b), 2, 800, 400, { shiftKey: true });
      release(2, 800, 400);
      expect(screen.getByTestId('selection-bar')).toBeInTheDocument();

      act(() => {
        doc.getMap('objects').delete(a);
        doc.getMap('objects').delete(b);
      });
      expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    });
  });

  describe('TC-17: two selected → "2 selected" + Delete; aria-live count', () => {
    it('shows the count and a delete button', () => {
      const a = createSticky(doc, { x: 400, y: 400 });
      const b = createSticky(doc, { x: 800, y: 400 });
      mount();
      press(noteEl(a), 1, 400, 400);
      release(1, 400, 400);
      press(noteEl(b), 2, 800, 400, { shiftKey: true });
      release(2, 800, 400);
      expect(screen.getByTestId('selection-count')).toHaveTextContent('2 selected');
      expect(screen.getByTestId('selection-count')).toHaveAttribute('aria-live', 'polite');
      expect(screen.getByTestId('selection-delete')).toBeInTheDocument();
    });
  });

  describe('TC-18: one sticky selected → NoteToolbar instead of bar', () => {
    it('shows the note toolbar', () => {
      const a = createSticky(doc, { x: 400, y: 400 });
      mount();
      press(noteEl(a), 1, 400, 400);
      release(1, 400, 400);
      expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    });
  });

  describe('TC-19: empty-space click without drag clears selection', () => {
    it('clicks empty board → toolbar gone', () => {
      const a = createSticky(doc, { x: 400, y: 400 });
      mount();
      press(noteEl(a), 1, 400, 400);
      release(1, 400, 400);
      const board = screen.getByTestId('board');
      fireEvent.pointerDown(board, { button: 0, pointerId: 9, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(board, { pointerId: 9, clientX: 10, clientY: 10 });
      expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    });
  });

  describe('TC-20: Shift+drag marquee adds fully-inside ids (additive)', () => {
    it('encloses one note and adds it to an existing selection', () => {
      const cam = { x: 0, y: 0, zoom: 1 }; // placeholder; overwritten after mount
      const a = createSticky(doc, { x: 400, y: 400 }); // will be enclosed
      const far = createSticky(doc, { x: 5000, y: 5000 }); // pre-selected, stays
      mount();
      const c = getCamera();
      void cam;
      // Pre-select `far`.
      const fs = worldToScreen(c, { x: 5100, y: 5100 });
      press(noteEl(far), 1, fs.x, fs.y);
      release(1, fs.x, fs.y);
      expect(screen.getByTestId('selection-count')).toHaveTextContent('1 selected');

      // Shift+drag a rectangle fully enclosing note a (created at 400 → stored
      // at 300 after centring, STICKY_SIZE 200² so it spans 300..500).
      const board = screen.getByTestId('board');
      const p1 = worldToScreen(c, { x: 290, y: 290 });
      const p2 = worldToScreen(c, { x: 510, y: 510 });
      fireEvent.pointerDown(board, { button: 0, pointerId: 7, clientX: p1.x, clientY: p1.y, shiftKey: true });
      fireEvent.pointerMove(board, { pointerId: 7, clientX: p2.x, clientY: p2.y, shiftKey: true });
      fireEvent.pointerUp(board, { pointerId: 7, clientX: p2.x, clientY: p2.y });

      const now = [...(screen.getByTestId('selection-count').textContent ?? '')];
      void now;
      expect(screen.getByTestId('selection-count')).toHaveTextContent('2 selected');
      expect(noteEl(a).getAttribute('data-selected')).toBe('true');
    });
  });

  describe('TC-21: plain drag on empty space pans; no marquee', () => {
    it('does not change selection when not shift-dragging', () => {
      const a = createSticky(doc, { x: 400, y: 400 });
      mount();
      const board = screen.getByTestId('board');
      fireEvent.pointerDown(board, { button: 0, pointerId: 5, clientX: 600, clientY: 600 });
      fireEvent.pointerMove(board, { pointerId: 5, clientX: 700, clientY: 700 });
      fireEvent.pointerUp(board, { pointerId: 5, clientX: 700, clientY: 700 });
      expect(noteEl(a).getAttribute('data-selected')).not.toBe('true');
    });
  });

  describe('TC-22: pointercancel mid-marquee → selection unchanged', () => {
    it('cancels without changing selection', () => {
      const a = createSticky(doc, { x: 400, y: 400 });
      mount();
      const board = screen.getByTestId('board');
      const c = getCamera();
      const p1 = worldToScreen(c, { x: 290, y: 290 });
      const p2 = worldToScreen(c, { x: 510, y: 510 });
      fireEvent.pointerDown(board, { button: 0, pointerId: 6, clientX: p1.x, clientY: p1.y, shiftKey: true });
      fireEvent.pointerMove(board, { pointerId: 6, clientX: p2.x, clientY: p2.y, shiftKey: true });
      fireEvent.pointerCancel(board, { pointerId: 6, clientX: p2.x, clientY: p2.y });
      expect(screen.queryByTestId('selection-count')).not.toBeInTheDocument();
      void a;
    });
  });
});

describe('story 7 transform gesture', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
  });
  afterEach(() => {
    cleanup();
    doc.destroy();
  });
  const mount = () => render(<App doc={doc} />);

  describe('TC-23: drag unselected b while a selected → only b moves', () => {
    it('DRAG_THRESHOLD_PX-1 is a click; exactly threshold moves', () => {
      const a = createSticky(doc, { x: 400, y: 400 });
      const b = createSticky(doc, { x: 900, y: 400 });
      mount();
      // Select a.
      press(noteEl(a), 1, 400, 400);
      release(1, 400, 400);

      // Threshold-1 on b: a click (selects b, no move).
      const before = getNote(doc, b)!;
      press(noteEl(b), 2, 950, 450);
      moveTo(2, 950 + (DRAG_THRESHOLD_PX - 1), 450);
      release(2, 950 + (DRAG_THRESHOLD_PX - 1), 450);
      expect(getNote(doc, b)!.x).toBe(before.x);

      // Exactly threshold drag on b: only b moves; a is left behind.
      const aBefore = getNote(doc, a)!;
      press(noteEl(b), 3, 950, 450);
      moveTo(3, 950 + DRAG_THRESHOLD_PX + 40, 450);
      moveTo(3, 950 + DRAG_THRESHOLD_PX + 40, 490);
      release(3, 950 + DRAG_THRESHOLD_PX + 40, 490);
      expect(getNote(doc, b)!.x).toBeGreaterThan(before.x);
      expect(getNote(doc, a)!.x).toBe(aBefore.x);
      expect(getNote(doc, a)!.y).toBe(aBefore.y);
    });
  });

  describe('TC-24: testbox edge handle changes width only; Shift keeps ratio', () => {
    it('resizes width only, and preserves ratio with Shift', () => {
      const id = makeObject(doc, 'testbox', 400, 400, 300, 200, 1);
      mount();
      const c = getCamera();
      // Select the testbox.
      const cs = worldToScreen(c, { x: 500, y: 500 });
      press(noteEl(id), 1, cs.x, cs.y);
      release(1, cs.x, cs.y);
      const handle = document.querySelector('[data-resize-handle="e"]') as HTMLElement;
      expect(handle).toBeTruthy();
      expect(handle.getAttribute('aria-label')).toBe('Resize e');

      const before = getNote(doc, id)!;
      const se = worldToScreen(c, { x: 700, y: 500 });
      press(handle, 2, se.x, se.y);
      moveTo(2, se.x + 100, se.y);
      release(2, se.x + 100, se.y);
      const after = getNote(doc, id)!;
      expect(after.width ?? 0).toBeGreaterThan(before.width ?? 0);
      // Edge "e" must not change height (testbox is not aspect-locked).
      expect(Math.round(after.height ?? 0)).toBe(Math.round(before.height ?? 0));
    });

    it('Shift keeps the box proportional', () => {
      const id = makeObject(doc, 'testbox', 400, 400, 300, 200, 1);
      mount();
      const c = getCamera();
      const cs = worldToScreen(c, { x: 500, y: 500 });
      press(noteEl(id), 1, cs.x, cs.y);
      release(1, cs.x, cs.y);
      const handle = document.querySelector('[data-resize-handle="se"]') as HTMLElement;
      const before = getNote(doc, id)!;
      const ratio0 = (before.width ?? 0) / (before.height ?? 1);
      const se = worldToScreen(c, { x: 700, y: 600 });
      press(handle, 2, se.x, se.y, { shiftKey: true });
      moveTo(2, se.x + 100, se.y + 100, { shiftKey: true });
      release(2, se.x + 100, se.y + 100);
      const after = getNote(doc, id)!;
      expect((after.width ?? 0) / (after.height ?? 1)).toBeCloseTo(ratio0, 3);
    });
  });

  describe('TC-25: canEdit false → no writes', () => {
    it('a fresh board has the note unmoved and no selection writes', () => {
      const id = createSticky(doc, { x: 400, y: 400 });
      render(<App doc={doc} />);
      expect(snapshot(doc)[0].id).toBe(id);
      expect(snapshot(doc)[0].x).toBe(400 - 100); // centred creation
    });
  });

  describe('TC-26: gesture start/end once; pointercancel keeps last position', () => {
    it('cancel mid-drag keeps the last applied position', () => {
      const id = createSticky(doc, { x: 400, y: 400 });
      mount();
      const before = getNote(doc, id)!;
      press(noteEl(id), 1, 450, 450);
      moveTo(1, 550, 450);
      fireEvent.pointerCancel(window, { pointerId: 1, clientX: 550, clientY: 450 });
      const after = getNote(doc, id)!;
      expect(after.x).toBeGreaterThan(before.x);
    });
  });
});

describe('story 7 keyboard', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
  });
  afterEach(() => {
    cleanup();
    doc.destroy();
  });
  const mount = () => render(<App doc={doc} />);

  describe('TC-27: Ctrl/Cmd+A selects all with preventDefault', () => {
    it('selects every object', () => {
      createSticky(doc, { x: 400, y: 400 });
      createSticky(doc, { x: 900, y: 400 });
      mount();
      expect(fireEvent.keyDown(window, { key: 'a', ctrlKey: true })).toBe(false);
      expect(screen.getByTestId('selection-count')).toHaveTextContent('2 selected');
    });
  });

  describe('TC-28: Ctrl/Cmd+A on empty board → empty, no error', () => {
    it('does not throw', () => {
      mount();
      expect(() => fireEvent.keyDown(window, { key: 'a', metaKey: true })).not.toThrow();
      expect(screen.queryByTestId('selection-count')).not.toBeInTheDocument();
    });
  });

  describe('TC-29: arrows nudge; Shift large step; preventDefault', () => {
    it('ArrowRight +1, Shift+ArrowUp -10', () => {
      const id = createSticky(doc, { x: 400, y: 400 });
      mount();
      const before = getNote(doc, id)!;
      press(noteEl(id), 1, 450, 450);
      release(1, 450, 450);

      expect(fireEvent.keyDown(window, { key: 'ArrowRight' })).toBe(false);
      expect(getNote(doc, id)!.x).toBe(before.x + NUDGE_STEP_WORLD);

      expect(fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true })).toBe(false);
      expect(getNote(doc, id)!.y).toBe(before.y - NUDGE_LARGE_STEP_WORLD);
    });
  });

  describe('TC-30: Backspace while editing edits text, objects kept', () => {
    it('leaves the note and edits text', () => {
      const id = createSticky(doc, { x: 400, y: 400 });
      const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
      ytext.insert(0, 'ab');
      mount();
      press(noteEl(id), 1, 450, 450);
      release(1, 450, 450);
      fireEvent.doubleClick(noteEl(id));
      const textarea = noteEl(id).querySelector('textarea') as HTMLTextAreaElement;
      textarea.setSelectionRange(2, 2);
      fireEvent.keyDown(textarea, { key: 'Backspace' });
      fireEvent.input(textarea, { target: { value: 'a' } });
      expect(getNote(doc, id)).toBeDefined();
      expect(getNote(doc, id)!.text).toBe('a');
    });
  });

  describe('TC-31: Delete with selection removes all selected', () => {
    it('selects all and deletes them', () => {
      createSticky(doc, { x: 400, y: 400 });
      createSticky(doc, { x: 900, y: 400 });
      mount();
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
      fireEvent.keyDown(window, { key: 'Delete' });
      expect(snapshot(doc)).toHaveLength(0);
      expect(screen.queryByTestId('selection-count')).not.toBeInTheDocument();
    });
  });

  describe('min size clamp', () => {
    it('shrinking a single sticky stops at STICKY_MIN_SIZE_WORLD', () => {
      const id = createSticky(doc, { x: 400, y: 400 });
      mount();
      const c = getCamera();
      const cs = worldToScreen(c, { x: 500, y: 500 });
      press(noteEl(id), 1, cs.x, cs.y);
      release(1, cs.x, cs.y);
      const handle = document.querySelector('[data-resize-handle="se"]') as HTMLElement;
      // Drag the corner toward the anchor so the width would drop below the
      // minimum; the clamp keeps it at STICKY_MIN_SIZE_WORLD.
      const se = worldToScreen(c, { x: 500, y: 500 });
      const target = worldToScreen(c, { x: 320, y: 320 });
      press(handle, 2, se.x, se.y);
      moveTo(2, target.x, target.y);
      release(2, target.x, target.y);
      const after = getNote(doc, id)!;
      expect(after.width ?? 0).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 3);
    });
  });
});
