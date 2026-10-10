import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  changeDoc,
  clickElement,
  createNote,
  docNotes,
  dragElement,
  flushFrame,
  noteElement,
  noteOf,
  objectElement,
  pointerAt,
  renderBoard,
  resizeHandleElement,
  resizeHandles,
  screenCentre,
  screenOf,
  selectionCount,
} from './harness';
import { FakeBoardProvider } from '../fixtures/fakeProvider';
import { TESTBOX_MIN_SIZE_WORLD, createTestBox, testBoxBounds } from '../fixtures/testbox';
import { TESTLABEL_TYPE, createTestLabel, registerTestLabel } from '../fixtures/testlabel';

/**
 * `sel.transform` in the rendered board (TC-23 to TC-26): one gesture for every
 * object type - press an object to move the selection, press a handle to resize
 * the whole selection from its bounding box.
 *
 * Coordinates are world coordinates converted through the camera the board is
 * using; at this board's zoom the numbers coincide, which is what lets the
 * expected positions be exact.
 */

interface Placed {
  id: string;
  /** Centre, as the model stores it. */
  cx: number;
  cy: number;
}

function placeNote(doc: Y.Doc, centre: { x: number; y: number }): Placed {
  return { id: createNote(doc, centre), cx: centre.x, cy: centre.y };
}

function pressNote(note: Placed, additive = false): void {
  const screen = screenOf({ x: note.cx, y: note.cy });
  clickElement(noteElement(note.id), screen.x, screen.y, additive ? { shiftKey: true } : {});
}

/** Press, drag and release the middle of a note. */
async function dragNote(
  note: Placed,
  delta: { x: number; y: number },
  steps = 4,
): Promise<void> {
  const from = screenOf({ x: note.cx, y: note.cy });
  dragElement(noteElement(note.id), from, { x: from.x + delta.x, y: from.y + delta.y }, steps);
  await flushFrame();
}

/** Where a rendered handle sits on screen: press its middle. */
function pressHandle(handle: string): { x: number; y: number } {
  const el = resizeHandleElement(handle);
  return {
    x: Number.parseFloat(el.style.left) + 4,
    y: Number.parseFloat(el.style.top) + 4,
  };
}

function dragHandle(
  handle: string,
  delta: { x: number; y: number },
  steps = 4,
  options: { shiftKey?: boolean } = {},
): void {
  const from = pressHandle(handle);
  dragElement(
    resizeHandleElement(handle),
    from,
    { x: from.x + delta.x, y: from.y + delta.y },
    steps,
    options,
  );
}

const pos = (doc: Y.Doc, id: string): { x: number; y: number } => {
  const note = noteOf(doc, id);
  return { x: note.x, y: note.y };
};

function box(doc: Y.Doc, rect: { x: number; y: number; width: number; height: number }): string {
  let id = '';
  changeDoc(() => {
    id = createTestBox(doc, rect);
  });
  return id;
}

function selectBox(id: string, rect: { x: number; y: number; width: number; height: number }): void {
  const centre = screenCentre(rect);
  clickElement(objectElement(id), centre.x, centre.y);
}

describe('sel.transform - group move (TC-23, TC-25, TC-26)', () => {
  it('TC-23 dragging an unselected note selects only it, and moves only it', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 400, y: 400 });
    const b = placeNote(doc, { x: 800, y: 400 });
    const before = { a: pos(doc, a.id), b: pos(doc, b.id) };
    pressNote(a);
    expect(selectionCount()).toBe(1);

    await dragNote(b, { x: 100, y: 0 });

    expect(selectionCount()).toBe(1);
    expect(noteElement(a.id).getAttribute('data-selected')).toBe('false');
    expect(noteElement(b.id).getAttribute('data-selected')).toBe('true');
    expect(pos(doc, b.id)).toEqual({ x: before.b.x + 100, y: before.b.y });
    expect(pos(doc, a.id)).toEqual(before.a);
  });

  it('TC-23 boundary: DRAG_THRESHOLD_PX - 1 is a click, DRAG_THRESHOLD_PX moves', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);

    // Just under the threshold: a click, and the note does not move.
    const short = screenOf({ x: a.cx, y: a.cy });
    dragElement(noteElement(a.id), short, { x: short.x + DRAG_THRESHOLD_PX - 1, y: short.y }, 1);
    await flushFrame();
    expect(pos(doc, a.id)).toEqual(before);
    expect(noteElement(a.id).getAttribute('data-dragging')).toBe('false');

    // Exactly the threshold: the gesture runs and the note lands under the pointer.
    const exact = screenOf({ x: a.cx, y: a.cy });
    dragElement(noteElement(a.id), exact, { x: exact.x + DRAG_THRESHOLD_PX, y: exact.y }, 1);
    await flushFrame();
    expect(pos(doc, a.id)).toEqual({ x: before.x + DRAG_THRESHOLD_PX, y: before.y });
  });

  it('a drag moves the whole selection together and raises it above what it overlaps', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 400, y: 400 });
    const b = placeNote(doc, { x: 700, y: 500 });
    const other = placeNote(doc, { x: 500, y: 450 }); // overlaps both, unselected
    const before = { a: pos(doc, a.id), b: pos(doc, b.id), other: pos(doc, other.id) };
    pressNote(a);
    pressNote(b, true);

    await dragNote(a, { x: 120, y: -60 });

    expect(pos(doc, a.id)).toEqual({ x: before.a.x + 120, y: before.a.y - 60 });
    expect(pos(doc, b.id)).toEqual({ x: before.b.x + 120, y: before.b.y - 60 });
    expect(pos(doc, other.id)).toEqual(before.other);

    // `sel.stacking`: both moved notes now sit above the note they overlap.
    const order = docNotes(doc).map((note) => note.id);
    expect(order.indexOf(a.id)).toBeGreaterThan(order.indexOf(other.id));
    expect(order.indexOf(b.id)).toBeGreaterThan(order.indexOf(other.id));
    // Their own relative order is kept.
    expect(order.indexOf(b.id)).toBeGreaterThan(order.indexOf(a.id));
  });

  it('TC-25 a board that could not be loaded is not moved (negative)', async () => {
    const doc = new Y.Doc();
    const provider = new FakeBoardProvider();
    renderBoard({ doc, connect: true, providerFactory: () => provider });
    const a = placeNote(doc, { x: 400, y: 400 });
    const b = placeNote(doc, { x: 700, y: 400 });
    act(() => {
      provider.refuseToLoad();
    });
    await flushFrame();
    expect(document.querySelector('[data-board-editable="false"]')).not.toBeNull();

    const before = docNotes(doc).map((note) => ({ id: note.id, x: note.x, y: note.y, z: note.z }));
    pressNote(a);
    pressNote(b, true);
    await dragNote(a, { x: 150, y: 150 });

    // Selecting is fine: a selection is the client's own business.
    expect(selectionCount()).toBe(2);
    const after = docNotes(doc).map((note) => ({ id: note.id, x: note.x, y: note.y, z: note.z }));
    expect(after).toEqual(before);
  });

  it('TC-26 gesture boundaries are reported once each, and a cancelled drag keeps what was applied', async () => {
    const doc = new Y.Doc();
    const started = vi.fn();
    const ended = vi.fn();
    renderBoard({ doc, onTransformStart: started, onTransformEnd: ended });
    const a = placeNote(doc, { x: 400, y: 400 });
    const b = placeNote(doc, { x: 700, y: 400 });
    pressNote(a);
    pressNote(b, true);

    const from = screenOf({ x: a.cx, y: a.cy });
    pointerAt(noteElement(a.id), 'pointerdown', from.x, from.y);
    pointerAt(noteElement(a.id), 'pointermove', from.x + DRAG_THRESHOLD_PX, from.y);
    expect(noteElement(a.id).getAttribute('data-dragging')).toBe('true');
    pointerAt(noteElement(a.id), 'pointermove', from.x + 60, from.y);
    await flushFrame(); // one frame applied
    const applied = { a: pos(doc, a.id), b: pos(doc, b.id) };

    pointerAt(noteElement(a.id), 'pointercancel', from.x + 60, from.y);
    await flushFrame();

    expect(started).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
    // What was already written stays; the queued offset is dropped.
    expect(pos(doc, a.id)).toEqual(applied.a);
    expect(pos(doc, b.id)).toEqual(applied.b);
    expect(noteElement(a.id).getAttribute('data-dragging')).toBe('false');
  });

  it('a note deleted elsewhere during a drag is skipped, not resurrected', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 400, y: 400 });
    const b = placeNote(doc, { x: 700, y: 400 });
    pressNote(a);
    pressNote(b, true);

    const from = screenOf({ x: a.cx, y: a.cy });
    pointerAt(noteElement(a.id), 'pointerdown', from.x, from.y);
    pointerAt(noteElement(a.id), 'pointermove', from.x + 40, from.y);
    await flushFrame();

    // Someone else deletes the second note mid-drag.
    changeDoc(() => {
      doc.getMap<unknown>('objects').delete(b.id);
    });

    pointerAt(noteElement(a.id), 'pointermove', from.x + 80, from.y);
    pointerAt(noteElement(a.id), 'pointerup', from.x + 80, from.y);
    await flushFrame();

    expect(docNotes(doc).map((note) => note.id)).toEqual([a.id]);
    expect(selectionCount()).toBe(1);
    expect(noteElement(a.id).getAttribute('data-dragging')).toBe('false');
  });
});

describe('sel.transform - bounding box resize (TC-24)', () => {
  it('TC-24 an edge handle changes one axis, and every handle is named', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const rect = { x: 300, y: 300, width: 400, height: 200 };
    const id = box(doc, rect);
    selectBox(id, rect);
    expect(selectionCount()).toBe(1);

    const handles = resizeHandles();
    expect(handles).toHaveLength(8);
    expect(handles.map((el) => el.getAttribute('aria-label'))).toEqual([
      'Resize top edge',
      'Resize top-right corner',
      'Resize right edge',
      'Resize bottom-right corner',
      'Resize bottom edge',
      'Resize bottom-left corner',
      'Resize left edge',
      'Resize top-left corner',
    ]);

    const before = testBoxBounds(doc, id);
    dragHandle('e', { x: 120, y: 500 });
    await flushFrame();

    const after = testBoxBounds(doc, id);
    // An edge handle drags one axis: width only, and the box stays where it was.
    expect(after.width).toBeCloseTo(before.width + 120);
    expect(after.height).toBeCloseTo(before.height);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('TC-24 Shift holds the proportions of a type that is not aspect-locked', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const rect = { x: 300, y: 300, width: 400, height: 200 };
    const id = box(doc, rect);
    selectBox(id, rect);

    const before = testBoxBounds(doc, id);
    dragHandle('se', { x: 100, y: 40 }, 4, { shiftKey: true });
    await flushFrame();

    const after = testBoxBounds(doc, id);
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.width / after.height).toBeCloseTo(before.width / before.height, 6);
  });

  it('a resize stops at the type minimum (testbox: TESTBOX_MIN_SIZE_WORLD)', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const rect = { x: 300, y: 300, width: 400, height: 200 };
    const id = box(doc, rect);
    selectBox(id, rect);

    const before = testBoxBounds(doc, id);
    // Drag the right edge far past the left one.
    dragHandle('e', { x: -3000, y: 0 }, 4);
    await flushFrame();

    const after = testBoxBounds(doc, id);
    expect(after.width).toBeCloseTo(TESTBOX_MIN_SIZE_WORLD);
    expect(after.height).toBeCloseTo(before.height);
  });

  it('sticky notes keep their proportions and stop at STICKY_MIN_SIZE_WORLD', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 400, y: 400 });
    pressNote(a);

    dragHandle('se', { x: 100, y: 0 });
    await flushFrame();
    const grown = noteOf(doc, a.id);
    // A corner drag on a square note stays square: story 2's note grew on both axes.
    expect(grown.width).toBeCloseTo(STICKY_SIZE_WORLD + 100);
    expect(grown.height).toBeCloseTo(STICKY_SIZE_WORLD + 100);

    dragHandle('se', { x: -5000, y: -5000 });
    await flushFrame();
    const clamped = noteOf(doc, a.id);
    expect(clamped.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
    expect(clamped.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
  });

  it('handles are hidden for a type that cannot be resized (sel.all_types)', () => {
    registerTestLabel();
    const doc = new Y.Doc();
    renderBoard({ doc });
    let id = '';
    changeDoc(() => {
      id = createTestLabel(doc, { x: 300, y: 300, width: 300, height: 100 });
    });
    selectBox(id, { x: 300, y: 300, width: 300, height: 100 });

    expect(selectionCount()).toBe(1);
    expect(resizeHandles()).toHaveLength(0);
    expect(document.querySelector('[data-testid="selection-overlay"]')?.getAttribute('data-resizable')).toBe(
      'false',
    );
    void TESTLABEL_TYPE;
  });
});
