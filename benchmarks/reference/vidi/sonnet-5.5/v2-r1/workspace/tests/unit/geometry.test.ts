import { describe, expect, it } from 'vitest';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleFromHandle,
  scaleWithin,
  unionRects,
} from '../../src/shared/geometry';

const sq = (x: number, y: number, size = 200) => ({ x, y, width: size, height: size });

describe('geometry', () => {
  it('TC-01 resizeRect se handle with aspect lock: 200x200 + (100,40) -> 300x300', () => {
    const r = resizeRect(sq(0, 0), 'se', { x: 100, y: 40 }, true);
    expect(r).toEqual(sq(0, 0, 300));
  });

  it('resizeRect: edge handle changes one axis, corner both, opposite side stays fixed', () => {
    expect(resizeRect(sq(10, 10), 'e', { x: 50, y: 99 }, false)).toEqual({ x: 10, y: 10, width: 250, height: 200 });
    expect(resizeRect(sq(10, 10), 'w', { x: -50, y: 0 }, false)).toEqual({ x: -40, y: 10, width: 250, height: 200 });
    expect(resizeRect(sq(10, 10), 'nw', { x: -20, y: -30 }, false)).toEqual({ x: -10, y: -20, width: 220, height: 230 });
  });

  it('resizeRect: Shift (aspect) on an edge handle keeps the ratio, centred on the other axis', () => {
    const r = resizeRect({ x: 0, y: 0, width: 200, height: 100 }, 'e', { x: 200, y: 0 }, true);
    expect(r).toEqual({ x: 0, y: -50, width: 400, height: 200 });
  });

  it('TC-02 shrinking below the minimum is clamped to 50x50 (boundary: -1 and exact)', () => {
    for (const target of [STICKY_MIN_SIZE_WORLD - 1, STICKY_MIN_SIZE_WORLD]) {
      const raw = resizeRect(sq(0, 0), 'se', { x: target - 200, y: target - 200 }, true);
      const scale = clampScale({ x: raw.width / 200, y: raw.height / 200 }, [sq(0, 0)], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      const out = scaleFromHandle(sq(0, 0), 'se', scale);
      expect(out.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
      expect(out.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
    }
  });

  it('TC-03 clampScale stops all objects when the first reaches the maximum; layout preserved', () => {
    const a = sq(0, 0, 1000);
    const b = { x: 2000, y: 0, width: 4000, height: 4000 };
    const box = unionRects([a, b])!;
    const scale = clampScale({ x: 10, y: 10 }, [a, b], [50, 10], MAX_OBJECT_SIZE_WORLD);
    expect(scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 4000);
    expect(scale.y).toBe(scale.x);
    const target = scaleFromHandle(box, 'se', scale);
    const outB = scaleWithin(b, box, target);
    expect(outB.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
    const outA = scaleWithin(a, box, target);
    expect(outA.width / outB.width).toBeCloseTo(a.width / b.width);
    expect((outB.x - outA.x) / outA.width).toBeCloseTo((b.x - a.x) / a.width);
  });

  it('clampScale: just over the maximum is clamped, exactly at it is kept', () => {
    const r = sq(0, 0, 10_000);
    expect(clampScale({ x: 2.0001, y: 2.0001 }, [r], [50], MAX_OBJECT_SIZE_WORLD).x).toBeCloseTo(2);
    expect(clampScale({ x: 2, y: 2 }, [r], [50], MAX_OBJECT_SIZE_WORLD).x).toBeCloseTo(2);
  });

  it('clampScale: unequal scales are clamped per axis', () => {
    const r = { x: 0, y: 0, width: 100, height: 100 };
    expect(clampScale({ x: 0.1, y: 3 }, [r], [10], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 0.1, y: 3 });
    expect(clampScale({ x: 0.01, y: 3 }, [r], [10], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 0.1, y: 3 });
  });

  it('TC-04 two 200-unit notes 100 apart, box width doubled -> 400 wide, gap 200', () => {
    const a = sq(0, 0);
    const b = sq(300, 0);
    const from = unionRects([a, b])!;
    const to = { ...from, width: from.width * 2 };
    const na = scaleWithin(a, from, to);
    const nb = scaleWithin(b, from, to);
    expect(na.width).toBe(400);
    expect(nb.width).toBe(400);
    expect(nb.x - (na.x + na.width)).toBe(200);
  });

  it('rectContains is true only when all four edges are inside', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 80, height: 80 })).toBe(true);
    expect(rectContains(outer, { x: 50, y: 10, width: 80, height: 80 })).toBe(false);
    expect(rectContains(outer, { x: 200, y: 10, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects and normalizeRect', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([sq(0, 0, 10), sq(20, 30, 10)])).toEqual({ x: 0, y: 0, width: 30, height: 40 });
    expect(normalizeRect({ x: 10, y: 5 }, { x: 2, y: 9 })).toEqual({ x: 2, y: 5, width: 8, height: 4 });
  });
});
