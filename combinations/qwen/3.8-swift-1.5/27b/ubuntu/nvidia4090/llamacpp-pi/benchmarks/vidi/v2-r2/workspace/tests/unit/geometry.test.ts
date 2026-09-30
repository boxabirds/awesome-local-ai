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

describe('sel.geometry_ops (unit)', () => {
  it('TC-01: resizeRect se handle, aspectLocked: 200×200 + (100,40) → 300×300', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    // Aspect locked (sticky notes): the dominant axis (width, 1.5×) wins.
    expect(resizeRect(start, 'se', { x: 100, y: 40 }, true)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
    // Not locked: each axis follows its pointer component.
    expect(resizeRect(start, 'se', { x: 100, y: 40 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 240,
    });
  });

  it('resizeRect anchors at the opposite corner/edge for every handle', () => {
    const start: Rect = { x: 10, y: 20, width: 100, height: 50 };
    // nw: both axes shrink, box anchored at bottom-right (110, 70).
    expect(resizeRect(start, 'nw', { x: 30, y: 10 }, false)).toEqual({
      x: 40,
      y: 30,
      width: 70,
      height: 40,
    });
    // e: width only; left edge stays at x=10.
    expect(resizeRect(start, 'e', { x: 25, y: 999 }, false)).toEqual({
      x: 10,
      y: 20,
      width: 125,
      height: 50,
    });
    // n: height only, anchored at the bottom edge (y=70).
    expect(resizeRect(start, 'n', { x: 999, y: 15 }, false)).toEqual({
      x: 10,
      y: 35,
      width: 100,
      height: 35,
    });
    // Edge handle with aspect lock: the pointer axis drives both; the
    // perpendicular axis anchors at the top edge (e/w grow downward).
    expect(resizeRect(start, 'e', { x: 50, y: 0 }, true)).toEqual({
      x: 10,
      y: 20,
      width: 150,
      height: 75,
    });
  });

  it('TC-02: shrinking below STICKY_MIN_SIZE_WORLD is clamped to 50×50 (boundary)', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD];

    // (min − 1) would give 49×49 → clamped to exactly the minimum.
    const below = (STICKY_MIN_SIZE_WORLD - 1) / 200;
    const sBelow = clampScale({ x: below, y: below }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(rects[0].width * sBelow.x).toBe(STICKY_MIN_SIZE_WORLD);
    expect(rects[0].height * sBelow.y).toBe(STICKY_MIN_SIZE_WORLD);

    // Exactly at the minimum → unchanged.
    const exact = STICKY_MIN_SIZE_WORLD / 200;
    const sExact = clampScale({ x: exact, y: exact }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(sExact.x).toBe(exact);
    expect(rects[0].width * sExact.x).toBe(STICKY_MIN_SIZE_WORLD);
  });

  it('TC-03: clampScale stops the whole selection when the first object hits MAX_OBJECT_SIZE_WORLD', () => {
    // Two objects, one twice as wide (tall heights so only the width binds).
    // A 200× growth would push the wide one to 40000 > MAX; the scale must
    // stop at 100× (wide one exactly at MAX), preserving the relative layout.
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 5000 },
      { x: 200, y: 0, width: 200, height: 5000 },
    ];
    const s = clampScale({ x: 200, y: 200 }, rects, [10, 10], MAX_OBJECT_SIZE_WORLD);
    expect(s.x).toBe(MAX_OBJECT_SIZE_WORLD / 200);
    expect(rects[1].width * s.x).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(rects[0].width * s.x).toBe(10000);
    // Gap between the two objects scaled uniformly: 100 → 10000.
    const gap = rects[1].x * s.x - (rects[0].x * s.x + rects[0].width * s.x);
    expect(gap).toBe(10000);

    // The same machinery clamps shrinking to the per-object minimum:
    // the 100-wide object hits its minimum (10) at scale 0.1 first.
    const sSmall = clampScale({ x: 0.01, y: 200 }, rects, [10, 10], MAX_OBJECT_SIZE_WORLD);
    expect(sSmall.x).toBe(0.1);
  });

  it('TC-04: two 200-unit notes 100 apart, box width ×2 → 400 wide, gap 200', () => {
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    const a = scaleWithin({ x: 0, y: 0, width: 200, height: 200 }, from, to);
    const b = scaleWithin({ x: 300, y: 0, width: 200, height: 200 }, from, to);
    expect(a).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(b.width).toBe(400);
    // The gap doubled from 100 to 200.
    expect(b.x - (a.x + a.width)).toBe(200);
  });

  it('rectContains: fully inside yes; touching from outside / partly inside no', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 50, height: 50 })).toBe(true);
    // Exactly coinciding edges count as inside.
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    // Partly inside (sticks out of the right edge).
    expect(rectContains(outer, { x: 50, y: 10, width: 60, height: 50 })).toBe(false);
    // Touching the edge from outside.
    expect(rectContains(outer, { x: 100, y: 10, width: 50, height: 50 })).toBe(false);
    // Completely outside.
    expect(rectContains(outer, { x: 200, y: 200, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects: null for empty; covers all rects otherwise', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 5, y: 5, width: 10, height: 10 }])).toEqual({
      x: 5,
      y: 5,
      width: 10,
      height: 10,
    });
    expect(unionRects([{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 30, width: 5, height: 5 }])).toEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 35,
    });
  });

  it('normalizeRect: any quadrant', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 40, y: 30 })).toEqual({
      x: 10,
      y: 10,
      width: 30,
      height: 20,
    });
    expect(normalizeRect({ x: 40, y: 30 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      width: 30,
      height: 20,
    });
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});
