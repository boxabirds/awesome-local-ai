import { describe, it, expect } from 'vitest';
import {
  Rect,
  Handle,
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
} from '@shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '@shared/config';

describe('geometry', () => {
  describe('rectContains', () => {
    it('returns true when inner is entirely inside outer', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 10, y: 10, width: 50, height: 50 };
      expect(rectContains(outer, inner)).toBe(true);
    });

    it('returns false when inner is partially outside', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 50, y: 50, width: 100, height: 100 };
      expect(rectContains(outer, inner)).toBe(false);
    });

    it('returns true when inner exactly matches outer', () => {
      const r: Rect = { x: 5, y: 5, width: 50, height: 50 };
      expect(rectContains(r, r)).toBe(true);
    });
  });

  describe('unionRects', () => {
    it('returns null for empty array', () => {
      expect(unionRects([])).toBeNull();
    });

    it('returns the single rect for one element', () => {
      const r: Rect = { x: 1, y: 2, width: 3, height: 4 };
      expect(unionRects([r])).toEqual(r);
    });

    it('returns bounding box of multiple rects', () => {
      const a: Rect = { x: 0, y: 0, width: 10, height: 10 };
      const b: Rect = { x: 20, y: 30, width: 10, height: 10 };
      expect(unionRects([a, b])).toEqual({ x: 0, y: 0, width: 30, height: 40 });
    });
  });

  describe('normalizeRect', () => {
    it('handles bottom-right drag', () => {
      const r = normalizeRect({ x: 10, y: 10 }, { x: 50, y: 60 });
      expect(r).toEqual({ x: 10, y: 10, width: 40, height: 50 });
    });

    it('handles top-left drag', () => {
      const r = normalizeRect({ x: 50, y: 60 }, { x: 10, y: 10 });
      expect(r).toEqual({ x: 10, y: 10, width: 40, height: 50 });
    });
  });

  describe('TC-01: resizeRect', () => {
    it('se handle, aspectLocked: 200x200 + (100,40) → 300x300', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
      // Aspect locked: uses the larger change (100/200 = 0.5 > 40/200 = 0.2)
      // ratio = 1.5, newWidth = 300, newHeight = 300/1 = 300
      expect(result.width).toBeCloseTo(300);
      expect(result.height).toBeCloseTo(300);
    });
  });

  describe('TC-02: resizeRect with aspect locked shrink', () => {
    it('shrink clamps to minimum 50x50', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      // Shrink a lot with se handle: delta = (-200, -200)
      const result = resizeRect(start, 'se', { x: -200, y: -200 }, true);
      // The resize rect itself can go to 0; clamping is done by clampScale
      // Test clampScale separately
      const rects = [start];
      const minSizes = [STICKY_MIN_SIZE_WORLD];
      const scaleX = result.width / start.width;
      const scaleY = result.height / start.height;
      const clamped = clampScale({ x: scaleX, y: scaleY }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      const finalWidth = start.width * clamped.x;
      const finalHeight = start.height * clamped.y;
      expect(finalWidth).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
      expect(finalHeight).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
      // 50 is the min: scale = 50/200 = 0.25
      expect(finalWidth).toBeCloseTo(50);
      expect(finalHeight).toBeCloseTo(50);
    });
  });

  describe('TC-03: clampScale stops at MAX_OBJECT_SIZE_WORLD', () => {
    it('mixed rects: stops uniformly when first exceeds max', () => {
      const rects: Rect[] = [
        { x: 0, y: 0, width: 1000, height: 1000 },
        { x: 0, y: 0, width: 500, height: 500 },
      ];
      const minSizes = [50, 50];
      // Try to scale by 21 (1000 * 21 = 21000 > MAX_OBJECT_SIZE_WORLD = 20000)
      const scale = clampScale({ x: 21, y: 21 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      // Should be clamped to 20000/1000 = 20
      expect(scale.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD / 1000);
      expect(scale.y).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD / 1000);
      expect(scale.x).toBeCloseTo(20);
      expect(scale.y).toBeCloseTo(20);
    });
  });

  describe('TC-04: scaleWithin - two notes 100 apart, box width x2', () => {
    it('each note 400 wide, gap 200', () => {
      // Two 200-unit notes, 100 apart
      const noteA: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const noteB: Rect = { x: 300, y: 0, width: 200, height: 200 };
      const bbox = unionRects([noteA, noteB])!;
      // bbox = { x: 0, y: 0, width: 500, height: 200 }
      expect(bbox.width).toBe(500);

      // Double the width
      const newBbox: Rect = { x: 0, y: 0, width: 1000, height: 200 };
      const scaledA = scaleWithin(noteA, bbox, newBbox);
      const scaledB = scaleWithin(noteB, bbox, newBbox);

      expect(scaledA.width).toBeCloseTo(400);
      expect(scaledB.width).toBeCloseTo(400);
      // Gap: scaledB.x - (scaledA.x + scaledA.width) = 600 - (0 + 400) = 200
      expect(scaledB.x - (scaledA.x + scaledA.width)).toBeCloseTo(200);
    });
  });

  describe('scaleWithin', () => {
    it('identity when from == to', () => {
      const child: Rect = { x: 10, y: 10, width: 50, height: 50 };
      const from: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const result = scaleWithin(child, from, from);
      expect(result).toEqual(child);
    });
  });
});
