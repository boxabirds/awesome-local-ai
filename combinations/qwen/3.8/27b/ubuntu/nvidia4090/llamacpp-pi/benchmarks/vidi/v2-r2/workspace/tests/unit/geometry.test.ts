/**
 * Story 7, sel.geometry_ops (unit TC-01 to TC-04) — pure geometry.
 *
 * resizeRect / clampScale / scaleWithin / rectContains / unionRects /
 * normalizeRect are pure; board-level group ops are covered in
 * board-model-group.test.ts against a real Y.Doc.
 */
import { describe, expect, it } from 'vitest';
import {
  HANDLES,
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Rect,
} from '../../src/shared/geometry';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

const r = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

describe('rectContains (marquee containment rule)', () => {
  it('is true only when all four edges of the inner rect are inside', () => {
    const marquee = r(0, 0, 100, 100);
    expect(rectContains(marquee, r(10, 10, 80, 80))).toBe(true); // fully inside
    expect(rectContains(marquee, r(0, 0, 100, 100))).toBe(true); // exact fit
    // Partly inside: crosses an edge.
    expect(rectContains(marquee, r(50, 50, 100, 100))).toBe(false);
    expect(rectContains(marquee, r(-50, 10, 60, 20))).toBe(false);
    expect(rectContains(marquee, r(10, -50, 20, 60))).toBe(false);
    // Touching the edge from outside.
    expect(rectContains(marquee, r(95, 0, 10, 100))).toBe(false);
    // Bigger rect around the marquee.
    expect(rectContains(marquee, r(-10, -10, 120, 120))).toBe(false);
  });
});

describe('unionRects', () => {
  it('unions overlapping and disjoint rects, including negatives', () => {
    expect(unionRects([r(0, 0, 100, 100), r(50, 50, 100, 100)])).toEqual(
      r(0, 0, 150, 150),
    );
    expect(unionRects([r(0, 0, 10, 10), r(100, 200, 10, 10)])).toEqual(
      r(0, 0, 110, 210),
    );
    expect(unionRects([r(-50, -20, 10, 10), r(0, 0, 10, 10)])).toEqual(
      r(-50, -20, 60, 30),
    );
    expect(unionRects([r(3, 4, 5, 6)])).toEqual(r(3, 4, 5, 6));
  });

  it('returns null for an empty list (no selection bounding box)', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([r(0, 0, 0, 0)])).toBeNull();
  });
});

describe('normalizeRect', () => {
  it('produces a positive rect for drags in all four directions', () => {
    const start = { x: 100, y: 100 };
    // Down-right.
    expect(normalizeRect(start, { x: 140, y: 130 })).toEqual(r(100, 100, 40, 30));
    // Up-left.
    expect(normalizeRect(start, { x: 60, y: 70 })).toEqual(r(60, 70, 40, 30));
    // Up-right.
    expect(normalizeRect(start, { x: 140, y: 70 })).toEqual(r(100, 70, 40, 30));
    // Down-left.
    expect(normalizeRect(start, { x: 60, y: 130 })).toEqual(r(60, 100, 40, 30));
    // Zero-size drag.
    expect(normalizeRect(start, start)).toEqual(r(100, 100, 0, 0));
  });
});

describe('resizeRect', () => {
  it('TC-01: se handle, aspect locked, 200×200 + (100,40) → 300×300', () => {
    const start = r(0, 0, 200, 200);
    expect(resizeRect(start, 'se', { x: 100, y: 40 }, true)).toEqual(
      r(0, 0, 300, 300),
    );
  });

  it('each of the eight handles moves the right edge(s) when unlocked', () => {
    const start = r(100, 100, 200, 100);
    const d = { x: 40, y: 20 };
    expect(resizeRect(start, 'e', d, false)).toEqual(r(100, 100, 240, 100));
    expect(resizeRect(start, 'w', d, false)).toEqual(r(140, 100, 160, 100));
    expect(resizeRect(start, 's', d, false)).toEqual(r(100, 100, 200, 120));
    expect(resizeRect(start, 'n', d, false)).toEqual(r(100, 120, 200, 80));
    expect(resizeRect(start, 'se', d, false)).toEqual(r(100, 100, 240, 120));
    expect(resizeRect(start, 'sw', d, false)).toEqual(r(140, 100, 160, 120));
    expect(resizeRect(start, 'ne', d, false)).toEqual(r(100, 120, 240, 80));
    expect(resizeRect(start, 'nw', d, false)).toEqual(r(140, 120, 160, 80));
  });

  it('negative drags pull edges back', () => {
    const start = r(0, 0, 100, 100);
    expect(resizeRect(start, 'e', { x: -30, y: 0 }, false)).toEqual(
      r(0, 0, 70, 100),
    );
    expect(resizeRect(start, 's', { x: 0, y: -30 }, false)).toEqual(
      r(0, 0, 100, 70),
    );
  });

  it('never flips to a negative size when dragged past the opposite edge', () => {
    const start = r(0, 0, 100, 100);
    const west = resizeRect(start, 'w', { x: 500, y: 0 }, false);
    expect(west.width).toBeGreaterThan(0);
    expect(west.x + west.width).toBe(100); // east edge stays put
    const north = resizeRect(start, 'n', { x: 0, y: 500 }, false);
    expect(north.height).toBeGreaterThan(0);
    expect(north.y + north.height).toBe(100);
    expect(resizeRect(start, 'e', { x: -500, y: 0 }, false).width).toBeGreaterThan(0);
    expect(resizeRect(start, 's', { x: 0, y: -500 }, false).height).toBeGreaterThan(0);
  });

  it('aspect lock keeps the ratio for corners, anchored at the opposite corner', () => {
    const start = r(0, 0, 200, 100); // 2:1
    // SE dragged horizontally: height follows the width scale.
    const out = resizeRect(start, 'se', { x: 100, y: 5 }, true);
    expect(out).toEqual(r(0, 0, 300, 150));
    // NW dragged up: width follows the height scale; bottom-right stays put.
    const up = resizeRect(start, 'nw', { x: 5, y: -25 }, true);
    expect(up).toEqual(r(-50, -25, 250, 125));
    expect(up.x + up.width).toBe(200);
    expect(up.y + up.height).toBe(100);
    // NW dragged down: shrinks.
    const down = resizeRect(start, 'nw', { x: 5, y: 25 }, true);
    expect(down).toEqual(r(50, 25, 150, 75));
    // NE: left edge and bottom edge stay put.
    const ne = resizeRect(start, 'ne', { x: 100, y: -25 }, true);
    expect(ne).toEqual(r(0, -50, 300, 150));
    // SW: right edge and top edge stay put.
    const sw = resizeRect(start, 'sw', { x: -50, y: 50 }, true);
    expect(sw).toEqual(r(-50, 0, 250, 125));
  });

  it('aspect lock on edge handles: the other axis follows, opposite edge fixed', () => {
    const start = r(0, 0, 200, 100); // 2:1
    // East edge out: width leads, height follows, top edge fixed.
    expect(resizeRect(start, 'e', { x: 100, y: 9 }, true)).toEqual(
      r(0, 0, 300, 150),
    );
    // West edge in (left edge moves right): width leads, top edge fixed,
    // right edge stays put.
    expect(resizeRect(start, 'w', { x: 50, y: 9 }, true)).toEqual(
      r(50, 0, 150, 75),
    );
    // North edge up: height leads, width follows, left edge fixed.
    expect(resizeRect(start, 'n', { x: 9, y: -50 }, true)).toEqual(
      r(0, -50, 300, 150),
    );
    // South edge down.
    expect(resizeRect(start, 's', { x: 9, y: 50 }, true)).toEqual(
      r(0, 0, 300, 150),
    );
  });

  it('zero delta is the identity for every handle', () => {
    const start = r(10, 20, 30, 40);
    for (const h of HANDLES) {
      expect(resizeRect(start, h, { x: 0, y: 0 }, false)).toEqual(start);
      expect(resizeRect(start, h, { x: 0, y: 0 }, true)).toEqual(start);
    }
  });

  it('accepts every handle in the exported set', () => {
    expect(HANDLES).toHaveLength(8);
    expect(new Set<Handle>(HANDLES).size).toBe(8);
  });
});

describe('scaleWithin', () => {
  it('TC-04: two 200-unit notes 100 apart, box width ×2 → 400 wide, gap 200', () => {
    const a = r(0, 0, 200, 200);
    const b = r(300, 0, 200, 200); // 100-unit gap
    const from = unionRects([a, b])!; // 0..500 wide
    const to = r(0, 0, from.width * 2, from.height);
    const a2 = scaleWithin(a, from, to);
    const b2 = scaleWithin(b, from, to);
    expect(a2).toEqual(r(0, 0, 400, 200));
    expect(b2).toEqual(r(600, 0, 400, 200));
    expect(b2.x - (a2.x + a2.width)).toBe(200); // gap doubled
  });

  it('scales non-uniformly per axis and translates', () => {
    const from = r(0, 0, 100, 100);
    const to = r(50, 50, 200, 50); // 2x wide, 0.5x tall, moved
    expect(scaleWithin(r(0, 0, 50, 50), from, to)).toEqual(r(50, 50, 100, 25));
    expect(scaleWithin(r(50, 50, 50, 50), from, to)).toEqual(
      r(150, 75, 100, 25),
    );
  });

  it('shrinking works too', () => {
    const from = r(0, 0, 200, 200);
    const to = r(0, 0, 100, 100);
    expect(scaleWithin(r(0, 0, 200, 200), from, to)).toEqual(r(0, 0, 100, 100));
  });
});

describe('clampScale', () => {
  it('TC-02: shrinking a 200×200 sticky below STICKY_MIN_SIZE_WORLD clamps at exactly 50×50', () => {
    const rect = r(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD);
    // Scale that would make it 49 wide (below min by 1).
    const below = clampScale(
      { x: 49 / STICKY_SIZE_WORLD, y: 49 / STICKY_SIZE_WORLD },
      [rect],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(STICKY_SIZE_WORLD * below.x).toBe(STICKY_MIN_SIZE_WORLD);
    expect(STICKY_SIZE_WORLD * below.y).toBe(STICKY_MIN_SIZE_WORLD);
    // Scale that lands exactly on the min: unchanged.
    const exact = clampScale(
      { x: STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, y: STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD },
      [rect],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(exact.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD);
    expect(exact.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD);
    // Above the min: unchanged.
    const above = clampScale(
      { x: 1, y: 1 },
      [rect],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(above).toEqual({ x: 1, y: 1 });
  });

  it('TC-03: mixed rects stop uniformly when the first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
    // One wide-ish, one small; a uniform 2x would push the big one past max.
    const big = r(0, 0, MAX_OBJECT_SIZE_WORLD / 2, MAX_OBJECT_SIZE_WORLD / 2);
    const small = r(10, 10, 100, 100);
    const clamped = clampScale(
      { x: 2, y: 2 },
      [big, small],
      [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    // The big object lands exactly on the limit.
    expect(big.width * clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
    expect(big.height * clamped.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
    // Relative layout preserved: the small object is scaled by the same factor.
    const smallAfter = scaleWithin(small, r(0, 0, big.width, big.height), {
      x: 0,
      y: 0,
      width: big.width * clamped.x,
      height: big.height * clamped.y,
    });
    expect(smallAfter.width / small.width).toBeCloseTo(clamped.x);
    expect(smallAfter.height / small.height).toBeCloseTo(clamped.y);
  });

  it('clamps each axis independently when the bounds differ per axis', () => {
    const wide = r(0, 0, MAX_OBJECT_SIZE_WORLD / 2, 100);
    const clamped = clampScale(
      { x: 2, y: 2 },
      [wide],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(wide.width * clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
    expect(clamped.y).toBe(2); // height bound not hit
  });

  it('passes through a scale that fits, and ignores degenerate rects', () => {
    expect(clampScale({ x: 1.5, y: 0.5 }, [r(0, 0, 100, 100)], [10], 20000)).toEqual({
      x: 1.5,
      y: 0.5,
    });
    expect(clampScale({ x: 3, y: 3 }, [], [10], 20000)).toEqual({ x: 3, y: 3 });
    expect(clampScale({ x: 3, y: 3 }, [r(0, 0, 0, 0)], [10], 20000)).toEqual({
      x: 3,
      y: 3,
    });
  });

  it('with contradictory limits the max bound wins', () => {
    // A rect already bigger than maxSize on one axis can never satisfy both.
    const huge = r(0, 0, MAX_OBJECT_SIZE_WORLD * 2, 100);
    const clamped = clampScale(
      { x: 1, y: 1 },
      [huge],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / huge.width);
  });
});
