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
 * Story 7 (sel.geometry_ops): pure geometry — resizeRect, clampScale,
 * scaleWithin and the marquee containment rule. TC-01 to TC-04.
 */
describe('geometry (sel.geometry_ops)', () => {
  describe('rectContains (marquee containment)', () => {
    it('is true only when all four edges of inner lie inside outer', () => {
      const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
      expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
      // Touching the edge from outside is NOT contained (PRD sel.marquee).
      expect(rectContains(outer, { x: 0, y: 10, width: 20, height: 20 })).toBe(false);
      expect(rectContains(outer, { x: 10, y: 0, width: 20, height: 20 })).toBe(false);
      expect(rectContains(outer, { x: 80, y: 10, width: 20, height: 20 })).toBe(false);
      expect(rectContains(outer, { x: 10, y: 80, width: 20, height: 20 })).toBe(false);
      // Exactly spanning the rectangle is not strictly inside.
      expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(false);
      // Partly inside.
      expect(rectContains(outer, { x: 50, y: 50, width: 90, height: 90 })).toBe(false);
    });
  });

  describe('unionRects', () => {
    it('returns null for an empty list', () => {
      expect(unionRects([])).toBeNull();
    });

    it('returns the bounding rect of all rects', () => {
      const u = unionRects([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: -4, width: 8, height: 6 },
        { x: 20, y: 10, width: 1, height: 1 },
      ]);
      expect(u).toEqual({ x: 0, y: -4, width: 21, height: 15 });
    });
  });

  describe('normalizeRect', () => {
    it('normalises two corner points to a positive rect', () => {
      expect(normalizeRect({ x: 10, y: 20 }, { x: 5, y: 30 })).toEqual({
        x: 5,
        y: 20,
        width: 5,
        height: 10,
      });
      expect(normalizeRect({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    });
  });

  // TC-01
  it('TC-01: resizeRect se handle aspectLocked 200×200 + (100,40) → 300×300', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(resizeRect(start, 'se', { x: 100, y: 40 }, true)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
  });

  it('resizeRect corner handles keep the opposite corner fixed', () => {
    const start: Rect = { x: 10, y: 20, width: 100, height: 50 };
    // nw: drag (−30, −20) → grows up-left, se corner fixed at (110, 70).
    expect(resizeRect(start, 'nw', { x: -30, y: -20 }, false)).toEqual({
      x: -20,
      y: 0,
      width: 130,
      height: 70,
    });
    // sw: drag (+40, +30) → left edge moves right (shrinks width), bottom
    // edge moves down (grows height), ne corner fixed at (110, 20).
    expect(resizeRect(start, 'sw', { x: 40, y: 30 }, false)).toEqual({
      x: 50,
      y: 20,
      width: 60,
      height: 80,
    });
  });

  it('resizeRect edge handles change one axis only (no aspect lock)', () => {
    const start: Rect = { x: 0, y: 0, width: 100, height: 50 };
    expect(resizeRect(start, 'e', { x: 25, y: 99 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 125,
      height: 50,
    });
    expect(resizeRect(start, 'n', { x: 99, y: -10 }, false)).toEqual({
      x: 0,
      y: -10,
      width: 100,
      height: 60,
    });
  });

  it('resizeRect edge handles keep the ratio when aspect-locked', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
    // 'e' with +100 width → height follows the 1:2 ratio → 150.
    expect(resizeRect(start, 'e', { x: 100, y: 0 }, true)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 150,
    });
    // 's' with +50 height → width follows → 300.
    expect(resizeRect(start, 's', { x: 0, y: 50 }, true)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 150,
    });
  });

  // TC-02
  it('TC-02: shrinking below STICKY_MIN_SIZE_WORLD clamps to 50×50 (boundary)', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    // 1 below the minimum: 200 − 151 = 49 → clamped to 50.
    const below = clampScale(
      { x: 49 / 200, y: 49 / 200 },
      [start],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(below.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200, 10);
    expect(below.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200, 10);
    // Exactly the minimum: unchanged.
    const exact = clampScale(
      { x: 50 / 200, y: 50 / 200 },
      [start],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(exact.x).toBeCloseTo(50 / 200, 10);
    expect(exact.y).toBeCloseTo(50 / 200, 10);
    // End-to-end: resizeRect to 49×49 then clamp → 50×50 box.
    const shrunk = resizeRect(start, 'se', { x: -151, y: -151 }, true);
    const scale = clampScale(
      { x: shrunk.width / start.width, y: shrunk.height / start.height },
      [start],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(start.width * scale.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 10);
    expect(start.height * scale.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 10);
  });

  // TC-03
  it('TC-03: clampScale stops uniformly when the first object hits MAX_OBJECT_SIZE_WORLD', () => {
    // Mixed selection: a small 100-unit object and a 1000-unit object.
    const rects = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 1000, height: 1000 },
    ];
    // ×100 would make the big object 100,000 > 20,000 → clamped to ×20.
    const clamped = clampScale({ x: 100, y: 100 }, rects, [50, 50], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(20, 10);
    expect(clamped.y).toBeCloseTo(20, 10);
    // Uniform: the whole selection scales by the same factor.
    expect(rects[0].width * clamped.x).toBeCloseTo(2000, 10);
    expect(rects[1].width * clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 10);
    // Relative layout preserved: ratio of the two widths unchanged.
    expect((rects[1].width * clamped.x) / (rects[0].width * clamped.x)).toBeCloseTo(10, 10);

    // Scaling down: stops when the first object hits its min size.
    // ×0.1 would make the small object 10 < 50 → clamped to ×0.5.
    const clampedDown = clampScale({ x: 0.1, y: 0.1 }, rects, [50, 10], MAX_OBJECT_SIZE_WORLD);
    expect(clampedDown.x).toBeCloseTo(0.5, 10);
    expect(clampedDown.y).toBeCloseTo(0.5, 10);
  });

  // TC-04
  it('TC-04: two 200-unit notes 100 apart, box width ×2 → 400 wide, gap 200', () => {
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 }; // 200 + 100 + 200
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    const noteA = scaleWithin({ x: 0, y: 0, width: 200, height: 200 }, from, to);
    const noteB = scaleWithin({ x: 300, y: 0, width: 200, height: 200 }, from, to);
    expect(noteA.width).toBeCloseTo(400, 10);
    expect(noteB.width).toBeCloseTo(400, 10);
    const gap = noteB.x - (noteA.x + noteA.width);
    expect(gap).toBeCloseTo(200, 10);
  });
});
