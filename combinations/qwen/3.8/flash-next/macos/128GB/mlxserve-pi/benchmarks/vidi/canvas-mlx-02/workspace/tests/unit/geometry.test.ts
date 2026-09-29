// Story 7, sel.geometry_ops — pure geometry unit tests (TC-01 to TC-04).
import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  type Rect,
} from '../../src/shared/geometry.ts';
import {
  STICKY_MIN_SIZE_WORLD,
  MAX_OBJECT_SIZE_WORLD,
} from '../../src/shared/config.ts';

describe('geometry rectContains / unionRects / normalizeRect', () => {
  it('rectContains is true only when the inner rect lies entirely inside', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    // exact edges count as inside
    expect(rectContains(outer, outer)).toBe(true);
    // partly inside (TC-07's negative) is NOT contained
    expect(rectContains(outer, { x: 90, y: 10, width: 20, height: 20 })).toBe(false);
    // fully outside
    expect(rectContains(outer, { x: 200, y: 200, width: 10, height: 10 })).toBe(false);
    // enclosing the outer rect is not "inside" it
    expect(rectContains(outer, { x: -10, y: -10, width: 200, height: 200 })).toBe(false);
    // non-finite inputs contain nothing
    expect(rectContains(outer, { x: Number.NaN, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects bounds a group and is null when there is nothing to bound', () => {
    expect(unionRects([])).toBeNull();
    const a: Rect = { x: 0, y: 0, width: 100, height: 50 };
    const b: Rect = { x: 200, y: 300, width: 100, height: 100 };
    expect(unionRects([a, b])).toEqual({ x: 0, y: 0, width: 300, height: 400 });
    expect(unionRects([a])).toEqual(a);
    // a non-finite rect yields no usable union, never a NaN box
    expect(
      unionRects([a, { x: Number.POSITIVE_INFINITY, y: 0, width: 10, height: 10 }]),
    ).toBeNull();
  });

  it('normalizeRect turns two corner points into a positive rect in any order', () => {
    expect(normalizeRect({ x: 10, y: 40 }, { x: 50, y: 90 })).toEqual({
      x: 10,
      y: 40,
      width: 40,
      height: 50,
    });
    // dragged up-left of the start: same rect
    expect(normalizeRect({ x: 50, y: 90 }, { x: 10, y: 40 })).toEqual({
      x: 10,
      y: 40,
      width: 40,
      height: 50,
    });
  });
});

describe('geometry resizeRect (TC-01)', () => {
  // TC-01: se handle, aspect-locked 200x200 dragged by (100, 40) -> 300x300
  // (the dominant axis drives the uniform scale; opposite corner is the anchor).
  it('TC-01 aspect-locked corner resize keeps the ratio from the opposite corner', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const out = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(out.width).toBeCloseTo(300, 6);
    expect(out.height).toBeCloseTo(300, 6);
    // top-left anchor unchanged
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
  });

  it('corner handles grow from the opposite corner in both directions', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 200 };
    // nw dragged up-left: width and height grow, bottom-right anchor fixed
    const nw = resizeRect(start, 'nw', { x: -50, y: -30 }, false);
    expect(nw.width).toBeCloseTo(250, 6);
    expect(nw.height).toBeCloseTo(230, 6);
    expect(nw.x + nw.width).toBeCloseTo(300, 6);
    expect(nw.y + nw.height).toBeCloseTo(300, 6);
  });

  it('edge handles resize one direction only; opposite edge is the anchor', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 100 };
    const e = resizeRect(start, 'e', { x: 40, y: 999 }, false);
    expect(e.width).toBeCloseTo(240, 6);
    expect(e.height).toBeCloseTo(100, 6); // the y delta is ignored
    expect(e.x).toBeCloseTo(100, 6);
    const w = resizeRect(start, 'w', { x: -40, y: 0 }, false);
    expect(w.width).toBeCloseTo(240, 6);
    expect(w.x + w.width).toBeCloseTo(300, 6); // right edge anchored
  });

  it('aspect lock on an edge handle couples the other axis (sticky stays square)', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const e = resizeRect(start, 'e', { x: 200, y: 0 }, true);
    expect(e.width).toBeCloseTo(400, 6);
    expect(e.height).toBeCloseTo(400, 6);
  });

  it('shrinking past the anchor clamps to a tiny positive size, never flips', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const out = resizeRect(start, 'se', { x: -500, y: -500 }, false);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
    // non-finite input produces no usable rect
    const bad = resizeRect(start, 'se', { x: Number.NaN, y: 0 }, false);
    expect(Number.isFinite(bad.width) && Number.isFinite(bad.height)).toBe(false);
  });
});

describe('geometry clampScale (TC-02, TC-03)', () => {
  const sticky200: Rect = { x: 0, y: 0, width: 200, height: 200 };

  // TC-02: a shrink that would take a sticky to STICKY_MIN_SIZE_WORLD - 1 is
  // clamped to exactly STICKY_MIN_SIZE_WORLD; exactly the minimum passes.
  it('TC-02 clamps a shrink at the minimum size (boundary)', () => {
    const shrinkTooFar = (STICKY_MIN_SIZE_WORLD - 1) / 200; // 0.245
    const clamped = clampScale(
      { x: shrinkTooFar, y: shrinkTooFar },
      [sticky200],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    const result = scaleWithin(sticky200, sticky200, {
      x: 0,
      y: 0,
      width: sticky200.width * clamped.x,
      height: sticky200.height * clamped.y,
    });
    expect(result.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(result.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);

    // exactly the minimum is allowed (boundary)
    const exact = STICKY_MIN_SIZE_WORLD / 200;
    const ok = clampScale(
      { x: exact, y: exact },
      [sticky200],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(ok.x).toBeCloseTo(exact, 6);
    expect(ok.y).toBeCloseTo(exact, 6);
  });

  // TC-03: with mixed rects the whole selection stops uniformly at the scale
  // where the FIRST object would exceed MAX_OBJECT_SIZE_WORLD; the relative
  // layout (positions scaled by the same factor) is preserved.
  it('TC-03 stops uniformly when the first object hits the maximum size', () => {
    const big: Rect = { x: 0, y: 0, width: 10_000, height: 4_000 };
    const small: Rect = { x: 12_000, y: 0, width: 400, height: 400 };
    const requested = { x: 3, y: 1 };
    const clamped = clampScale(
      requested,
      [big, small],
      [STICKY_MIN_SIZE_WORLD, 10],
      MAX_OBJECT_SIZE_WORLD,
    );
    // big's width hits 20 000 at scale x = 2; the request of 3 stops there.
    expect(clamped.x).toBeCloseTo(2, 6);
    // the y axis was free to reach 1 and stays there.
    expect(clamped.y).toBeCloseTo(1, 6);
    // applying it: big is exactly at the maximum, small scaled by the same 2x
    const bigOut = scaleWithin(big, big, {
      x: 0,
      y: 0,
      width: big.width * clamped.x,
      height: big.height * clamped.y,
    });
    const smallOut = scaleWithin(small, big, {
      x: 0,
      y: 0,
      width: big.width * clamped.x,
      height: big.height * clamped.y,
    });
    expect(bigOut.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
    expect(smallOut.width).toBeCloseTo(800, 6);
    // relative layout: the gap also doubled
    expect(smallOut.x).toBeCloseTo(24_000, 6);
  });

  it('a uniform request is clamped uniformly so an aspect-locked box stays locked', () => {
    // sticky 200 (min 50) and a non-locked box 400x100 (min 10): shrinking the
    // sticky is the binding constraint; both axes stop at the same factor.
    const sticky: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const box: Rect = { x: 500, y: 0, width: 400, height: 100 };
    const clamped = clampScale(
      { x: 0.1, y: 0.1 },
      [sticky, box],
      [STICKY_MIN_SIZE_WORLD, 10],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(clamped.x).toBeCloseTo(clamped.y, 9);
    expect(clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200, 6);
  });

  it('non-finite scale leaves the scale unchanged (no write downstream)', () => {
    const sticky: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const out = clampScale(
      { x: Number.NaN, y: 2 },
      [sticky],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(Number.isFinite(out.x)).toBe(false);
  });
});

describe('geometry scaleWithin (TC-04)', () => {
  // TC-04: two 200-unit notes 100 apart; the bounding box (500 wide) doubles
  // in width: each note is 400 wide and the gap is 200.
  it('TC-04 scales sizes and gaps by the box scale', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    const aOut = scaleWithin(a, from, to);
    const bOut = scaleWithin(b, from, to);
    expect(aOut.width).toBeCloseTo(400, 6);
    expect(bOut.width).toBeCloseTo(400, 6);
    expect(bOut.x - (aOut.x + aOut.width)).toBeCloseTo(200, 6);
    // height untouched: scale y is 1
    expect(aOut.height).toBeCloseTo(200, 6);
  });

  it('scales from any anchor corner, preserving relative positions', () => {
    const child: Rect = { x: 100, y: 100, width: 50, height: 50 };
    const from: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const to: Rect = { x: 500, y: 500, width: 400, height: 400 };
    const out = scaleWithin(child, from, to);
    expect(out).toEqual({ x: 700, y: 700, width: 100, height: 100 });
  });
});
