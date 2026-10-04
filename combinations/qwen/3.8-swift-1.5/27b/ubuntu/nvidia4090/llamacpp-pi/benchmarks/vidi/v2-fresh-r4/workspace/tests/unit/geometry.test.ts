import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  type Rect,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('geometry', () => {
  describe('rectContains', () => {
    it('returns true when inner is fully inside outer', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 10, y: 10, width: 50, height: 50 };
      expect(rectContains(outer, inner)).toBe(true);
    });

    it('returns true when inner touches outer edges (fully inside)', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 0, y: 0, width: 100, height: 100 };
      expect(rectContains(outer, inner)).toBe(true);
    });

    it('returns false when inner is partly outside', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 50, y: 50, width: 80, height: 80 };
      expect(rectContains(outer, inner)).toBe(false);
    });

    it('returns false when inner is completely outside', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 200, y: 200, width: 50, height: 50 };
      expect(rectContains(outer, inner)).toBe(false);
    });
  });

  describe('unionRects', () => {
    it('returns null for empty list', () => {
      expect(unionRects([])).toBeNull();
    });

    it('returns single rect for one element', () => {
      const r: Rect = { x: 10, y: 20, width: 100, height: 50 };
      expect(unionRects([r])).toEqual(r);
    });

    it('computes bounding box of multiple rects', () => {
      const r1: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const r2: Rect = { x: 50, y: 50, width: 100, height: 100 };
      expect(unionRects([r1, r2])).toEqual({ x: 0, y: 0, width: 150, height: 150 });
    });
  });

  describe('normalizeRect', () => {
    it('handles a < b', () => {
      expect(normalizeRect({ x: 10, y: 20 }, { x: 50, y: 60 })).toEqual({
        x: 10, y: 20, width: 40, height: 40,
      });
    });

    it('handles b < a (negative direction)', () => {
      expect(normalizeRect({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({
        x: 10, y: 20, width: 40, height: 40,
      });
    });
  });

  // TC-01
  describe('resizeRect', () => {
    it('TC-01: se handle aspectLocked 200x200 + (100,40) → 300x300', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
      expect(result.width).toBe(300);
      expect(result.height).toBe(300);
    });

    it('edge handle e changes width only', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
      const result = resizeRect(start, 'e', { x: 50, y: 0 }, false);
      expect(result.width).toBe(250);
      expect(result.height).toBe(100);
    });

    it('edge handle n changes height only (moves top edge down)', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
      const result = resizeRect(start, 'n', { x: 0, y: 30 }, false);
      expect(result.y).toBe(30);
      expect(result.height).toBe(70);
      expect(result.width).toBe(200);
    });

    it('nw handle moves both left and top edges', () => {
      const start: Rect = { x: 100, y: 100, width: 200, height: 200 };
      const result = resizeRect(start, 'nw', { x: -50, y: -30 }, false);
      expect(result.x).toBe(50);
      expect(result.y).toBe(70);
      expect(result.width).toBe(250);
      expect(result.height).toBe(230);
    });
  });

  // TC-02
  describe('clampScale', () => {
    it('TC-02: shrink below STICKY_MIN_SIZE_WORLD → clamped', () => {
      const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
      const minSizes = [STICKY_MIN_SIZE_WORLD];
      // Scale that would make it 49x49 (below min of 50)
      const scale = { x: 49 / 200, y: 49 / 200 };
      const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      expect(clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200);
      expect(clamped.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200);
    });

    it('exact minimum is allowed', () => {
      const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
      const minSizes = [STICKY_MIN_SIZE_WORLD];
      const scale = { x: STICKY_MIN_SIZE_WORLD / 200, y: STICKY_MIN_SIZE_WORLD / 200 };
      const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      expect(clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200);
      expect(clamped.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200);
    });
  });

  // TC-03
  it('TC-03: clampScale mixed rects stops uniformly when first hits max', () => {
    // Two rects: one small (100x100), one large (15000x15000)
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 200, y: 0, width: 15000, height: 15000 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // Scale of 2x would make the large one 30000 (exceeds MAX_OBJECT_SIZE_WORLD=20000)
    const scale = { x: 2, y: 2 };
    const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // The large rect limits: 20000/15000 = 1.333...
    expect(clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 15000);
    expect(clamped.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 15000);
  });

  // TC-04
  describe('scaleWithin', () => {
    it('TC-04: two 200-unit notes 100 apart, box width x2 → 400 wide, gap 200', () => {
      // Two notes: first at x=0, second at x=300 (200 wide + 100 gap)
      const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
      const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };

      const child1: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const child2: Rect = { x: 300, y: 0, width: 200, height: 200 };

      const scaled1 = scaleWithin(child1, from, to);
      const scaled2 = scaleWithin(child2, from, to);

      expect(scaled1.width).toBe(400);
      expect(scaled1.height).toBe(200);
      expect(scaled2.width).toBe(400);
      expect(scaled2.height).toBe(200);

      // Gap: scaled2.x - (scaled1.x + scaled1.width) = 600 - 400 = 200
      const gap = scaled2.x - (scaled1.x + scaled1.width);
      expect(gap).toBe(200);
    });
  });
});
