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
  scaleRectAbout,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';

const NOTE: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };

function near(actual: number, expected: number, tolerance = 1e-9): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

/** Box equality at board precision: scaling is floating-point maths. */
function expectRect(actual: Rect, expected: Rect): void {
  expect(near(actual.x, expected.x)).toBe(true);
  expect(near(actual.y, expected.y)).toBe(true);
  expect(near(actual.width, expected.width)).toBe(true);
  expect(near(actual.height, expected.height)).toBe(true);
}

describe('geometry — rectContains', () => {
  it('accepts an object fully inside and one exactly on the edges', () => {
    const outer: Rect = { x: 0, y: 0, width: 500, height: 500 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    // Touching from the inside is still inside.
    expect(rectContains(outer, { x: 0, y: 0, width: 500, height: 500 })).toBe(true);
  });

  it('rejects an object that is only partly inside, or touches from outside', () => {
    const outer: Rect = { x: 0, y: 0, width: 500, height: 500 };
    expect(rectContains(outer, { x: 490, y: 10, width: 100, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: 500, y: 0, width: 100, height: 100 })).toBe(false);
    expect(rectContains(outer, { x: -1, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('rejects non-finite input rather than throwing', () => {
    expect(rectContains(NOTE, { x: NaN, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe('geometry — unionRects and normalizeRect', () => {
  it('unions several rectangles, and returns null for none', () => {
    expect(unionRects([])).toBeNull();
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: -50, width: 100, height: 100 };
    expect(unionRects([a, b])).toEqual({ x: 0, y: -50, width: 400, height: 250 });
  });

  it('normalizes two drag corners in any order', () => {
    expect(normalizeRect({ x: 10, y: 30 }, { x: 50, y: 90 })).toEqual({
      x: 10,
      y: 30,
      width: 40,
      height: 60,
    });
    expect(normalizeRect({ x: 50, y: 90 }, { x: 10, y: 30 })).toEqual({
      x: 10,
      y: 30,
      width: 40,
      height: 60,
    });
    expect(normalizeRect({ x: 7, y: 7 }, { x: 7, y: 7 })).toEqual({
      x: 7,
      y: 7,
      width: 0,
      height: 0,
    });
  });
});

describe('geometry — resizeRect', () => {
  it('TC-01: the south-east corner with the ratio locked grows both axes', () => {
    const result = resizeRect(NOTE, 'se', { x: 100, y: 40 }, true);
    expect(result.width).toBeCloseTo(300, 6);
    expect(result.height).toBeCloseTo(300, 6);
    // Anchored on the opposite corner: the top-left does not move.
    expect(result.x).toBeCloseTo(0, 6);
    expect(result.y).toBeCloseTo(0, 6);
  });

  it('an edge handle moves one axis only when the ratio is free', () => {
    expectRect(resizeRect(NOTE, 'e', { x: 50, y: 0 }, false), {
      x: 0,
      y: 0,
      width: 250,
      height: 200,
    });
    // Dragging the west edge 50 to the right shrinks it; the east edge holds.
    expectRect(resizeRect(NOTE, 'w', { x: 50, y: 0 }, false), {
      x: 50,
      y: 0,
      width: 150,
      height: 200,
    });
    expectRect(resizeRect(NOTE, 'w', { x: -50, y: 0 }, false), {
      x: -50,
      y: 0,
      width: 250,
      height: 200,
    });
    expectRect(resizeRect(NOTE, 'n', { x: 0, y: -20 }, false), {
      x: 0,
      y: -20,
      width: 200,
      height: 220,
    });
    // The north-west corner moves both axes and anchors the bottom-right.
    expectRect(resizeRect(NOTE, 'nw', { x: -100, y: 20 }, false), {
      x: -100,
      y: 20,
      width: 300,
      height: 180,
    });
  });

  it('an edge handle with the ratio locked scales the other axis around the centre', () => {
    const result = resizeRect(NOTE, 'e', { x: 100, y: 0 }, true);
    expect(result.width).toBeCloseTo(300, 6);
    expect(result.height).toBeCloseTo(300, 6);
    expect(result.x).toBeCloseTo(0, 6);
    expect(result.y).toBeCloseTo(-50, 6);
  });

  it('shrinking from the north-west corner anchors the bottom-right', () => {
    expectRect(resizeRect(NOTE, 'nw', { x: 50, y: 50 }, false), {
      x: 50,
      y: 50,
      width: 150,
      height: 150,
    });
  });

  it('a resize never flips through zero, and non-finite input is ignored', () => {
    const flattened = resizeRect(NOTE, 'e', { x: -400, y: 0 }, false);
    expect(flattened.width).toBe(0);
    expect(near(resizeRect(NOTE, 'se', { x: NaN, y: 10 }, false).width, 200)).toBe(true);
  });
});

describe('geometry — scaleRectAbout', () => {
  it('places the resized box by the handle it was dragged from', () => {
    expectRect(scaleRectAbout(NOTE, 'se', { x: 2, y: 1 }), {
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    });
    expectRect(scaleRectAbout(NOTE, 'nw', { x: 2, y: 2 }), {
      x: -200,
      y: -200,
      width: 400,
      height: 400,
    });
    expectRect(scaleRectAbout(NOTE, 'n', { x: 1, y: 0.5 }), {
      x: 0,
      y: 100,
      width: 200,
      height: 100,
    });
  });
});

describe('geometry — clampScale', () => {
  it('TC-02: a shrink to one unit below the minimum is clamped to the minimum', () => {
    const below = STICKY_MIN_SIZE_WORLD - 1; // 49: the boundary
    const requested = { x: below / STICKY_SIZE_WORLD, y: below / STICKY_SIZE_WORLD };
    const clamped = clampScale(requested, [NOTE], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, 9);
    expect(clamped.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, 9);
    const box = scaleRectAbout(NOTE, 'se', clamped);
    expect(box.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(box.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);

    // Exactly the minimum is allowed through untouched.
    const exact = { x: STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, y: 0.25 };
    const allowed = clampScale(exact, [NOTE], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(allowed.x).toBeCloseTo(0.25, 9);
    expect(allowed.y).toBeCloseTo(0.25, 9);
  });

  it('TC-03: growth stops for the whole selection when the first object reaches the maximum', () => {
    const wide: Rect = { x: 300, y: 0, width: 400, height: 200 };
    const minSizes = [STICKY_MIN_SIZE_WORLD, 10];
    const requested = { x: 60, y: 60 };
    const clamped = clampScale(
      requested,
      [NOTE, wide],
      minSizes,
      MAX_OBJECT_SIZE_WORLD,
    );
    // The 400-unit object reaches 20 000 first, and both axes stop with it.
    expect(clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 400, 6);
    expect(clamped.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 400, 6);
    // Applied to the selection, no object crosses the limit and the layout holds.
    const to = scaleRectAbout({ x: 0, y: 0, width: 500, height: 200 }, 'se', clamped);
    const scaled = [NOTE, wide].map((rect) => scaleWithin(rect, { x: 0, y: 0, width: 500, height: 200 }, to));
    for (const rect of scaled) {
      expect(rect.width).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-6);
      expect(rect.height).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-6);
    }
    expect(scaled[1]!.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 3);
    // Relative layout: the second note's left edge sits at its old offset, scaled.
    expect(scaled[1]!.x).toBeCloseTo(300 * clamped.x, 3);
    expect(scaled[1]!.y).toBeCloseTo(0, 6);
  });

  it('a per-axis request is clamped per axis and an unconstrained request passes through', () => {
    // The west edge only: the height must be left alone.
    const clamped = clampScale({ x: 0.1, y: 1 }, [NOTE], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, 9);
    expect(clamped.y).toBeCloseTo(1, 9);
    // No rectangles at all: nothing to clamp against.
    expect(clampScale({ x: 1234, y: 2 }, [], [], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1234, y: 2 });
    // A non-finite request means "no resize".
    expect(clampScale({ x: NaN, y: 1 }, [NOTE], [50], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1,
      y: 1,
    });
  });
});

describe('geometry — scaleWithin', () => {
  it('TC-04: doubling the box doubles each object and each gap between them', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    const scaledA = scaleWithin(a, from, to);
    const scaledB = scaleWithin(b, from, to);
    expect(scaledA.width).toBeCloseTo(400, 6);
    expect(scaledB.width).toBeCloseTo(400, 6);
    expect(scaledB.x - (scaledA.x + scaledA.width)).toBeCloseTo(200, 6);
  });

  it('a box with no width leaves the child alone instead of dividing by zero', () => {
    const child: Rect = { x: 10, y: 10, width: 20, height: 20 };
    expect(
      scaleWithin(child, { x: 0, y: 0, width: 0, height: 100 }, { x: 0, y: 0, width: 100, height: 100 }),
    ).toEqual(child);
  });
});
