/**
 * Geometry unit tests (TC-01 to TC-04). Pure maths on world-unit rects.
 */
import { describe, it, expect } from 'vitest';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  unionRects,
  normalizeRect,
  rectContains,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('geometry.resizeRect', () => {
  it('TC-01: se handle, aspectLocked, 200x200 + (100,40) -> 300x300', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const out = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(out.width).toBeCloseTo(300, 6);
    expect(out.height).toBeCloseTo(300, 6);
    // Anchor is the top-left corner, which stays put.
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
  });

  it('se handle without aspect lock: changes both axes independently', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const out = resizeRect(start, 'se', { x: 100, y: 40 }, false);
    expect(out.width).toBeCloseTo(300, 6);
    expect(out.height).toBeCloseTo(240, 6);
  });

  it('edge handle (e) changes width only, anchored at left edge', () => {
    const start = { x: 10, y: 20, width: 200, height: 100 };
    const out = resizeRect(start, 'e', { x: 50, y: 0 }, false);
    expect(out.x).toBeCloseTo(10, 6);
    expect(out.width).toBeCloseTo(250, 6);
    expect(out.height).toBeCloseTo(100, 6);
    expect(out.y).toBeCloseTo(20, 6);
  });

  it('nw handle drags the top-left, anchored at the bottom-right', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const out = resizeRect(start, 'nw', { x: -30, y: -20 }, false);
    expect(out.x).toBeCloseTo(-30, 6);
    expect(out.y).toBeCloseTo(-20, 6);
    expect(out.width).toBeCloseTo(230, 6);
    expect(out.height).toBeCloseTo(220, 6);
  });

  it('nw handle with aspect lock keeps the ratio and the opposite anchor', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const out = resizeRect(start, 'nw', { x: -100, y: 0 }, true);
    expect(out.width).toBeCloseTo(300, 6);
    expect(out.height).toBeCloseTo(300, 6);
    // Bottom-right (200,200) stays fixed.
    expect(out.x + out.width).toBeCloseTo(200, 6);
    expect(out.y + out.height).toBeCloseTo(200, 6);
  });
});

describe('geometry.clampScale', () => {
  it('TC-02: shrink one 200 square below STICKY_MIN_SIZE_WORLD clamps to 50', () => {
    const rects = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    // Desired scale that would give 200 * 0.24 = 48 (< 50).
    const clamped = clampScale({ x: 0.24, y: 0.24 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200, 6);
    expect(clamped.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200, 6);
    const scaled = scaleWithin(rects[0], rects[0], {
      x: 0,
      y: 0,
      width: 200 * clamped.x,
      height: 200 * clamped.y,
    });
    expect(scaled.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(scaled.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
  });

  it('TC-02 boundary: exactly STICKY_MIN_SIZE_WORLD is allowed', () => {
    const rects = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    const scale = STICKY_MIN_SIZE_WORLD / 200; // -> exactly 50
    const clamped = clampScale({ x: scale, y: scale }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(scale, 6);
    expect(clamped.y).toBeCloseTo(scale, 6);
  });

  it('TC-03: uniform scale stops when the first object would exceed MAX_OBJECT_SIZE_WORLD; relative layout preserved', () => {
    // A large object (10000 wide) and a small one; scaling up must stop at the
    // first to hit the 20000 ceiling (scale 2), not push it past.
    const rects = [
      { x: 0, y: 0, width: 10000, height: 10000 },
      { x: 0, y: 0, width: 100, height: 100 },
    ];
    const minSizes = [50, 50];
    const clamped = clampScale({ x: 4, y: 4 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // The large object caps the uniform scale at 20000 / 10000 = 2.
    expect(clamped.x).toBeCloseTo(2, 6);
    expect(clamped.y).toBeCloseTo(2, 6);
    // Applying that uniform scale keeps relative layout (both scale by 2).
    const from = { x: 0, y: 0, width: 10000, height: 10000 };
    const to = { x: 0, y: 0, width: 10000 * clamped.x, height: 10000 * clamped.y };
    const big = scaleWithin(rects[0], from, to);
    const small = scaleWithin(rects[1], from, to);
    expect(big.width).toBeCloseTo(20000, 6);
    expect(small.width).toBeCloseTo(200, 6);
  });

  it('scale within the legal band is returned unchanged', () => {
    const rects = [{ x: 0, y: 0, width: 100, height: 100 }];
    const clamped = clampScale({ x: 1.5, y: 1.5 }, rects, [50], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(1.5, 6);
    expect(clamped.y).toBeCloseTo(1.5, 6);
  });
});

describe('geometry.scaleWithin / helpers', () => {
  it('TC-04: two 200-unit notes 100 apart, box width x2 -> 400 wide, gap 200', () => {
    const from = { x: 0, y: 0, width: 500, height: 200 };
    const to = { x: 0, y: 0, width: 1000, height: 200 };
    const a = { x: 0, y: 0, width: 200, height: 200 };
    const b = { x: 300, y: 0, width: 200, height: 200 };
    const a2 = scaleWithin(a, from, to);
    const b2 = scaleWithin(b, from, to);
    expect(a2.width).toBeCloseTo(400, 6);
    expect(b2.width).toBeCloseTo(400, 6);
    // gap between a2 right (400) and b2 left (600) is 200.
    expect(b2.x - (a2.x + a2.width)).toBeCloseTo(200, 6);
  });

  it('unionRects: null for empty, bounding box otherwise', () => {
    expect(unionRects([])).toBeNull();
    const u = unionRects([
      { x: 10, y: 10, width: 20, height: 20 },
      { x: 40, y: 0, width: 10, height: 30 },
    ]);
    expect(u).toEqual({ x: 10, y: 0, width: 40, height: 30 });
  });

  it('normalizeRect: handles reversed corner order', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 30, y: 5 })).toEqual({
      x: 10,
      y: 5,
      width: 20,
      height: 15,
    });
  });

  it('rectContains: inside true, edge-touch true, partly false', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(rectContains(outer, { x: 50, y: 50, width: 100, height: 100 })).toBe(false);
    expect(rectContains(outer, { x: -1, y: 0, width: 10, height: 10 })).toBe(false);
  });
});
