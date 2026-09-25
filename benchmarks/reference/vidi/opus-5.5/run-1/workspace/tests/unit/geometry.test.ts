import { describe, expect, it } from 'vitest';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import {
  anchoredRect,
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleBetween,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';

const NOTE = 200;
const GAP = 100;
const DOUBLE = 2;
const STICKY_BOX: Rect = { x: 0, y: 0, width: NOTE, height: NOTE };

/** The gesture's resize pipeline for a selection: box → resizeRect → clampScale → scaleWithin. */
function resizeSelection(
  rects: Rect[],
  handle: Parameters<typeof resizeRect>[1],
  delta: { x: number; y: number },
  aspectLocked: boolean,
  minSizes: number[],
): Rect[] {
  const box = unionRects(rects)!;
  const wanted = scaleBetween(box, resizeRect(box, handle, delta, aspectLocked));
  const scale = clampScale(wanted, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
  const target = anchoredRect(box, handle, scale);
  return rects.map((r) => scaleWithin(r, box, target));
}

describe('sel.geometry_ops: geometry', () => {
  it('rectContains: inside and touching edges count, sticking out does not', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(rectContains(outer, outer)).toBe(true);
    expect(rectContains(outer, { x: 90, y: 10, width: 20, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: -1, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects: null for none, bounding box otherwise', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([STICKY_BOX, { x: 300, y: -50, width: 10, height: 10 }])).toEqual({
      x: 0,
      y: -50,
      width: 310,
      height: 250,
    });
  });

  it('normalizeRect: any two corners, in any order', () => {
    expect(normalizeRect({ x: 50, y: 10 }, { x: -50, y: 30 })).toEqual({ x: -50, y: 10, width: 100, height: 20 });
  });

  it('TC-01 resizeRect se corner, aspectLocked: 200×200 + (100,40) → 300×300 from the top-left', () => {
    expect(resizeRect(STICKY_BOX, 'se', { x: 100, y: 40 }, true)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('resizeRect edge handles change one dimension; nw moves the top-left; free corner changes both', () => {
    expect(resizeRect(STICKY_BOX, 'e', { x: 50, y: 999 }, false)).toEqual({ x: 0, y: 0, width: 250, height: 200 });
    expect(resizeRect(STICKY_BOX, 'n', { x: 999, y: 20 }, false)).toEqual({ x: 0, y: 20, width: 200, height: 180 });
    expect(resizeRect(STICKY_BOX, 'nw', { x: 10, y: 30 }, false)).toEqual({ x: 10, y: 30, width: 190, height: 170 });
    // Edge handle with aspect lock: the other dimension scales about its centre.
    expect(resizeRect(STICKY_BOX, 'w', { x: -200, y: 0 }, true)).toEqual({ x: -200, y: -100, width: 400, height: 400 });
  });

  it.each([
    ['STICKY_MIN_SIZE_WORLD − 1', STICKY_MIN_SIZE_WORLD - 1],
    ['exactly STICKY_MIN_SIZE_WORLD', STICKY_MIN_SIZE_WORLD],
  ])('TC-02 shrinking a sticky to %s → clamped 50×50', (_label, size) => {
    const shrink = size - NOTE;
    const [r] = resizeSelection([STICKY_BOX], 'se', { x: shrink, y: shrink }, true, [STICKY_MIN_SIZE_WORLD]);
    expect(r).toEqual({ x: 0, y: 0, width: STICKY_MIN_SIZE_WORLD, height: STICKY_MIN_SIZE_WORLD });
  });

  it('TC-03 clampScale stops the whole selection when the first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
    const big: Rect = { x: 0, y: 0, width: 4000, height: 4000 };
    const small: Rect = { x: 5000, y: 0, width: 100, height: 100 };
    const factor = 10; // big would become 40,000 (> MAX + 1)
    const scale = clampScale({ x: factor, y: factor }, [big, small], [STICKY_MIN_SIZE_WORLD, 10], MAX_OBJECT_SIZE_WORLD);
    expect(scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / big.width);
    expect(scale.y).toBe(scale.x);
    // Relative layout preserved: both objects and their gap scale by the same factor.
    const box = unionRects([big, small])!;
    const to = anchoredRect(box, 'se', scale);
    const [b, s] = [scaleWithin(big, box, to), scaleWithin(small, box, to)];
    expect(b.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
    expect(s.width / small.width).toBeCloseTo(b.width / big.width);
    expect((s.x - (b.x + b.width)) / (small.x - big.width)).toBeCloseTo(scale.x);
  });

  it('clampScale boundary: MAX_OBJECT_SIZE_WORLD + 1 is clamped, exactly MAX passes', () => {
    const r: Rect = { x: 0, y: 0, width: 1000, height: 1000 };
    const over = (MAX_OBJECT_SIZE_WORLD + 1) / r.width;
    const exact = MAX_OBJECT_SIZE_WORLD / r.width;
    expect(clampScale({ x: over, y: over }, [r], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD).x).toBe(exact);
    expect(clampScale({ x: exact, y: exact }, [r], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD).x).toBe(exact);
  });

  it('clampScale uniform: the smallest object stops everything at its minimum', () => {
    const scale = clampScale(
      { x: 0.1, y: 0.1 },
      [{ x: 0, y: 0, width: 1000, height: 1000 }, { x: 0, y: 0, width: 100, height: 100 }],
      [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(scale).toEqual({ x: 0.5, y: 0.5 });
  });

  it('clampScale rejects non-finite or negative scales (no change)', () => {
    expect(clampScale({ x: Number.NaN, y: 1 }, [STICKY_BOX], [1], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
    expect(clampScale({ x: -1, y: -1 }, [STICKY_BOX], [1], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
  });

  it('TC-04 two 200-unit notes 100 apart, box width ×2 → each 400 wide (and tall), gap 200', () => {
    const a: Rect = { x: 0, y: 0, width: NOTE, height: NOTE };
    const b: Rect = { x: NOTE + GAP, y: 0, width: NOTE, height: NOTE };
    const boxWidth = NOTE * DOUBLE + GAP;
    const [ra, rb] = resizeSelection([a, b], 'e', { x: boxWidth, y: 0 }, true, [
      STICKY_MIN_SIZE_WORLD,
      STICKY_MIN_SIZE_WORLD,
    ]);
    expect(ra!.width).toBe(NOTE * DOUBLE);
    expect(ra!.height).toBe(NOTE * DOUBLE);
    expect(rb!.width).toBe(NOTE * DOUBLE);
    expect(rb!.x - (ra!.x + ra!.width)).toBe(GAP * DOUBLE);
    expect(ra!.x).toBe(0);
  });
});
