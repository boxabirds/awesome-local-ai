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

/**
 * Story 7 (sel.geometry_ops): pure world-unit geometry for marquee, bounding
 * boxes and group resize. No Y.Doc involved — this is the maths layer.
 */
describe('geometry (pure)', () => {
  describe('rectContains', () => {
    it('TC-07 geometry: fully inside → true; partly inside → false; outside → false; touching from outside → false', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const a: Rect = { x: 10, y: 10, width: 50, height: 50 }; // fully inside
      const b: Rect = { x: 50, y: 10, width: 80, height: 50 }; // half inside
      const c: Rect = { x: 200, y: 200, width: 10, height: 10 }; // outside
      const d: Rect = { x: -10, y: 10, width: 30, height: 20 }; // touches edge from outside
      const e: Rect = { x: 90, y: 90, width: 10, height: 10 }; // edge coincident (fully inside)
      expect(rectContains(outer, a)).toBe(true);
      expect(rectContains(outer, b)).toBe(false);
      expect(rectContains(outer, c)).toBe(false);
      expect(rectContains(outer, d)).toBe(false);
      expect(rectContains(outer, e)).toBe(true);
    });
  });

  describe('unionRects', () => {
    it('unions all rects; null for empty list', () => {
      expect(unionRects([])).toBeNull();
      const u = unionRects([
        { x: 10, y: 20, width: 30, height: 40 }, // x 10..40, y 20..60
        { x: -5, y: 5, width: 100, height: 20 }, // x -5..95, y 5..25
      ]);
      expect(u).toEqual({ x: -5, y: 5, width: 100, height: 55 });
    });
  });

  describe('normalizeRect', () => {
    it('normalizes in any direction', () => {
      expect(normalizeRect({ x: 10, y: 20 }, { x: 30, y: 5 })).toEqual({
        x: 10, y: 5, width: 20, height: 15,
      });
      expect(normalizeRect({ x: 30, y: 5 }, { x: 10, y: 20 })).toEqual({
        x: 10, y: 5, width: 20, height: 15,
      });
      expect(normalizeRect({ x: 7, y: 9 }, { x: 7, y: 9 })).toEqual({
        x: 7, y: 9, width: 0, height: 0,
      });
    });
  });

  describe('resizeRect', () => {
    // TC-01
    it('TC-01: se handle with aspect lock: 200×200 + (100, 40) → 300×300', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      expect(resizeRect(start, 'se', { x: 100, y: 40 }, true)).toEqual({
        x: 0, y: 0, width: 300, height: 300,
      });
    });

    it('corner handles change both axes; edge handles change one axis', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
      // e: width only, anchored at left edge
      expect(resizeRect(start, 'e', { x: 50, y: 999 }, false)).toEqual({
        x: 0, y: 0, width: 250, height: 100,
      });
      // n: height only, anchored at bottom edge
      expect(resizeRect(start, 'n', { x: 999, y: -30 }, false)).toEqual({
        x: 0, y: -30, width: 200, height: 130,
      });
      // w: width grows when delta.x is negative, x moves
      expect(resizeRect(start, 'w', { x: -40, y: 999 }, false)).toEqual({
        x: -40, y: 0, width: 240, height: 100,
      });
      // s: height grows when delta.y is positive
      expect(resizeRect(start, 's', { x: 999, y: 25 }, false)).toEqual({
        x: 0, y: 0, width: 200, height: 125,
      });
      // nw: both axes, anchored at bottom-right
      expect(resizeRect(start, 'nw', { x: -20, y: -10 }, false)).toEqual({
        x: -20, y: -10, width: 220, height: 110,
      });
    });

    it('aspect-locked edge handle scales the other axis from the fixed edge', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
      // e with lock: width ×1.5 → height ×1.5, top edge fixed
      expect(resizeRect(start, 'e', { x: 100, y: 0 }, true)).toEqual({
        x: 0, y: 0, width: 300, height: 150,
      });
      // s with lock: height ×1.2 → width ×1.2, left edge fixed
      expect(resizeRect(start, 's', { x: 0, y: 20 }, true)).toEqual({
        x: 0, y: 0, width: 240, height: 120,
      });
    });

    it('never produces negative sizes', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const out = resizeRect(start, 'se', { x: -300, y: -300 }, true);
      expect(out.width).toBeGreaterThanOrEqual(0);
      expect(out.height).toBeGreaterThanOrEqual(0);
    });
  });

  describe('clampScale', () => {
    // TC-02
    it(`TC-02: shrink below STICKY_MIN_SIZE_WORLD (−1 and exact) → clamped to exactly ${STICKY_MIN_SIZE_WORLD}`, () => {
      const rect: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const below = clampScale(
        { x: (STICKY_MIN_SIZE_WORLD - 1) / 200, y: (STICKY_MIN_SIZE_WORLD - 1) / 200 },
        [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD,
      );
      // 200 × 0.25 = 50 exactly at the boundary
      expect(200 * below.x).toBe(STICKY_MIN_SIZE_WORLD);
      expect(200 * below.y).toBe(STICKY_MIN_SIZE_WORLD);

      const exact = clampScale(
        { x: STICKY_MIN_SIZE_WORLD / 200, y: STICKY_MIN_SIZE_WORLD / 200 },
        [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD,
      );
      expect(exact).toEqual({ x: STICKY_MIN_SIZE_WORLD / 200, y: STICKY_MIN_SIZE_WORLD / 200 });
    });

    // TC-03
    it('TC-03: mixed rects stop uniformly when the first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
      const rects: Rect[] = [
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 200, y: 0, width: 50, height: 50 },
      ];
      const out = clampScale({ x: 300, y: 300 }, rects, [10, 10], MAX_OBJECT_SIZE_WORLD);
      // The 100×100 rect hits the max at scale 200 (100×200 = 20 000);
      // the 50×50 rect would allow 400, so the whole selection stops at 200.
      expect(out).toEqual({ x: 200, y: 200 });
      // Relative layout preserved: both scaled by the same factor.
      expect(100 * out.x).toBe(MAX_OBJECT_SIZE_WORLD);
      expect(50 * out.y).toBe(MAX_OBJECT_SIZE_WORLD / 2);
    });

    it('does not clamp a scale already within the limits', () => {
      const rect: Rect = { x: 0, y: 0, width: 200, height: 200 };
      expect(clampScale({ x: 1.2, y: 0.8 }, [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD))
        .toEqual({ x: 1.2, y: 0.8 });
    });
  });

  describe('scaleWithin', () => {
    // TC-04
    it('TC-04: two 200-unit notes 100 apart, box width ×2 → 400 wide, gap 200', () => {
      const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
      const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
      const n1 = scaleWithin({ x: 0, y: 0, width: 200, height: 200 }, from, to);
      const n2 = scaleWithin({ x: 300, y: 0, width: 200, height: 200 }, from, to);
      expect(n1).toEqual({ x: 0, y: 0, width: 400, height: 200 });
      expect(n2).toEqual({ x: 600, y: 0, width: 400, height: 200 });
      expect(n2.x - (n1.x + n1.width)).toBe(200); // gap doubled 100 → 200
    });

    it('maps position and size for an offset child', () => {
      const from: Rect = { x: 10, y: 20, width: 100, height: 100 };
      const to: Rect = { x: 10, y: 20, width: 200, height: 100 };
      const child = { x: 40, y: 50, width: 20, height: 10 };
      expect(scaleWithin(child, from, to)).toEqual({ x: 70, y: 50, width: 40, height: 10 });
    });
  });
});
