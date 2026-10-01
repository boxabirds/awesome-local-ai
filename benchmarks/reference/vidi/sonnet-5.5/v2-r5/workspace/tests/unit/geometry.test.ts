import { describe, expect, it } from 'vitest';
import {
  clampScale, normalizeRect, rectContains, resizeRect, scaleWithin, unionRects, type Rect,
} from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

const sq = (x: number, y: number, s = 200): Rect => ({ x, y, width: s, height: s });

describe('geometry (sel.geometry_ops)', () => {
  it('TC-01 se handle with aspect lock: 200x200 + (100,40) -> 300x300', () => {
    expect(resizeRect(sq(0, 0), 'se', { x: 100, y: 40 }, true)).toEqual(sq(0, 0, 300));
  });

  it('resizeRect: edge handle changes one axis, nw keeps the se corner fixed', () => {
    expect(resizeRect(sq(0, 0), 'e', { x: 50, y: 99 }, false)).toEqual({ x: 0, y: 0, width: 250, height: 200 });
    expect(resizeRect(sq(0, 0), 'nw', { x: -50, y: -50 }, false)).toEqual({ x: -50, y: -50, width: 250, height: 250 });
    // aspect-locked edge handle centres the other axis
    expect(resizeRect(sq(0, 0), 's', { x: 0, y: 100 }, true)).toEqual({ x: -50, y: 0, width: 300, height: 300 });
  });

  it.each([STICKY_MIN_SIZE_WORLD - 1, STICKY_MIN_SIZE_WORLD])('TC-02 shrink to %i is clamped to 50x50', (target) => {
    const start = sq(0, 0);
    const delta = target - 200;
    const box = resizeRect(start, 'se', { x: delta, y: delta }, true);
    const scale = clampScale({ x: box.width / 200, y: box.height / 200 }, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(start.width * scale.x).toBeCloseTo(50);
    expect(start.height * scale.y).toBeCloseTo(50);
  });

  it('TC-03 clampScale stops the whole selection when the first object hits the maximum', () => {
    const rects = [sq(0, 0, 10_000), sq(20_000, 0, 100)];
    const s = clampScale({ x: 5, y: 5 }, rects, [50, 50], MAX_OBJECT_SIZE_WORLD);
    expect(s.x).toBeCloseTo(2);
    expect(s.y).toBeCloseTo(2);
    // layout preserved: both rects scale by the same factor
    const box = { x: 0, y: 0, width: 20_100, height: 10_000 };
    const to = { ...box, width: box.width * s.x, height: box.height * s.y };
    const a = scaleWithin(rects[0], box, to);
    const b = scaleWithin(rects[1], box, to);
    expect(a.width).toBeCloseTo(20_000);
    expect(b.width / a.width).toBeCloseTo(0.01);
    expect(b.x / a.width).toBeCloseTo(2);
    // MAX + 1 never passes
    expect(clampScale({ x: 20_001 / 200, y: 20_001 / 200 }, [sq(0, 0)], [50], MAX_OBJECT_SIZE_WORLD).x * 200)
      .toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
  });

  it('clampScale clamps axes independently when the scales differ', () => {
    const s = clampScale({ x: 0.1, y: 3 }, [{ x: 0, y: 0, width: 100, height: 100 }], [10], MAX_OBJECT_SIZE_WORLD);
    expect(s.x).toBeCloseTo(0.1);
    expect(s.y).toBe(3);
    expect(clampScale({ x: 0.01, y: 3 }, [{ x: 0, y: 0, width: 100, height: 100 }], [10], MAX_OBJECT_SIZE_WORLD).x).toBeCloseTo(0.1);
  });

  it('TC-04 two 200-unit notes 100 apart, box doubled in width -> 400 wide, gap 200', () => {
    const a = { x: 0, y: 0, width: 200, height: 200 };
    const b = { x: 300, y: 0, width: 200, height: 200 };
    const from = unionRects([a, b])!;
    const to = resizeRect(from, 'e', { x: 500, y: 0 }, false);
    const a2 = scaleWithin(a, from, to);
    const b2 = scaleWithin(b, from, to);
    expect(a2.width).toBe(400);
    expect(b2.x - (a2.x + a2.width)).toBe(200);
  });

  it('unionRects, normalizeRect, rectContains', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([sq(0, 0, 10), sq(20, 30, 10)])).toEqual({ x: 0, y: 0, width: 30, height: 40 });
    expect(normalizeRect({ x: 10, y: 10 }, { x: 0, y: 5 })).toEqual({ x: 0, y: 5, width: 10, height: 5 });
    expect(rectContains(sq(0, 0, 100), sq(0, 0, 100))).toBe(true);
    expect(rectContains(sq(0, 0, 100), sq(1, 0, 100))).toBe(false);
  });
});
