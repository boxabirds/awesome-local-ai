/**
 * Story 7, sel.geometry_ops — pure geometry (TC-01 to TC-04).
 *
 * The resize pipeline is: resizeRect (bounding box) → clampScale (per-type
 * min sizes + MAX_OBJECT_SIZE_WORLD) → scaleWithin (per object).
 */
import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  type Rect,
} from 'src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from 'src/shared/config';

/** resizeRect → clampScale → scaleWithin, the gesture's per-frame pipeline. */
function applyResize(
  start: Rect,
  handle: Parameters<typeof resizeRect>[1],
  delta: { x: number; y: number },
  aspectLocked: boolean,
  objects: readonly Rect[],
  minSizes: readonly number[],
): Rect[] {
  const box = resizeRect(start, handle, delta, aspectLocked);
  const scale = clampScale(
    { x: box.width / start.width, y: box.height / start.height },
    objects,
    minSizes,
    MAX_OBJECT_SIZE_WORLD,
  );
  const clampedBox: Rect = {
    x: box.x,
    y: box.y,
    width: start.width * scale.x,
    height: start.height * scale.y,
  };
  return objects.map((o) => scaleWithin(o, start, clampedBox));
}

describe('geometry: rectContains / unionRects / normalizeRect', () => {
  it('rectContains: fully inside is true, touching is true, partly inside is false, outside is false', () => {
    const outer: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(rectContains(outer, { x: 10, y: 10, width: 100, height: 100 })).toBe(true);
    // Touching the edges still counts as fully inside (marquee boundary).
    expect(rectContains(outer, { x: 0, y: 0, width: 200, height: 200 })).toBe(true);
    expect(rectContains(outer, { x: 190, y: 0, width: 100, height: 100 })).toBe(false);
    expect(rectContains(outer, { x: 201, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectContains(outer, { x: -1, y: 0, width: 10, height: 10 })).toBe(false);
    // Non-finite input never contains.
    expect(rectContains(outer, { x: NaN, y: 0, width: 1, height: 1 })).toBe(false);
  });

  it('unionRects: smallest enclosing rect, null for empty', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 0, y: 0, width: 100, height: 50 }])).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(
      unionRects([
        { x: 0, y: 0, width: 100, height: 50 },
        { x: 30, y: -20, width: 40, height: 30 },
        { x: 200, y: 10, width: 10, height: 10 },
      ]),
    ).toEqual({ x: 0, y: -20, width: 210, height: 70 });
  });

  it('normalizeRect: order-independent, non-negative size', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: -5, y: 5 })).toEqual({ x: -5, y: 5, width: 15, height: 15 });
    expect(normalizeRect({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('geometry: resizeRect + clampScale + scaleWithin (TC-01 to TC-04)', () => {
  it('TC-01: se handle, aspect locked, 200×200 + delta (100,40) → 300×300', () => {
    const box = resizeRect({ x: 0, y: 0, width: 200, height: 200 }, 'se', { x: 100, y: 40 }, true);
    // Width drives the scale (100 → 300); height follows the locked ratio.
    expect(box).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('TC-02: shrink to STICKY_MIN_SIZE_WORLD − 1 and exactly → clamped 50×50 (boundary)', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const note: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const minSize = STICKY_MIN_SIZE_WORLD; // 50

    // Drag past the limit: box would be 49×49 (STICKY_MIN_SIZE_WORLD − 1).
    const past = applyResize(start, 'se', { x: -151, y: -151 }, true, [note], [minSize]);
    expect(past[0].width).toBe(minSize);
    expect(past[0].height).toBe(minSize);

    // Drag exactly to the limit: box is 50×50 — allowed, not clamped down.
    const exact = applyResize(start, 'se', { x: -150, y: -150 }, true, [note], [minSize]);
    expect(exact[0].width).toBe(minSize);
    expect(exact[0].height).toBe(minSize);

    // Drag further: still stopped at the limit.
    const further = applyResize(start, 'se', { x: -300, y: -300 }, true, [note], [minSize]);
    expect(further[0].width).toBe(minSize);
    expect(further[0].height).toBe(minSize);
  });

  it('TC-03: clampScale stops every object uniformly when the first hits MAX_OBJECT_SIZE_WORLD; relative layout preserved', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 50 };
    const b: Rect = { x: 150, y: 0, width: 150, height: 150 };
    const box: Rect = { x: 0, y: 0, width: 300, height: 150 };

    const scale = clampScale({ x: 200, y: 200 }, [a, b], [0, 0], MAX_OBJECT_SIZE_WORLD);
    // b would reach 30 000 wide; the uniform scale stops at 20 000 / 150.
    expect(scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 150);
    expect(scale.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 150);

    const clampedBox: Rect = {
      x: box.x,
      y: box.y,
      width: box.width * scale.x,
      height: box.height * scale.y,
    };
    const aScaled = scaleWithin(a, box, clampedBox);
    const bScaled = scaleWithin(b, box, clampedBox);

    // b sits exactly at the max; a is below it.
    expect(bScaled.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
    expect(bScaled.height).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
    expect(aScaled.width).toBeLessThan(MAX_OBJECT_SIZE_WORLD);
    // Relative layout: a stays left of b, gap scaled by the same factor.
    expect(aScaled.x).toBeLessThan(bScaled.x);
    expect(bScaled.x - (aScaled.x + aScaled.width)).toBeCloseTo(50 * scale.x);
  });

  it('TC-04: two 200-unit notes 100 apart, box width ×2 → each 400 wide, gap 200 (square)', () => {
    const start: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const note1: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const note2: Rect = { x: 300, y: 0, width: 200, height: 200 };

    const [s1, s2] = applyResize(start, 'se', { x: 500, y: 500 }, true, [note1, note2], [
      STICKY_MIN_SIZE_WORLD,
      STICKY_MIN_SIZE_WORLD,
    ]);

    expect(s1).toEqual({ x: 0, y: 0, width: 400, height: 400 });
    expect(s2.x).toBe(600);
    expect(s2.width).toBe(400);
    expect(s2.height).toBe(400); // sticky notes stay square
    expect(s2.x - (s1.x + s1.width)).toBe(200); // gap doubled
  });
});
