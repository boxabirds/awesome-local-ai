import { describe, expect, it } from 'vitest';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';

const sq = (x: number, y: number, s = 200): Rect => ({ x, y, width: s, height: s });

describe('geometry', () => {
  it('TC-01 resizeRect se handle with aspect lock: 200x200 + (100,40) -> 300x300', () => {
    expect(resizeRect(sq(0, 0), 'se', { x: 100, y: 40 }, true)).toEqual(sq(0, 0, 300));
  });

  it('resizeRect without aspect lock: corner changes both, edge only one axis', () => {
    expect(resizeRect(sq(0, 0), 'se', { x: 100, y: 40 }, false)).toEqual({ x: 0, y: 0, width: 300, height: 240 });
    expect(resizeRect(sq(0, 0), 'e', { x: 100, y: 40 }, false)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(resizeRect(sq(0, 0), 'n', { x: 100, y: -50 }, false)).toEqual({ x: 0, y: -50, width: 200, height: 250 });
  });

  it('resizeRect grows from the opposite corner and keeps the ratio on an edge handle', () => {
    expect(resizeRect(sq(100, 100), 'nw', { x: -100, y: -100 }, true)).toEqual(sq(0, 0, 300));
    expect(resizeRect(sq(0, 0), 'e', { x: 200, y: 0 }, true)).toEqual({ x: 0, y: -100, width: 400, height: 400 });
  });

  it('TC-02 shrinking below the sticky minimum is clamped to 50x50 (and exactly 50 is allowed)', () => {
    for (const target of [STICKY_MIN_SIZE_WORLD - 1, STICKY_MIN_SIZE_WORLD]) {
      const start = sq(0, 0);
      const raw = resizeRect(start, 'se', { x: target - 200, y: target - 200 }, true);
      const s = clampScale({ x: raw.width / 200, y: raw.height / 200 }, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      expect(start.width * s.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
      expect(start.height * s.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
    }
  });

  it('TC-03 clampScale stops the whole selection when the first object hits the maximum', () => {
    const rects = [sq(0, 0, 100), sq(300, 0, 5000)];
    const s = clampScale({ x: 10, y: 10 }, rects, [50, 50], MAX_OBJECT_SIZE_WORLD);
    expect(s.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 5000);
    expect(s.y).toBe(s.x); // uniform: relative layout preserved
    expect(5000 * s.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
    expect(100 * s.x).toBeGreaterThan(100);
    // one unit over / exactly at the limit
    expect(clampScale({ x: 4, y: 4 }, [sq(0, 0, 5000)], [50], MAX_OBJECT_SIZE_WORLD).x).toBe(4);
    expect(clampScale({ x: 4.0002, y: 4.0002 }, [sq(0, 0, 5000)], [50], MAX_OBJECT_SIZE_WORLD).x).toBe(4);
  });

  it('clampScale limits axes separately for non-uniform scales and never forces an undersized object up', () => {
    const s = clampScale({ x: 0.01, y: 2 }, [{ x: 0, y: 0, width: 200, height: 100 }], [10], MAX_OBJECT_SIZE_WORLD);
    expect(s.x).toBeCloseTo(0.05);
    expect(s.y).toBe(2);
    expect(clampScale({ x: 0.5, y: 0.5 }, [sq(0, 0, 40)], [50], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
  });

  it('TC-04 two 200 notes 100 apart: box twice as wide -> 400 wide, gap 200', () => {
    const a = sq(0, 0);
    const b = sq(300, 0);
    const from = unionRects([a, b])!;
    expect(from).toEqual({ x: 0, y: 0, width: 500, height: 200 });
    const to = resizeRect(from, 'e', { x: 500, y: 0 }, true);
    const na = scaleWithin(a, from, to);
    const nb = scaleWithin(b, from, to);
    expect(na.width).toBe(400);
    expect(na.height).toBe(400);
    expect(nb.x - (na.x + na.width)).toBe(200);
  });

  it('rectContains: only fully inside counts; touching edges are inside', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 80, height: 80 })).toBe(true);
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(rectContains(outer, { x: 50, y: 50, width: 100, height: 10 })).toBe(false);
    expect(rectContains(outer, { x: 100.5, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects is null when empty; normalizeRect orders corners', () => {
    expect(unionRects([])).toBeNull();
    expect(normalizeRect({ x: 10, y: 20 }, { x: -5, y: 40 })).toEqual({ x: -5, y: 20, width: 15, height: 20 });
  });
});
