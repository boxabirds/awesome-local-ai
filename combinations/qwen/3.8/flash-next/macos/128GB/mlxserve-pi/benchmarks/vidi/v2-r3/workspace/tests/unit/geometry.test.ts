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
    it('fully-inside is true', () => {
      expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 50, height: 50 })).toBe(true);
    });
    it('partly-outside is false', () => {
      expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50, width: 100, height: 100 })).toBe(false);
    });
    it('exact match is true (all edges at boundary)', () => {
      expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    });
    it('touching from outside is false', () => {
      expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 100, y: 0, width: 50, height: 50 })).toBe(false);
    });
  });

  describe('unionRects', () => {
    it('returns null for empty array', () => {
      expect(unionRects([])).toBeNull();
    });
    it('returns the rect for one rect', () => {
      const r = { x: 10, y: 20, width: 30, height: 40 };
      expect(unionRects([r])).toEqual(r);
    });
    it('returns smallest enclosing rect for multiple', () => {
      const a = { x: 0, y: 0, width: 100, height: 100 };
      const b = { x: 50, y: 200, width: 100, height: 50 };
      expect(unionRects([a, b])).toEqual({ x: 0, y: 0, width: 150, height: 250 });
    });
  });

  describe('normalizeRect', () => {
    it('handles top-left to bottom-right', () => {
      expect(normalizeRect({ x: 0, y: 0 }, { x: 100, y: 100 })).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });
    it('handles bottom-right to top-left', () => {
      expect(normalizeRect({ x: 100, y: 100 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });
  });

  // TC-01: resizeRect se handle, aspectLocked, 200x200 + (100,40) → 300x300
  describe('TC-01 resizeRect se aspectLocked', () => {
    it('200×200 + (100,40) → 300×300 (aspect locked, width drives)', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
      // Width moved by 100, height by 40. Aspect locked ratio = 1.
      // scaleX = 300/200 = 1.5, scaleY = 240/200 = 1.2
      // |scaleX-1| = 0.5 >= |scaleY-1| = 0.2, so height = width/ratio = 300/1 = 300
      expect(result.width).toBeCloseTo(300);
      expect(result.height).toBeCloseTo(300);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });
  });

  // TC-02: shrink below STICKY_MIN_SIZE_WORLD boundary
  describe('TC-02 resizeRect shrink boundary', () => {
    it('delta that would shrink below STICKY_MIN_SIZE_WORLD is clamped by clampScale', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      // se handle with delta that would give 199 width (200-1=-1 not right; use scale)
      // resizeRect doesn't clamp; it computes the new rect. Clamping is clampScale's job.
      // Test: resizeRect gives 49 (below 50), then clampScale clamps to 50.
      const result = resizeRect(start, 'se', { x: -151, y: -151 }, false);
      // width: 200 + (-151) = 49
      expect(result.width).toBeCloseTo(49);
      // Now clamp: scale = 49/200 = 0.245, minSize = 50
      const scale = clampScale({ x: result.width / start.width, y: result.height / start.height }, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      // Clamped scale: 50/200 = 0.25
      expect(scale.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200);
    });
    it('exact STICKY_MIN_SIZE_WORLD is allowed', () => {
      const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const scale = clampScale({ x: 0.25, y: 0.25 }, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      // 200*0.25 = 50 = STICKY_MIN_SIZE_WORLD, exactly at the limit, allowed
      expect(scale.x).toBeCloseTo(0.25);
    });
  });

  // TC-03: clampScale mixed rects stops uniformly when first hits MAX_OBJECT_SIZE_WORLD
  describe('TC-03 clampScale MAX_OBJECT_SIZE_WORLD', () => {
    it('stops uniformly when first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
      const rects: Rect[] = [
        { x: 0, y: 0, width: 10000, height: 10000 },
        { x: 0, y: 0, width: 5000, height: 5000 },
      ];
      const minSizes = [50, 50];
      // Propose scale of 3: first rect would become 30000 > MAX(20000)
      const scale = clampScale({ x: 3, y: 3 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      // max scale for first: 20000/10000 = 2
      // max scale for second: 20000/5000 = 4
      // uniform: min(2, 4) = 2
      expect(scale.x).toBeCloseTo(2);
      expect(scale.y).toBeCloseTo(2);
    });
  });

  // TC-04: scaleWithin box ×2 width
  describe('TC-04 scaleWithin', () => {
    it('two 200-unit notes 100 apart, box ×2 → 400 wide, gap 200', () => {
      const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
      const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
      const note1: Rect = { x: 0, y: 0, width: 200, height: 200 };
      const note2: Rect = { x: 300, y: 0, width: 200, height: 200 };
      const scaled1 = scaleWithin(note1, from, to);
      const scaled2 = scaleWithin(note2, from, to);
      // Scale factors: x=2, y=1
      expect(scaled1.width).toBeCloseTo(400);
      expect(scaled2.width).toBeCloseTo(400);
      // Gap between them: note2.x - note1.right = 300*2 - 200*2 = 600 - 400 = 200
      const gap = scaled2.x - (scaled1.x + scaled1.width);
      expect(gap).toBeCloseTo(200);
    });
  });
});
