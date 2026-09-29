import { describe, expect, it } from 'vitest';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import {
  clampScale,
  normalizeRect,
  pointInRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';

/**
 * Story 7 geometry unit tests (task 6, TC-01 to TC-04) plus the helper
 * functions the group operations build on (rectContains / unionRects /
 * normalizeRect / pointInRect boundaries).
 */

describe('resizeRect (TC-01, TC-24)', () => {
  const box: Rect = { x: 0, y: 0, width: 200, height: 200 };

  it('TC-01 se handle aspectLocked 200×200 + (100, 40) → 300×300', () => {
    // The drag-dominant axis (|100| > |40|) sets the single scale 1.5,
    // applied to both axes from the opposite (top-left) anchor.
    const r = resizeRect(box, 'se', { x: 100, y: 40 }, true);
    expect(r).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('TC-01 (minority axis) the minority axis sets the scale when it dominates', () => {
    const r = resizeRect(box, 'se', { x: 40, y: 100 }, true);
    expect(r).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('corner handle without aspect lock changes both axes independently', () => {
    const r = resizeRect(box, 'se', { x: 100, y: 40 }, false);
    expect(r).toEqual({ x: 0, y: 0, width: 300, height: 240 });
  });

  it('edge handle changes one axis only (dragging west right shrinks width, keeps height)', () => {
    const r = resizeRect(box, 'w', { x: 50, y: 30 }, false);
    expect(r).toEqual({ x: 50, y: 0, width: 150, height: 200 });
  });

  it('north-east handle anchors the bottom-left corner', () => {
    const r = resizeRect(box, 'ne', { x: 50, y: -50 }, true);
    expect(r).toEqual({ x: 0, y: -50, width: 250, height: 250 });
  });
});

describe('clampScale (TC-02, TC-03)', () => {
  it('TC-02 shrinking a 100×100 sticky below STICKY_MIN_SIZE_WORLD clamps to 50×50 (−1 and exact)', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 100, height: 100 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD]; // 50
    const minScale = STICKY_MIN_SIZE_WORLD / 100; // 0.5

    // Just below the limit (100 × 0.49 = 49 < 50) → clamped up to 0.5 → 50.
    const small = clampScale({ x: minScale - 0.01, y: minScale - 0.01 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(100 * small.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 9);
    expect(100 * small.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 9);

    // Exactly at the limit → unchanged (boundary).
    const exact = clampScale({ x: minScale, y: minScale }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(100 * exact.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 9);

    // Above the limit → unchanged.
    const above = clampScale({ x: minScale + 0.1, y: minScale + 0.1 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(above.x).toBeCloseTo(minScale + 0.1, 9);
  });

  it('TC-03 mixed rects: stops uniformly when the first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
    // A large (200) and a small (100) object. The large one hits the max
    // first (at scale 100), so the whole group stops there — uniformly.
    const rects: Rect[] = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 1000, y: 0, width: 100, height: 100 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    const clamped = clampScale({ x: 500, y: 1 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);

    // The large object reaches MAX exactly: 200 × 100 = 20000.
    expect(200 * clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
    expect(clamped.y).toBe(1); // the y axis was never a limit
    // The small object stays under the max (100 × 100 = 10000 < 20000).
    expect(100 * clamped.x).toBeLessThan(MAX_OBJECT_SIZE_WORLD);
  });

  it('TC-03 (layout) the clamped scale preserves the relative layout', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 100, height: 100 };
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    const from = unionRects([a, b])!;
    const clamped = clampScale({ x: 500, y: 1 }, [a, b], minSizes, MAX_OBJECT_SIZE_WORLD);
    const to: Rect = { x: from.x, y: from.y, width: from.width * clamped.x, height: from.height * clamped.y };
    // Both objects use the exact same scale → the 100-unit gap scales by it.
    const a2 = scaleWithin(a, from, to);
    const b2 = scaleWithin(b, from, to);
    const gap = b2.x - (a2.x + a2.width);
    expect(gap).toBeCloseTo(100 * clamped.x, 6);
  });

  it('non-finite or non-positive scale components degrade to 1 on that axis', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 100, height: 100 }];
    const clamped = clampScale({ x: Number.NaN, y: -3 }, rects, [10], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBe(1);
    expect(clamped.y).toBe(1);
  });
});

describe('scaleWithin (TC-04)', () => {
  it('TC-04 two 200-unit notes 100 apart, box ×2 width → 400 wide, gap 200', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 }; // gap 100
    const from = unionRects([a, b])!; // 0..500
    const to: Rect = { x: from.x, y: from.y, width: from.width * 2, height: from.height };

    const a2 = scaleWithin(a, from, to);
    const b2 = scaleWithin(b, from, to);
    expect(a2.width).toBe(400);
    expect(b2.width).toBe(400);
    expect(b2.x - (a2.x + a2.width)).toBe(200); // gap doubled
  });
});

describe('helper bounds (boundaries used by marquee / hitTest)', () => {
  const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };

  it('rectContains: fully inside, edge-touching, and partly outside', () => {
    expect(rectContains(outer, { x: 10, y: 10, width: 80, height: 80 })).toBe(true);
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true); // exact
    expect(rectContains(outer, { x: 99, y: 0, width: 1, height: 100 })).toBe(true); // touches right edge
    expect(rectContains(outer, { x: 50, y: 0, width: 60, height: 100 })).toBe(false); // partly out
    expect(rectContains(outer, { x: 100, y: 0, width: 10, height: 10 })).toBe(false); // outside
  });

  it('pointInRect includes edges and excludes 1 unit outside (TC-11 boundary)', () => {
    expect(pointInRect(outer, { x: 50, y: 50 })).toBe(true);
    expect(pointInRect(outer, { x: 100, y: 50 })).toBe(true); // on the edge
    expect(pointInRect(outer, { x: 101, y: 50 })).toBe(false); // 1 outside
    expect(pointInRect(outer, { x: -1, y: 50 })).toBe(false);
  });

  it('normalizeRect handles any drag direction', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 5, y: 20 })).toEqual({ x: 5, y: 10, width: 5, height: 10 });
    expect(normalizeRect({ x: 5, y: 20 }, { x: 10, y: 10 })).toEqual({ x: 5, y: 10, width: 5, height: 10 });
  });

  it('unionRects: empty → null; several rects span all', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: -5, width: 5, height: 30 }])).toEqual({
      x: 0,
      y: -5,
      width: 25,
      height: 30,
    });
  });
});
