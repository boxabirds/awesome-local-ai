import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
} from '../../src/shared/geometry';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('geometry — rectContains', () => {
  it('returns true when inner is fully inside outer', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const inner = { x: 10, y: 10, width: 50, height: 50 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('returns true when inner touches outer edges exactly', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const inner = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('returns false when inner overflows on any side', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: -1, y: 0, width: 50, height: 50 })).toBe(false);
    expect(rectContains(outer, { x: 0, y: -1, width: 50, height: 50 })).toBe(false);
    expect(rectContains(outer, { x: 0, y: 0, width: 101, height: 50 })).toBe(false);
    expect(rectContains(outer, { x: 0, y: 0, width: 50, height: 101 })).toBe(false);
  });
});

describe('geometry — unionRects', () => {
  it('returns null for empty input', () => {
    expect(unionRects([])).toBeNull();
  });

  it('returns the same rect for a single rect', () => {
    const r = { x: 10, y: 20, width: 30, height: 40 };
    expect(unionRects([r])).toEqual(r);
  });

  it('computes the bounding box of multiple rects', () => {
    const rects = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 50, width: 100, height: 100 },
      { x: -10, y: 200, width: 50, height: 50 },
    ];
    expect(unionRects(rects)).toEqual({ x: -10, y: 0, width: 160, height: 250 });
  });
});

describe('geometry — normalizeRect', () => {
  it('normalizes points dragged in any direction', () => {
    expect(normalizeRect({ x: 100, y: 200 }, { x: 50, y: 80 })).toEqual({
      x: 50, y: 80, width: 50, height: 120,
    });
    expect(normalizeRect({ x: 50, y: 80 }, { x: 100, y: 200 })).toEqual({
      x: 50, y: 80, width: 50, height: 120,
    });
  });

  it('returns zero-size rect for same point', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe('geometry — resizeRect (TC-01)', () => {
  it('TC-01: se handle, aspectLocked, 200x200 + delta(100,40) → 300x300', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    // aspect locked: dominant scale is scaleX = 300/200 = 1.5
    // so height also becomes 200 * 1.5 = 300
    expect(result.width).toBeCloseTo(300, 6);
    expect(result.height).toBeCloseTo(300, 6);
    expect(result.x).toBeCloseTo(0, 6);
    expect(result.y).toBeCloseTo(0, 6);
  });

  it('se handle without aspect lock changes width and height independently', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, false);
    expect(result.width).toBeCloseTo(300, 6);
    expect(result.height).toBeCloseTo(240, 6);
  });

  it('e handle changes width only', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'e', { x: 50, y: 0 }, false);
    expect(result.width).toBeCloseTo(250, 6);
    expect(result.height).toBeCloseTo(200, 6);
    expect(result.x).toBeCloseTo(0, 6);
    expect(result.y).toBeCloseTo(0, 6);
  });

  it('nw handle moves x and y, shrinks from top-left', () => {
    const start = { x: 100, y: 100, width: 200, height: 200 };
    const result = resizeRect(start, 'nw', { x: 20, y: 30 }, false);
    expect(result.x).toBeCloseTo(120, 6);
    expect(result.y).toBeCloseTo(130, 6);
    expect(result.width).toBeCloseTo(180, 6);
    expect(result.height).toBeCloseTo(170, 6);
  });

  it('n handle changes height from top, y shifts', () => {
    const start = { x: 10, y: 10, width: 100, height: 100 };
    const result = resizeRect(start, 'n', { x: 0, y: 20 }, false);
    expect(result.y).toBeCloseTo(30, 6);
    expect(result.height).toBeCloseTo(80, 6);
    expect(result.x).toBeCloseTo(10, 6);
    expect(result.width).toBeCloseTo(100, 6);
  });
});

describe('geometry — clampScale (TC-02, TC-03)', () => {
  it('TC-02: shrink below STICKY_MIN_SIZE_WORLD is clamped', () => {
    // A 200x200 sticky; try to scale to below 50
    const rects = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD]; // 50
    // scale that would make width = 49 → 49/200 = 0.245
    const desired = { x: 49 / 200, y: 49 / 200 };
    const clamped = clampScale(desired, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x * 200).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(clamped.y * 200).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
  });

  it('TC-02 boundary: exactly at min size is allowed', () => {
    const rects = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    const desired = { x: 50 / 200, y: 50 / 200 };
    const clamped = clampScale(desired, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(50 / 200, 10);
    expect(clamped.y).toBeCloseTo(50 / 200, 10);
  });

  it('TC-03: clampScale stops uniformly when first object exceeds MAX_OBJECT_SIZE_WORLD', () => {
    const rects = [
      { x: 0, y: 0, width: 1000, height: 1000 },
      { x: 2000, y: 2000, width: 200, height: 200 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // Scale that would make the first rect 21000 wide (exceeds MAX_OBJECT_SIZE_WORLD=20000)
    const desired = { x: 21, y: 21 };
    const clamped = clampScale(desired, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // First rect: 1000 * scaleX <= 20000 → scaleX <= 20
    expect(clamped.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD / 1000 + 1e-9);
    expect(clamped.y).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD / 1000 + 1e-9);
    // The clamped scale applied to both rects: none exceeds max
    expect(1000 * clamped.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-6);
    expect(200 * clamped.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-6);
  });

  it('TC-03: relative layout is preserved by uniform clamp', () => {
    const rects = [
      { x: 0, y: 0, width: 5000, height: 5000 },
      { x: 10000, y: 10000, width: 4000, height: 4000 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // Scale 5 would make first = 25000 > 20000
    const desired = { x: 5, y: 5 };
    const clamped = clampScale(desired, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // Clamped so first stays <= 20000: scale <= 4
    expect(clamped.x).toBeLessThanOrEqual(20000 / 5000 + 1e-9);
    // Both should be the same (uniform clamp uses the most restrictive)
    expect(clamped.x).toBeCloseTo(clamped.y, 10);
  });
});

describe('geometry — scaleWithin (TC-04)', () => {
  it('TC-04: two 200-unit notes 100 apart, box ×2 width → 400 wide, gap 200', () => {
    // Two notes: A at (0,0) 200x200, B at (300,0) 200x200 → gap=100 between them
    const noteA = { x: 0, y: 0, width: 200, height: 200 };
    const noteB = { x: 300, y: 0, width: 200, height: 200 };
    const from = { x: 0, y: 0, width: 500, height: 200 }; // union: x0..500
    // Double the width: to box is 1000 wide
    const to = { x: 0, y: 0, width: 1000, height: 200 };

    const scaledA = scaleWithin(noteA, from, to);
    const scaledB = scaleWithin(noteB, from, to);

    // Each note should be 400 wide (200 * 1000/500 = 400)
    expect(scaledA.width).toBeCloseTo(400, 6);
    expect(scaledB.width).toBeCloseTo(400, 6);

    // Gap: B.x - (A.x + A.width) = (0 + 300*2) - (0 + 400) = 600 - 400 = 200
    const gap = scaledB.x - (scaledA.x + scaledA.width);
    expect(gap).toBeCloseTo(200, 6);
  });
});
