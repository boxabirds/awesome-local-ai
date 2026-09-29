import { describe, expect, it } from 'vitest';
import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

describe('geometry.ts', () => {
  describe('rectContains', () => {
    it('fully inside rect returns true', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 10, y: 10, width: 20, height: 20 };
      expect(rectContains(outer, inner)).toBe(true);
    });

    it('touching edges counts as inside', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 0, y: 0, width: 100, height: 100 };
      expect(rectContains(outer, inner)).toBe(true);
    });

    it('partly inside returns false', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 90, y: 50, width: 20, height: 20 };
      expect(rectContains(outer, inner)).toBe(false);
    });

    it('outside returns false', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const inner: Rect = { x: 200, y: 200, width: 10, height: 10 };
      expect(rectContains(outer, inner)).toBe(false);
    });
  });

  describe('unionRects', () => {
    it('empty list returns null', () => {
      expect(unionRects([])).toBeNull();
    });

    it('one rect returns its bounding box', () => {
      const r: Rect = { x: 10, y: 20, width: 30, height: 40 };
      expect(unionRects([r])).toEqual(r);
    });

    it('two rects returns their bounding box', () => {
      const a: Rect = { x: 0, y: 0, width: 100, height: 50 };
      const b: Rect = { x: 200, y: 100, width: 50, height: 50 };
      expect(unionRects([a, b])).toEqual({ x: 0, y: 0, width: 250, height: 150 });
    });
  });

  describe('normalizeRect', () => {
    it('top-left to bottom-right produces same rect', () => {
      expect(normalizeRect({ x: 10, y: 10 }, { x: 50, y: 60 })).toEqual({ x: 10, y: 10, width: 40, height: 50 });
    });

    it('bottom-right to top-left produces same rect', () => {
      expect(normalizeRect({ x: 50, y: 60 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 40, height: 50 });
    });
  });

  describe('resizeRect', () => {
    it('TC-01: se handle with aspectLocked, 200×200 + (100,40) → 300×300', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
      expect(result.width).toBeCloseTo(300);
      expect(result.height).toBeCloseTo(300);
    });

    it('se handle without aspect lock changes both axes', () => {
      const start: Rect = { x: 10, y: 10, width: 200, height: 100 };
      const result = resizeRect(start, 'se', { x: 50, y: 20 }, false);
      expect(result).toEqual({ x: 10, y: 10, width: 250, height: 120 });
    });

    it('e handle changes only width', () => {
      const start: Rect = { x: 10, y: 10, width: 200, height: 100 };
      const result = resizeRect(start, 'e', { x: 50, y: 0 }, false);
      expect(result).toEqual({ x: 10, y: 10, width: 250, height: 100 });
    });

    it('n handle changes height, anchor at bottom', () => {
      const start: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const result = resizeRect(start, 'n', { x: 0, y: -20 }, false);
      expect(result).toEqual({ x: 0, y: -20, width: 100, height: 120 });
    });

    it('nw handle resizes from opposite corner', () => {
      const start: Rect = { x: 100, y: 100, width: 200, height: 200 };
      // Dragging nw left/up (negative delta) grows the rect
      const result = resizeRect(start, 'nw', { x: -30, y: -40 }, false);
      expect(result).toEqual({ x: 70, y: 60, width: 230, height: 240 });
    });

    it('w handle with aspect lock derives height from ratio', () => {
      // Start is 200x100 (ratio 2:1); w handle moves left by 100, so newW = 300, newH = 150
      const start: Rect = { x: 200, y: 0, width: 200, height: 100 };
      const result = resizeRect(start, 'w', { x: -100, y: 0 }, true);
      expect(result.width).toBeCloseTo(300);
      expect(result.height).toBeCloseTo(150);
    });

    it('returns start rect for non-finite inputs', () => {
      const start: Rect = { x: 0, y: 0, width: 100, height: 100 };
      expect(resizeRect(start, 'se', { x: NaN, y: 0 }, false)).toEqual(start);
    });
  });

  describe('clampScale', () => {
    it('TC-02: shrink below STICKY_MIN_SIZE_WORLD is clamped', () => {
      const r: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
      // Try to scale to 49/200 = 0.245 → should clamp to 50/200 = 0.25
      const scale = clampScale({ x: 49 / STICKY_SIZE_WORLD, y: 49 / STICKY_SIZE_WORLD }, [r], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      expect(scale.x).toBeCloseTo(50 / STICKY_SIZE_WORLD);
      expect(scale.y).toBeCloseTo(50 / STICKY_SIZE_WORLD);
      expect(STICKY_SIZE_WORLD * scale.x).toBe(STICKY_MIN_SIZE_WORLD);
    });

    it('exact minimum size is allowed', () => {
      const r: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
      const scale = clampScale({ x: 50 / STICKY_SIZE_WORLD, y: 50 / STICKY_SIZE_WORLD }, [r], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      expect(STICKY_SIZE_WORLD * scale.x).toBe(STICKY_MIN_SIZE_WORLD);
    });

    it('TC-03: clampScale stops uniformly when first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
      const r1: Rect = { x: 0, y: 0, width: 10000, height: 10000 };
      const r2: Rect = { x: 20000, y: 20000, width: 5000, height: 5000 };
      const r3: Rect = { x: 5000, y: 5000, width: 2500, height: 2500 };
      const rects = [r1, r2, r3];
      const minSizes = [0, 0, 0];
      // Try uniform scale 2.5: r1 would become 25000 > 20000. Clamp to 2.0.
      const scale = clampScale({ x: 2.5, y: 2.5 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      // r1 is the binding constraint: maxSize / 10000 = 2.0
      expect(scale.x).toBeCloseTo(2.0);
      expect(scale.y).toBeCloseTo(2.0);
      // All rects stay within limits
      for (const r of rects) {
        expect(r.width * scale.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
        expect(r.height * scale.y).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
      }
    });

    it('does not clamp below min when growing', () => {
      const r: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const scale = clampScale({ x: 2, y: 2 }, [r], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      expect(scale.x).toBeCloseTo(2);
    });

    it('returns {1,1} for empty rects', () => {
      expect(clampScale({ x: 2, y: 2 }, [], [], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
    });
  });

  describe('scaleWithin', () => {
    it('TC-04: two 200-unit notes 100 apart, box ×2 width → 400 wide, gap 200', () => {
      // Two sticky notes side by side with a gap of 100
      const box: Rect = { x: 0, y: 0, width: 500, height: 200 };
      const note1: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const note2: Rect = { x: 300, y: 0, width: 200, height: 200 };
      const newBox: Rect = { x: 0, y: 0, width: 1000, height: 200 };

      const scaled1 = scaleWithin(note1, box, newBox);
      const scaled2 = scaleWithin(note2, box, newBox);

      expect(scaled1.width).toBeCloseTo(400);
      expect(scaled2.width).toBeCloseTo(400);
      // Gap: scaled2.x - (scaled1.x + scaled1.width) = 600 - 400 = 200
      expect(scaled2.x - (scaled1.x + scaled1.width)).toBeCloseTo(200);
    });

    it('preserves relative position', () => {
      const box: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const child: Rect = { x: 50, y: 50, width: 100, height: 100 };
      const newBox: Rect = { x: 0, y: 0, width: 400, height: 400 };
      expect(scaleWithin(child, box, newBox)).toEqual({ x: 100, y: 100, width: 200, height: 200 });
    });
  });
});
