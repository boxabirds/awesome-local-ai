import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  boardElement,
  clickElement,
  createNote,
  dragElement,
  flushFrame,
  marqueeElement,
  noteElement,
  pointerAt,
  pressKey,
  readCamera,
  renderBoard,
  screenOf,
  selectionCount,
} from './harness';

/**
 * `sel.marquee_ui`: Shift+drag selects with a rectangle, and only what the
 * rectangle fully holds (TC-20, TC-21, TC-22).
 *
 * The rectangle is stored in world units, so every coordinate in this file is a
 * world coordinate, converted with the camera the board is actually using.
 * `createNote` places a note by its centre, exactly as the board does.
 */

const HALF = STICKY_SIZE_WORLD / 2;

interface Placed {
  id: string;
  /** Centre, as the model stores it. */
  cx: number;
  cy: number;
  /** The rectangle it occupies. */
  x: number;
  y: number;
  width: number;
  height: number;
}

function placeNote(doc: Y.Doc, centre: { x: number; y: number }): Placed {
  const id = createNote(doc, centre);
  return {
    id,
    cx: centre.x,
    cy: centre.y,
    x: centre.x - HALF,
    y: centre.y - HALF,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
  };
}

/** Three notes: `a` and `b` fit inside the rectangle below, `c` does not. */
function cluster(doc: Y.Doc): { a: Placed; b: Placed; c: Placed } {
  return {
    a: placeNote(doc, { x: 400, y: 400 }), // 300..500 x 300..500: fully inside
    b: placeNote(doc, { x: 550, y: 420 }), // 450..650 x 320..520: fully inside
    c: placeNote(doc, { x: 800, y: 700 }), // 700..900 x 600..800: outside
  };
}

/** The rectangle these tests drag: world units. */
const MARQUEE = { from: { x: 250, y: 250 }, to: { x: 680, y: 560 } };

function pressNote(note: Placed, additive = false): void {
  const screen = screenOf({ x: note.cx, y: note.cy });
  clickElement(noteElement(note.id), screen.x, screen.y, additive ? { shiftKey: true } : {});
}

const selected = (id: string): boolean => noteElement(id).getAttribute('data-selected') === 'true';

describe('sel.marquee_ui - Shift+drag selection (TC-20 to TC-22)', () => {
  it('TC-20 Shift+drag adds every fully enclosed note to the selection', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const { a, b, c } = cluster(doc);
    pressNote(c); // the selection starts as {c}
    expect(selectionCount()).toBe(1);

    dragElement(boardElement(), screenOf(MARQUEE.from), screenOf(MARQUEE.to), 4, {
      shiftKey: true,
    });

    // `objectsInRect` keeps only what lies entirely inside (TC-07), and a marquee
    // adds to the selection instead of replacing it.
    expect(selectionCount()).toBe(3);
    expect(selected(a.id)).toBe(true);
    expect(selected(b.id)).toBe(true);
    expect(selected(c.id)).toBe(true); // already selected, and still selected
    expect(marqueeElement()).toBeNull(); // the rectangle is gone once released
  });

  it('the rectangle is stored in world units while it is dragged', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    cluster(doc);

    const from = screenOf(MARQUEE.from);
    const mid = screenOf({ x: 465, y: 405 });
    pointerAt(boardElement(), 'pointerdown', from.x, from.y, { shiftKey: true });
    pointerAt(boardElement(), 'pointermove', mid.x, mid.y, { shiftKey: true });

    const rect = marqueeElement();
    expect(rect).not.toBeNull();
    expect(Number(rect!.getAttribute('data-world-width'))).toBeCloseTo(465 - MARQUEE.from.x);
    expect(Number(rect!.getAttribute('data-world-height'))).toBeCloseTo(405 - MARQUEE.from.y);

    pointerAt(boardElement(), 'pointerup', mid.x, mid.y, { shiftKey: true });
    expect(marqueeElement()).toBeNull();
  });

  it('TC-21 a plain drag on empty space pans the board and does not select (negative)', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const { a } = cluster(doc);
    pressNote(a);
    expect(selectionCount()).toBe(1);
    await flushFrame();

    const before = readCamera();
    const from = screenOf({ x: 100, y: 100 });
    const to = screenOf({ x: 400, y: 400 });
    dragElement(boardElement(), from, to, 4);
    await flushFrame();
    const after = readCamera();

    expect(after.x).not.toBe(before.x);
    expect(after.y).not.toBe(before.y);
    expect(marqueeElement()).toBeNull();
    // A pan is not a click, so the selection survives it.
    expect(selectionCount()).toBe(1);
    expect(selected(a.id)).toBe(true);
  });

  it('TC-22 a cancelled marquee leaves the selection as it was (error path)', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const { a, c } = cluster(doc);
    pressNote(c);
    expect(selectionCount()).toBe(1);

    const from = screenOf(MARQUEE.from);
    const mid = screenOf({ x: 500, y: 450 });
    pointerAt(boardElement(), 'pointerdown', from.x, from.y, { shiftKey: true });
    pointerAt(boardElement(), 'pointermove', mid.x, mid.y, { shiftKey: true });
    expect(marqueeElement()).not.toBeNull();

    pointerAt(boardElement(), 'pointercancel', mid.x, mid.y, { shiftKey: true });

    expect(marqueeElement()).toBeNull();
    expect(selectionCount()).toBe(1);
    expect(selected(c.id)).toBe(true);
    expect(selected(a.id)).toBe(false);
  });

  it('Escape during a marquee discards it and leaves the selection alone', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const { a, c } = cluster(doc);
    pressNote(c);
    await flushFrame();

    const from = screenOf(MARQUEE.from);
    const mid = screenOf({ x: 500, y: 450 });
    pointerAt(boardElement(), 'pointerdown', from.x, from.y, { shiftKey: true });
    pointerAt(boardElement(), 'pointermove', mid.x, mid.y, { shiftKey: true });
    expect(marqueeElement()).not.toBeNull();

    pressKey('Escape');
    await flushFrame();

    expect(marqueeElement()).toBeNull();
    expect(selectionCount()).toBe(1);
    expect(selected(c.id)).toBe(true);
    expect(selected(a.id)).toBe(false);
  });

  it('a marquee that encloses nothing leaves the selection unchanged', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const { c } = cluster(doc);
    pressNote(c);

    dragElement(
      boardElement(),
      screenOf({ x: 5000, y: 5000 }),
      screenOf({ x: 5200, y: 5200 }),
      3,
      { shiftKey: true },
    );

    expect(selectionCount()).toBe(1);
    expect(selected(c.id)).toBe(true);
  });
});
