import { describe, expect, it } from 'vitest';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import {
  clampScale, normalizeRect, rectContains, resizeRect, scaledRect, scaleWithin, unionRects, type Rect,
} from '../../src/shared/geometry';

const sq = (x: number, y: number, size = 200): Rect => ({ x, y, width: size, height: size });

describe('geometry', () => {
  it('TC-01 se handle with aspect lock: 200x200 + (100,40) -> 300x300', () => {
    expect(resizeRect(sq(0, 0), 'se', { x: 100, y: 40 }, true)).toEqual(sq(0, 0, 300));
  });

  it('corner handles anchor the opposite corner; edge handles change one axis', () => {
    expect(resizeRect(sq(10, 10), 'nw', { x: -50, y: -20 }, false)).toEqual({ x: -40, y: -10, width: 250, height: 220 });
    expect(resizeRect(sq(0, 0), 'e', { x: 60, y: 99 }, false)).toEqual({ x: 0, y: 0, width: 260, height: 200 });
    expect(resizeRect(sq(0, 0), 'n', { x: 99, y: -50 }, false)).toEqual({ x: 0, y: -50, width: 200, height: 250 });
  });

  it('an edge handle with aspect lock keeps the ratio, centred on the other axis', () => {
    expect(resizeRect(sq(0, 0), 'e', { x: 100, y: 0 }, true)).toEqual({ x: 0, y: -50, width: 300, height: 300 });
  });

  it('dragging past the opposite edge never flips the box', () => {
    const r = resizeRect(sq(0, 0), 'e', { x: -500, y: 0 }, false);
    expect(r.width).toBeGreaterThan(0);
  });

  it('TC-02 shrinking below the minimum clamps at exactly 50x50 (minimum - 1, and exact)', () => {
    for (const target of [STICKY_MIN_SIZE_WORLD - 1, STICKY_MIN_SIZE_WORLD]) {
      const box = sq(0, 0);
      const raw = resizeRect(box, 'se', { x: target - 200, y: target - 200 }, true);
      const s = clampScale({ x: raw.width / 200, y: raw.height / 200 }, [box], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      const out = scaledRect(box, 'se', s);
      expect(out.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 9);
      expect(out.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 9);
    }
  });

  it('TC-03 the whole selection stops when the first object reaches the maximum', () => {
    const rects = [sq(0, 0, 1000), sq(1500, 0, 10_000)];
    const s = clampScale({ x: 5, y: 5 }, rects, [50, 10], MAX_OBJECT_SIZE_WORLD);
    expect(s.x).toBeCloseTo(2, 9); // 10,000 * 2 = 20,000
    expect(s.y).toBeCloseTo(2, 9);
    const box = unionRects(rects)!;
    const target = scaledRect(box, 'se', s);
    const out = rects.map((r) => scaleWithin(r, box, target));
    expect(out[1].width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
    expect(out[0].width).toBeCloseTo(2000, 6);
    expect(out[1].x - out[0].x).toBeCloseTo(3000, 6); // layout scaled uniformly
    // one over the limit is refused, exactly at the limit is allowed
    expect(clampScale({ x: 2.0001, y: 2.0001 }, [sq(0, 0, 10_000)], [50], MAX_OBJECT_SIZE_WORLD).x).toBe(2);
    expect(clampScale({ x: 2, y: 2 }, [sq(0, 0, 10_000)], [50], MAX_OBJECT_SIZE_WORLD).x).toBe(2);
  });

  it('clampScale limits axes independently when they scale differently', () => {
    const s = clampScale({ x: 0.01, y: 3 }, [{ x: 0, y: 0, width: 100, height: 100 }], [10], MAX_OBJECT_SIZE_WORLD);
    expect(s.x).toBeCloseTo(0.1, 9);
    expect(s.y).toBe(3);
  });

  it('TC-04 two 200 notes 100 apart, box width x2 -> 400 wide, gap 200', () => {
    const a = sq(0, 0);
    const b = sq(300, 0);
    const box = unionRects([a, b])!;
    expect(box).toEqual({ x: 0, y: 0, width: 500, height: 200 });
    const target = resizeRect(box, 'e', { x: 500, y: 0 }, true);
    const [na, nb] = [a, b].map((r) => scaleWithin(r, box, target));
    expect(na.width).toBe(400);
    expect(na.height).toBe(400);
    expect(nb.x - (na.x + na.width)).toBe(200);
  });

  it('rectContains is true only when all four edges are inside', () => {
    const marquee = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(marquee, { x: 10, y: 10, width: 80, height: 80 })).toBe(true);
    expect(rectContains(marquee, { x: 10, y: 10, width: 100, height: 80 })).toBe(false);
    expect(rectContains(marquee, { x: 200, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects is null for nothing; normalizeRect orders corners', () => {
    expect(unionRects([])).toBeNull();
    expect(normalizeRect({ x: 10, y: 5 }, { x: -10, y: 20 })).toEqual({ x: -10, y: 5, width: 20, height: 15 });
  });

  it('scaleWithin leaves a child alone inside a degenerate box', () => {
    const child = sq(1, 2, 3);
    expect(scaleWithin(child, { x: 0, y: 0, width: 0, height: 0 }, sq(0, 0))).toEqual(child);
  });
});
