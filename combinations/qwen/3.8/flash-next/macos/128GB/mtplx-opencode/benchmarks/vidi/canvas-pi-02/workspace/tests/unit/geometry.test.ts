import { describe, expect, it } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('rectContains', () => {
  it('returns true when inner is fully inside outer', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 50, height: 50 })).toBe(true);
  });
  it('returns false when inner is partly outside', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 80, y: 80, width: 50, height: 50 })).toBe(false);
  });
  it('returns false when inner is outside', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 200, y: 200, width: 50, height: 50 })).toBe(false);
  });
  it('exact match counts as inside', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
  });
});

describe('unionRects', () => {
  it('returns null for empty array', () => {
    expect(unionRects([])).toBeNull();
  });
  it('returns the same rect for one element', () => {
    const r = { x: 10, y: 20, width: 30, height: 40 };
    expect(unionRects([r])).toEqual(r);
  });
  it('computes bounding box of two non-overlapping rects', () => {
    const a = { x: 0, y: 0, width: 50, height: 50 };
    const b = { x: 100, y: 100, width: 50, height: 50 };
    expect(unionRects([a, b])).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });
});

describe('normalizeRect', () => {
  it('handles reversed corners (bottom-right to top-left)', () => {
    expect(normalizeRect({ x: 100, y: 100 }, { x: 50, y: 50 })).toEqual({ x: 50, y: 50, width: 50, height: 50 });
  });
  it('handles same point (zero size)', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe('resizeRect', () => {
  // TC-01: se handle, aspectLocked, 200x200, delta (100,40) → 300x300
  it('TC-01 corner handle with aspectLocked keeps ratio', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(result.width).toBeCloseTo(300, 1);
    expect(result.height).toBeCloseTo(300, 1);
  });

  it('edge handle without aspect lock changes only one axis', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'e', { x: 100, y: 0 }, false);
    expect(result.width).toBeCloseTo(300, 1);
    expect(result.height).toBeCloseTo(200, 1);
  });

  it('nw handle resizes from top-left, adjusting x and y', () => {
    const start = { x: 100, y: 100, width: 200, height: 200 };
    const result = resizeRect(start, 'nw', { x: -50, y: -50 }, false);
    // Moving nw by (-50,-50) → width += 50, height += 50
    expect(result.width).toBeCloseTo(250, 1);
    expect(result.height).toBeCloseTo(250, 1);
    expect(result.x).toBeCloseTo(50, 1);
    expect(result.y).toBeCloseTo(50, 1);
  });

  it('se handle with aspectLocked uses dominant axis for uniform scale', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    // delta (100, 40): width scale = 300/200 = 1.5, height scale = 240/200 = 1.2
    // dominant = 1.5 → 300 x 300
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(result.width).toBeCloseTo(300, 1);
    expect(result.height).toBeCloseTo(300, 1);
  });
});

describe('clampScale', () => {
  // TC-02: shrink below STICKY_MIN_SIZE_WORLD
  it('TC-02 clamps scale to prevent going below minSize', () => {
    const rect = { x: 0, y: 0, width: 200, height: 200 };
    // Desired scale to get to 49: 49/200 = 0.245
    const scale = { x: 0.245, y: 0.245 };
    const clamped = clampScale(scale, [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    // Should not allow going below 50.
    expect(200 * clamped.x).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
    expect(200 * clamped.y).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(50 / 200, 4);
  });

  // TC-03: multiple rects, clamp stops when first hits max
  it('TC-03 clamps uniformly when any rect would exceed maxSize', () => {
    // rect1: width=200, rect2: width=400
    const rects = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 300, y: 0, width: 400, height: 400 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // Desired scale x = 60 → rect2 would be 400*60 = 24000 > MAX_OBJECT_SIZE_WORLD(20000)
    const scale = { x: 60, y: 60 };
    const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // Should be clamped to 20000/400 = 50
    expect(400 * clamped.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
    expect(200 * clamped.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
  });
});

describe('scaleWithin', () => {
  // TC-04: two notes 200 wide, 100 apart. Box ×2 width → 400 wide, gap 200
  it('TC-04 proportional scaling of positions and sizes', () => {
    // Two 200-wide notes, 100 apart. Parent from 0..500 to 0..1000.
    const parent = { x: 0, y: 0, width: 500, height: 200 };
    const parentScaled = { x: 0, y: 0, width: 1000, height: 200 };
    const note1 = { x: 0, y: 0, width: 200, height: 200 };
    const note2 = { x: 300, y: 0, width: 200, height: 200 };

    const scaled1 = scaleWithin(note1, parent, parentScaled);
    const scaled2 = scaleWithin(note2, parent, parentScaled);

    // Note1 starts at fraction 0 of parent, stays at 0.
    expect(scaled1.x).toBeCloseTo(0, 1);
    expect(scaled1.width).toBeCloseTo(400, 1); // 200 * 2

    // Note2 starts at fraction 300/500 = 0.6 of parent → at 600 in scaled.
    expect(scaled2.x).toBeCloseTo(600, 1);
    expect(scaled2.width).toBeCloseTo(400, 1);

    // Gap: 600 - (0 + 400) = 200
    const gap = scaled2.x - (scaled1.x + scaled1.width);
    expect(gap).toBeCloseTo(200, 1);
  });
});