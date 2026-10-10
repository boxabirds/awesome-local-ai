/**
 * Geometry unit tests (story 7, TC-01 to TC-04 and the maths around them).
 *
 * Every number here is written by hand from the PRD's own sentences, because
 * this is the one place where the product's arithmetic ("resize the box from the
 * opposite corner", "stop the whole selection where the first object reaches its
 * limit", "the gap doubles when the box doubles") has to be a fact rather than a
 * description. `src/shared/geometry.ts` is pure, so no Y.Doc and no DOM: the
 * group writes those numbers make are in `board-model-group.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Rect,
} from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

/** A sticky note of the size story 2 made them, at the origin. */
const NOTE = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe('rectContains (sel.marquee containment)', () => {
  it('TC-07 support: fully inside is inside; touching the far side from outside is not', () => {
    const box = rect(0, 0, 400, 400);
    expect(rectContains(box, rect(0, 0, 200, 200))).toBe(true);
    // The inner rect's right/bottom edges lie exactly on the box's: inside.
    expect(rectContains(box, rect(200, 200, 200, 200))).toBe(true);
    // Partly inside.
    expect(rectContains(box, rect(300, 0, 200, 200))).toBe(false);
    // Touching the box's right edge from outside, and the same from below.
    expect(rectContains(box, rect(400, 0, 200, 200))).toBe(false);
    expect(rectContains(box, rect(0, 400, 200, 200))).toBe(false);
    // Somewhere else entirely.
    expect(rectContains(box, rect(1000, 1000, 200, 200))).toBe(false);
    // Bigger than the box, containing it.
    expect(rectContains(box, rect(-100, -100, 600, 600))).toBe(false);
  });
});

describe('unionRects and normalizeRect', () => {
  it('the bounding box of nothing is null, and of one rect that rect', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([NOTE])).toEqual(NOTE);
  });

  it('the bounding box of several encloses them all', () => {
    const box = unionRects([rect(0, 0, 200, 200), rect(300, 400, 200, 200)]);
    expect(box).toEqual(rect(0, 0, 500, 600));
  });

  it('a dragged rectangle is the same whichever way the pointer went', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual(rect(0, 5, 10, 15));
    expect(normalizeRect({ x: 0, y: 5 }, { x: 10, y: 20 })).toEqual(rect(0, 5, 10, 15));
    expect(normalizeRect({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual(rect(4, 4, 0, 0));
  });

  it('a non-finite point collapses instead of poisoning the rectangle', () => {
    expect(normalizeRect({ x: 0, y: 0 }, { x: Number.NaN, y: Number.POSITIVE_INFINITY })).toEqual(
      rect(0, 0, 0, 0),
    );
  });
});

describe('resizeRect (sel.resize)', () => {
  it('TC-01: a corner handle with the ratio locked grows both sides by the same factor', () => {
    // Drag the bottom-right corner of a 200×200 note by (100, 40): the width
    // axis moved further, so the ratio decides the height, and 300×300 it is.
    expect(resizeRect(NOTE, 'se', { x: 100, y: 40 }, true)).toEqual(rect(0, 0, 300, 300));
  });

  it('the same drag without the lock changes each side on its own', () => {
    expect(resizeRect(NOTE, 'se', { x: 100, y: 40 }, false)).toEqual(rect(0, 0, 300, 240));
  });

  it('edge handles move one axis; corner handles move both', () => {
    expect(resizeRect(NOTE, 'e', { x: 100, y: 0 }, false)).toEqual(rect(0, 0, 300, 200));
    expect(resizeRect(NOTE, 'w', { x: -50, y: 0 }, false)).toEqual(rect(-50, 0, 250, 200));
    expect(resizeRect(NOTE, 'n', { x: 0, y: -50 }, false)).toEqual(rect(0, -50, 200, 250));
    expect(resizeRect(NOTE, 's', { x: 0, y: 100 }, false)).toEqual(rect(0, 0, 200, 300));
    expect(resizeRect(NOTE, 'nw', { x: -20, y: -10 }, false)).toEqual(rect(-20, -10, 220, 210));
  });

  it('the opposite corner or edge stays where it was', () => {
    // 'se' keeps the top-left; 'nw' keeps the bottom-right; 'n' keeps the bottom.
    expect(resizeRect(NOTE, 'se', { x: 50, y: 50 }, false)).toEqual(rect(0, 0, 250, 250));
    expect(resizeRect(NOTE, 'nw', { x: 50, y: 50 }, false)).toEqual(rect(50, 50, 150, 150));
    expect(resizeRect(NOTE, 'n', { x: 0, y: 50 }, false)).toEqual(rect(0, 50, 200, 150));
    // Locked, the untouched axis follows the ratio from the same anchor: the
    // bottom edge of a 'ne' drag stays at y = 200 while the box grows upwards.
    expect(resizeRect(NOTE, 'ne', { x: 100, y: 0 }, true)).toEqual(rect(0, -100, 300, 300));
  });

  it('the ratio is kept whatever the starting rectangle was', () => {
    const wide = rect(0, 0, 400, 200); // 2:1
    expect(resizeRect(wide, 'se', { x: 100, y: 0 }, true)).toEqual(rect(0, 0, 500, 250));
    // The other axis can be the one that decides, when it moved further.
    expect(resizeRect(wide, 'se', { x: 20, y: 100 }, true)).toEqual(rect(0, 0, 600, 300));
  });

  it('a drag past the opposite edge never turns the box inside out', () => {
    for (const handle of ['se', 'nw', 'e', 'w', 'n', 's', 'ne', 'sw'] as Handle[]) {
      const out = resizeRect(NOTE, handle, { x: -3000, y: -3000 }, false);
      expect(out.width).toBeGreaterThanOrEqual(0);
      expect(out.height).toBeGreaterThanOrEqual(0);
    }
  });

  it('non-finite input changes nothing at all', () => {
    expect(resizeRect(NOTE, 'se', { x: Number.NaN, y: 10 }, false)).toEqual(NOTE);
    expect(resizeRect(rect(0, 0, Number.NaN, 200), 'se', { x: 10, y: 10 }, false)).toEqual(
      rect(0, 0, Number.NaN, 200),
    );
  });
});

describe('clampScale (sel.size_limits)', () => {
  it('TC-02: shrinking stops at the minimum side, exactly at it and one unit less', () => {
    const sticky = rect(0, 0, 100, 100);
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    // One unit below the limit (49 of a 100-unit note): refused, and the scale
    // that lands exactly on 50 is allowed instead.
    const oneTooSmall = clampScale({ x: 0.49, y: 0.49 }, [sticky], minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(oneTooSmall.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 100, 10);
    expect(oneTooSmall.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 100, 10);
    expect(scaleWithin(sticky, sticky, { x: 0, y: 0, width: 100 * oneTooSmall.x, height: 100 * oneTooSmall.y })).toEqual(
      rect(0, 0, STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD),
    );
    // Exactly on the limit: unchanged.
    const exact = clampScale({ x: 0.5, y: 0.5 }, [sticky], minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(exact.x).toBeCloseTo(0.5, 10);
    expect(exact.y).toBeCloseTo(0.5, 10);
    // And a shrinking selection that keeps both sides above the minimum is left alone.
    const allowed = clampScale({ x: 0.6, y: 0.6 }, [sticky], minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(allowed).toEqual({ x: 0.6, y: 0.6 });
  });

  it('TC-03: one object hitting the maximum stops the whole selection, layout intact', () => {
    const small = rect(0, 0, 1000, 800);
    const big = rect(2000, 0, 10_000, 4000);
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // ×3 would make the second object 30,000 units wide, past MAX_OBJECT_SIZE_WORLD,
    // so the whole selection is capped at the largest scale that fits.
    const clamped = clampScale({ x: 3, y: 3 }, [small, big], minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 10_000, 10);
    expect(clamped.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 10_000, 10);

    // One scale for all: the relative layout survives — the gap doubles with
    // everything else, and no object crosses either limit.
    const from = { x: 0, y: 0, width: 12_000, height: 4000 };
    const to = { x: 0, y: 0, width: 12_000 * clamped.x, height: 4000 * clamped.y };
    const movedSmall = scaleWithin(small, from, to);
    const movedBig = scaleWithin(big, from, to);
    expect(movedSmall.width).toBeCloseTo(1000 * clamped.x, 6);
    expect(movedBig.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
    expect(movedBig.x - (movedSmall.x + movedSmall.width)).toBeCloseTo(1000 * clamped.x, 6);
    for (const grown of [movedSmall, movedBig]) {
      expect(grown.width).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-6);
      expect(grown.height).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-6);
      expect(grown.width).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
      expect(grown.height).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
    }
  });

  it('a per-axis scale is capped per axis, so an edge handle still moves', () => {
    const big = rect(0, 0, 10_000, 400);
    // Doubling the width of a 10,000-wide object is fine; quadrupling is not.
    const both = clampScale({ x: 4, y: 1 }, [big], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(both.x).toBeCloseTo(2, 10);
    expect(both.y).toBe(1);
    // The height axis has its own limit: this one comes from the minimum.
    const thin = clampScale({ x: 1, y: 0.01 }, [big], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(thin.x).toBe(1);
    expect(thin.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 400, 10);
  });

  it('limits that cannot both be honoured, and non-finite scales, refuse the resize', () => {
    const tiny = rect(0, 0, 100, 100);
    // A minimum bigger than the maximum: no scale is inside both, so the resize
    // is refused (scale 1 = nothing written) instead of breaking one of them.
    expect(clampScale({ x: 2, y: 2 }, [tiny], [200], 100)).toEqual({ x: 1, y: 1 });
    // A pointer that reported nonsense does not resize anything either.
    const nonsense = clampScale(
      { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      [tiny],
      [50],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(nonsense).toEqual({ x: 1, y: 1 });
  });
});

describe('scaleWithin (sel.resize: each object in its box)', () => {
  it('TC-04: doubling the box doubles every object and every gap', () => {
    // Two notes of 200 units, 100 apart: the box is 500 wide.
    const a = rect(0, 0, 200, 200);
    const b = rect(300, 0, 200, 200);
    const from = { x: 0, y: 0, width: 500, height: 200 };
    const to = { x: 0, y: 0, width: 1000, height: 400 };
    const grownA = scaleWithin(a, from, to);
    const grownB = scaleWithin(b, from, to);
    expect(grownA).toEqual(rect(0, 0, 400, 400));
    expect(grownB).toEqual(rect(600, 0, 400, 400));
    // The gap doubled with everything else.
    expect(grownB.x - (grownA.x + grownA.width)).toBeCloseTo(200, 6);
  });

  it('objects keep touching when they are stacked on top of each other', () => {
    const a = rect(100, 100, 200, 200);
    const b = rect(120, 120, 200, 200);
    const from = { x: 100, y: 100, width: 220, height: 220 };
    const to = { x: 0, y: 0, width: 440, height: 440 };
    const movedA = scaleWithin(a, from, to);
    const movedB = scaleWithin(b, from, to);
    expect(movedB.x - movedA.x).toBeCloseTo(20 * 2, 6);
    expect(movedB.x - movedA.x).toBeCloseTo(movedB.y - movedA.y, 6);
  });

  it('a box with no width anywhere leaves its objects alone', () => {
    const line = rect(0, 0, 0, 100);
    const child = rect(0, 10, 0, 20);
    expect(scaleWithin(child, line, { x: 0, y: 0, width: 0, height: 200 })).toEqual(rect(0, 20, 0, 40));
  });
});

describe('geometry is total (error paths)', () => {
  it('unionRects ignores nothing and reports honestly', () => {
    const one = rect(1, 1, 2, 2);
    expect(unionRects([one, one])).toEqual(one);
  });

  it('rectContains refuses to compare non-finite rectangles', () => {
    expect(rectContains(rect(0, 0, 100, 100), rect(0, 0, Number.NaN, 10))).toBe(false);
    expect(rectContains(rect(0, 0, Number.POSITIVE_INFINITY, 100), rect(0, 0, 10, 10))).toBe(false);
  });
});
