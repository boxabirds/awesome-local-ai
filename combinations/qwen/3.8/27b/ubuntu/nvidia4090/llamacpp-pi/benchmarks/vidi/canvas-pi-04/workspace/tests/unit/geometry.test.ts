// Story 7, task 6: pure selection-geometry unit tests (TC-01 to TC-04).
//
// resizeRect / clampScale / scaleWithin are pure world-unit maths; these tests
// pin the boundary values the PRD and design call out (min size, max size,
// aspect lock, proportional spread).

import { describe, expect, it } from 'vitest';
import { clampScale, normalizeRect, rectContains, resizeRect, scaleWithin, unionRects } from '../../src/shared/geometry';
import type { Rect } from '../../src/shared/geometry';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

const START: Rect = { x: 0, y: 0, width: 200, height: 200 };

describe('geometry: resizeRect', () => {
  it('TC-01 se corner, aspect locked: 200x200 + (100,40) -> 300x300', () => {
    const out = resizeRect(START, 'se', { x: 100, y: 40 }, true);
    expect(out).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('e edge, unlocked: width only, height unchanged', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
    const out = resizeRect(start, 'e', { x: 50, y: 0 }, false);
    expect(out).toEqual({ x: 0, y: 0, width: 250, height: 100 });
  });

  it('e edge, aspect locked (Shift): ratio preserved, anchored at left', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
    const out = resizeRect(start, 'e', { x: 50, y: 0 }, true);
    expect(out.width).toBe(250);
    expect(out.height).toBe(125); // 250 * (100/200)
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('w edge: anchor stays at the right edge', () => {
    const out = resizeRect(START, 'w', { x: -50, y: 0 }, false);
    expect(out).toEqual({ x: -50, y: 0, width: 250, height: 200 });
    // right edge unchanged
    expect(out.x + out.width).toBe(START.x + START.width);
  });

  it('n edge: anchor stays at the bottom edge', () => {
    const out = resizeRect(START, 'n', { x: 0, y: -50 }, false);
    expect(out).toEqual({ x: 0, y: -50, width: 200, height: 250 });
    expect(out.y + out.height).toBe(START.y + START.height);
  });
});

describe('geometry: clampScale', () => {
  it('TC-02 shrink below min (min-1) clamps to the min size (50x50); exactly min stays', () => {
    const rects = [START];
    const minSizes = [STICKY_MIN_SIZE_WORLD];

    // Request a size of STICKY_MIN_SIZE_WORLD - 1 (scale 49/200): clamped up to 50.
    const tooSmall = clampScale({ x: 49 / 200, y: 49 / 200 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(START.width * tooSmall.x).toBe(STICKY_MIN_SIZE_WORLD);
    expect(START.height * tooSmall.y).toBe(STICKY_MIN_SIZE_WORLD);

    // Request exactly the min size: unchanged.
    const exact = clampScale({ x: 50 / 200, y: 50 / 200 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(START.width * exact.x).toBe(STICKY_MIN_SIZE_WORLD);
  });

  it('TC-03 stops all objects uniformly when the first reaches MAX; layout preserved', () => {
    // Two objects of different sizes; the LARGER one hits MAX first (it reaches
    // MAX at a smaller scale). The whole selection stops together at that scale.
    const rects = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 50, height: 50 },
    ];
    const minSizes = [10, 10];
    const scale = clampScale({ x: 10_000, y: 10_000 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // The 100-wide object hits MAX first: 20000/100 = 200.
    expect(scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 100);
    expect(scale.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 100);
    // The larger object is exactly at MAX; none exceed it. Relative layout (the
    // 50-wide at half the 100-wide) is preserved under the uniform scale.
    expect(rects[0].width * scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
    expect(rects[1].width * scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 2);
    for (const r of rects) {
      expect(r.width * scale.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-9);
      expect(r.height * scale.y).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-9);
    }
  });

  it('respects the per-object min on the axis with the largest min/size ratio', () => {
    const rects = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 0, y: 0, width: 400, height: 400 },
    ];
    const minSizes = [50, 50];
    // Shrink far below both minima: bounded by the smallest object (50/200).
    const scale = clampScale({ x: 0.01, y: 0.01 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(scale.x).toBeCloseTo(50 / 200);
    // The smaller object lands exactly on its min.
    expect(rects[0].width * scale.x).toBeCloseTo(50);
  });
});

describe('geometry: scaleWithin', () => {
  it('TC-04 two 200-unit notes 100 apart, box x2 width -> 400 wide, gap 200', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const from = unionRects([a, b])!; // x:0, width:500
    expect(from).toEqual({ x: 0, y: 0, width: 500, height: 200 });
    const to = { ...from, width: from.width * 2 }; // 1000 wide

    const aOut = scaleWithin(a, from, to);
    const bOut = scaleWithin(b, from, to);
    expect(aOut.width).toBe(400);
    expect(bOut.width).toBe(400);
    const gap = bOut.x - (aOut.x + aOut.width);
    expect(gap).toBe(200); // was 100, doubled
  });

  it('anchors children to the fixed edge (w handle grows leftward)', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const from: Rect = { x: 0, y: 0, width: 100, height: 100 };
    // w handle: the right edge (x=100) is the fixed anchor, width doubles to 200
    // so the box now spans -100..100.
    const to: Rect = { x: -100, y: 0, width: 200, height: 100 };
    const out = scaleWithin(a, from, to);
    expect(out.x).toBe(-100);
    expect(out.width).toBe(200);
    // right edge stays at the anchor (100)
    expect(out.x + out.width).toBe(100);
  });
});

describe('geometry: helpers', () => {
  it('rectContains: fully inside (edges coinciding) yes; partly / outside no', () => {
    const box: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(box, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    // touching the boundary counts as inside
    expect(rectContains(box, { x: 80, y: 0, width: 20, height: 100 })).toBe(true);
    // partly inside
    expect(rectContains(box, { x: 90, y: 0, width: 20, height: 20 })).toBe(false);
    // outside
    expect(rectContains(box, { x: 120, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects: null for empty, bounding box otherwise', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: -5, width: 10, height: 10 }]))
      .toEqual({ x: 0, y: -5, width: 15, height: 15 });
  });

  it('normalizeRect: order-independent top-left + size', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: -5, y: 5 })).toEqual({
      x: -5,
      y: 5,
      width: 15,
      height: 5,
    });
  });
});
