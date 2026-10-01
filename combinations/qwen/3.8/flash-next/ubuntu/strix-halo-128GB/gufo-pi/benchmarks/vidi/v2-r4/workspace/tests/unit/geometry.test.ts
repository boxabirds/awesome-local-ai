import { describe, expect, it } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  type Rect,
} from '../../src/shared/geometry';

describe('geometry — rectContains', () => {
  it('TC-07 returns true for a rect fully inside', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const inner: Rect = { x: 10, y: 10, width: 50, height: 50 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('returns true when edges touch exactly', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const inner: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('returns false when partly outside', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const inner: Rect = { x: 50, y: 50, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it('returns false when entirely outside', () => {
    const outer: Rect = { x: 0, y: 0, width: 50, height: 50 };
    const inner: Rect = { x: 100, y: 100, width: 20, height: 20 };
    expect(rectContains(outer, inner)).toBe(false);
  });
});

describe('geometry — unionRects', () => {
  it('returns null for an empty array', () => {
    expect(unionRects([])).toBeNull();
  });

  it('returns the same rect for a single element', () => {
    const r: Rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(unionRects([r])).toEqual(r);
  });

  it('returns the bounding box of multiple rects', () => {
    const rects: Rect[] = [
      { x: 10, y: 10, width: 20, height: 20 },
      { x: 50, y: 60, width: 30, height: 40 },
    ];
    expect(unionRects(rects)).toEqual({ x: 10, y: 10, width: 70, height: 90 });
  });
});

describe('geometry — normalizeRect', () => {
  it('produces a positive rect from top-left to bottom-right', () => {
    const r = normalizeRect({ x: 10, y: 10 }, { x: 50, y: 60 });
    expect(r).toEqual({ x: 10, y: 10, width: 40, height: 50 });
  });

  it('handles reverse drag (bottom-right to top-left)', () => {
    const r = normalizeRect({ x: 50, y: 60 }, { x: 10, y: 10 });
    expect(r).toEqual({ x: 10, y: 10, width: 40, height: 50 });
  });
});

describe('geometry — resizeRect', () => {
  it('TC-01 se handle with aspectLocked: 200x200 + (100,40) → 300x300', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    // Aspect locked: the larger axis delta (x=100) drives; ratio stays 1:1
    expect(result.width).toBeCloseTo(300, 0);
    expect(result.height).toBeCloseTo(300, 0);
  });

  it('se handle without aspect lock changes both independently', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 50 }, false);
    expect(result.width).toBeCloseTo(300, 0);
    expect(result.height).toBeCloseTo(250, 0);
  });

  it('e handle only changes width', () => {
    const start: Rect = { x: 10, y: 10, width: 100, height: 80 };
    const result = resizeRect(start, 'e', { x: 50, y: 0 }, false);
    expect(result.width).toBeCloseTo(150, 0);
    expect(result.height).toBeCloseTo(80, 0);
    expect(result.x).toBeCloseTo(10, 0);
  });

  it('nw handle changes top-left, keeps bottom-right anchored', () => {
    const start: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const result = resizeRect(start, 'nw', { x: -20, y: -10 }, false);
    expect(result.x).toBeCloseTo(-20, 0);
    expect(result.y).toBeCloseTo(-10, 0);
    expect(result.width).toBeCloseTo(120, 0);
    expect(result.height).toBeCloseTo(110, 0);
  });
});

describe('geometry — clampScale', () => {
  it('TC-02 shrinks stop at STICKY_MIN_SIZE_WORLD (50)', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [50];
    // Try to scale down so width would be 200 * 0.2 = 40 (below 50)
    const result = clampScale({ x: 0.2, y: 0.2 }, rects, minSizes, 20_000);
    expect(result.x).toBeCloseTo(50 / 200, 6); // 0.25
    expect(result.y).toBeCloseTo(50 / 200, 6);
  });

  it('TC-03 clamps when first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 300, y: 0, width: 500, height: 500 },
    ];
    const minSizes = [50, 50];
    // Scale that would push the 500-wide object past 20000
    const result = clampScale({ x: 100, y: 100 }, rects, minSizes, 20_000);
    // 500 * s <= 20000 → s <= 40
    expect(result.x).toBeLessThanOrEqual(40);
    expect(result.y).toBeLessThanOrEqual(40);
    // Relative layout is preserved (same scale for both axes here)
    expect(result.x).toBe(result.y);
  });

  it('allows scaling when within bounds', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 100, height: 100 }];
    const minSizes = [50];
    const result = clampScale({ x: 2, y: 2 }, rects, minSizes, 20_000);
    expect(result.x).toBe(2);
    expect(result.y).toBe(2);
  });
});

describe('geometry — scaleWithin', () => {
  it('TC-04 two 200-unit notes 100 apart, box ×2 width → 400 wide, gap 200', () => {
    // Two notes each 200x200, 100 apart. Bounding box is 500x200.
    const noteA: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const noteB: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const bbox: Rect = { x: 0, y: 0, width: 500, height: 200 };
    // Resize box to 1000x200 (double width)
    const newBbox: Rect = { x: 0, y: 0, width: 1000, height: 200 };

    const scaledA = scaleWithin(noteA, bbox, newBbox);
    const scaledB = scaleWithin(noteB, bbox, newBbox);

    expect(scaledA.width).toBeCloseTo(400, 0);
    expect(scaledB.width).toBeCloseTo(400, 0);
    // Gap: noteB starts at 600, noteA ends at 400 → gap is 200
    expect(scaledB.x - (scaledA.x + scaledA.width)).toBeCloseTo(200, 0);
  });

  it('identity scale returns the same rect', () => {
    const child: Rect = { x: 10, y: 20, width: 30, height: 40 };
    const parent: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const result = scaleWithin(child, parent, parent);
    expect(result.x).toBeCloseTo(child.x, 6);
    expect(result.y).toBeCloseTo(child.y, 6);
    expect(result.width).toBeCloseTo(child.width, 6);
    expect(result.height).toBeCloseTo(child.height, 6);
  });
});
