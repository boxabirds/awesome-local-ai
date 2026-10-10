import { describe, expect, test } from 'vitest';
import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Rect
} from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

describe('geometry: rectContains', () => {
  test('fully inside is true, partly or outside is false', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    // Touching the border from the inside counts as inside.
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    // Poking past any edge (partly inside) is not inside.
    expect(rectContains(outer, { x: 90, y: 10, width: 20, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: -1, y: 10, width: 20, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: 200, y: 200, width: 10, height: 10 })).toBe(false);
  });
});

describe('geometry: unionRects / normalizeRect', () => {
  test('union of empty list is null', () => {
    expect(unionRects([])).toBeNull();
  });

  test('union spans all four extremes', () => {
    const u = unionRects([
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 300, y: -50, width: 100, height: 100 }
    ]);
    expect(u).toEqual({ x: 0, y: -50, width: 400, height: 250 });
  });

  test('normalizeRect flips inverted drags', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 20
    });
  });
});

describe('geometry: resizeRect', () => {
  // TC-01
  test('TC-01 se corner with aspect lock: 200×200 + (100, 40) → 300×300', () => {
    const r = resizeRect({ x: 0, y: 0, width: 200, height: 200 }, 'se', { x: 100, y: 40 }, true);
    expect(r.width).toBeCloseTo(300);
    expect(r.height).toBeCloseTo(300);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0); // opposite anchor (top-left) stays fixed
  });

  test('edge handle without aspect lock changes one axis only', () => {
    const r = resizeRect({ x: 0, y: 0, width: 200, height: 100 }, 'e', { x: 50, y: 0 }, false);
    expect(r).toEqual({ x: 0, y: 0, width: 250, height: 100 });
    const w = resizeRect({ x: 0, y: 0, width: 200, height: 100 }, 'w', { x: 30, y: 0 }, false);
    expect(w).toEqual({ x: 30, y: 0, width: 170, height: 100 });
  });

  test('aspect-locked edge handle scales both axes, keeping the anchored edge', () => {
    // 'e' grows width ×1.5; height follows with the vertical centre fixed.
    const r = resizeRect({ x: 0, y: 0, width: 200, height: 100 }, 'e', { x: 100, y: 0 }, true);
    expect(r.width).toBeCloseTo(300);
    expect(r.height).toBeCloseTo(150);
    expect(r.x).toBe(0);
    expect(r.y).toBeCloseTo(-25);
  });

  test('north handle keeps the bottom edge fixed', () => {
    const r = resizeRect({ x: 0, y: 0, width: 200, height: 200 }, 'n', { x: 0, y: -100 }, true);
    expect(r.width).toBeCloseTo(300);
    expect(r.height).toBeCloseTo(300);
    expect(r.y).toBeCloseTo(-100); // y + height stays 200
    expect(r.x).toBeCloseTo(-50); // centre stays 100
  });
});

describe('geometry: clampScale', () => {
  // TC-02 (boundary: STICKY_MIN_SIZE_WORLD − 1 and exactly)
  test('TC-02 uniform shrink clamps at STICKY_MIN_SIZE_WORLD', () => {
    const rect: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const below = clampScale(
      { x: STICKY_MIN_SIZE_WORLD / 200 - 0.005, y: STICKY_MIN_SIZE_WORLD / 200 - 0.005 },
      [rect],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD
    );
    expect(below.x * 200).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
    expect(below.y * 200).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
    const exact = clampScale(
      { x: 0.25, y: 0.25 },
      [rect],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD
    );
    expect(exact).toEqual({ x: 0.25, y: 0.25 });
    // The clamped scale applied through scaleWithin lands on exactly 50×50.
    const out = scaleWithin(rect, rect, { x: 0, y: 0, width: 200 * below.x, height: 200 * below.y });
    expect(out.width).toBeCloseTo(50);
    expect(out.height).toBeCloseTo(50);
  });

  // TC-03
  test('TC-03 uniform grow stops when the first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
    const first: Rect = { x: 0, y: 0, width: 10_000, height: 10_000 };
    const second: Rect = { x: 10_000, y: 0, width: 100, height: 100 };
    const rects = [first, second];
    const clamped = clampScale({ x: 3, y: 3 }, rects, [50, 10], MAX_OBJECT_SIZE_WORLD);
    expect(clamped).toEqual({ x: 2, y: 2 });
    // Relative layout is preserved: each object scales by the same factor.
    const from = unionRects(rects)!;
    const to = { x: from.x, y: from.y, width: from.width * 2, height: from.height * 2 };
    const grownFirst = scaleWithin(first, from, to);
    expect(grownFirst.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
    const grownSecond = scaleWithin(second, from, to);
    expect(grownSecond.width).toBeCloseTo(200);
    expect(grownSecond.x).toBeCloseTo(20_000);
  });

  test('per-axis clamp keeps each axis within both limits', () => {
    const rect: Rect = { x: 0, y: 0, width: 200, height: 100 };
    const clamped = clampScale({ x: 0.1, y: 300 }, [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x * 200).toBeCloseTo(STICKY_MIN_SIZE_WORLD); // width stops at min
    expect(clamped.y * 100).toBeCloseTo(MAX_OBJECT_SIZE_WORLD); // height stops at max
  });
});

describe('geometry: scaleWithin', () => {
  // TC-04
  test('TC-04 two notes 100 apart, box width ×2 → notes 400 wide, gap 200', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const from = unionRects([a, b])!;
    expect(from).toEqual({ x: 0, y: 0, width: 500, height: 200 });
    const to = { x: 0, y: 0, width: 1000, height: 200 };
    const sa = scaleWithin(a, from, to);
    const sb = scaleWithin(b, from, to);
    expect(sa.width).toBeCloseTo(400);
    expect(sa.height).toBeCloseTo(200);
    expect(sb.width).toBeCloseTo(400);
    expect(sb.x - (sa.x + sa.width)).toBeCloseTo(200); // the gap doubled too
  });
});
