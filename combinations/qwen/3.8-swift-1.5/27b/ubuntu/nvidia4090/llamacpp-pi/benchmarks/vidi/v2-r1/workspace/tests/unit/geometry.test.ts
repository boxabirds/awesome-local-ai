import { describe, it, expect } from 'vitest';
import {
  type Rect,
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
} from '@shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD, STICKY_SIZE_WORLD } from '@shared/config';

describe('sel.geometry_ops (geometry.ts)', () => {
  describe('rectContains', () => {
    it('is true when inner is fully inside outer', () => {
      const outer: Rect = { x: 0, y: 0, width: 400, height: 400 };
      const inner: Rect = { x: 50, y: 60, width: 100, height: 80 };
      expect(rectContains(outer, inner)).toBe(true);
    });

    it('is false when inner is only partly inside (negative)', () => {
      const outer: Rect = { x: 0, y: 0, width: 400, height: 400 };
      const inner: Rect = { x: 350, y: 0, width: 100, height: 100 };
      expect(rectContains(outer, inner)).toBe(false);
    });

    it('is false when inner is outside', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 200, y: 0, width: 100, height: 100 };
      expect(rectContains(outer, inner)).toBe(false);
    });

    it('is false when inner touches the outer edge (boundary)', () => {
      const outer: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const touching: Rect = { x: 0, y: 0, width: 100, height: 100 };
      expect(rectContains(outer, touching)).toBe(false);
    });

    it('is false for non-finite values', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: NaN, y: 0, width: 50, height: 50 };
      expect(rectContains(outer, inner)).toBe(false);
    });
  });

  describe('unionRects', () => {
    it('returns the bounding box of all rects', () => {
      const rects: Rect[] = [
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 150, y: 50, width: 80, height: 120 },
      ];
      expect(unionRects(rects)).toEqual({ x: 0, y: 0, width: 230, height: 170 });
    });

    it('returns null for an empty list', () => {
      expect(unionRects([])).toBeNull();
    });

    it('handles a single rect', () => {
      const one: Rect = { x: 5, y: 6, width: 10, height: 20 };
      expect(unionRects([one])).toEqual(one);
    });
  });

  describe('normalizeRect', () => {
    it('produces a rect with non-negative size from two points', () => {
      expect(normalizeRect({ x: 100, y: 50 }, { x: 40, y: 90 })).toEqual({
        x: 40, y: 50, width: 60, height: 40,
      });
    });

    it('handles identical points (zero size)', () => {
      expect(normalizeRect({ x: 10, y: 20 }, { x: 10, y: 20 })).toEqual({
        x: 10, y: 20, width: 0, height: 0,
      });
    });
  });

  describe('resizeRect', () => {
    // TC-01: se handle, aspectLocked, 200×200 + (100,40) → 300×300
    it('TC-01: se handle with aspectLocked keeps the ratio (200×200 + (100,40) → 300×300)', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
      expect(result).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    });

    it('se handle without aspect lock changes both axes independently', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const result = resizeRect(start, 'se', { x: 100, y: 40 }, false);
      expect(result).toEqual({ x: 0, y: 0, width: 300, height: 240 });
    });

    it('nw handle resizes from the bottom-right anchor', () => {
      const start: Rect = { x: 100, y: 100, width: 200, height: 200 };
      // drag top-left corner by (-50, -25)
      const result = resizeRect(start, 'nw', { x: -50, y: -25 }, false);
      expect(result).toEqual({ x: 50, y: 75, width: 250, height: 225 });
    });

    it('e handle changes width only (x anchored at left edge)', () => {
      const start: Rect = { x: 10, y: 20, width: 100, height: 50 };
      const result = resizeRect(start, 'e', { x: 30, y: 999 }, false);
      expect(result).toEqual({ x: 10, y: 20, width: 130, height: 50 });
    });

    it('w handle changes width only (anchored at right edge)', () => {
      const start: Rect = { x: 10, y: 20, width: 100, height: 50 };
      const result = resizeRect(start, 'w', { x: 30, y: 999 }, false);
      expect(result).toEqual({ x: 40, y: 20, width: 70, height: 50 });
    });

    it('n handle changes height only (anchored at bottom edge)', () => {
      const start: Rect = { x: 10, y: 20, width: 100, height: 50 };
      const result = resizeRect(start, 'n', { x: 999, y: 15 }, false);
      expect(result).toEqual({ x: 10, y: 35, width: 100, height: 35 });
    });

    it('s handle changes height only (anchored at top edge)', () => {
      const start: Rect = { x: 10, y: 20, width: 100, height: 50 };
      const result = resizeRect(start, 's', { x: 999, y: 15 }, false);
      expect(result).toEqual({ x: 10, y: 20, width: 100, height: 65 });
    });

    it('aspect-locked edge handle keeps the ratio and stays centred on the fixed axis', () => {
      const start: Rect = { x: 0, y: 0, width: 100, height: 50 };
      // e handle: width 100 → 200, height must scale ×2 and stay vertically centred
      const result = resizeRect(start, 'e', { x: 100, y: 0 }, true);
      // height 50 → 100, centred on the original middle (y 0..50 → mid 25)
      expect(result).toEqual({ x: 0, y: -25, width: 200, height: 100 });
    });

    it('does not grow past zero size (clamps at the opposite anchor)', () => {
      const start: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const result = resizeRect(start, 'se', { x: -500, y: -500 }, false);
      expect(result.width).toBeGreaterThanOrEqual(0);
      expect(result.height).toBeGreaterThanOrEqual(0);
    });

    it('returns the start rect for non-finite input (error path)', () => {
      const start: Rect = { x: 0, y: 0, width: 100, height: 100 };
      expect(resizeRect(start, 'se', { x: NaN, y: 0 }, false)).toEqual(start);
      expect(resizeRect({ x: NaN, y: 0, width: 100, height: 100 }, 'se', { x: 1, y: 1 }, false)).toEqual(start);
    });
  });

  describe('clampScale', () => {
    // TC-02: shrink to STICKY_MIN_SIZE_WORLD − 1 → clamped to exactly the min
    it('TC-02: shrink below STICKY_MIN_SIZE_WORLD is clamped to exactly the min (boundary)', () => {
      const rect: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
      // −1: scale to 49 → clamped to 50
      const below = clampScale(
        { x: (STICKY_MIN_SIZE_WORLD - 1) / STICKY_SIZE_WORLD, y: (STICKY_MIN_SIZE_WORLD - 1) / STICKY_SIZE_WORLD },
        [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD,
      );
      expect(STICKY_SIZE_WORLD * below.x).toBe(STICKY_MIN_SIZE_WORLD);
      expect(STICKY_SIZE_WORLD * below.y).toBe(STICKY_MIN_SIZE_WORLD);

      // exact: scale to exactly 50 → unchanged
      const exact = clampScale(
        { x: STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, y: STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD },
        [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD,
      );
      expect(STICKY_SIZE_WORLD * exact.x).toBe(STICKY_MIN_SIZE_WORLD);
      expect(STICKY_SIZE_WORLD * exact.y).toBe(STICKY_MIN_SIZE_WORLD);
    });

    // TC-03: mixed rects stop uniformly when the first object would exceed MAX_OBJECT_SIZE_WORLD
    it('TC-03: growing stops uniformly when the first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
      const rects: Rect[] = [
        { x: 0, y: 0, width: 200, height: 100 },   // would reach 40,000 wide at scale 200
        { x: 300, y: 0, width: 100, height: 100 }, // would reach 20,000 wide at scale 200
      ];
      const clamped = clampScale({ x: 200, y: 1 }, rects, [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      // The limiting object is the 200-wide one: scale x = 20,000 / 200 = 100
      expect(clamped.x).toBe(MAX_OBJECT_SIZE_WORLD / 200);
      expect(clamped.y).toBe(1);
      // No object may exceed the max at the clamped scale
      for (const r of rects) {
        expect(r.width * clamped.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
      }
      // Relative layout preserved: scaleWithin keeps proportions
      const from: Rect = { x: 0, y: 0, width: 400, height: 100 };
      const to: Rect = { x: 0, y: 0, width: 400 * clamped.x, height: 100 * clamped.y };
      const a = scaleWithin(rects[0], from, to);
      const b = scaleWithin(rects[1], from, to);
      expect(a.width).toBe(MAX_OBJECT_SIZE_WORLD);
      expect(b.width).toBe(MAX_OBJECT_SIZE_WORLD / 2);
      expect(b.x - (a.x + a.width)).toBe((rects[1].x - (rects[0].x + rects[0].width)) * clamped.x);
    });

    it('does not clamp scales already within the limits', () => {
      const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const clamped = clampScale({ x: 1.5, y: 0.5 }, [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      expect(clamped.x).toBe(1.5);
      expect(clamped.y).toBe(0.5);
    });

    it('uses per-object min sizes', () => {
      const rects: Rect[] = [
        { x: 0, y: 0, width: 100, height: 100 },  // min 50 → lower bound 0.5
        { x: 0, y: 0, width: 100, height: 100 },  // min 30 → lower bound 0.3
      ];
      const clamped = clampScale({ x: 0.1, y: 0.1 }, rects, [50, 30], MAX_OBJECT_SIZE_WORLD);
      expect(clamped.x).toBe(0.5); // the stricter (larger) lower bound wins
      expect(clamped.y).toBe(0.5);
    });
  });

  describe('scaleWithin', () => {
    // TC-04: two 200-unit notes 100 apart, box ×2 width → 400 wide, gap 200
    it('TC-04: scaling the box ×2 width scales notes to 400 wide and the gap to 200', () => {
      const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const b: Rect = { x: 300, y: 0, width: 200, height: 200 }; // 100 apart
      const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
      const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
      const a2 = scaleWithin(a, from, to);
      const b2 = scaleWithin(b, from, to);
      expect(a2).toEqual({ x: 0, y: 0, width: 400, height: 200 });
      expect(b2).toEqual({ x: 600, y: 0, width: 400, height: 200 });
      expect(b2.x - (a2.x + a2.width)).toBe(200); // gap doubled
    });

    it('scales positions relative to the box origin', () => {
      const child: Rect = { x: 10, y: 10, width: 20, height: 30 };
      const from: Rect = { x: 100, y: 100, width: 100, height: 100 };
      const to: Rect = { x: 0, y: 0, width: 200, height: 100 };
      const result = scaleWithin(child, from, to);
      expect(result.x).toBe(0 + (10 - 100) * 2); // to.x + (child.x - from.x) * sx = -180
      expect(result.y).toBe(0 + (10 - 100) * 1);  // -90
      expect(result.width).toBe(40);
      expect(result.height).toBe(30);
    });

    it('returns non-finite results for non-finite input (error path)', () => {
      const child: Rect = { x: 0, y: 0, width: 10, height: 10 };
      const from: Rect = { x: 0, y: 0, width: 0, height: 10 }; // zero width → infinite scale
      const result = scaleWithin(child, from, { x: 0, y: 0, width: 10, height: 10 });
      expect(Number.isFinite(result.width)).toBe(false);
    });
  });
});
