// Unit tests for the selection geometry (story 7, sel.geometry_ops):
// TC-01 to TC-04 plus containment, union and normalisation coverage.
// Pure functions — no Y.Doc, no DOM.

import { describe, expect, it } from 'vitest';
import {
  HANDLE_NAMES,
  HANDLES,
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe('sel.geometry_ops (unit)', () => {
  it('TC-01: resizeRect se handle, aspect locked: 200x200 + (100,40) → 300x300', () => {
    const out = resizeRect(r(0, 0, 200, 200), 'se', { x: 100, y: 40 }, true);
    expect(out).toEqual(r(0, 0, 300, 300));
  });

  it('TC-02: shrinking below STICKY_MIN_SIZE_WORLD clamps at exactly 50 (boundary)', () => {
    const start = r(0, 0, 200, 200);

    // One unit under the minimum (49): the clamped scale lands exactly on 50.
    const under = resizeRect(start, 'se', { x: -151, y: -151 }, true);
    expect(under).toEqual(r(0, 0, 49, 49));
    const scaleUnder = clampScale(
      { x: under.width / start.width, y: under.height / start.height },
      [start],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(start.width * scaleUnder.x).toBe(STICKY_MIN_SIZE_WORLD);
    expect(start.height * scaleUnder.y).toBe(STICKY_MIN_SIZE_WORLD);

    // Exactly at the minimum (50): the scale passes through unchanged.
    const exact = resizeRect(start, 'se', { x: -150, y: -150 }, true);
    expect(exact).toEqual(r(0, 0, 50, 50));
    const scaleExact = clampScale(
      { x: exact.width / start.width, y: exact.height / start.height },
      [start],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(start.width * scaleExact.x).toBe(STICKY_MIN_SIZE_WORLD);
  });

  it('TC-03: clampScale stops uniformly when the first object would cross a limit; relative layout preserved', () => {
    // Max side: the 3000-wide object would reach 30000 → clamped so it is
    // exactly MAX_OBJECT_SIZE_WORLD; the 100-wide object scales by the same
    // factor (no per-object stopping, no distortion).
    const big = r(0, 0, 3000, 2000);
    const small = r(100, 100, 100, 100);
    const clamped = clampScale({ x: 10, y: 10 }, [big, small], [50, 50], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 3000, 12);
    expect(big.width * clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
    expect(small.width * clamped.x).toBeCloseTo(100 * (MAX_OBJECT_SIZE_WORLD / 3000), 6);
    // Height: 2000 * 10 = 20000 is exactly the maximum → allowed.
    expect(clamped.y).toBe(10);

    // Min side: the 100x100 object with minSize 10 stops the shrink first
    // (10/100 = 0.1 beats 50/3000 ≈ 0.017).
    const minClamped = clampScale({ x: 0.01, y: 0.01 }, [big, small], [50, 10], MAX_OBJECT_SIZE_WORLD);
    expect(minClamped.x).toBe(10 / 100);
    expect(minClamped.y).toBe(10 / 100);

    // Relative layout is preserved: both objects are scaled within the
    // clamped bounding box, so each keeps its position relative to the box.
    const from = unionRects([big, small])!;
    const to = r(from.x, from.y, from.width * clamped.x, from.height * clamped.y);
    const bigOut = scaleWithin(big, from, to);
    const smallOut = scaleWithin(small, from, to);
    expect(bigOut.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
    expect(smallOut.width).toBeCloseTo(100 * clamped.x, 6);
    expect(smallOut.x).toBeCloseTo(100 * clamped.x, 6); // 100 units in, scaled
    expect(smallOut.y).toBeCloseTo(100 * clamped.y, 6);
  });

  it('TC-04: two 200-unit notes 100 apart, box width x2 → 400 wide each, gap 200', () => {
    const a = r(0, 0, 200, 200);
    const b = r(300, 0, 200, 200);
    const from = unionRects([a, b])!;
    expect(from).toEqual(r(0, 0, 500, 200));

    const to = r(0, 0, 1000, 200); // box width doubled
    const a2 = scaleWithin(a, from, to);
    const b2 = scaleWithin(b, from, to);
    expect(a2).toEqual(r(0, 0, 400, 200));
    expect(b2).toEqual(r(600, 0, 400, 200));
    expect(b2.x - (a2.x + a2.width)).toBe(200); // gap doubled
  });

  it('rectContains: fully inside is contained, partly inside and outside are not (TC-07 mirror)', () => {
    const outer = r(0, 0, 300, 300);
    expect(rectContains(outer, r(0, 0, 200, 200))).toBe(true); // A: fully inside
    expect(rectContains(outer, r(200, 0, 200, 200))).toBe(false); // B: half inside
    expect(rectContains(outer, r(500, 0, 200, 200))).toBe(false); // C: outside
    // Touching the edge without enclosing is not contained.
    expect(rectContains(outer, r(-1, 0, 200, 200))).toBe(false);
    // Equal rects contain each other.
    expect(rectContains(outer, outer)).toBe(true);
  });

  it('unionRects: null for empty, bounding box for many, single rect unchanged', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([r(0, 0, 10, 10)])).toEqual(r(0, 0, 10, 10));
    expect(unionRects([r(10, 20, 30, 40), r(-5, -5, 10, 10), r(100, 0, 1, 1)])).toEqual(r(-5, -5, 106, 65));
  });

  it('normalizeRect: order-independent (dragging in any direction)', () => {
    expect(normalizeRect({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual(r(0, 0, 100, 50));
    expect(normalizeRect({ x: 100, y: 50 }, { x: 0, y: 0 })).toEqual(r(0, 0, 100, 50));
    expect(normalizeRect({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual(r(10, 10, 0, 0));
  });

  it('resizeRect: edge handles move the dragged edge with the delta (no aspect lock)', () => {
    const start = r(0, 0, 200, 100);
    // 'e': east edge moves right → wider; the other edges stay put.
    expect(resizeRect(start, 'e', { x: 50, y: 999 }, false)).toEqual(r(0, 0, 250, 100));
    // 'w': west edge moves right → narrower.
    expect(resizeRect(start, 'w', { x: 30, y: 999 }, false)).toEqual(r(30, 0, 170, 100));
    expect(resizeRect(start, 's', { x: 999, y: 40 }, false)).toEqual(r(0, 0, 200, 140));
    // 'n': north edge moves down → shorter.
    expect(resizeRect(start, 'n', { x: 999, y: 20 }, false)).toEqual(r(0, 20, 200, 80));
  });

  it('resizeRect: corner handles change both axes, anchored at the opposite corner', () => {
    const start = r(10, 20, 200, 100);
    expect(resizeRect(start, 'nw', { x: 30, y: 10 }, false)).toEqual(r(40, 30, 170, 90));
    expect(resizeRect(start, 'ne', { x: 30, y: -10 }, false)).toEqual(r(10, 10, 230, 110));
    expect(resizeRect(start, 'sw', { x: -30, y: 15 }, false)).toEqual(r(-20, 20, 230, 115));
  });

  it('resizeRect: aspect lock on an edge handle keeps the ratio (dominant scale)', () => {
    const start = r(0, 0, 200, 100);
    // 'e' with aspect: the requested width scale 1.5 stretches the height too.
    expect(resizeRect(start, 'e', { x: 100, y: 0 }, true)).toEqual(r(0, 0, 300, 150));
    // 'n' with aspect: dragging the top edge 200 up gives scale 3 on height,
    // which stretches the width too.
    expect(resizeRect(start, 'n', { x: 0, y: -200 }, true)).toEqual(r(0, -200, 600, 300));
  });

  it('handles: 8 positions with distinct accessible names', () => {
    expect(HANDLES).toHaveLength(8);
    const names = HANDLES.map((h) => HANDLE_NAMES[h]);
    expect(new Set(names).size).toBe(8);
    expect(HANDLE_NAMES.nw).toBe('top-left');
    expect(HANDLE_NAMES.se).toBe('bottom-right');
  });
});
