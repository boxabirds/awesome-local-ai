// sel.geometry_ops: pure rectangle maths (TC-01 to TC-04).
import { describe, expect, it } from 'vitest';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  type Rect,
  clampScale,
  handleScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleFromHandle,
  scaleWithin,
  unionRects,
} from '../../src/shared/geometry';

const square = (x: number, y: number, size = STICKY_SIZE_WORLD): Rect => ({
  x,
  y,
  width: size,
  height: size,
});

describe('geometry', () => {
  it('rectContains is true only when all four edges are inside (edges may coincide)', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(rectContains(outer, { x: 90, y: 10, width: 20, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects spans all rects; null for none', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([square(0, 0, 10), square(50, -20, 10)])).toEqual({
      x: 0,
      y: -20,
      width: 60,
      height: 30,
    });
  });

  it('normalizeRect accepts corners in any order', () => {
    expect(normalizeRect({ x: 10, y: 50 }, { x: -10, y: 20 })).toEqual({
      x: -10,
      y: 20,
      width: 20,
      height: 30,
    });
  });

  it('TC-01 resizeRect se handle, aspect locked: 200×200 + (100, 40) → 300×300 from the top-left', () => {
    expect(resizeRect(square(0, 0), 'se', { x: 100, y: 40 }, true)).toEqual(square(0, 0, 300));
  });

  it('resizeRect without aspect lock: corner changes both, edge one; opposite side stays', () => {
    expect(resizeRect(square(0, 0), 'se', { x: 100, y: 40 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 240,
    });
    expect(resizeRect(square(0, 0), 'e', { x: 100, y: 40 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
    expect(resizeRect(square(0, 0), 'nw', { x: 50, y: 20 }, false)).toEqual({
      x: 50,
      y: 20,
      width: 150,
      height: 180,
    });
    // Aspect-locked edge handle: the other axis grows around the centre.
    expect(resizeRect(square(0, 0), 'e', { x: 200, y: 0 }, true)).toEqual({
      x: 0,
      y: -100,
      width: 400,
      height: 400,
    });
  });

  it('TC-02 shrinking a sticky to STICKY_MIN_SIZE_WORLD − 1 is clamped to exactly the minimum', () => {
    const start = square(0, 0);
    for (const target of [STICKY_MIN_SIZE_WORLD - 1, STICKY_MIN_SIZE_WORLD]) {
      const wanted = handleScale(start, 'se', { x: target - 200, y: target - 200 }, true);
      const s = clampScale(wanted, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      expect(scaleFromHandle(start, 'se', s)).toEqual(square(0, 0, STICKY_MIN_SIZE_WORLD));
    }
    // Dragging past the opposite corner (a negative size) also stops at the minimum.
    const flipped = handleScale(start, 'se', { x: -500, y: -500 }, true);
    const s = clampScale(flipped, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(scaleFromHandle(start, 'se', s)).toEqual(square(0, 0, STICKY_MIN_SIZE_WORLD));
  });

  it('TC-03 clampScale stops every object at the scale where the first reaches MAX_OBJECT_SIZE_WORLD', () => {
    const big = { x: 0, y: 0, width: 10_000, height: 400 };
    const small = { x: 10_100, y: 0, width: 200, height: 200 };
    const s = clampScale({ x: 3, y: 1 }, [big, small], [10, STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(s).toEqual({ x: 2, y: 1 });
    // Just above the limit is clamped; relative layout is preserved.
    const exceed = (MAX_OBJECT_SIZE_WORLD + 1) / 10_000;
    const s2 = clampScale({ x: exceed, y: exceed }, [big, small], [10, 50], MAX_OBJECT_SIZE_WORLD);
    expect(s2).toEqual({ x: 2, y: 2 });
    const from = unionRects([big, small])!;
    const to = scaleFromHandle(from, 'se', s2);
    const a = scaleWithin(big, from, to);
    const b = scaleWithin(small, from, to);
    expect(a.width).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(b.width).toBe(400);
    expect(b.x - (a.x + a.width)).toBe(200);
  });

  it('TC-04 two 200-unit notes 100 apart, box twice as wide → 400 wide each, gap 200', () => {
    const a = square(0, 0);
    const b = square(300, 0);
    const from = unionRects([a, b])!;
    const to = resizeRect(from, 'e', { x: from.width, y: 0 }, true);
    expect(to.width).toBe(1000);
    const a2 = scaleWithin(a, from, to);
    const b2 = scaleWithin(b, from, to);
    expect(a2.width).toBe(400);
    expect(a2.height).toBe(400);
    expect(b2.width).toBe(400);
    expect(b2.x - (a2.x + a2.width)).toBe(200);
  });
});
