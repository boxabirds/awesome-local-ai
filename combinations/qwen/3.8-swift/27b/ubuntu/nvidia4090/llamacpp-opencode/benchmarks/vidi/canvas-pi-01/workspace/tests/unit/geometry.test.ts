// sel.geometry_ops (story 7, TC-01 to TC-04, TC-09 partial): pure geometry.

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
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

describe('sel.geometry_ops — geometry', () => {
  it('TC-01 resizeRect se handle, aspectLocked: 200x200 + (100,40) -> 300x300', () => {
    const start: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    const out = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(out).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('TC-02 shrinking past STICKY_MIN_SIZE_WORLD is clamped: -1 and exact boundaries -> 50x50', () => {
    const start: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    // Target 49x49 (min - 1): scale 49/200 must clamp to 50/200.
    const below = clampScale({ x: 49 / 200, y: 49 / 200 }, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(start.width * below.x).toBe(STICKY_MIN_SIZE_WORLD);
    expect(start.height * below.y).toBe(STICKY_MIN_SIZE_WORLD);
    // Target exactly 50x50: allowed, no clamp.
    const exact = clampScale({ x: 50 / 200, y: 50 / 200 }, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(exact.x).toBeCloseTo(0.25, 12);
    expect(exact.y).toBeCloseTo(0.25, 12);
    expect(start.width * exact.x).toBe(STICKY_MIN_SIZE_WORLD);
  });

  it('TC-03 clampScale stops the whole selection uniformly at MAX_OBJECT_SIZE_WORLD; layout preserved', () => {
    // A 100x100 note and a note that is already 20,000 wide.
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 300, y: 0, width: MAX_OBJECT_SIZE_WORLD, height: 100 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    const clamped = clampScale({ x: 2, y: 1 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // The 20,000-wide object would exceed the max at any scale > 1.
    expect(clamped.x).toBe(1);
    expect(clamped.y).toBe(1);
    // Relative layout preserved: scaling the bounding box by the clamped
    // scale leaves every object exactly where it was.
    const box = unionRects(rects)!;
    const to = { x: box.x, y: box.y, width: box.width * clamped.x, height: box.height * clamped.y };
    expect(scaleWithin(rects[0]!, box, to)).toEqual(rects[0]);
    expect(scaleWithin(rects[1]!, box, to)).toEqual(rects[1]);
  });

  it('TC-04 two 200-unit notes 100 apart, box width x2 -> 400 wide, gap 200', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const from = unionRects([a, b])!; // 0..500 wide
    const to = { x: from.x, y: from.y, width: from.width * 2, height: from.height };
    const a2 = scaleWithin(a, from, to);
    const b2 = scaleWithin(b, from, to);
    expect(a2.width).toBe(400);
    expect(b2.width).toBe(400);
    expect(b2.x - (a2.x + a2.width)).toBe(200);
  });

  it('resizeRect edge handles change one axis only', () => {
    const start: Rect = { x: 10, y: 20, width: 200, height: 100 };
    expect(resizeRect(start, 'e', { x: 50, y: 10 }, false)).toEqual({ x: 10, y: 20, width: 250, height: 100 });
    expect(resizeRect(start, 'w', { x: 30, y: 10 }, false)).toEqual({ x: 40, y: 20, width: 170, height: 100 });
    expect(resizeRect(start, 'n', { x: 10, y: 25 }, false)).toEqual({ x: 10, y: 45, width: 200, height: 75 });
    expect(resizeRect(start, 's', { x: 10, y: 40 }, false)).toEqual({ x: 10, y: 20, width: 200, height: 140 });
  });

  it('resizeRect corner handles keep the opposite corner fixed', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 200 };
    expect(resizeRect(start, 'nw', { x: -50, y: -50 }, false)).toEqual({ x: 50, y: 50, width: 250, height: 250 });
    expect(resizeRect(start, 'sw', { x: -50, y: 50 }, false)).toEqual({ x: 50, y: 100, width: 250, height: 250 });
    expect(resizeRect(start, 'ne', { x: 50, y: -50 }, false)).toEqual({ x: 100, y: 50, width: 250, height: 250 });
  });

  it('resizeRect aspect lock keeps the ratio on every handle', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
    const e = resizeRect(start, 'e', { x: 100, y: 999 }, true);
    expect(e.width / e.height).toBeCloseTo(2, 12);
    const w = resizeRect(start, 'w', { x: -50, y: 999 }, true);
    expect(w.width / w.height).toBeCloseTo(2, 12);
    expect(w.x + w.width).toBe(200);
  });

  it('rectContains: fully inside yes, partly inside no, touching edge no', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 80, height: 80 })).toBe(true);
    expect(rectContains(outer, { x: 50, y: 10, width: 80, height: 80 })).toBe(false);
    // Touching the outer boundary without lying inside: not contained.
    expect(rectContains(outer, { x: 100, y: 10, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects: empty -> null; two rects -> enclosing rect', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: -5, width: 20, height: 30 }])).toEqual({
      x: 0,
      y: -5,
      width: 25,
      height: 30,
    });
  });

  it('normalizeRect: negative deltas normalised away', () => {
    expect(normalizeRect({ x: 100, y: 50 }, { x: 40, y: 90 })).toEqual({ x: 40, y: 50, width: 60, height: 40 });
    expect(normalizeRect({ x: 4, y: 9 }, { x: 4, y: 9 })).toEqual({ x: 4, y: 9, width: 0, height: 0 });
  });

  it('clampScale: non-finite scale -> identity; min sizes raise the floor', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
    expect(clampScale({ x: NaN, y: Infinity }, rects, [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1,
      y: 1,
    });
    const raised = clampScale({ x: 0.1, y: 0.1 }, rects, [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(raised.x).toBeCloseTo(0.25, 12);
    expect(raised.y).toBeCloseTo(0.25, 12);
  });

  it('scaleWithin: degenerate source rect -> child unchanged', () => {
    const child: Rect = { x: 5, y: 5, width: 10, height: 10 };
    expect(scaleWithin(child, { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 100, height: 100 })).toEqual(child);
  });
});
