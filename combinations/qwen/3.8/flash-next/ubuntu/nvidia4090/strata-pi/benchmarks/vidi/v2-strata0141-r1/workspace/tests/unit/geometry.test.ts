import { describe, expect, it } from 'vitest';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  resizeRectFromScale,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';

/**
 * Unit tests for the pure board geometry story 7 selects, moves and resizes
 * with (anchor `sel.geometry_ops`). World units only; no DOM, no document.
 */

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

/** Boxes come out of multiplication and division, so they are matched loosely. */
const matchRect = (actual: Rect, expected: Rect): void => {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.width).toBeCloseTo(expected.width, 6);
  expect(actual.height).toBeCloseTo(expected.height, 6);
};

describe('sel.geometry_ops - containment and unions (TC-07 support)', () => {
  it('rectContains is true only when all four edges of the inner rect lie inside', () => {
    const outer = rect(0, 0, 500, 500);
    expect(rectContains(outer, rect(10, 10, 100, 100))).toBe(true);
    // Lying exactly on the border is still "entirely inside".
    expect(rectContains(outer, rect(0, 0, 500, 500))).toBe(true);
    expect(rectContains(outer, rect(0, 400, 100, 100))).toBe(true);
    // Partly inside: 40 units of it hang out of the right edge.
    expect(rectContains(outer, rect(460, 10, 100, 100))).toBe(false);
    // Merely touches the edge from outside.
    expect(rectContains(outer, rect(500, 10, 100, 100))).toBe(false);
    expect(rectContains(outer, rect(-100, 10, 100, 100))).toBe(false);
    expect(rectContains(outer, rect(400, 500, 100, 100))).toBe(false);
  });

  it('rectContains rejects non-finite input instead of answering true', () => {
    expect(rectContains(rect(0, 0, 100, 100), rect(Number.NaN, 0, 10, 10))).toBe(false);
    expect(rectContains(rect(0, 0, 100, 100), rect(0, 0, Number.POSITIVE_INFINITY, 10))).toBe(false);
    expect(rectContains(rect(0, 0, Number.NaN, 100), rect(0, 0, 10, 10))).toBe(false);
  });

  it('unionRects of several rects is the smallest box around all of them', () => {
    const box = unionRects([rect(10, 20, 100, 100), rect(300, -5, 50, 60)]);
    expect(box).toEqual({ x: 10, y: -5, width: 340, height: 125 });
  });

  it('unionRects of nothing is null (an empty selection has no bounding box)', () => {
    expect(unionRects([])).toBeNull();
  });

  it('normalizeRect turns two dragged points into a rectangle in any direction', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 60, y: 40 })).toEqual({
      x: 10,
      y: 10,
      width: 50,
      height: 30,
    });
    // Dragged up and to the left.
    expect(normalizeRect({ x: 60, y: 40 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      width: 50,
      height: 30,
    });
  });
});

describe('sel.geometry_ops - resizing a bounding box', () => {
  // TC-01
  it('TC-01 a bottom-right corner drag on a 200x200 box with the ratio locked gives 300x300', () => {
    const box = resizeRect(rect(0, 0, 200, 200), 'se', { x: 100, y: 40 }, true);
    expect(box.width).toBeCloseTo(300, 6);
    expect(box.height).toBeCloseTo(300, 6);
    // The opposite corner (top-left) is the anchor and never moves.
    expect(box.x).toBeCloseTo(0, 6);
    expect(box.y).toBeCloseTo(0, 6);
  });

  it('a corner handle resizes both directions from the opposite corner', () => {
    // Dragging the top-left handle left and up expands the box away from the
    // bottom-right corner, which stays at (300, 200).
    const box = resizeRect(rect(100, 100, 200, 100), 'nw', { x: -20, y: -30 }, false);
    matchRect(box, { x: 80, y: 70, width: 220, height: 130 });

    // Dragging it back in shrinks the box.
    matchRect(resizeRect(rect(100, 100, 200, 100), 'nw', { x: 20, y: 30 }, false), {
      x: 120,
      y: 130,
      width: 180,
      height: 70,
    });

    const se = resizeRect(rect(100, 100, 200, 100), 'se', { x: 20, y: 30 }, false);
    matchRect(se, { x: 100, y: 100, width: 220, height: 130 });

    const ne = resizeRect(rect(100, 100, 200, 100), 'ne', { x: 20, y: -30 }, false);
    matchRect(ne, { x: 100, y: 70, width: 220, height: 130 });

    const sw = resizeRect(rect(100, 100, 200, 100), 'sw', { x: -20, y: 30 }, false);
    matchRect(sw, { x: 80, y: 100, width: 220, height: 130 });
  });

  it('an edge handle resizes one direction only', () => {
    matchRect(resizeRect(rect(0, 0, 200, 100), 'e', { x: 50, y: 999 }, false), {
      x: 0,
      y: 0,
      width: 250,
      height: 100,
    });
    // Dragged left, the left edge handle narrows the box and keeps its right
    // edge at x = 200.
    matchRect(resizeRect(rect(0, 0, 200, 100), 'w', { x: 50, y: 999 }, false), {
      x: 50,
      y: 0,
      width: 150,
      height: 100,
    });
    matchRect(resizeRect(rect(0, 0, 200, 100), 'w', { x: -50, y: 999 }, false), {
      x: -50,
      y: 0,
      width: 250,
      height: 100,
    });
    matchRect(resizeRect(rect(0, 0, 200, 100), 'n', { x: 999, y: 25 }, false), {
      x: 0,
      y: 25,
      width: 200,
      height: 75,
    });
    matchRect(resizeRect(rect(0, 0, 200, 100), 's', { x: 999, y: 25 }, false), {
      x: 0,
      y: 0,
      width: 200,
      height: 125,
    });
  });

  it('Shift on an edge handle keeps the box ratio (the perpendicular axis follows)', () => {
    const box = resizeRect(rect(0, 0, 200, 100), 'e', { x: 200, y: 0 }, true);
    expect(box.width).toBeCloseTo(400, 6);
    expect(box.height).toBeCloseTo(200, 6);
  });

  it('a resize never turns a box inside out', () => {
    const box = resizeRect(rect(0, 0, 200, 200), 'se', { x: -1_000, y: -1_000 }, false);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  // TC-02 (boundary: one unit below the minimum, and exactly at it)
  it('TC-02 shrinking a sticky below STICKY_MIN_SIZE_WORLD stops at exactly 50 x 50', () => {
    const sticky = rect(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD);
    for (const target of [STICKY_MIN_SIZE_WORLD - 1, STICKY_MIN_SIZE_WORLD]) {
      const box = resizeRect(
        sticky,
        'se',
        { x: target - STICKY_SIZE_WORLD, y: target - STICKY_SIZE_WORLD },
        true,
      );
      // The raw resize is allowed to want something too small ...
      expect(box.width).toBeCloseTo(target, 6);
      const scale = clampScale(
        { x: box.width / sticky.width, y: box.height / sticky.height },
        [sticky],
        [STICKY_MIN_SIZE_WORLD],
        MAX_OBJECT_SIZE_WORLD,
      );
      // ... and the clamp is what stops it at exactly 50.
      const clamped = scaleWithin(sticky, sticky, {
        x: sticky.x,
        y: sticky.y,
        width: sticky.width * scale.x,
        height: sticky.height * scale.y,
      });
      expect(clamped.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
      expect(clamped.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    }
  });

  it('TC-02 the growth limit is MAX_OBJECT_SIZE_WORLD, not the minimum', () => {
    const sticky = rect(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD);
    const scale = clampScale(
      { x: 200, y: 200 },
      [sticky],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / STICKY_SIZE_WORLD, 6);
    expect(sticky.width * scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
  });

  // TC-03
  it('TC-03 clampScale stops the whole selection where the first object reaches 20,000 units', () => {
    const small = rect(0, 0, 200, 200);
    const large = rect(1_000, 1_000, 10_000, 10_000);
    const box = unionRects([small, large])!;

    const scale = clampScale({ x: 3, y: 3 }, [small, large], [50, 50], MAX_OBJECT_SIZE_WORLD);
    // The large note hits 20,000 first, so nothing goes past the same factor.
    expect(scale.x).toBeCloseTo(2, 6);
    expect(scale.y).toBeCloseTo(2, 6);

    const movedSmall = scaleWithin(small, box, {
      x: box.x,
      y: box.y,
      width: box.width * scale.x,
      height: box.height * scale.y,
    });
    const movedLarge = scaleWithin(large, box, {
      x: box.x,
      y: box.y,
      width: box.width * scale.x,
      height: box.height * scale.y,
    });
    expect(movedLarge.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
    expect(movedLarge.height).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
    // Relative layout is preserved: offsets and sizes all use the same factor.
    expect(movedSmall.width).toBeCloseTo(400, 6);
    expect(movedSmall.x).toBeCloseTo(box.x + (small.x - box.x) * 2, 6);
    expect(movedLarge.x).toBeCloseTo(box.x + (large.x - box.x) * 2, 6);
    expect(movedSmall.height).toBeCloseTo(movedSmall.width, 6);
  });

  it('clampScale respects each type own minimum, per axis', () => {
    const wide = rect(0, 0, 400, 100);
    const scale = clampScale({ x: 0.1, y: 5 }, [wide], [50], MAX_OBJECT_SIZE_WORLD);
    expect(scale.x).toBeCloseTo(50 / 400, 6);
    expect(scale.y).toBeCloseTo(5, 6);
  });

  it('clampScale ignores a nonsense request instead of producing NaN', () => {
    expect(clampScale({ x: Number.NaN, y: 1 }, [], [], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1,
      y: 1,
    });
    expect(clampScale({ x: 2, y: 2 }, [], [], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 2, y: 2 });
  });

  // TC-04
  it('TC-04 doubling the box width doubles each note and the gap between them', () => {
    const a = rect(0, 0, 200, 200);
    const b = rect(300, 0, 200, 200);
    const from = unionRects([a, b])!;
    expect(from).toEqual({ x: 0, y: 0, width: 500, height: 200 });

    // Sticky notes lock the ratio, so a box dragged to twice the width is also
    // twice as tall.
    const to = { x: 0, y: 0, width: 1_000, height: 400 };
    const resizedA = scaleWithin(a, from, to);
    const resizedB = scaleWithin(b, from, to);

    expect(resizedA.width).toBeCloseTo(400, 6);
    expect(resizedB.width).toBeCloseTo(400, 6);
    // Every note stayed square.
    expect(resizedA.height).toBeCloseTo(400, 6);
    expect(resizedB.height).toBeCloseTo(400, 6);
    expect(resizedB.x - (resizedA.x + resizedA.width)).toBeCloseTo(200, 6);
  });

  it('scaleWithin leaves a rect alone when the box did not change', () => {
    const child = rect(10, 10, 50, 50);
    const box = rect(0, 0, 100, 100);
    expect(scaleWithin(child, box, box)).toEqual(child);
  });
});

describe('sel.geometry_ops - error paths and defaults', () => {
  it('rectContains refuses a rect it cannot measure', () => {
    expect(rectContains(rect(0, 0, 100, 100), rect(Number.NaN, 0, 10, 10))).toBe(false);
    expect(rectContains(rect(0, 0, Number.POSITIVE_INFINITY, 100), rect(1, 1, 10, 10))).toBe(false);
    expect(unionRects([])).toBeNull();
    expect(unionRects([rect(0, 0, Number.NaN, 10)])).toBeNull();
  });

  it('normalizeRect works whichever way the pointer was dragged', () => {
    expect(normalizeRect({ x: 10, y: 40 }, { x: 30, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 20,
      height: 20,
    });
    expect(normalizeRect({ x: 30, y: 20 }, { x: 10, y: 40 })).toEqual({
      x: 10,
      y: 20,
      width: 20,
      height: 20,
    });
  });

  it('a drag that would turn a box inside out keeps a positive size', () => {
    const box = resizeRect(rect(0, 0, 200, 200), 'se', { x: -1_000, y: -1_000 }, false);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    // A locked ratio survives the same abuse.
    const locked = resizeRect(rect(0, 0, 200, 200), 'se', { x: -1_000, y: -1_000 }, true);
    expect(locked.width).toBeGreaterThan(0);
    expect(locked.width).toBeCloseTo(locked.height, 6);
  });

  it('a handle that is not a handle changes nothing', () => {
    expect(resizeRect(rect(0, 0, 100, 50), 'middle' as never, { x: 10, y: 10 }, false)).toEqual(
      rect(0, 0, 100, 50),
    );
  });

  it('a clamped scale is applied around the handle that was dragged', () => {
    // The gesture clamps the scale, then rebuilds the box from the same corner.
    const start = rect(0, 0, 200, 200);
    const clamped = clampScale({ x: 0.1, y: 0.1 }, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, 6);
    matchRect(resizeRectFromScale(start, 'nw', clamped), {
      x: 200 - STICKY_MIN_SIZE_WORLD,
      y: 200 - STICKY_MIN_SIZE_WORLD,
      width: STICKY_MIN_SIZE_WORLD,
      height: STICKY_MIN_SIZE_WORLD,
    });
  });
});
