/**
 * Geometry unit tests (`sel.geometry_ops`, TC-01 to TC-04 plus the rectangle
 * helpers the marquee and the bounding box depend on).
 *
 * Pure maths, world units, no document: every number here is written out so a
 * change in behaviour shows up as a changed expectation rather than a passing
 * test. Sizes are chosen so the arithmetic is exact in binary floating point
 * (halves, quarters, tenths of powers of ten).
 */
import { describe, expect, it } from 'vitest';

import {
  anchoredRect,
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

const NOTE = { x: 0, y: 0, width: 200, height: 200 } satisfies Rect;

/** Two 200-unit notes with a 100-unit gap: the PRD's resize example. */
const LEFT = { x: 0, y: 0, width: 200, height: 200 } satisfies Rect;
const RIGHT = { x: 300, y: 0, width: 200, height: 200 } satisfies Rect;
const PAIR_BOX = { x: 0, y: 0, width: 500, height: 200 } satisfies Rect;

describe('rectContains', () => {
  it('holds a rectangle that lies entirely inside, including one flush with an edge', () => {
    const outer = { x: 0, y: 0, width: 1000, height: 1000 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    // Flush with all four edges is still entirely inside.
    expect(rectContains(outer, outer)).toBe(true);
  });

  it('refuses a rectangle that hangs over any edge', () => {
    const outer = { x: 0, y: 0, width: 1000, height: 1000 };
    expect(rectContains(outer, { x: 990, y: 10, width: 20, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: -1, y: 10, width: 20, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: 10, y: 990, width: 20, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: 10, y: -1, width: 20, height: 20 })).toBe(false);
  });

  it('refuses a rectangle that only touches the border from outside', () => {
    const marquee = { x: 500, y: 0, width: 500, height: 500 };
    // Its right edge lands exactly on the marquee's left edge: touching, not inside.
    expect(rectContains(marquee, { x: 300, y: 10, width: 200, height: 20 })).toBe(false);
    // And the same on the other side.
    expect(rectContains(marquee, { x: 1000, y: 10, width: 200, height: 20 })).toBe(false);
  });
});

describe('unionRects', () => {
  it('is null when there is nothing to enclose', () => {
    expect(unionRects([])).toBeNull();
  });

  it('is the rectangle itself for one object', () => {
    expect(unionRects([NOTE])).toEqual(NOTE);
  });

  it('covers every rectangle, including ones up and to the left', () => {
    const box = unionRects([
      LEFT,
      RIGHT,
      { x: -100, y: -50, width: 20, height: 20 },
    ]);
    expect(box).toEqual({ x: -100, y: -50, width: 600, height: 250 });
  });
});

describe('normalizeRect', () => {
  it('turns two dragged corners into a rectangle, in either order', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 110, y: 60 })).toEqual({
      x: 10,
      y: 10,
      width: 100,
      height: 50,
    });
    expect(normalizeRect({ x: 110, y: 60 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      width: 100,
      height: 50,
    });
  });

  it('gives a zero-sized rectangle when the drag has no distance', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});

describe('resizeRect', () => {
  // TC-01
  it('TC-01 drags the bottom-right corner of a 200×200 note with the ratio locked to 300×300', () => {
    expect(resizeRect(NOTE, 'se', { x: 100, y: 40 }, true)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
  });

  it('changes width only from the right edge', () => {
    expect(resizeRect(NOTE, 'e', { x: 100, y: 40 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
  });

  it('keeps the opposite edge fixed when dragging the left edge', () => {
    expect(resizeRect(NOTE, 'w', { x: -50, y: 0 }, false)).toEqual({
      x: -50,
      y: 0,
      width: 250,
      height: 200,
    });
    // The right edge is still at 200.
    expect(-50 + 250).toBe(200);
  });

  it('keeps the opposite edge fixed when dragging the top edge', () => {
    expect(resizeRect(NOTE, 'n', { x: 0, y: -100 }, false)).toEqual({
      x: 0,
      y: -100,
      width: 200,
      height: 300,
    });
  });

  it('moves the top-left corner and grows both axes from the top-left handle', () => {
    expect(resizeRect(NOTE, 'nw', { x: -50, y: -50 }, false)).toEqual({
      x: -50,
      y: -50,
      width: 250,
      height: 250,
    });
    // The bottom-right corner is still at (200, 200).
    expect(-50 + 250).toBe(200);
    expect(-50 + 250).toBe(200);
  });

  it('grows both axes from a corner handle without the ratio locked', () => {
    expect(resizeRect(NOTE, 'se', { x: 100, y: 40 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 240,
    });
  });

  it('keeps the anchor of a ratio-locked edge handle, growing the other axis about the centre', () => {
    // The left edge stays put, the width is 300, so a 1:1 note is 300 tall and
    // centred where it was.
    expect(resizeRect(NOTE, 'e', { x: 100, y: 0 }, true)).toEqual({
      x: 0,
      y: -50,
      width: 300,
      height: 300,
    });
  });

  it('keeps the ratio when shrinking from a corner', () => {
    const result = resizeRect(NOTE, 'se', { x: -50, y: -10 }, true);
    expect(result.width).toBe(150);
    expect(result.height).toBe(150);
  });

  it('leaves a non-finite delta alone rather than writing nonsense', () => {
    expect(resizeRect(NOTE, 'se', { x: Number.NaN, y: 10 }, false)).toEqual(NOTE);
    expect(resizeRect(NOTE, 'se', { x: 10, y: Number.POSITIVE_INFINITY }, false)).toEqual(NOTE);
  });
});

describe('anchoredRect', () => {
  it('places a resized box so the handle opposite the one dragged does not move', () => {
    expect(anchoredRect(NOTE, 'se', 300, 300)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    expect(anchoredRect(NOTE, 'nw', 300, 300)).toEqual({ x: -100, y: -100, width: 300, height: 300 });
    expect(anchoredRect(NOTE, 'e', 300, 100)).toEqual({ x: 0, y: 50, width: 300, height: 100 });
    expect(anchoredRect(NOTE, 'n', 100, 300)).toEqual({ x: 50, y: -100, width: 100, height: 300 });
  });
});

describe('clampScale', () => {
  // TC-02 (boundary: one unit under the minimum, then exactly the minimum)
  it('TC-02 stops a shrink at STICKY_MIN_SIZE_WORLD', () => {
    const rects = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD];

    const under = clampScale(
      { x: (STICKY_MIN_SIZE_WORLD - 1) / 200, y: (STICKY_MIN_SIZE_WORLD - 1) / 200 },
      rects,
      minSizes,
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(under.x * 200).toBe(STICKY_MIN_SIZE_WORLD);
    expect(under.y * 200).toBe(STICKY_MIN_SIZE_WORLD);

    const exact = clampScale(
      { x: STICKY_MIN_SIZE_WORLD / 200, y: STICKY_MIN_SIZE_WORLD / 200 },
      rects,
      minSizes,
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(exact.x * 200).toBe(STICKY_MIN_SIZE_WORLD);
  });

  // TC-03
  it('TC-03 stops the whole selection where the first object reaches MAX_OBJECT_SIZE_WORLD', () => {
    const rects = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 300, y: 0, width: 100, height: 100 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // The pointer asks for 150×: the small note would fit, the big one would not.
    const scale = clampScale({ x: 150, y: 1 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);

    expect(scale.x).toBe(MAX_OBJECT_SIZE_WORLD / 200);
    expect(200 * scale.x).toBe(MAX_OBJECT_SIZE_WORLD);
    // One scale for all: the small note stops part way, and its layout is intact.
    expect(100 * scale.x).toBe(10_000);
    expect(scale.y).toBe(1);
  });

  it('lets a scale through when nothing reaches a limit', () => {
    const scale = clampScale({ x: 2, y: 0.5 }, [LEFT], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(scale).toEqual({ x: 2, y: 0.5 });
  });

  it('stops on the smallest minimum in the selection, not the first one', () => {
    const rects = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 300, y: 0, width: 100, height: 100 },
    ];
    const scale = clampScale({ x: 0.2, y: 1 }, rects, [50, 50], MAX_OBJECT_SIZE_WORLD);
    // The 100-unit note hits 50 first: everything stops at half of that note.
    expect(100 * scale.x).toBe(50);
    expect(200 * scale.x).toBe(100);
  });

  it('is the identity for a scale that is not a number', () => {
    expect(clampScale({ x: Number.NaN, y: 2 }, [LEFT], [50], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1,
      y: 1,
    });
    expect(clampScale({ x: 2, y: Number.POSITIVE_INFINITY }, [LEFT], [50], MAX_OBJECT_SIZE_WORLD)).toEqual(
      { x: 1, y: 1 },
    );
  });
});

describe('scaleWithin', () => {
  // TC-04: the PRD's resize example, twice the width, notes and gap together.
  it('TC-04 doubles a box of two 200-unit notes 100 apart into 400-unit notes 200 apart', () => {
    const to = { x: 0, y: 0, width: 1000, height: 200 };
    const left = scaleWithin(LEFT, PAIR_BOX, to);
    const right = scaleWithin(RIGHT, PAIR_BOX, to);

    expect(left).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(right).toEqual({ x: 600, y: 0, width: 400, height: 200 });
    expect(right.x - (left.x + left.width)).toBe(200);
  });

  it('scales both axes and keeps the layout when the box moves as well as grows', () => {
    const to = { x: 100, y: 50, width: 1000, height: 400 };
    expect(scaleWithin(LEFT, PAIR_BOX, to)).toEqual({ x: 100, y: 50, width: 400, height: 400 });
    expect(scaleWithin(RIGHT, PAIR_BOX, to)).toEqual({ x: 700, y: 50, width: 400, height: 400 });
  });

  it('is the identity when the box has not changed', () => {
    expect(scaleWithin(LEFT, PAIR_BOX, PAIR_BOX)).toEqual(LEFT);
  });

  it('keeps a zero-size box from producing non-finite numbers', () => {
    const flat = { x: 10, y: 10, width: 0, height: 0 };
    const scaled = scaleWithin(LEFT, flat, { x: 0, y: 0, width: 100, height: 100 });
    expect(Number.isFinite(scaled.x)).toBe(true);
    expect(Number.isFinite(scaled.width)).toBe(true);
  });
});
