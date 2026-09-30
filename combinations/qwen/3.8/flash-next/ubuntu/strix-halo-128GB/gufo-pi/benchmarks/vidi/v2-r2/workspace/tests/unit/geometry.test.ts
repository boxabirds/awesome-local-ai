import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  type Rect,
} from '@shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '@shared/config';

describe('geometry', () => {
  describe('rectContains', () => {
    it('fully inside returns true', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 10, y: 10, width: 50, height: 50 };
      expect(rectContains(outer, inner)).toBe(true);
    });

    it('partly inside returns false', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 50, y: 50, width: 100, height: 100 };
      expect(rectContains(outer, inner)).toBe(false);
    });

    it('touching edge from outside returns false', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 100, y: 0, width: 50, height: 50 };
      expect(rectContains(outer, inner)).toBe(false);
    });
  });

  describe('unionRects', () => {
    it('empty returns null', () => {
      expect(unionRects([])).toBeNull();
    });

    it('single rect returns itself', () => {
      const r: Rect = { x: 10, y: 20, width: 30, height: 40 };
      expect(unionRects([r])).toEqual(r);
    });

    it('multiple rects returns bounding box', () => {
      const rects: Rect[] = [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 30, width: 10, height: 10 },
      ];
      expect(unionRects(rects)).toEqual({ x: 0, y: 0, width: 30, height: 40 });
    });
  });

  describe('normalizeRect', () => {
    it('two points produce positive rect', () => {
      expect(normalizeRect({ x: 10, y: 30 }, { x: 50, y: 10 })).toEqual({
        x: 10,
        y: 10,
        width: 40,
        height: 20,
      });
    });
  });

  describe('resizeRect', () => {
    // TC-01: se handle, aspectLocked, 200×200 + (100,40) → 300×300
    it('TC-01: se handle aspectLocked 200x200 + (100,40) → 300x300', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
      // Corner handle with aspect lock: scaleX=1.5, scaleY=1.2, larger relative change is scaleX
      expect(result.width).toBeCloseTo(300, 5);
      expect(result.height).toBeCloseTo(300, 5);
      // Anchor is top-left for 'se' handle so x,y stays
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(0, 5);
    });

    it('e handle changes width only', () => {
      const start: Rect = { x: 10, y: 10, width: 100, height: 200 };
      const result = resizeRect(start, 'e', { x: 50, y: 0 }, false);
      expect(result.width).toBeCloseTo(150, 5);
      expect(result.height).toBeCloseTo(200, 5);
      expect(result.x).toBeCloseTo(10, 5);
      expect(result.y).toBeCloseTo(10, 5);
    });

    it('nw handle changes top-left', () => {
      const start: Rect = { x: 10, y: 10, width: 100, height: 100 };
      const result = resizeRect(start, 'nw', { x: -20, y: -30 }, false);
      expect(result.x).toBeCloseTo(-10, 5);
      expect(result.y).toBeCloseTo(-20, 5);
      expect(result.width).toBeCloseTo(120, 5);
      expect(result.height).toBeCloseTo(130, 5);
    });
  });

  describe('clampScale', () => {
    // TC-02: shrink below STICKY_MIN_SIZE_WORLD → clamped to 50×50
    it('TC-02: shrink below STICKY_MIN_SIZE_WORLD clamps to 50', () => {
      const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
      const minSizes = [STICKY_MIN_SIZE_WORLD];
      // Want to shrink to scale 0.2 → 200*0.2=40 < 50, should clamp
      const result = clampScale({ x: 0.2, y: 0.2 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      expect(result.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200, 10); // 0.25
      expect(result.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200, 10);
    });

    it('TC-02 boundary: exactly STICKY_MIN_SIZE_WORLD is allowed', () => {
      const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
      const minSizes = [STICKY_MIN_SIZE_WORLD];
      // scale = 50/200 = 0.25 → exactly at minimum, allowed
      const result = clampScale({ x: 0.25, y: 0.25 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      expect(result.x).toBeCloseTo(0.25, 10);
      expect(result.y).toBeCloseTo(0.25, 10);
    });

    // TC-03: clampScale mixed rects stops uniformly when first hits MAX_OBJECT_SIZE_WORLD
    it('TC-03: stops when first object hits MAX_OBJECT_SIZE_WORLD', () => {
      const rects: Rect[] = [
        { x: 0, y: 0, width: 200, height: 200 },
        { x: 300, y: 0, width: 400, height: 400 },
      ];
      const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
      // Scale 60 → 400*60 = 24000 > 20000, so clamped to 20000/400 = 50
      const result = clampScale({ x: 60, y: 60 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      expect(result.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD / 400 + 0.001);
      expect(result.y).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD / 400 + 0.001);
      // 200*50=10000 < 20000 (first object ok)
      expect(result.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 400, 5);
    });
  });

  describe('scaleWithin', () => {
    // TC-04: two 200-unit notes 100 apart, box ×2 width → 400 wide, gap 200
    it('TC-04: scale 2x horizontally, sizes and gaps double', () => {
      const noteA: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const noteB: Rect = { x: 300, y: 0, width: 200, height: 200 }; // gap = 100
      const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
      const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };

      const scaledA = scaleWithin(noteA, from, to);
      const scaledB = scaleWithin(noteB, from, to);

      expect(scaledA.width).toBeCloseTo(400, 5);
      expect(scaledB.width).toBeCloseTo(400, 5);
      // gap: B.x - (A.x + A.width) = 600 - 400 = 200
      const gap = scaledB.x - (scaledA.x + scaledA.width);
      expect(gap).toBeCloseTo(200, 5);
    });
  });
});
