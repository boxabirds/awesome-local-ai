// tests/unit/geometry.test.ts
// TC-01 to TC-04: geometry operations

import { describe, it, expect } from 'vitest';
import {
  Rect,
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('sel.geometry_ops (unit)', () => {
  // TC-01: resizeRect se handle aspectLocked 200×200 + (100,40) → 300×300
  describe('TC-01: resizeRect corner aspectLocked', () => {
    it('se handle aspectLocked: 200x200 + (100,40) → 300x300', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
      expect(result.width).toBe(300);
      expect(result.height).toBe(300);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  // TC-02: shrink below STICKY_MIN_SIZE_WORLD → clamped
  describe('TC-02: size limits (boundary)', () => {
    it('shrink below STICKY_MIN_SIZE_WORLD - 1 → clamped to min', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      // Try to shrink to 49 (below min of 50)
      const scale = { sx: 49 / 200, sy: 49 / 200 };
      const clamped = clampScale(scale, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      const newW = start.width * clamped.sx;
      const newH = start.height * clamped.sy;
      expect(newW).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
      expect(newH).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
    });

    it('shrink to exactly STICKY_MIN_SIZE_WORLD → allowed', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const scale = { sx: STICKY_MIN_SIZE_WORLD / 200, sy: STICKY_MIN_SIZE_WORLD / 200 };
      const clamped = clampScale(scale, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      const newW = start.width * clamped.sx;
      expect(newW).toBe(STICKY_MIN_SIZE_WORLD);
    });
  });

  // TC-03: clampScale mixed rects: stops uniformly when first object would exceed MAX
  describe('TC-03: clampScale mixed sizes', () => {
    it('stops uniformly when first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
      const rects: Rect[] = [
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 200, y: 0, width: 50, height: 50 },
      ];
      const minSizes = [50, 50];
      // Scale that would make the 50x50 rect exceed MAX
      const scale = { sx: (MAX_OBJECT_SIZE_WORLD + 1) / 50, sy: (MAX_OBJECT_SIZE_WORLD + 1) / 50 };
      const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      // The 50x50 rect should be exactly at MAX
      const newW = rects[1].width * clamped.sx;
      expect(newW).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
      // The 100x100 rect should also be within limits
      const newW0 = rects[0].width * clamped.sx;
      expect(newW0).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
      // Relative layout preserved (same scale applied)
      expect(clamped.sx).toBe(clamped.sy);
    });
  });

  // TC-04: two 200-unit notes 100 apart, box width ×2 → 400 wide, gap 200
  describe('TC-04: scaleWithin proportionality', () => {
    it('two notes 100 apart, box ×2 width → 400 wide, gap 200', () => {
      // Note A at x=0, width=200; Note B at x=300, width=200
      // Bounding box: x=0, width=500
      const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
      const to: Rect = { x: 0, y: 0, width: 1000, height: 400 };

      const noteA: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const noteB: Rect = { x: 300, y: 0, width: 200, height: 200 };

      const scaledA = scaleWithin(noteA, from, to);
      const scaledB = scaleWithin(noteB, from, to);

      expect(scaledA.width).toBe(400);
      expect(scaledA.height).toBe(400);
      expect(scaledB.width).toBe(400);
      expect(scaledB.height).toBe(400);

      // Gap: was 100 (300 - 200), now should be 200
      const gap = scaledB.x - (scaledA.x + scaledA.width);
      expect(gap).toBe(200);
    });
  });

  // Additional geometry tests
  describe('rectContains', () => {
    it('true when inner is fully inside outer', () => {
      expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 50, height: 50 })).toBe(true);
    });
    it('true when inner equals outer', () => {
      expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    });
    it('false when inner extends beyond outer', () => {
      expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50, width: 80, height: 80 })).toBe(false);
    });
    it('false when inner is outside', () => {
      expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 200, y: 200, width: 50, height: 50 })).toBe(false);
    });
  });

  describe('unionRects', () => {
    it('returns null for empty array', () => {
      expect(unionRects([])).toBeNull();
    });
    it('returns single rect for one element', () => {
      expect(unionRects([{ x: 10, y: 20, width: 100, height: 50 }])).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    });
    it('computes correct bounding box', () => {
      expect(unionRects([
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 50, y: 50, width: 100, height: 100 },
      ])).toEqual({ x: 0, y: 0, width: 150, height: 150 });
    });
  });

  describe('normalizeRect', () => {
    it('handles a < b', () => {
      expect(normalizeRect({ x: 10, y: 20 }, { x: 110, y: 120 })).toEqual({ x: 10, y: 20, width: 100, height: 100 });
    });
    it('handles a > b (negative drag)', () => {
      expect(normalizeRect({ x: 110, y: 120 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 100, height: 100 });
    });
  });

  describe('resizeRect edge handles', () => {
    it('e handle changes width only', () => {
      const start: Rect = { x: 0, y: 0, width: 100, height: 50 };
      const result = resizeRect(start, 'e', { x: 30, y: 10 }, false);
      expect(result.width).toBe(130);
      expect(result.height).toBe(50);
      expect(result.x).toBe(0);
    });
    it('n handle changes height only (moves y)', () => {
      const start: Rect = { x: 0, y: 0, width: 100, height: 50 };
      const result = resizeRect(start, 'n', { x: 10, y: -20 }, false);
      expect(result.height).toBe(70);
      expect(result.width).toBe(100);
      expect(result.y).toBe(-20);
    });
  });
});
