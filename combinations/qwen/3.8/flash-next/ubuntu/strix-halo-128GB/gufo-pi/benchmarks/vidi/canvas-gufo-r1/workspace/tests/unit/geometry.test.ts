import { describe, expect, it } from 'vitest';
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

    it('returns true when inner matches outer exactly', () => {
      const r: Rect = { x: 5, y: 5, width: 50, height: 50 };
      expect(rectContains(r, { ...r })).toBe(true);
    });

    it('returns false when inner extends past right edge', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 10, y: 10, width: 100, height: 50 };
      expect(rectContains(outer, inner)).toBe(false);
    });

    it('returns false when inner extends past bottom edge', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 10, y: 10, width: 50, height: 100 };
      expect(rectContains(outer, inner)).toBe(false);
    });

    it('returns false when inner starts outside left edge', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: -5, y: 10, width: 50, height: 50 };
      expect(rectContains(outer, inner)).toBe(false);
    });
  });

  describe('unionRects', () => {
    it('returns null for empty list', () => {
      expect(unionRects([])).toBeNull();
    });

    it('returns the single rect for a list of one', () => {
      const r: Rect = { x: 10, y: 20, width: 30, height: 40 };
      expect(unionRects([r])).toEqual(r);
    });

    it('returns bounding box of multiple rects', () => {
      const rects: Rect[] = [
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 50, y: 50, width: 100, height: 100 },
      ];
      expect(unionRects(rects)).toEqual({ x: 0, y: 0, width: 150, height: 150 });
    });
  });

  describe('normalizeRect', () => {
    it('normalizes two points to a positive rect', () => {
      const result = normalizeRect({ x: 100, y: 200 }, { x: 50, y: 80 });
      expect(result).toEqual({ x: 50, y: 80, width: 50, height: 120 });
    });

    it('handles same point (zero-size rect)', () => {
      const result = normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 });
      expect(result).toEqual({ x: 5, y: 5, width: 0, height: 0 });
    });
  });

  // TC-01: resizeRect se handle, aspectLocked 200×200 + (100,40) → 300×300
  describe('TC-01 resizeRect se corner with aspectLocked', () => {
    it('keeps ratio when aspectLocked: 200x200 + (100,40) → 300x300', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const delta: Point = { x: 100, y: 40 };
      const result = resizeRect(start, 'se', delta, true);
      // aspect locked: scale from larger axis change (sx = 300/200 = 1.5)
      expect(result.width).toBeCloseTo(300);
      expect(result.height).toBeCloseTo(300);
    });
  });

  // TC-02: shrink below STICKY_MIN_SIZE_WORLD → clamped 50×50
  describe('TC-02 clampScale for minimum size', () => {
    it('clamps scale so object does not go below STICKY_MIN_SIZE_WORLD', () => {
      const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
      const minSizes = [STICKY_MIN_SIZE_WORLD];
      // Want to scale down to width 49 (below minimum)
      const desiredScale: Point = { x: 49 / 200, y: 49 / 200 };
      const result = clampScale(desiredScale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      expect(result.x * 200).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
      expect(result.y * 200).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
    });

    it('allows exactly STICKY_MIN_SIZE_WORLD', () => {
      const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
      const minSizes = [STICKY_MIN_SIZE_WORLD];
      const desiredScale: Point = { x: 50 / 200, y: 50 / 200 };
      const result = clampScale(desiredScale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      expect(result.x * 200).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
      expect(result.y * 200).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
    });

    it('clamps at exactly STICKY_MIN_SIZE_WORLD - 1 (boundary, should clamp)', () => {
      const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
      const minSizes = [STICKY_MIN_SIZE_WORLD];
      const desiredScale: Point = { x: 49.99 / 200, y: 49.99 / 200 };
      const result = clampScale(desiredScale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      expect(result.x * 200).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 0.01);
    });
  });

  // TC-03: clampScale stops uniformly when first object would exceed MAX_OBJECT_SIZE_WORLD
  describe('TC-03 clampScale stops at MAX_OBJECT_SIZE_WORLD', () => {
    it('uniformly clamps when first object would exceed max', () => {
      const rects: Rect[] = [
        { x: 0, y: 0, width: 10000, height: 10000 },
        { x: 0, y: 0, width: 5000, height: 5000 },
      ];
      const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
      // Scale that would make first rect exceed max
      const desiredScale: Point = { x: 2.5, y: 2.5 }; // 10000*2.5 = 25000 > 20000
      const result = clampScale(desiredScale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      expect(result.x * 10000).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
      expect(result.y * 10000).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
      // Second object also scaled: relative layout preserved
      expect(result.x).toBeCloseTo(result.y);
    });
  });

  // TC-04: two 200-unit notes 100 apart, scaleWithin box ×2 width → 400 wide, gap 200
  describe('TC-04 scaleWithin doubles sizes and gaps', () => {
    it('scales child positions and sizes proportionally', () => {
      const from: Rect = { x: 0, y: 0, width: 500, height: 200 }; // bounding box
      const to: Rect = { x: 0, y: 0, width: 1000, height: 400 }; // ×2
      const noteA: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const noteB: Rect = { x: 300, y: 0, width: 200, height: 200 };

      const scaledA = scaleWithin(noteA, from, to);
      const scaledB = scaleWithin(noteB, from, to);

      // Each note should be 400 wide (200*2)
      expect(scaledA.width).toBeCloseTo(400);
      expect(scaledB.width).toBeCloseTo(400);

      // Gap should be 200 (originally 100, ×2)
      const gap = scaledB.x - (scaledA.x + scaledA.width);
      expect(gap).toBeCloseTo(200);
    });
  });

  describe('resizeRect edge handles', () => {
    it('e handle changes width only', () => {
      const start: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const result = resizeRect(start, 'e', { x: 50, y: 0 }, false);
      expect(result.width).toBeCloseTo(150);
      expect(result.height).toBeCloseTo(100);
    });

    it('n handle changes height and y', () => {
      const start: Rect = { x: 10, y: 10, width: 100, height: 100 };
      const result = resizeRect(start, 'n', { x: 0, y: -30 }, false);
      expect(result.height).toBeCloseTo(130);
      expect(result.y).toBeCloseTo(-20);
    });
  });
});
