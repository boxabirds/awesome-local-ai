import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
} from '../../src/shared/geometry';
import type { Rect, Handle } from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('geometry — rectContains', () => {
  it('TC-07: returns true when inner is fully inside outer', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const inner: Rect = { x: 10, y: 10, width: 50, height: 50 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('returns true when inner is flush with outer edges', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const inner: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('returns false when inner is partly outside', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const inner: Rect = { x: 50, y: 50, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it('returns false when inner touches from outside', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const inner: Rect = { x: -1, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(false);
  });
});

describe('geometry — unionRects', () => {
  it('returns null for empty array', () => {
    expect(unionRects([])).toBeNull();
  });

  it('returns the single rect for array of one', () => {
    const r: Rect = { x: 5, y: 10, width: 20, height: 30 };
    expect(unionRects([r])).toEqual(r);
  });

  it('returns bounding box of multiple rects', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 30, width: 15, height: 25 },
    ];
    expect(unionRects(rects)).toEqual({ x: 0, y: 0, width: 35, height: 55 });
  });
});

describe('geometry — normalizeRect', () => {
  it('produces positive width/height from top-left to bottom-right', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 50, y: 80 })).toEqual({
      x: 10, y: 20, width: 40, height: 60,
    });
  });

  it('produces positive width/height from bottom-right to top-left', () => {
    expect(normalizeRect({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      x: 10, y: 20, width: 40, height: 60,
    });
  });
});

describe('geometry — resizeRect', () => {
  it('TC-01: se handle with aspectLocked 200×200 + (100,40) → 300×300', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    // Aspect locked: ratio = 1. delta.x=100 > delta.y=40 so width drives: 200+100=300
    expect(result.width).toBeCloseTo(300);
    expect(result.height).toBeCloseTo(300);
    // Anchor is top-left (se handle → anchor is top-left of start)
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  it('e handle changes width only (no aspect)', () => {
    const start: Rect = { x: 10, y: 10, width: 100, height: 200 };
    const result = resizeRect(start, 'e', { x: 50, y: 0 }, false);
    expect(result.x).toBe(10);
    expect(result.y).toBe(10);
    expect(result.width).toBe(150);
    expect(result.height).toBe(200);
  });

  it('nw handle moves top-left corner (anchor is bottom-right)', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const result = resizeRect(start, 'nw', { x: -20, y: -30 }, false);
    expect(result.x).toBe(80);
    expect(result.y).toBe(70);
    expect(result.width).toBe(220);
    expect(result.height).toBe(230);
  });

  it('TC-02: corner handle aspect-locked, shrink below min → clamped via clampScale', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    // Shrink by 160 in both directions → 40×40, below min 50
    const result = resizeRect(start, 'se', { x: -160, y: -160 }, true);
    expect(result.width).toBeCloseTo(40);
    expect(result.height).toBeCloseTo(40);
    // clampScale will prevent this from being applied
    const clamped = clampScale(
      { x: result.width / start.width, y: result.height / start.height },
      [start],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200);
    expect(clamped.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200);
  });
});

describe('geometry — clampScale', () => {
  it('TC-02: clamps scale so object does not go below minSize', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD]; // 50
    const result = clampScale({ x: 0.1, y: 0.1 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // min scale = 50/200 = 0.25
    expect(result.x).toBeCloseTo(0.25);
    expect(result.y).toBeCloseTo(0.25);
  });

  it('TC-02 boundary: scale exactly at minSize is not clamped', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD]; // 50
    const result = clampScale({ x: 0.25, y: 0.25 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(result.x).toBeCloseTo(0.25);
    expect(result.y).toBeCloseTo(0.25);
  });

  it('TC-03: stops uniformly when first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
    // Two objects: one 100 wide, one 200 wide
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 0, width: 200, height: 200 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // Proposed scale: 150x → first object would be 15000, second would be 30000 > max
    const result = clampScale({ x: 150, y: 150 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // maxSx = min(20000/100, 20000/200) = min(200, 100) = 100
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(100); // same for height
  });

  it('TC-03: relative layout preserved when clamped', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 50, width: 200, height: 200 },
    ];
    const minSizes = [50, 50];
    const scale = clampScale({ x: 50, y: 50 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // Apply clamped scale to each object: sizes should not exceed max
    for (const r of rects) {
      expect(r.width * scale.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
      expect(r.height * scale.y).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
    }
  });
});

describe('geometry — scaleWithin', () => {
  it('TC-04: two 200-unit notes 100 apart, box width ×2 → 400 wide, gap 200', () => {
    // Bounding box of two notes: first at x=0, second at x=300 (200 width + 100 gap)
    const bbox: Rect = { x: 0, y: 0, width: 500, height: 200 }; // 0..500 total
    // Resize to 1000 wide (×2)
    const newBbox: Rect = { x: 0, y: 0, width: 1000, height: 200 };

    const noteA: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const noteB: Rect = { x: 300, y: 0, width: 200, height: 200 };

    const scaledA = scaleWithin(noteA, bbox, newBbox);
    const scaledB = scaleWithin(noteB, bbox, newBbox);

    expect(scaledA.width).toBeCloseTo(400);
    expect(scaledB.width).toBeCloseTo(400);
    // Gap between them: 100 * 2 = 200
    const gap = scaledB.x - (scaledA.x + scaledA.width);
    expect(gap).toBeCloseTo(200);
  });

  it('maps child proportionally within the new rect', () => {
    const from: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const to: Rect = { x: 10, y: 10, width: 200, height: 300 };
    const child: Rect = { x: 25, y: 50, width: 50, height: 50 };
    const result = scaleWithin(child, from, to);
    // x: 10 + (25-0) * 2 = 60, y: 10 + (50-0) * 3 = 160
    expect(result.x).toBeCloseTo(60);
    expect(result.y).toBeCloseTo(160);
    expect(result.width).toBeCloseTo(100);
    expect(result.height).toBeCloseTo(150);
  });
});
