import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('geometry — rectContains', () => {
  it('fully inside returns true', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const inner = { x: 10, y: 10, width: 50, height: 50 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('touching from inside returns true', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const inner = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('partly outside returns false', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const inner = { x: 50, y: 50, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it('touching edge from outside returns false', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const touching = { x: 100, y: 0, width: 50, height: 50 };
    expect(rectContains(outer, touching)).toBe(false);
  });
});

describe('geometry — unionRects', () => {
  it('empty array returns null', () => {
    expect(unionRects([])).toBeNull();
  });

  it('single rect returns itself', () => {
    const r = { x: 10, y: 20, width: 30, height: 40 };
    expect(unionRects([r])).toEqual(r);
  });

  it('two rects returns enclosing rect', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 200, y: 200, width: 100, height: 100 };
    expect(unionRects([a, b])).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });
});

describe('geometry — normalizeRect', () => {
  it('top-left to bottom-right', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 50, y: 50 })).toEqual({ x: 10, y: 10, width: 40, height: 40 });
  });

  it('bottom-right to top-left', () => {
    expect(normalizeRect({ x: 50, y: 50 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 40, height: 40 });
  });

  it('same point returns zero-size rect', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe('geometry — resizeRect (TC-01)', () => {
  it('TC-01: se handle, aspect locked: 200x200 + (100,40) → 300x300', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    // Aspect locked (ratio 1:1). Dominant axis: dx=100, dy=40 → dx wins → width=300, height=300
    expect(result.width).toBe(300);
    expect(result.height).toBe(300);
    // Anchor is top-left (opposite of se)
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('se handle without aspect lock: 200x200 + (100,40) → 300x240', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, false);
    expect(result.width).toBe(300);
    expect(result.height).toBe(240);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('nw handle: resizes from bottom-right anchor', () => {
    const start = { x: 100, y: 100, width: 200, height: 200 };
    const result = resizeRect(start, 'nw', { x: -50, y: -30 }, false);
    expect(result.x).toBe(50);
    expect(result.y).toBe(70);
    expect(result.width).toBe(250);
    expect(result.height).toBe(230);
  });

  it('e handle changes width only', () => {
    const start = { x: 0, y: 0, width: 200, height: 100 };
    const result = resizeRect(start, 'e', { x: 50, y: 0 }, false);
    expect(result.width).toBe(250);
    expect(result.height).toBe(100);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('e handle with aspect lock: width change forces height', () => {
    const start = { x: 0, y: 0, width: 200, height: 100 };
    const result = resizeRect(start, 'e', { x: 200, y: 0 }, true);
    // Ratio = 2:1, new width = 400, new height = 200
    expect(result.width).toBe(400);
    expect(result.height).toBe(200);
  });
});

describe('geometry — clampScale (TC-02, TC-03)', () => {
  it('TC-02: shrink below STICKY_MIN_SIZE_WORLD is clamped to min', () => {
    // A 200x200 rect; scale to get width < 50
    const rects = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD]; // 50
    // Scale that would make width = 49 (< 50): scaleX = 49/200 = 0.245
    const scale = { x: 49 / 200, y: 49 / 200 };
    const result = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // Should be clamped to 50/200 = 0.25
    expect(result.x).toBeCloseTo(50 / 200, 10);
    expect(result.y).toBeCloseTo(50 / 200, 10);
    // Verify: new size = 200 * 0.25 = 50
    expect(200 * result.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 10);
  });

  it('TC-02 boundary: exactly min size is allowed', () => {
    const rects = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    const scale = { x: 50 / 200, y: 50 / 200 };
    const result = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(result.x).toBeCloseTo(50 / 200, 10);
  });

  it('TC-03: clampScale stops uniformly when first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
    // Two rects: one small (100x100), one large (19900x19900)
    // Scale that would make the large one exceed 20000: scaleX > 20000/19900
    const rects = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 200, y: 0, width: 19900, height: 19900 },
    ];
    const minSizes = [50, 50];
    const scale = { x: 20100 / 19900, y: 20100 / 19900 };
    const result = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // The second object hits max first: clamped to 20000/19900
    expect(result.x).toBeCloseTo(20000 / 19900, 10);
    expect(result.y).toBeCloseTo(20000 / 19900, 10);
    // First object at this scale: 100 * 20000/19900 ≈ 100.5 < 20000 ✓
    expect(100 * result.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
  });
});

describe('geometry — scaleWithin (TC-04)', () => {
  it('TC-04: two notes 200 units wide, 100 apart; box doubled → each 400 wide, gap 200', () => {
    // Two sticky notes at x=0 and x=300 (gap of 100 between them)
    const note1 = { x: 0, y: 0, width: 200, height: 200 };
    const note2 = { x: 300, y: 0, width: 200, height: 200 };
    // Bounding box of selection
    const from = { x: 0, y: 0, width: 500, height: 200 }; // covers both notes (0 to 500)
    // Double the width
    const to = { x: 0, y: 0, width: 1000, height: 200 };

    const scaled1 = scaleWithin(note1, from, to);
    const scaled2 = scaleWithin(note2, from, to);

    // Scale factor X = 1000/500 = 2
    expect(scaled1.width).toBe(400);
    expect(scaled2.width).toBe(400);
    // Gap: note2 starts at to.x + (300-0)*2 = 600, note1 ends at 0+400=400, gap = 200
    expect(scaled2.x - (scaled1.x + scaled1.width)).toBe(200);
  });
});
