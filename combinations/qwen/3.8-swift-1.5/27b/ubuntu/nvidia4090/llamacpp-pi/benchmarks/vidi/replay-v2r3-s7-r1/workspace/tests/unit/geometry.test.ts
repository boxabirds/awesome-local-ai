import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  type Rect,
  type Handle,
} from '../../src/shared/geometry';
import {
  STICKY_MIN_SIZE_WORLD,
  MAX_OBJECT_SIZE_WORLD,
} from '../../src/shared/config';

/**
 * The same pipeline the transform gesture uses: resizeRect on the bounding
 * box → clampScale against per-object minimums and the global maximum →
 * box rebuilt from the clamped scale with the anchor edge/corner fixed.
 */
function pipelineResize(
  start: Rect,
  handle: Handle,
  delta: { x: number; y: number },
  aspectLocked: boolean,
  minSizes: number[],
): Rect {
  const box = resizeRect(start, handle, delta, aspectLocked);
  const scale = {
    x: start.width > 0 ? box.width / start.width : 1,
    y: start.height > 0 ? box.height / start.height : 1,
  };
  const clamped = clampScale(scale, [start], minSizes, MAX_OBJECT_SIZE_WORLD);
  const w = start.width * clamped.x;
  const h = start.height * clamped.y;
  return {
    x: handle.includes('w') ? start.x + start.width - w : start.x,
    y: handle.includes('n') ? start.y + start.height - h : start.y,
    width: w,
    height: h,
  };
}

describe('sel.geometry_ops (geometry.ts)', () => {
  // TC-01
  it('TC-01: resizeRect se handle, aspectLocked: 200×200 + (100, 40) → 300×300', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const out = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(out).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('resizeRect corner without aspect lock changes both axes independently', () => {
    const start: Rect = { x: 10, y: 20, width: 200, height: 100 };
    expect(resizeRect(start, 'se', { x: 50, y: 25 }, false)).toEqual({
      x: 10, y: 20, width: 250, height: 125,
    });
    expect(resizeRect(start, 'nw', { x: 50, y: 25 }, false)).toEqual({
      x: 60, y: 45, width: 150, height: 75,
    });
  });

  it('resizeRect edge handles change one axis only', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
    expect(resizeRect(start, 'e', { x: 40, y: 999 }, false)).toEqual({
      x: 0, y: 0, width: 240, height: 100,
    });
    expect(resizeRect(start, 'n', { x: 999, y: 30 }, false)).toEqual({
      x: 0, y: 30, width: 200, height: 70,
    });
  });

  // TC-02
  it('TC-02: shrinking a sticky below STICKY_MIN_SIZE_WORLD clamps to 50×50 (−1 and exact boundaries)', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    // 200 − 151 = 49 < 50 → clamped to exactly the minimum.
    const below = pipelineResize(start, 'se', { x: -151, y: 0 }, true, [STICKY_MIN_SIZE_WORLD]);
    expect(below).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    // 200 − 150 = 50 → exactly the minimum, unchanged.
    const exact = pipelineResize(start, 'se', { x: -150, y: 0 }, true, [STICKY_MIN_SIZE_WORLD]);
    expect(exact).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });

  // TC-03
  it('TC-03: clampScale stops the whole selection when the first object would exceed MAX_OBJECT_SIZE_WORLD; relative layout preserved', () => {
    // B is the large object: at scale 3 its width would be 21,000 > 20,000.
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const b: Rect = { x: 0, y: 0, width: 7000, height: 1000 };
    const clamped = clampScale(
      { x: 3, y: 3 },
      [a, b],
      [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 7000, 9);
    expect(clamped.y).toBe(3);
    // The large object lands exactly on the maximum; both objects share the
    // one uniform scale, so their relative layout is preserved.
    expect(b.width * clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 3);
    const from: Rect = { x: 0, y: 0, width: 8000, height: 1000 };
    const to: Rect = { x: 0, y: 0, width: 8000 * clamped.x, height: 1000 * clamped.y };
    const aScaled = scaleWithin(a, from, to);
    const bScaled = scaleWithin(b, from, to);
    expect(aScaled.width / bScaled.width).toBeCloseTo(a.width / b.width, 9);
    expect(aScaled.height / bScaled.height).toBeCloseTo(a.height / b.height, 9);
  });

  it('clampScale stops growth at the per-axis minimum too', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const clamped = clampScale({ x: 0.1, y: 0.1 }, [r], [50], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(0.5, 9);
    expect(clamped.y).toBeCloseTo(0.5, 9);
  });

  // TC-04
  it('TC-04: two 200-unit notes 100 apart, box width ×2 → each 400 wide, gap 200', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    const aScaled = scaleWithin(a, from, to);
    const bScaled = scaleWithin(b, from, to);
    expect(aScaled).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(bScaled).toEqual({ x: 600, y: 0, width: 400, height: 200 });
    expect(bScaled.x - (aScaled.x + aScaled.width)).toBe(200);
  });

  it('unionRects of an empty list is null; of several rects the outer bounds', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 10, y: 20, width: 100, height: 50 }])).toEqual({
      x: 10, y: 20, width: 100, height: 50,
    });
    expect(unionRects([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 50, y: -30, width: 20, height: 40 },
      { x: -5, y: 5, width: 3, height: 3 },
    ])).toEqual({ x: -5, y: -30, width: 75, height: 40 });
  });

  it('normalizeRect spans two points in any order', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: -5, y: 5 })).toEqual({
      x: -5, y: 5, width: 15, height: 15,
    });
    expect(normalizeRect({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({
      x: 1, y: 1, width: 0, height: 0,
    });
  });

  it('rectContains: fully inside is true; touching edge from outside is false (negative)', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 80, height: 80 })).toBe(true);
    // Exactly on the edges: still fully inside.
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    // Half in: not selected.
    expect(rectContains(outer, { x: 50, y: 10, width: 80, height: 80 })).toBe(false);
    // Touching the edge from outside: not selected.
    expect(rectContains(outer, { x: 100, y: 10, width: 10, height: 10 })).toBe(false);
    expect(rectContains(outer, { x: -10, y: 10, width: 10, height: 10 })).toBe(false);
  });
});
