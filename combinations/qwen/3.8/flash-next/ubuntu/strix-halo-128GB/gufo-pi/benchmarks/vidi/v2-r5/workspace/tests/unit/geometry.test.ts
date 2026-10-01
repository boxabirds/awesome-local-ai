import { describe, expect, it } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  type Rect,
  type Point,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('geometry: rectContains', () => {
  it('TC-07a: fully inside → true', () => {
    const outer: Rect = { x: 0, y: 0, width: 1000, height: 1000 };
    const inner: Rect = { x: 100, y: 100, width: 200, height: 200 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('TC-07b: partly inside → false', () => {
    const outer: Rect = { x: 0, y: 0, width: 300, height: 300 };
    const inner: Rect = { x: 200, y: 200, width: 200, height: 200 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it('TC-07c: outside → false', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const inner: Rect = { x: 200, y: 200, width: 50, height: 50 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it('touching edges from inside counts as inside', () => {
    const outer: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const inner: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('non-finite inputs return false', () => {
    expect(rectContains({ x: NaN, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 50, height: 50 })).toBe(false);
  });
});

describe('geometry: unionRects', () => {
  it('returns null for empty array', () => {
    expect(unionRects([])).toBeNull();
  });

  it('single rect returns same', () => {
    const r: Rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(unionRects([r])).toEqual(r);
  });

  it('two rects produce bounding box', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const b: Rect = { x: 200, y: 200, width: 100, height: 100 };
    expect(unionRects([a, b])).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });
});

describe('geometry: normalizeRect', () => {
  it('drag from top-left to bottom-right', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 100, y: 200 })).toEqual({
      x: 10, y: 10, width: 90, height: 190,
    });
  });

  it('drag from bottom-right to top-left', () => {
    expect(normalizeRect({ x: 100, y: 200 }, { x: 10, y: 10 })).toEqual({
      x: 10, y: 10, width: 90, height: 190,
    });
  });
});

describe('geometry: resizeRect', () => {
  it('TC-01: se handle, aspectLocked, 200×200 + delta(100,40) → 300×300', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    // Aspect locked: width becomes 300 (dominant axis), height also 300
    expect(result.width).toBeCloseTo(300, 5);
    expect(result.height).toBeCloseTo(300, 5);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('nw handle moves top-left corner', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const result = resizeRect(start, 'nw', { x: -50, y: -50 }, false);
    expect(result.x).toBe(50);
    expect(result.y).toBe(50);
    expect(result.width).toBe(250);
    expect(result.height).toBe(250);
  });

  it('e handle changes width only', () => {
    const start: Rect = { x: 0, y: 0, width: 100, height: 200 };
    const result = resizeRect(start, 'e', { x: 50, y: 30 }, false);
    expect(result.width).toBe(150);
    expect(result.height).toBe(200);
  });

  it('n handle changes height only, moves y', () => {
    const start: Rect = { x: 0, y: 100, width: 200, height: 100 };
    const result = resizeRect(start, 'n', { x: 0, y: -30 }, false);
    expect(result.y).toBe(70);
    expect(result.height).toBe(130);
    expect(result.width).toBe(200);
  });
});

describe('geometry: clampScale', () => {
  it('TC-02: shrink below STICKY_MIN_SIZE_WORLD is clamped', () => {
    const rect: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    // Scale that would give width = 49 (below min 50)
    const scale: Point = { x: 49 / 200, y: 49 / 200 };
    const clamped = clampScale(scale, [rect], minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x * 200).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 5);
    expect(clamped.y * 200).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 5);
  });

  it('TC-02b: exactly at STICKY_MIN_SIZE_WORLD is allowed', () => {
    const rect: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    const scale: Point = { x: 50 / 200, y: 50 / 200 };
    const clamped = clampScale(scale, [rect], minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(0.25, 5);
    expect(clamped.y).toBeCloseTo(0.25, 5);
  });

  it('TC-03: clampScale stops uniformly when first hits MAX_OBJECT_SIZE_WORLD', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 1000, height: 1000 },
      { x: 1500, y: 0, width: 500, height: 500 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // Scale that would make the first rect 21000 (> MAX_OBJECT_SIZE_WORLD)
    const scale: Point = { x: 21, y: 21 };
    const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // First rect limits: 20000 / 1000 = 20
    expect(clamped.x).toBeLessThanOrEqual(20);
    expect(clamped.x).toBeCloseTo(20, 5);
    // Second rect: 500 * 20 = 10000, well under max
  });
});

describe('geometry: scaleWithin', () => {
  it('TC-04: two 200-unit notes 100 apart, box ×2 width → 400 wide, gap 200', () => {
    // Two notes at x=0 and x=300 (gap of 100 between them: 0+200=200, gap=100, next starts at 300)
    const note1: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const note2: Rect = { x: 300, y: 0, width: 200, height: 200 };

    // Bounding box of both: { x: 0, y: 0, width: 500, height: 200 }
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    // Resize right edge to double width
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };

    const scaled1 = scaleWithin(note1, from, to);
    const scaled2 = scaleWithin(note2, from, to);

    expect(scaled1.width).toBeCloseTo(400, 5);
    expect(scaled2.width).toBeCloseTo(400, 5);
    // Gap: note2.x - (note1.x + note1.width) = scaled2.x - (0 + 400)
    const gap = scaled2.x - (scaled1.x + scaled1.width);
    expect(gap).toBeCloseTo(200, 5);
  });

  it('child at origin stays at origin of target', () => {
    const child: Rect = { x: 50, y: 50, width: 100, height: 100 };
    const from: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 400, height: 400 };
    const result = scaleWithin(child, from, to);
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
  });
});
