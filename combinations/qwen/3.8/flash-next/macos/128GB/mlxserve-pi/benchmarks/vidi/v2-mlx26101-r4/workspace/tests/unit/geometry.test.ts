/**
 * Unit tests for the pure geometry of selection and transformation
 * (`sel.geometry_ops`, TC-01 to TC-04).
 *
 * These are the numbers a person judges with their eyes — how far a box grew, where
 * the objects inside it ended up, and exactly where a resize stops — so they are
 * tested as maths, on their own, before anything is allowed to depend on them.
 */
import { describe, expect, it } from 'vitest';

import {
  HANDLES,
  HANDLE_LABELS,
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Point,
  type Rect,
} from '../../src/shared/geometry';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

/** A note at the default size, at the origin. */
const NOTE: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };

const point = (x: number, y: number): Point => ({ x, y });

describe('geometry rectContains', () => {
  it('TC-07a: selects what lies entirely inside and refuses what does not', () => {
    const box: Rect = { x: 0, y: 0, width: 500, height: 500 };

    expect(rectContains(box, { x: 10, y: 10, width: 100, height: 100 })).toBe(true);
    // Edges included: an object whose edge lands on the box was inside it.
    expect(rectContains(box, { x: 0, y: 0, width: 500, height: 500 })).toBe(true);
    // Half in, half out, and a rect that only touches the box from outside.
    expect(rectContains(box, { x: 450, y: 10, width: 100, height: 100 })).toBe(false);
    expect(rectContains(box, { x: 500, y: 0, width: 100, height: 100 })).toBe(false);
    expect(rectContains(box, { x: -1, y: 0, width: 100, height: 100 })).toBe(false);
  });

  it('is false about a rectangle it cannot measure', () => {
    expect(rectContains(NOTE, { x: Number.NaN, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectContains({ ...NOTE, width: Number.POSITIVE_INFINITY }, NOTE)).toBe(false);
  });
});

describe('geometry unionRects', () => {
  it('answers null when there is nothing to bound', () => {
    expect(unionRects([])).toBeNull();
    // A rectangle that is not a rectangle is not counted, and does not poison the rest.
    expect(unionRects([{ x: 0, y: 0, width: Number.NaN, height: 10 }])).toBeNull();
  });

  it('bounds every rectangle given, in any order', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const b: Rect = { x: 300, y: 200, width: 100, height: 50 };

    expect(unionRects([a, b])).toEqual({ x: 0, y: 0, width: 400, height: 250 });
    expect(unionRects([b, a])).toEqual({ x: 0, y: 0, width: 400, height: 250 });
    // Negative coordinates and a rect that contains the others.
    expect(unionRects([{ x: -50, y: -50, width: 1000, height: 1000 }, b])).toEqual({
      x: -50,
      y: -50,
      width: 1000,
      height: 1000,
    });
  });
});

describe('geometry normalizeRect', () => {
  it('turns two dragged points into one rectangle, whichever way they went', () => {
    expect(normalizeRect(point(0, 0), point(100, 50))).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(normalizeRect(point(100, 50), point(0, 0))).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(normalizeRect(point(-30, 20), point(10, -40))).toEqual({ x: -30, y: -40, width: 40, height: 60 });
    // A drag that never moved is a rectangle of nothing, not a point that could be
    // mistaken for an object of zero size somewhere on the board.
    expect(normalizeRect(point(7, 9), point(7, 9))).toEqual({ x: 7, y: 9, width: 0, height: 0 });
  });
});

describe('geometry resizeRect', () => {
  it('TC-01: drags the bottom-right corner of a square note to 300x300 with the proportions locked', () => {
    const resized = resizeRect(NOTE, 'se', point(100, 40), true);

    // The axis the pointer travelled further along decides the scale: 100 of 200 is
    // half again as big, and the locked ratio makes the height follow it.
    expect(resized).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('keeps the opposite corner where it was', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 200 };

    // The bottom-right corner is held, so the top-left does not move.
    expect(resizeRect(start, 'se', point(50, 50), false)).toEqual({ x: 100, y: 100, width: 250, height: 250 });
    // The top-left corner is the one that moves, so the box grows west and north.
    expect(resizeRect(start, 'nw', point(-50, -50), false)).toEqual({ x: 50, y: 50, width: 250, height: 250 });
    // And dragging the top-left corner inwards shrinks it about the bottom-right.
    expect(resizeRect(start, 'nw', point(20, 20), false)).toEqual({ x: 120, y: 120, width: 180, height: 180 });
  });

  it('changes one axis only for an edge handle', () => {
    const start: Rect = { x: 0, y: 0, width: 400, height: 200 };

    expect(resizeRect(start, 'e', point(100, 0), false)).toEqual({ x: 0, y: 0, width: 500, height: 200 });
    expect(resizeRect(start, 'w', point(100, 0), false)).toEqual({ x: 100, y: 0, width: 300, height: 200 });
    // A drag along the wrong axis of an edge handle moves nothing: the edge it holds
    // is the edge it holds.
    expect(resizeRect(start, 'e', point(0, 77), false)).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    // The top edge moves up as the pointer goes north.
    expect(resizeRect(start, 'n', point(0, -20), false)).toEqual({ x: 0, y: -20, width: 400, height: 220 });
  });

  it('keeps the proportions when they are locked, on every handle', () => {
    const start: Rect = { x: 0, y: 0, width: 400, height: 200 };

    // Corners: a wide box dragged wider grows taller by the same ratio.
    expect(resizeRect(start, 'se', point(200, 0), true)).toEqual({ x: 0, y: 0, width: 600, height: 300 });
    // Edges with the ratio locked grow the other axis evenly about the middle of the box.
    expect(resizeRect(start, 'e', point(200, 0), true)).toEqual({ x: 0, y: -50, width: 600, height: 300 });
    expect(resizeRect(start, 's', point(0, 100), true)).toEqual({ x: -100, y: 0, width: 600, height: 300 });
    // Shrinking is the same maths backwards.
    expect(resizeRect(start, 'se', point(-100, 0), true)).toEqual({ x: 0, y: 0, width: 300, height: 150 });
  });

  it('is unmoved by a delta that is not a place, and by a box it cannot scale', () => {
    expect(resizeRect(NOTE, 'se', point(Number.NaN, 10), false)).toEqual(NOTE);
    // A box with no width cannot have its proportions kept, so it is resized as asked.
    const flat: Rect = { x: 0, y: 0, width: 0, height: 100 };
    expect(resizeRect(flat, 'e', point(50, 0), true)).toEqual({ x: 0, y: 0, width: 50, height: 100 });
  });

  it('names every handle in the way a screen reader should read it', () => {
    expect(HANDLES).toHaveLength(8);
    expect(Object.keys(HANDLE_LABELS).sort()).toEqual([...HANDLES].sort());
    // The PRD's example.
    expect(HANDLE_LABELS.nw).toBe('Resize top-left');
    expect(HANDLE_LABELS.se).toBe('Resize bottom-right');
  });
});

describe('geometry clampScale', () => {
  it('TC-02: stops a shrink at the minimum size, and lets the exact minimum through', () => {
    const rects = [NOTE];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    // 49 is one unit below the smallest note the board accepts.
    const below = clampScale(point(49 / STICKY_SIZE_WORLD, 49 / STICKY_SIZE_WORLD), rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(scaleWithin(NOTE, NOTE, boxAtScale(NOTE, below))).toEqual({
      x: 0,
      y: 0,
      width: STICKY_MIN_SIZE_WORLD,
      height: STICKY_MIN_SIZE_WORLD,
    });

    // The boundary itself is allowed: 50 is not smaller than 50.
    const exact = clampScale(
      point(STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD),
      rects,
      minSizes,
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(scaleWithin(NOTE, NOTE, boxAtScale(NOTE, exact))).toEqual({
      x: 0,
      y: 0,
      width: STICKY_MIN_SIZE_WORLD,
      height: STICKY_MIN_SIZE_WORLD,
    });
  });

  it('TC-03: stops the whole selection where the first object reaches the maximum', () => {
    // A big note and a small one, selected together, dragged bigger together.
    const big: Rect = { x: 0, y: 0, width: 1000, height: 500 };
    const small: Rect = { x: 2000, y: 0, width: 100, height: 400 };
    const rects = [big, small];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    const box = unionRects(rects)!;

    // The pointer asks for thirty times as wide. The small one would survive that and
    // the big one would be 30000 wide, so nothing goes past the scale at which the big
    // one is exactly as large as the board allows.
    const clamped = clampScale(point(30, 1), rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBe(MAX_OBJECT_SIZE_WORLD / big.width);
    expect(clamped.y).toBe(1);

    // And the answer really is the last scale at which every object is legal.
    const grownBox = boxAtScale(box, clamped);
    for (const rect of rects) {
      const grown = scaleWithin(rect, box, grownBox);
      expect(grown.width).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-6);
      expect(grown.height).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-6);
    }

    // One scale for the whole group is also what keeps the layout a layout: the gap
    // between two objects is scaled by the same number as their sizes are.
    const moved = rects.map((rect) => scaleWithin(rect, box, grownBox));
    expect(moved[1]!.x - (moved[0]!.x + moved[0]!.width)).toBeCloseTo((2000 - 1000) * clamped.x, 6);

    // A request one unit past the maximum is stopped at it, not rounded to it.
    expect(clampScale(point(21, 1), rects, minSizes, MAX_OBJECT_SIZE_WORLD).x).toBe(
      MAX_OBJECT_SIZE_WORLD / big.width,
    );
  });

  it('shrinks nothing past the smallest minimum of the group', () => {
    // The selection stops as soon as the first object reaches its own limit, which is
    // the smallest note in this group, not the average of the two.
    const wide: Rect = { x: 0, y: 0, width: 400, height: 400 };
    const narrow: Rect = { x: 500, y: 0, width: 100, height: 100 };
    const clamped = clampScale(point(0.2, 0.2), [wide, narrow], [100, 100], MAX_OBJECT_SIZE_WORLD);

    expect(clamped.x).toBe(1); // narrow is already at its minimum: it cannot go smaller
    expect(clamped.y).toBe(1);
  });

  it('treats a scale that is not a number as no scale at all', () => {
    expect(clampScale(point(Number.NaN, Number.POSITIVE_INFINITY), [NOTE], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1,
      y: 1,
    });
    // Nothing selected: nothing to clamp, and nothing that may be resized either.
    expect(clampScale(point(3, 3), [], [], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 3, y: 3 });
  });
});

describe('geometry scaleWithin', () => {
  it('TC-04: doubles a box and with it each note and each gap', () => {
    // Two 200-unit notes 100 units apart; the box around them is 500 wide.
    const left: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    const right: Rect = { x: 300, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    const box = unionRects([left, right])!;
    expect(box).toEqual({ x: 0, y: 0, width: 500, height: 200 });

    // The right edge dragged until the box is twice as wide.
    const grown: Rect = { x: 0, y: 0, width: 1000, height: 200 };

    const notes = [left, right].map((note) => scaleWithin(note, box, grown));
    // Each note is 400 wide, and the gap between them is 200 (the PRD's example).
    expect(notes[0]).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(notes[1]).toEqual({ x: 600, y: 0, width: 400, height: 200 });
    expect(notes[1]!.x - (notes[0]!.x + notes[0]!.width)).toBe(200);
  });

  it('moves and sizes an object about the top-left of the box', () => {
    const box: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const child: Rect = { x: 200, y: 150, width: 100, height: 50 };

    expect(scaleWithin(child, box, { x: 100, y: 100, width: 400, height: 100 })).toEqual({
      x: 300,
      y: 125,
      width: 200,
      height: 25,
    });
  });

  it('leaves an object alone rather than dividing by a box with no size', () => {
    const child: Rect = { x: 0, y: 0, width: 100, height: 100 };

    expect(scaleWithin(child, { x: 0, y: 0, width: 0, height: 100 }, { x: 5, y: 5, width: 500, height: 200 })).toEqual({
      x: 5,
      y: 5,
      width: 100,
      height: 200,
    });
    expect(scaleWithin(child, { x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: Number.NaN, height: 1 })).toEqual(
      child,
    );
  });
});

/** The box of a rect grown or shrunk by a scale, from its own top-left. */
function boxAtScale(rect: Rect, scale: Point): Rect {
  return { x: rect.x, y: rect.y, width: rect.width * scale.x, height: rect.height * scale.y };
}
