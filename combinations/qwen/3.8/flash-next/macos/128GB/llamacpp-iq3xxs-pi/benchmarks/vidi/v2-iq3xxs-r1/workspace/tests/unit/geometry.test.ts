import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  type Rect,
  type Point,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('geometry', () => {
  describe('rectContains', () => {
    it('returns true when inner is fully inside outer', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 10, y: 10, width: 50, height: 50 };
      expect(rectContains(outer, inner)).toBe(true);
    });

    it('returns true when inner touches edges of outer (boundary)', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 0, y: 0, width: 100, height: 100 };
      expect(rectContains(outer, inner)).toBe(true);
    });

    it('returns false when inner is partly outside', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 50, y: 50, width: 100, height: 100 };
      expect(rectContains(outer, inner)).toBe(false);
    });

    it('returns false when inner is entirely outside', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 200, y: 200, width: 50, height: 50 };
      expect(rectContains(outer, inner)).toBe(false);
    });
  });

  describe('unionRects', () => {
    it('returns null for empty array', () => {
      expect(unionRects([])).toBeNull();
    });

    it('returns the single rect for one-element array', () => {
      const r: Rect = { x: 10, y: 20, width: 30, height: 40 };
      expect(unionRects([r])).toEqual(r);
    });

    it('encloses multiple rects', () => {
      const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const b: Rect = { x: 50, y: 50, width: 100, height: 100 };
      const u = unionRects([a, b]);
      expect(u).toEqual({ x: 0, y: 0, width: 150, height: 150 });
    });
  });

  describe('normalizeRect', () => {
    it('normalises reversed corners', () => {
      const a: Point = { x: 100, y: 100 };
      const b: Point = { x: 20, y: 30 };
      expect(normalizeRect(a, b)).toEqual({ x: 20, y: 30, width: 80, height: 70 });
    });
  });

  // TC-01: resizeRect se handle aspectLocked 200×200 + (100,40) → 300×300
  describe('resizeRect', () => {
    it('TC-01: se handle with aspectLocked keeps ratio', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
      // aspect locked: ratio was 1:1, width grew by 100 → height also grows by 100 → 300x300
      expect(result.width).toBeCloseTo(300);
      expect(result.height).toBeCloseTo(300);
    });

    it('se handle without aspect lock changes both axes independently', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const result = resizeRect(start, 'se', { x: 100, y: 40 }, false);
      expect(result.width).toBeCloseTo(300);
      expect(result.height).toBeCloseTo(240);
    });

    it('n handle changes y and height only', () => {
      const start: Rect = { x: 10, y: 10, width: 100, height: 100 };
      const result = resizeRect(start, 'n', { x: 0, y: -20 }, false);
      expect(result.y).toBeCloseTo(-10);
      expect(result.height).toBeCloseTo(120);
      expect(result.x).toBeCloseTo(10);
      expect(result.width).toBeCloseTo(100);
    });

    it('e handle changes width only', () => {
      const start: Rect = { x: 10, y: 10, width: 100, height: 100 };
      const result = resizeRect(start, 'e', { x: 50, y: 0 }, false);
      expect(result.width).toBeCloseTo(150);
      expect(result.height).toBeCloseTo(100);
    });

    it('w handle changes x and width', () => {
      const start: Rect = { x: 10, y: 10, width: 100, height: 100 };
      const result = resizeRect(start, 'w', { x: 20, y: 0 }, false);
      expect(result.x).toBeCloseTo(30);
      expect(result.width).toBeCloseTo(80);
      expect(result.height).toBeCloseTo(100);
    });
  });

  // TC-02: shrink below STICKY_MIN_SIZE_WORLD (−1 and exact) → clamped 50×50
  describe('clampScale', () => {
    it('TC-02: clamps scale when shrinking below minimum', () => {
      const rect: Rect = { x: 0, y: 0, width: 200, height: 200 };
      // Try to shrink to 49 (one below min)
      const scale = clampScale({ x: 49 / 200, y: 49 / 200 }, [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      const newW = rect.width * scale.x;
      const newH = rect.height * scale.y;
      expect(newW).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
      expect(newH).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
    });

    it('TC-02 boundary: exactly STICKY_MIN_SIZE_WORLD is allowed', () => {
      const rect: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const scale = clampScale({ x: 50 / 200, y: 50 / 200 }, [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      const newW = rect.width * scale.x;
      expect(newW).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
    });

    // TC-03: clampScale mixed rects: stops uniformly when first hits MAX_OBJECT_SIZE_WORLD
    it('TC-03: clamps to MAX_OBJECT_SIZE_WORLD uniformly', () => {
      const rectA: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const rectB: Rect = { x: 300, y: 0, width: 400, height: 400 };
      // Scale of 60 would make B's width 24000 > MAX (20000), but A's width would be 12000 < MAX
      const scale = clampScale({ x: 60, y: 60 }, [rectA, rectB], [50, 50], MAX_OBJECT_SIZE_WORLD);
      // B hits max first: 400 * scale = 20000 → scale = 50
      expect(scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 400);
      // Both get the same scale
      expect(rectA.width * scale.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
      expect(rectB.width * scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
      // Relative layout preserved
      expect(scale.x).toBeCloseTo(scale.y);
    });
  });

  // TC-04: two notes 200 units wide, 100 units apart, box width ×2 → 400 wide, gap 200
  describe('scaleWithin', () => {
    it('TC-04: two notes 100 apart, box ×2 → 400 wide, gap 200', () => {
      // Two 200-wide notes, 100 apart: first at x=0, second at x=300, union box is 0..500
      const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
      const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
      const noteA: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const noteB: Rect = { x: 300, y: 0, width: 200, height: 200 };
      const scaledA = scaleWithin(noteA, from, to);
      const scaledB = scaleWithin(noteB, from, to);
      // Widths: 200 * (1000/500) = 400
      expect(scaledA.width).toBeCloseTo(400);
      expect(scaledB.width).toBeCloseTo(400);
      // Gap: 300*(1000/500) - 400 = 200
      const gap = scaledB.x - (scaledA.x + scaledA.width);
      expect(gap).toBeCloseTo(200);
    });
  });
});
