import { describe, it, expect } from 'vitest';
import {
  type Rect,
  type Handle,
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('geometry — rectContains', () => {
  it('fully inside → true', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
  });

  it('touching edges from inside → true', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
  });

  it('partly outside → false', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 90, y: 90, width: 20, height: 20 })).toBe(false);
  });

  it('touching from outside → false', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: -10, y: -10, width: 10, height: 10 })).toBe(false);
  });
});

describe('geometry — unionRects', () => {
  it('empty list → null', () => {
    expect(unionRects([])).toBeNull();
  });

  it('single rect → same rect', () => {
    expect(unionRects([{ x: 1, y: 2, width: 3, height: 4 }])).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('two disjoint rects → enclosing rect', () => {
    const r = unionRects([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 30, width: 10, height: 10 },
    ])!;
    expect(r).toEqual({ x: 0, y: 0, width: 30, height: 40 });
  });
});

describe('geometry — normalizeRect', () => {
  it('normalizes any two corners', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 5, y: 8 })).toEqual({ x: 5, y: 8, width: 5, height: 12 });
  });

  it('same point → zero-size rect', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe('geometry — resizeRect (TC-01)', () => {
  const start: Rect = { x: 0, y: 0, width: 200, height: 200 };

  it('TC-01: se handle, aspectLocked=true, delta (100,40) → 300x300', () => {
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(result.width).toBe(300);
    expect(result.height).toBe(300);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('se handle, no aspect lock', () => {
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, false);
    expect(result.width).toBe(300);
    expect(result.height).toBe(240);
  });

  it('nw handle changes origin and size', () => {
    const result = resizeRect(start, 'nw', { x: -50, y: -50 }, false);
    expect(result.x).toBe(-50);
    expect(result.y).toBe(-50);
    expect(result.width).toBe(250);
    expect(result.height).toBe(250);
  });

  it('e handle changes width only', () => {
    const result = resizeRect(start, 'e', { x: 50, y: 0 }, false);
    expect(result.x).toBe(0);
    expect(result.width).toBe(250);
    expect(result.height).toBe(200);
  });
});

describe('geometry — clampScale (TC-02, TC-03)', () => {
  it('TC-02: shrink below STICKY_MIN_SIZE_WORLD clamps to 50', () => {
    // A 200x200 rect scaled down to 49 (one unit below min)
    const scale = clampScale({ x: 49 / 200, y: 49 / 200 }, [{ x: 0, y: 0, width: 200, height: 200 }], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    const finalWidth = 200 * scale.x;
    expect(finalWidth).toBe(STICKY_MIN_SIZE_WORLD);
  });

  it('TC-02 boundary: exactly at min → no clamping', () => {
    const scale = clampScale({ x: 50 / 200, y: 50 / 200 }, [{ x: 0, y: 0, width: 200, height: 200 }], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(scale.x).toBeCloseTo(50 / 200, 10);
  });

  it('TC-03: stops uniformly when first object exceeds MAX_OBJECT_SIZE_WORLD', () => {
    // Object A: 10000 wide → scale of 2.5 gives 25000 > MAX(20000)
    // Object B: 5000 wide → scale of 2.5 gives 12500, OK
    const rects: Rect[] = [
      { x: 0, y: 0, width: 10000, height: 10000 },
      { x: 0, y: 0, width: 5000, height: 5000 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    const scale = clampScale({ x: 2.5, y: 2.5 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // Object A reaches 20000 → scale = 2.0
    expect(10000 * scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
    expect(5000 * scale.x).toBeLessThan(MAX_OBJECT_SIZE_WORLD);
  });

  it('uniform scale (sx === sy) clamps uniformly', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 0, y: 0, width: 100, height: 100 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, 80];
    // Scale 0.5: first object → 100 (OK), second → 50 (clamped by minSize 80)
    const scale = clampScale({ x: 0.5, y: 0.5 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // Second object clamps: 80/100 = 0.8
    expect(scale.x).toBeCloseTo(0.8);
    expect(scale.y).toBeCloseTo(0.8);
  });
});

describe('geometry — scaleWithin (TC-04)', () => {
  it('TC-04: two notes 200 units wide, 100 apart, doubled → 400 wide, 200 gap', () => {
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 400 };

    const noteA: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const noteB: Rect = { x: 300, y: 0, width: 200, height: 200 };

    const scaledA = scaleWithin(noteA, from, to);
    const scaledB = scaleWithin(noteB, from, to);

    expect(scaledA.width).toBe(400);
    expect(scaledB.width).toBe(400);
    // Gap = noteB.x - (noteA.x + noteA.width) = 600 - (0 + 400) = 200
    const gap = scaledB.x - (scaledA.x + scaledA.width);
    expect(gap).toBe(200);
  });
});
