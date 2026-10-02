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
 * Story 7 unit tests for the pure geometry (sel.geometry_ops), TC-01 to TC-04.
 * The board-model group-operation cases (TC-05 to TC-10) live in
 * board-model-group.test.ts.
 */

describe('geometry.rectContains', () => {
  it('TC-07 support: fully inside → true; partly inside and outside → false', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const fullyInside: Rect = { x: 10, y: 10, width: 20, height: 20 };
    const partlyInside: Rect = { x: 90, y: 0, width: 20, height: 20 }; // right edge 110 > 100
    const outside: Rect = { x: 200, y: 200, width: 20, height: 20 };
    expect(rectContains(outer, fullyInside)).toBe(true);
    expect(rectContains(outer, partlyInside)).toBe(false);
    expect(rectContains(outer, outside)).toBe(false);
  });

  it('edges exactly on the boundary count as inside; touching from outside does not', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const onEdge: Rect = { x: 80, y: 80, width: 20, height: 20 }; // right/bottom exactly 100
    const touchingOutside: Rect = { x: 100, y: 40, width: 20, height: 20 };
    expect(rectContains(outer, onEdge)).toBe(true);
    expect(rectContains(outer, touchingOutside)).toBe(false);
  });
});

describe('geometry.unionRects', () => {
  it('unions disjoint rects', () => {
    const u = unionRects([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 50, y: -20, width: 30, height: 40 },
    ]);
    expect(u).toEqual({ x: 0, y: -20, width: 80, height: 40 });
  });

  it('empty list → null', () => {
    expect(unionRects([])).toBeNull();
  });
});

describe('geometry.normalizeRect', () => {
  it('normalises any quadrant', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 5, y: 20 })).toEqual({
      x: 5,
      y: 10,
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

describe('geometry.resizeRect', () => {
  // TC-01
  it('TC-01: se handle with aspectLocked: 200×200 + (100, 40) → 300×300', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const r = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(r).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('se handle without aspect lock grows both axes by the delta', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(resizeRect(start, 'se', { x: 100, y: 40 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 240,
    });
  });

  it('nw handle anchors the bottom-right corner', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    // Drag the top-left corner in by (50, 50): the box shrinks towards (200, 200).
    expect(resizeRect(start, 'nw', { x: 50, y: 50 }, false)).toEqual({
      x: 50,
      y: 50,
      width: 150,
      height: 150,
    });
  });

  it('edge handles change one axis only', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
    expect(resizeRect(start, 'e', { x: 50, y: 999 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 250,
      height: 100,
    });
    expect(resizeRect(start, 'w', { x: 40, y: 999 }, false)).toEqual({
      x: 40,
      y: 0,
      width: 160,
      height: 100,
    });
    expect(resizeRect(start, 'n', { x: 999, y: 30 }, false)).toEqual({
      x: 0,
      y: 30,
      width: 200,
      height: 70,
    });
    expect(resizeRect(start, 's', { x: 999, y: -25 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 75,
    });
  });
});

describe('geometry.clampScale', () => {
  // TC-02
  it('TC-02: shrinking below STICKY_MIN_SIZE_WORLD clamps to exactly 50×50 (boundary)', () => {
    const rects = [{ x: 0, y: 0, width: 200, height: 200 }];
    // 49 board units → below the minimum → clamped to 50.
    const below = clampScale({ x: 49 / 200, y: 49 / 200 }, rects, [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(below.x * 200).toBe(STICKY_MIN_SIZE_WORLD);
    expect(below.y * 200).toBe(STICKY_MIN_SIZE_WORLD);
    // Exactly 50 → allowed unchanged.
    const exact = clampScale({ x: 50 / 200, y: 50 / 200 }, rects, [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(exact.x * 200).toBe(STICKY_MIN_SIZE_WORLD);
    expect(exact.y * 200).toBe(STICKY_MIN_SIZE_WORLD);
  });

  // TC-03
  it('TC-03: mixed rects stop uniformly when the first object hits MAX_OBJECT_SIZE_WORLD', () => {
    // A is 200×200 (min 50), B is 100×100 (min 10).
    const rects = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 300, y: 0, width: 100, height: 100 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, 10];
    // A proposed 200× scale would push A to 40,000 — past the 20,000 max.
    const clamped = clampScale({ x: 200, y: 200 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // A reaches the max first: uniform scale 100.
    expect(clamped.x).toBe(100);
    expect(clamped.y).toBe(100);
    // Relative layout preserved: A at the max, B exactly half the size of A.
    expect(200 * clamped.x).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(100 * clamped.y).toBe(MAX_OBJECT_SIZE_WORLD / 2);
  });

  it('growth below the limits is left unchanged', () => {
    const rects = [{ x: 0, y: 0, width: 200, height: 200 }];
    const clamped = clampScale({ x: 2, y: 2 }, rects, [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(clamped).toEqual({ x: 2, y: 2 });
  });
});

describe('geometry.scaleWithin', () => {
  // TC-04
  it('TC-04: two 200-unit notes 100 apart, box width ×2 → 400 wide, gap 200', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    const a2 = scaleWithin(a, from, to);
    const b2 = scaleWithin(b, from, to);
    expect(a2.width).toBe(400);
    expect(b2.width).toBe(400);
    expect(b2.x - (a2.x + a2.width)).toBe(200); // gap doubled 100 → 200
  });

  it('maps position as well as size', () => {
    const child: Rect = { x: 50, y: 25, width: 100, height: 50 };
    const from: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const to: Rect = { x: 10, y: 20, width: 200, height: 100 };
    expect(scaleWithin(child, from, to)).toEqual({ x: 110, y: 45, width: 200, height: 50 });
  });
});
