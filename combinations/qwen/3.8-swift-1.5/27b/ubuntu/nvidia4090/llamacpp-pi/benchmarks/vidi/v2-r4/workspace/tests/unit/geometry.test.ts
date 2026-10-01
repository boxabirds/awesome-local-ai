import { describe, it, expect } from 'vitest';
import {
  Rect,
  Point,
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('geometry.ts unit tests', () => {
  // TC-01: resizeRect se handle, aspectLocked: 200×200 + delta(100,40) → 300×300
  it('TC-01: resizeRect with se handle and aspectLocked keeps square', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const delta: Point = { x: 100, y: 40 };
    const result = resizeRect(start, 'se', delta, true);
    expect(result.width).toBe(300);
    expect(result.height).toBe(300);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  // TC-02: shrink below STICKY_MIN_SIZE_WORLD → clamped 50×50
  it('TC-02: resizeRect shrink below min size is clamped by clampScale', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    // Try to shrink to 49×49 (below min of 50)
    const delta: Point = { x: -151, y: -151 };
    const rawResult = resizeRect(start, 'se', delta, true);

    // The raw resize would give 49×49, but clampScale should prevent this
    const scale = { x: rawResult.width / start.width, y: rawResult.height / start.height };
    const clamped = clampScale(scale, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);

    const finalWidth = start.width * clamped.x;
    const finalHeight = start.height * clamped.y;
    expect(finalWidth).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
    expect(finalHeight).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
  });

  // TC-02 boundary: exactly at min size is allowed
  it('TC-02 boundary: resize to exactly STICKY_MIN_SIZE_WORLD is allowed', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const scale = { x: STICKY_MIN_SIZE_WORLD / start.width, y: STICKY_MIN_SIZE_WORLD / start.height };
    const clamped = clampScale(scale, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / start.width);
    expect(clamped.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / start.height);
  });

  // TC-03: clampScale stops uniformly when first object would exceed MAX_OBJECT_SIZE_WORLD
  it('TC-03: clampScale stops all objects when first hits max size', () => {
    // Two objects: one small (100×100), one large (1000×1000)
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 200, y: 0, width: 1000, height: 1000 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];

    // Try to scale by 30x: small → 3000, large → 30000 (exceeds max 20000)
    const scale = { x: 30, y: 30 };
    const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);

    // The large object (1000) would hit max at scale 20, so clamped scale should be 20
    expect(clamped.x).toBeCloseTo(20);
    expect(clamped.y).toBeCloseTo(20);

    // Verify relative layout is preserved (both scaled by same factor)
    const smallFinal = 100 * clamped.x;
    const largeFinal = 1000 * clamped.x;
    expect(smallFinal).toBeCloseTo(2000);
    expect(largeFinal).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
  });

  // TC-04: two 200-unit notes 100 apart, box width ×2 → 400 wide, gap 200
  it('TC-04: scaleWithin scales position and size proportionally', () => {
    // Note A at x=0, width=200; Note B at x=300, width=200
    // Bounding box: x=0, width=500
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 }; // width ×2

    const noteA: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const noteB: Rect = { x: 300, y: 0, width: 200, height: 200 };

    const scaledA = scaleWithin(noteA, from, to);
    const scaledB = scaleWithin(noteB, from, to);

    // Note A: width 400, x=0
    expect(scaledA.width).toBeCloseTo(400);
    expect(scaledA.x).toBeCloseTo(0);

    // Note B: width 400, x=600
    expect(scaledB.width).toBeCloseTo(400);
    expect(scaledB.x).toBeCloseTo(600);

    // Gap between A and B: 600 - (0+400) = 200
    const gap = scaledB.x - (scaledA.x + scaledA.width);
    expect(gap).toBeCloseTo(200);
  });

  // TC-07: objectsInRect: A fully inside, B partly, C outside → [A]
  it('TC-07: rectContains only for fully contained rects', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };

    // A: fully inside
    const a: Rect = { x: 10, y: 10, width: 50, height: 50 };
    expect(rectContains(outer, a)).toBe(true);

    // B: partly inside (extends beyond right edge)
    const b: Rect = { x: 50, y: 10, width: 80, height: 50 };
    expect(rectContains(outer, b)).toBe(false);

    // C: outside
    const c: Rect = { x: 200, y: 200, width: 50, height: 50 };
    expect(rectContains(outer, c)).toBe(false);

    // D: touching edge from outside (left edge at -1)
    const d: Rect = { x: -1, y: 10, width: 50, height: 50 };
    expect(rectContains(outer, d)).toBe(false);

    // E: exactly filling the outer (all edges match)
    const e: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, e)).toBe(true);
  });

  // Additional: unionRects
  it('unionRects returns bounding box of all rects', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 50, width: 100, height: 100 },
    ];
    const result = unionRects(rects);
    expect(result).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });

  it('unionRects returns null for empty array', () => {
    expect(unionRects([])).toBeNull();
  });

  // Additional: normalizeRect
  it('normalizeRect returns positive width/height from two points', () => {
    const a: Point = { x: 100, y: 100 };
    const b: Point = { x: 0, y: 0 };
    const result = normalizeRect(a, b);
    expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  // Additional: resizeRect without aspect lock
  it('resizeRect without aspect lock changes only the dragged axis', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 100 };

    // East handle: only width changes
    const eResult = resizeRect(start, 'e', { x: 50, y: 0 }, false);
    expect(eResult.width).toBe(250);
    expect(eResult.height).toBe(100);

    // South handle: only height changes
    const sResult = resizeRect(start, 's', { x: 0, y: 30 }, false);
    expect(sResult.width).toBe(200);
    expect(sResult.height).toBe(130);
  });

  // Additional: resizeRect with nw handle
  it('resizeRect with nw handle moves x and y', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const result = resizeRect(start, 'nw', { x: 50, y: 30 }, false);
    expect(result.x).toBe(150);
    expect(result.y).toBe(130);
    expect(result.width).toBe(150);
    expect(result.height).toBe(170);
  });
});
