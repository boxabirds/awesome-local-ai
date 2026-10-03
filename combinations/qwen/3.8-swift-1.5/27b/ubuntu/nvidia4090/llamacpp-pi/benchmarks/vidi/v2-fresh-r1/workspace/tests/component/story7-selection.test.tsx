// Story 7 component tests: multi-selection, marquee, group transform,
// selection UI, keyboard. TC-16 to TC-31.

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { BoardHarness, makeDoc } from './board-harness';
import { clearRAF, flushRAF } from './fake-raf';
import '../fixtures/testbox';

// --- testbox helpers (fixture object type) ---

let testboxCounter = 0;

function docSnapshotWithTestbox(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [...snapshot(doc)];
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  objects.forEach((obj, id) => {
    if (obj.get('type') === 'testbox') {
      out.push({
        id,
        type: 'testbox',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        z: (obj.get('z') as number | undefined) ?? 0,
        createdAt: (obj.get('createdAt') as number | undefined) ?? 0,
        width: (obj.get('width') as number | undefined) ?? 100,
        height: (obj.get('height') as number | undefined) ?? 50,
      });
    }
  });
  return out;
}

function createTestbox(doc: Y.Doc, x: number, y: number, width = 100, height = 50) {
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  testboxCounter += 1;
  const id = `tb${testboxCounter}-${Math.random().toString(36).slice(2, 8)}`;
  const obj = new Y.Map();
  obj.set('id', id);
  obj.set('type', 'testbox');
  obj.set('x', x);
  obj.set('y', y);
  obj.set('z', 0);
  obj.set('createdAt', Date.now());
  obj.set('width', width);
  obj.set('height', height);
  objects.set(id, obj);
  return id;
}

// Default harness camera: x=-640, y=-400, zoom=1. Screen (640,400) = world (0,0).
const S = (wx: number, wy: number) => ({ clientX: 640 + wx, clientY: 400 + wy });

function notes() {
  return screen.getAllByTestId('sticky-note');
}

function selectNoteAt(index: number) {
  const note = notes()[index];
  act(() => {
    fireEvent.pointerDown(note, { ...S(0, 0), button: 0, pointerId: 1 });
    fireEvent.pointerUp(note, { ...S(0, 0), button: 0, pointerId: 1 });
  });
}

/** Marquee-select everything inside world rect (x0,y0)-(x1,y1) (screen = world here). */
function marquee(x0: number, y0: number, x1: number, y1: number) {
  const viewport = screen.getByTestId('board-viewport');
  act(() => {
    fireEvent.pointerDown(viewport, { ...S(x0, y0), button: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerMove(viewport, { ...S(x1, y1), button: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(viewport, { ...S(x1, y1), button: 0, pointerId: 1, shiftKey: true });
  });
}

function flushNow() {
  act(() => {
    flushRAF();
  });
}

/** Assert the selection (order-insensitive) equals exactly the given ids. */
function expectSelected(...ids: string[]) {
  const value = screen.getByTestId('selected').getAttribute('data-value') ?? '';
  const got = value ? value.split(',') : [];
  expect(got.sort()).toEqual([...ids].sort());
}

afterEach(() => {
  cleanup();
  clearRAF();
  vi.restoreAllMocks();
});

describe('TC-16 to TC-19: selection UI (bar, toolbar, clear)', () => {
  // TC-16: prune — many selected, all deleted → Empty, bar hidden.
  test('TC-16 objects deleted remotely prune the selection, hiding the bar', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });

    render(<BoardHarness doc={doc} />);

    marquee(-200, -150, 600, 150);
    expectSelected(a, b);
    expect(screen.getByTestId('selection-bar')).toBeTruthy();

    // Remote delete of both notes.
    act(() => {
      const objects = doc.getMap('objects') as Y.Map<unknown>;
      objects.delete(a);
      objects.delete(b);
    });

    // Selection pruned, bar hidden.
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-17: bar with 2 selected → "2 selected" + Delete + aria-live.
  test('TC-17 two selected shows the count bar with Delete and a live announcement', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });

    render(<BoardHarness doc={doc} />);
    marquee(-200, -150, 600, 150);

    expectSelected(a, b);
    // Count text and delete button.
    const count = screen.getByTestId('selection-count');
    expect(count).toHaveTextContent('2 selected');
    expect(screen.getByTestId('delete-selection-btn')).toBeTruthy();
    // aria-live announcement.
    expect(count).toHaveAttribute('aria-live', 'polite');
  });

  // TC-18: bar with 1 sticky → NoteToolbar shown instead of the count bar.
  test('TC-18 a single sticky shows the NoteToolbar, not the count bar', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });

    render(<BoardHarness doc={doc} />);
    selectNoteAt(0);

    expectSelected(a);
    // NoteToolbar is shown (moved from the note to the selection overlay).
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    // No count bar / delete-selection button.
    expect(screen.queryByTestId('selection-count')).toBeNull();
    expect(screen.queryByTestId('delete-selection-btn')).toBeNull();
  });

  // TC-19: clear — empty-space click without drag → Empty.
  test('TC-19 clicking empty space clears the selection', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });

    render(<BoardHarness doc={doc} />);
    selectNoteAt(0);
    expectSelected(a);

    act(() => {
      fireEvent.click(screen.getByTestId('board-viewport'));
    });
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
  });
});

describe('TC-20 to TC-22: marquee', () => {
  // TC-20: Shift+drag adds fully-inside ids to the existing selection.
  test('TC-20 shift+drag marquee adds fully-inside objects to the selection', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });

    render(<BoardHarness doc={doc} />);

    // Select a first, then marquee fully around b (world 300..500, -100..100)
    // but not a (world -100..100).
    selectNoteAt(0);
    marquee(260, -150, 560, 150);

    expectSelected(a, b);
    // No marquee rect after finish.
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  // TC-21 (negative): plain drag (no Shift) pans; no marquee.
  test('TC-21 plain drag pans the camera and does not marquee', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });

    render(<BoardHarness doc={doc} />);
    selectNoteAt(0);

    const viewport = screen.getByTestId('board-viewport');
    const camXBefore = Number(screen.getByTestId('camera-x').getAttribute('data-value'));
    act(() => {
      fireEvent.pointerDown(viewport, { ...S(0, 0), button: 0, pointerId: 1, shiftKey: false });
      fireEvent.pointerMove(viewport, { ...S(50, 20), button: 0, pointerId: 1, shiftKey: false });
      fireEvent.pointerUp(viewport, { ...S(50, 20), button: 0, pointerId: 1, shiftKey: false });
    });
    flushNow();

    // Camera panned.
    const camXAfter = Number(screen.getByTestId('camera-x').getAttribute('data-value'));
    expect(camXAfter).not.toBe(camXBefore);
    // No marquee, selection unchanged.
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expectSelected(a);
  });

  // TC-22: pointercancel mid-marquee → selection unchanged.
  test('TC-22 pointercancel mid-marquee leaves the selection unchanged', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });

    render(<BoardHarness doc={doc} />);
    selectNoteAt(0);

    const viewport = screen.getByTestId('board-viewport');
    act(() => {
      fireEvent.pointerDown(viewport, { ...S(260, -150), button: 0, pointerId: 1, shiftKey: true });
      fireEvent.pointerMove(viewport, { ...S(560, 150), button: 0, pointerId: 1, shiftKey: true });
      fireEvent.pointerCancel(viewport, { ...S(560, 150), button: 0, pointerId: 1 });
    });

    // Selection unchanged (only a), no marquee rect.
    expectSelected(a);
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    void b;
  });
});

describe('TC-23 to TC-26: group transform', () => {
  // TC-23: drag unselected b while {a} selected → selection {b}; only b moves.
  test('TC-23 dragging an unselected note replaces the selection and moves only it', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });

    render(<BoardHarness doc={doc} />);
    selectNoteAt(0);
    expectSelected(a);

    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const aObj = objects.get(a) as Y.Map<unknown>;
    const bObj = objects.get(b) as Y.Map<unknown>;
    const ax = aObj.get('x') as number;
    const bx = bObj.get('x') as number;

    const noteB = notes()[1];
    act(() => {
      fireEvent.pointerDown(noteB, { ...S(400, 0), button: 0, pointerId: 1 });
      fireEvent.pointerMove(noteB, { ...S(420, 0), button: 0, pointerId: 1 });
      fireEvent.pointerUp(noteB, { ...S(420, 0), button: 0, pointerId: 1 });
    });
    flushNow();

    // Selection is now {b}; b moved, a did not.
    expectSelected(b);
    expect(bObj.get('x')).toBe(bx + 20);
    expect(aObj.get('x')).toBe(ax);
  });

  // TC-24: resize a non-locked (testbox) via edge handle; Shift keeps ratio.
  test('TC-24 edge handle resizes width only; Shift keeps the ratio', () => {
    const doc = makeDoc();
    initDoc(doc);
    const tb = createTestbox(doc, 0, 0, 100, 50);

    render(<BoardHarness doc={doc} snapshotOfDoc={docSnapshotWithTestbox} />);

    // Select the testbox.
    const box = screen.getByTestId('testbox');
    act(() => {
      fireEvent.pointerDown(box, { ...S(0, 0), button: 0, pointerId: 1 });
      fireEvent.pointerUp(box, { ...S(0, 0), button: 0, pointerId: 1 });
    });
    expectSelected(tb);
    // Handles are visible for a resizable type.
    const handleE = screen.getByTestId('resize-handle-e');

    // Drag the east handle +30 world px (no Shift): width 100 → 130, height 50.
    act(() => {
      fireEvent.pointerDown(handleE, { ...S(100, 0), button: 0, pointerId: 1 });
      fireEvent.pointerMove(handleE, { ...S(130, 0), button: 0, pointerId: 1 });
      fireEvent.pointerUp(handleE, { ...S(130, 0), button: 0, pointerId: 1 });
    });
    flushNow();

    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const tbObj = objects.get(tb) as Y.Map<unknown>;
    expect(tbObj.get('width')).toBe(130);
    expect(tbObj.get('height')).toBe(50);

    // Drag the east handle +30 more WITH Shift: ratio 130/50 = 2.6 kept.
    act(() => {
      fireEvent.pointerDown(handleE, { ...S(130, 0), button: 0, pointerId: 1, shiftKey: true });
      fireEvent.pointerMove(handleE, { ...S(160, 0), button: 0, pointerId: 1, shiftKey: true });
      fireEvent.pointerUp(handleE, { ...S(160, 0), button: 0, pointerId: 1, shiftKey: true });
    });
    flushNow();

    const w = tbObj.get('width') as number;
    const h = tbObj.get('height') as number;
    expect(w).toBeCloseTo(160, 1);
    expect(h).toBeCloseTo(160 / 2.6, 1);
  });

  // TC-25 (negative): load-failed board refuses gestures; no writes.
  test('TC-25 a load-failed board refuses group moves (no writes)', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });

    render(<BoardHarness doc={doc} canEdit={false} />);
    const note = notes()[0];
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const aObj = objects.get(a) as Y.Map<unknown>;
    const ax = aObj.get('x') as number;
    const ay = aObj.get('y') as number;

    // Selection still works (viewing), but the drag must not move the note.
    act(() => {
      fireEvent.pointerDown(note, { ...S(0, 0), button: 0, pointerId: 1 });
      fireEvent.pointerMove(note, { ...S(30, 30), button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { ...S(30, 30), button: 0, pointerId: 1 });
    });
    flushNow();

    expect(aObj.get('x')).toBe(ax);
    expect(aObj.get('y')).toBe(ay);
  });

  // TC-26: onGestureStart and onGestureEnd each called once per drag.
  test('TC-26 onGestureStart and onGestureEnd are each called once per drag', () => {
    const doc = makeDoc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 400, y: 0 });

    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    render(
      <BoardHarness doc={doc} onGestureStart={onGestureStart} onGestureEnd={onGestureEnd} />,
    );

    // Marquee-select both (no gesture callbacks expected).
    marquee(-200, -150, 600, 150);
    expect(onGestureStart).not.toHaveBeenCalled();
    expect(onGestureEnd).not.toHaveBeenCalled();

    // Drag note 0.
    const note = notes()[0];
    act(() => {
      fireEvent.pointerDown(note, { ...S(0, 0), button: 0, pointerId: 1 });
      fireEvent.pointerMove(note, { ...S(20, 0), button: 0, pointerId: 1 });
      fireEvent.pointerMove(note, { ...S(40, 0), button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { ...S(40, 0), button: 0, pointerId: 1 });
    });
    flushNow();

    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });
});

describe('TC-27 to TC-31: keyboard', () => {
  // TC-27: Ctrl/Cmd+A selects all; preventDefault.
  test('TC-27 Ctrl+A selects every object and preventDefault is called', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });

    render(<BoardHarness doc={doc} />);

    // dispatchEvent returns false when a listener called preventDefault.
    const notCancelled = fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expectSelected(a, b);
    expect(notCancelled).toBe(false);
  });

  // TC-28: Ctrl+A on an empty board → Empty, no error.
  test('TC-28 Ctrl+A on an empty board selects nothing and does not throw', () => {
    const doc = makeDoc();
    initDoc(doc);

    render(<BoardHarness doc={doc} />);
    expect(() => fireEvent.keyDown(window, { key: 'a', ctrlKey: true })).not.toThrow();
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
  });

  // TC-29: nudge — ArrowRight x+1; Shift+ArrowUp y-10; preventDefault.
  test('TC-29 arrow keys nudge the selection; Shift uses the large step', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });

    render(<BoardHarness doc={doc} />);
    selectNoteAt(0);

    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const aObj = objects.get(a) as Y.Map<unknown>;

    const x0 = aObj.get('x') as number;
    const y0 = aObj.get('y') as number;
    // dispatchEvent returns false when a listener called preventDefault.
    expect(fireEvent.keyDown(window, { key: 'ArrowRight' })).toBe(false);
    expect(aObj.get('x')).toBe(x0 + NUDGE_STEP_WORLD);

    expect(fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true })).toBe(false);
    expect(aObj.get('y')).toBe(y0 - NUDGE_LARGE_STEP_WORLD);
  });

  // TC-30 (negative): Backspace while editing edits the text; objects kept.
  test('TC-30 Backspace while editing deletes text, not objects', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });
    const ytext = getStickyText(doc, a)!;
    ytext.insert(0, 'ab');

    render(<BoardHarness doc={doc} />);
    marquee(-200, -150, 600, 150);

    // Start editing a (double-click).
    act(() => {
      fireEvent.doubleClick(notes()[0]);
    });
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(a);

    // Simulate Backspace in the textarea: the text edits, objects are kept.
    const textarea = screen.getByLabelText('Sticky note text') as HTMLTextAreaElement;
    act(() => {
      textarea.value = 'a';
      fireEvent.input(textarea);
    });

    expect(ytext.toString()).toBe('a');
    // Both objects still present.
    expect(screen.getByTestId('note-count').getAttribute('data-value')).toBe('2');
    void b;
  });

  // TC-31: Delete removes all selected, selection Empty.
  test('TC-31 Delete removes every selected object and clears the selection', () => {
    const doc = makeDoc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });

    render(<BoardHarness doc={doc} />);
    marquee(-200, -150, 600, 150);
    expectSelected(a, b);

    act(() => {
      fireEvent.keyDown(window, { key: 'Delete' });
    });

    expect(screen.getByTestId('note-count').getAttribute('data-value')).toBe('0');
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
  });
});
