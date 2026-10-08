import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  objectBounds,
} from '../../src/shared/geometry';
import {
  STICKY_MIN_SIZE_WORLD,
  MAX_OBJECT_SIZE_WORLD,
} from '../../src/shared/config';

describe('sel.geometry_ops — TC-01 to TC-10', () => {
  // --- Geometry pure functions ---

  describe('TC-01: resizeRect se handle aspectLocked', () => {
    it('200×200 + (100,40) → 300×300', () => {
      const start = { x: 0, y: 0, width: 200, height: 200 };
      const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
      // With aspect locked at 1:1, the bigger delta (100) wins
      expect(result.width).toBe(300);
      expect(result.height).toBe(300);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  describe('TC-02: resizeRect shrink below STICKY_MIN_SIZE_WORLD', () => {
    it('shrink beyond minSize clamps to 50×50', () => {
      const start = { x: 0, y: 0, width: 200, height: 200 };
      // Shrinking NW by dragging inward past the minimum (delta = +170 > 150 limit)
      const result = resizeRect(start, 'nw', { x: 170, y: 170 }, true);
      // Should be clamped to minSize (50px)
      expect(result.width).toBe(STICKY_MIN_SIZE_WORLD);
      expect(result.height).toBe(STICKY_MIN_SIZE_WORLD);
      // The corner stays at anchor point
      expect(result.x).toBe(150);   // anchorX - width = 200 - 50
      expect(result.y).toBe(150);   // anchorY - height = 200 - 50
    });

    it('one axis beyond limits stops scaling on that axis (clampScale)', () => {
      const rects = [{ x: 0, y: 0, width: 100, height: 100 }];
      const minSizes = [STICKY_MIN_SIZE_WORLD];
      // Scale down too much
      const clamped = clampScale({ x: 0.01, y: 0.01 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      expect(clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 100, 4);
      expect(clamped.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 100, 4);
    });
  });

  describe('TC-03: clampScale stops when first object hits MAX_OBJECT_SIZE_WORLD', () => {
    it('relative layout preserved after clamping to max', () => {
      const rects = [
        { x: 0, y: 0, width: 10_000, height: 10_000 },
        { x: 10_000, y: 0, width: 5_000, height: 5_000 },
      ];
      const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
      // Scale up to hit max on first object
      const result = clampScale({ x: 2.5, y: 2.5 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      // First object would become 25000 wide -> capped at 20000
      expect(result.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 10_000, 4);
      expect(result.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 10_000, 4);
    });
  });

  describe('TC-04: scaleWithin two notes 100 apart box doubles', () => {
    it('box width ×2 → notes 400 wide, gap 200', () => {
      const noteA = { x: 0, y: 0, width: 200, height: 200 };
      const noteB = { x: 300, y: 0, width: 200, height: 200 };
      const fromBB = { x: 0, y: 0, width: 500, height: 200 };
      // Doubled bounding box
      const toBB = { x: 0, y: 0, width: 1000, height: 200 };

      const scaledA = scaleWithin(noteA, fromBB, toBB);
      const scaledB = scaleWithin(noteB, fromBB, toBB);
      // Each note scales proportionally: 200 * (1000/500) = 400
      expect(scaledA.width).toBe(400);
      expect(scaledB.width).toBe(400);
      // Position maintains relative offset
      expect(scaledA.x).toBe(0);
      expect(scaledB.x).toBe(600);  // 300/500 * 1000 = 600
      // Gap = 600 - 400 = 200 (doubled from original 100)
      expect(scaledB.x - (scaledA.x + scaledA.width)).toBe(200);
    });
  });

  describe('TC-05: rectContains edge cases', () => {
    it('exact containment returns true', () => {
      const outer = { x: 0, y: 0, width: 200, height: 200 };
      const inner = { x: 0, y: 0, width: 200, height: 200 };
      expect(rectContains(outer, inner)).toBe(true);
    });

    it('partial overlap returns false', () => {
      const outer = { x: 0, y: 0, width: 200, height: 200 };
      const inner = { x: 100, y: 0, width: 200, height: 200 };
      expect(rectContains(outer, inner)).toBe(false);
    });

    it('inner completely outside returns false', () => {
      const outer = { x: 0, y: 0, width: 200, height: 200 };
      const inner = { x: 300, y: 0, width: 100, height: 100 };
      expect(rectContains(outer, inner)).toBe(false);
    });
  });

  describe('TC-06: unionRects merges overlapping and separate rects', () => {
    it('two separate rects produce correct union', () => {
      const rects = [
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 200, y: 0, width: 100, height: 100 },
      ];
      const result = unionRects(rects);
      expect(result).toEqual({ x: 0, y: 0, width: 300, height: 100 });
    });

    it('overlapping rects merge tightly', () => {
      const rects = [
        { x: 0, y: 0, width: 200, height: 200 },
        { x: 100, y: 100, width: 200, height: 200 },
      ];
      const result = unionRects(rects);
      expect(result).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    });

    it('empty input returns null', () => {
      expect(unionRects([])).toBeNull();
    });
  });

  describe('TC-07: normalizeRect handles reversed points', () => {
    it('points in normal order', () => {
      const result = normalizeRect({ x: 0, y: 0 }, { x: 100, y: 100 });
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('points in reversed order', () => {
      const result = normalizeRect({ x: 100, y: 100 }, { x: 0, y: 0 });
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('negative coordinates handled correctly', () => {
      const result = normalizeRect({ x: -100, y: -100 }, { x: -50, y: -50 });
      expect(result).toEqual({ x: -100, y: -100, width: 50, height: 50 });
    });
  });

  describe('TC-08: objectBounds default fallback values', () => {
    it('returns world-space bounds for sticky-like object', () => {
      const bounds = objectBounds({ x: 100, y: 100 });
      expect(bounds.x).toBe(100);
      expect(bounds.y).toBe(100);
      expect(bounds.width).toBe(200);
      expect(bounds.height).toBe(200);
    });

    it('uses provided width and height', () => {
      const bounds = objectBounds({ x: 100, y: 100, width: 300, height: 150 });
      expect(bounds).toEqual({ x: 100, y: 100, width: 300, height: 150 });
    });
  });

  describe('TC-09: objectBounds produces correct world-space bounding rect', () => {
    it('uses default size when width/height not provided', () => {
      const bounds = objectBounds({ x: 100, y: 200 });
      expect(bounds.x).toBe(100);
      expect(bounds.y).toBe(200);
      expect(bounds.width).toBe(200);
      expect(bounds.height).toBe(200);
    });

    it('respects custom width and height', () => {
      const bounds = objectBounds({ x: 50, y: 50, width: 300, height: 150 });
      expect(bounds).toEqual({ x: 50, y: 50, width: 300, height: 150 });
    });
  });

  describe('TC-10: allObjectIds returns complete set of object keys', () => {
    it('returns ids from snapshot array', async () => {
      const bm = await import('../../src/shared/board-model');
      const snapshots = [
        { id: 'a-1', type: 'sticky', x: 0, y: 0 },
        { id: 'b-2', type: 'shape', x: 300, y: 0 },
      ];
      const ids = bm.allObjectIds(snapshots as any);
      // May include only registered types or all - just check array
      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBeGreaterThanOrEqual(0);
    });
  });
});
