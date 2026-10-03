/**
 * Unit tests for pure geometry (sel.geometry_ops), story 7.
 * TC-01 to TC-04.
 */
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

describe('sel.geometry_ops: geometry', () => {
  // TC-01: resizeRect se handle, aspectLocked: 200×200 + (100, 40) → 300×300
  it('TC-01: se corner with aspect lock keeps the ratio from the opposite corner', () => {
    const start: Rect = { x: 10, y: 20, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(result).toEqual({ x: 10, y: 20, width: 300, height: 300 });
  });

  // TC-02: shrinking below STICKY_MIN_SIZE_WORLD − 1 clamps to 50×50;
  // shrinking to exactly the minimum is allowed (boundary).
  it('TC-02: shrink below the minimum clamps to exactly STICKY_MIN_SIZE_WORLD', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };

    // 1 unit below the minimum: 200 − 151 = 49 → clamped to 50
    const box = resizeRect(start, 'se', { x: -151, y: -151 }, true);
    const scale = clampScale(
      { x: box.width / start.width, y: box.height / start.height },
      [start],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(start.width * scale.x).toBe(STICKY_MIN_SIZE_WORLD);
    expect(start.height * scale.y).toBe(STICKY_MIN_SIZE_WORLD);

    // Exactly at the minimum: no clamping needed
    const boxExact = resizeRect(start, 'se', { x: -150, y: -150 }, true);
    const scaleExact = clampScale(
      { x: boxExact.width / start.width, y: boxExact.height / start.height },
      [start],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(start.width * scaleExact.x).toBe(STICKY_MIN_SIZE_WORLD);
    expect(start.height * scaleExact.y).toBe(STICKY_MIN_SIZE_WORLD);
  });

  // TC-03: mixed rects — clampScale stops uniformly when the first object
  // would exceed MAX_OBJECT_SIZE_WORLD; the relative layout is preserved by
  // scaleWithin.
  it('TC-03: clampScale stops the whole selection when the first object hits the max size', () => {
    const small: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const large: Rect = { x: 500, y: 0, width: 1000, height: 1000 };

    // Proposing ×30: the 1000-unit object would reach 30,000 > 20,000.
    const clamped = clampScale({ x: 30, y: 30 }, [small, large], [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBe(MAX_OBJECT_SIZE_WORLD / large.width); // 20
    expect(clamped.y).toBe(MAX_OBJECT_SIZE_WORLD / large.height); // 20

    // The whole selection uses that one scale; relative layout preserved.
    const from: Rect = { x: 0, y: 0, width: 600, height: 1000 };
    const to: Rect = { x: 0, y: 0, width: from.width * clamped.x, height: from.height * clamped.y };
    const smallAfter = scaleWithin(small, from, to);
    const largeAfter = scaleWithin(large, from, to);
    expect(largeAfter.width).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(largeAfter.height).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(smallAfter.width).toBe(100 * clamped.x);
    // Gap between the two objects scales by the same factor.
    const gapBefore = large.x - (small.x + small.width); // 400
    const gapAfter = largeAfter.x - (smallAfter.x + smallAfter.width);
    expect(gapAfter).toBe(gapBefore * clamped.x);
  });

  // TC-04: two 200-unit notes 100 units apart; the box width ×2 →
  // each note 400 wide, gap 200.
  it('TC-04: scaleWithin doubles sizes and gaps when the box width doubles', () => {
    const noteA: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const noteB: Rect = { x: 300, y: 0, width: 200, height: 200 }; // 100 apart
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };

    const aAfter = scaleWithin(noteA, from, to);
    const bAfter = scaleWithin(noteB, from, to);

    expect(aAfter.width).toBe(400);
    expect(bAfter.width).toBe(400);
    const gap = bAfter.x - (aAfter.x + aAfter.width);
    expect(gap).toBe(200);
  });

  it('rectContains: fully inside yes; touching edge from inside yes; partly inside no; outside no', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(rectContains(outer, { x: 80, y: 80, width: 20, height: 20 })).toBe(true); // edge coincides
    expect(rectContains(outer, { x: 90, y: 10, width: 20, height: 20 })).toBe(false); // partly
    expect(rectContains(outer, { x: 100, y: 10, width: 20, height: 20 })).toBe(false); // outside
  });

  it('unionRects: empty → null; mixed → enclosing rect', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 10, y: 20, width: 100, height: 50 }, { x: -5, y: 5, width: 30, height: 80 }])).toEqual({
      x: -5,
      y: 5,
      width: 115,
      height: 80,
    });
  });

  it('normalizeRect: order-independent', () => {
    expect(normalizeRect({ x: 5, y: 7 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2, width: 4, height: 5 });
    expect(normalizeRect({ x: 1, y: 2 }, { x: 5, y: 7 })).toEqual({ x: 1, y: 2, width: 4, height: 5 });
  });

  it('resizeRect: edge handles change one axis only', () => {
    const start: Rect = { x: 0, y: 0, width: 100, height: 50 };
    expect(resizeRect(start, 'e', { x: 30, y: 10 }, false)).toEqual({ x: 0, y: 0, width: 130, height: 50 });
    expect(resizeRect(start, 'w', { x: 30, y: 10 }, false)).toEqual({ x: 30, y: 0, width: 70, height: 50 });
    expect(resizeRect(start, 'n', { x: 10, y: 30 }, false)).toEqual({ x: 0, y: 30, width: 100, height: 20 });
    expect(resizeRect(start, 's', { x: 10, y: 30 }, false)).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  });

  it('clampScale: non-finite or non-positive scale → no change', () => {
    const rects = [{ x: 0, y: 0, width: 100, height: 100 }];
    expect(clampScale({ x: NaN, y: 1 }, rects, [10], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
    expect(clampScale({ x: 1, y: -2 }, rects, [10], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
  });
});
