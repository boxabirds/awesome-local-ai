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
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe('rectContains', () => {
  it('TC-07 basis: true only when all four edges are inside', () => {
    const outer = rect(0, 0, 100, 100);
    expect(rectContains(outer, rect(10, 10, 20, 20))).toBe(true);
    expect(rectContains(outer, rect(90, 10, 20, 20))).toBe(false); // partly inside
    expect(rectContains(outer, rect(100, 10, 20, 20))).toBe(false); // touches edge from outside
    expect(rectContains(outer, rect(0, 0, 100, 100))).toBe(true); // exact fit
  });
});

describe('unionRects', () => {
  it('bounding box of several rects', () => {
    expect(unionRects([rect(0, 0, 10, 10), rect(50, 40, 20, 30)])).toEqual(rect(0, 0, 70, 70));
  });

  it('null for an empty list', () => {
    expect(unionRects([])).toBeNull();
  });
});

describe('normalizeRect', () => {
  it('handles either drag direction', () => {
    expect(normalizeRect({ x: 10, y: 50 }, { x: 60, y: 20 })).toEqual(rect(10, 20, 50, 30));
    expect(normalizeRect({ x: 60, y: 20 }, { x: 10, y: 50 })).toEqual(rect(10, 20, 50, 30));
  });
});

describe('resizeRect', () => {
  // TC-01: corner resize with aspect locked keeps the square.
  it('TC-01: se corner, aspectLocked 200x200 with dx=100 -> 300x300', () => {
    const out = resizeRect(rect(0, 0, 200, 200), 'se', { x: 100, y: 0 }, true);
    expect(out.width).toBeCloseTo(300);
    expect(out.height).toBeCloseTo(300);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(0);
  });

  it('TC-01 variant: nw corner, aspectLocked 200x200 with dx=-100 -> 300x300 anchored bottom-right', () => {
    const out = resizeRect(rect(0, 0, 200, 200), 'nw', { x: -100, y: 0 }, true);
    expect(out.width).toBeCloseTo(300);
    expect(out.height).toBeCloseTo(300);
    expect(out.x + out.width).toBeCloseTo(200);
    expect(out.y + out.height).toBeCloseTo(200);
  });

  it('TC-24 basis: edge handle without aspect lock changes width only', () => {
    const out = resizeRect(rect(10, 10, 100, 50), 'e', { x: 40, y: 7 }, false);
    expect(out.width).toBeCloseTo(140);
    expect(out.height).toBeCloseTo(50);
    expect(out.x).toBeCloseTo(10);
  });

  it('edge handle w keeps right edge anchored', () => {
    const out = resizeRect(rect(10, 10, 100, 50), 'w', { x: -20, y: 0 }, false);
    expect(out.width).toBeCloseTo(120);
    expect(out.x).toBeCloseTo(-10);
    expect(out.x + out.width).toBeCloseTo(110);
  });

  it('edge handle keeps the unaffected axis centred when aspect-locked', () => {
    const out = resizeRect(rect(0, 0, 100, 50), 'e', { x: 100, y: 0 }, true);
    expect(out.width).toBeCloseTo(200);
    expect(out.height).toBeCloseTo(100);
    expect(out.y).toBeCloseTo(-25);
  });

  it('never produces a negative size', () => {
    const out = resizeRect(rect(0, 0, 100, 100), 'e', { x: -500, y: 0 }, false);
    expect(out.width).toBe(0);
  });
});

describe('scaleWithin', () => {
  // TC-04: 2 notes 100 apart, box width x2 -> 400 wide, gap 200.
  it('TC-04: doubling box width doubles gap and sizes', () => {
    const from = rect(0, 0, 300, 200);
    const a = rect(0, 0, 100, 100);
    const b = rect(200, 0, 100, 100); // 100 gap between a and b
    const to = rect(0, 0, 600, 200);
    const na = scaleWithin(a, from, to);
    const nb = scaleWithin(b, from, to);
    expect(na.width).toBeCloseTo(200);
    expect(nb.width).toBeCloseTo(200);
    expect(nb.x - (na.x + na.width)).toBeCloseTo(200);
    expect(nb.x + nb.width).toBeCloseTo(600);
  });
});

describe('clampScale', () => {
  // TC-02: shrinking a sticky below STICKY_MIN_SIZE_WORLD is clamped to 50x50.
  it('TC-02: shrink to STICKY_MIN_SIZE_WORLD - 1 clamps to 50x50', () => {
    const r = rect(0, 0, 200, 200);
    const target = STICKY_MIN_SIZE_WORLD - 1; // 49
    const wanted = { x: target / 200, y: target / 200 };
    const out = clampScale(wanted, [r], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(r.width * out.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
    expect(r.height * out.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
  });

  // TC-03: group scale stops when the first object hits MAX_OBJECT_SIZE_WORLD.
  it('TC-03: growth stops at max for the largest object, relative layout preserved', () => {
    const big = rect(0, 0, 1000, 1000);
    const small = rect(2000, 0, 100, 100);
    const rects = [big, small];
    const wanted = { x: MAX_OBJECT_SIZE_WORLD / 1000 + 0.5, y: MAX_OBJECT_SIZE_WORLD / 1000 + 0.5 };
    const out = clampScale(
      wanted,
      rects,
      [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(big.width * out.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
    // the small object stops proportionally below the max
    expect(small.width * out.x).toBeLessThan(MAX_OBJECT_SIZE_WORLD);
    // uniform factor keeps relative scale identical on both axes
    expect(out.x).toBeCloseTo(out.y);
  });

  it('within limits the requested scale passes through unchanged', () => {
    const r = rect(0, 0, 200, 200);
    const wanted = { x: 1.5, y: 1.5 };
    const out = clampScale(wanted, [r], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(out.x).toBeCloseTo(1.5);
    expect(out.y).toBeCloseTo(1.5);
  });

  it('empty rect list returns the requested scale', () => {
    const wanted = { x: 3, y: 3 };
    expect(clampScale(wanted, [], [], MAX_OBJECT_SIZE_WORLD)).toEqual(wanted);
  });
});
