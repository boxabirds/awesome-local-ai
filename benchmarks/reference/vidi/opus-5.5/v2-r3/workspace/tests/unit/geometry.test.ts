import { describe, expect, it } from 'vitest';
import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleRectFrom,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

const note = (x: number, y: number, size = STICKY_SIZE_WORLD): Rect => ({ x, y, width: size, height: size });

describe('geometry (sel.geometry_ops)', () => {
  it('rectContains is true only when all four edges are inside (edges may coincide)', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(rectContains(outer, { x: 90, y: 10, width: 20, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: 100, y: 0, width: 10, height: 10 })).toBe(false); // touching from outside
  });

  it('unionRects spans all rects; null for none', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([note(0, 0), note(300, -50)])).toEqual({ x: 0, y: -50, width: 500, height: 250 });
  });

  it('normalizeRect accepts corners in any order', () => {
    expect(normalizeRect({ x: 10, y: 50 }, { x: -10, y: 20 })).toEqual({ x: -10, y: 20, width: 20, height: 30 });
  });

  it('TC-01 se handle, aspectLocked: 200×200 + (100, 40) → 300×300 from the nw anchor', () => {
    expect(resizeRect(note(0, 0), 'se', { x: 100, y: 40 }, true)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('corner without aspect lock changes both axes independently; nw keeps the se corner', () => {
    expect(resizeRect(note(0, 0), 'nw', { x: 50, y: -20 }, false)).toEqual({ x: 50, y: -20, width: 150, height: 220 });
  });

  it('edge handles change one axis; with aspect lock the other axis scales about its centre', () => {
    const start = { x: 0, y: 0, width: 200, height: 100 };
    expect(resizeRect(start, 'e', { x: 200, y: 999 }, false)).toEqual({ x: 0, y: 0, width: 400, height: 100 });
    expect(resizeRect(start, 'e', { x: 200, y: 0 }, true)).toEqual({ x: 0, y: -50, width: 400, height: 200 });
    expect(resizeRect(start, 'n', { x: 0, y: 50 }, false)).toEqual({ x: 0, y: 50, width: 200, height: 50 });
    expect(resizeRect(start, 'w', { x: 300, y: 0 }, false)).toEqual({ x: 200, y: 0, width: 0, height: 100 }); // no flip
  });

  it('TC-02 shrinking below STICKY_MIN_SIZE_WORLD clamps to exactly 50×50 (−1 and exact)', () => {
    const start = note(0, 0);
    for (const target of [STICKY_MIN_SIZE_WORLD - 1, STICKY_MIN_SIZE_WORLD]) {
      const raw = resizeRect(start, 'se', { x: target - STICKY_SIZE_WORLD, y: target - STICKY_SIZE_WORLD }, true);
      const s = clampScale(
        { x: raw.width / start.width, y: raw.height / start.height },
        [start],
        [STICKY_MIN_SIZE_WORLD],
        MAX_OBJECT_SIZE_WORLD,
      );
      expect(scaleRectFrom(start, 'se', s)).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    }
  });

  it('TC-03 clampScale stops every object when the first reaches MAX_OBJECT_SIZE_WORLD; layout kept', () => {
    const small = { x: 0, y: 0, width: 100, height: 60 };
    const big = { x: 200, y: 0, width: 1000, height: 400 };
    const rects = [small, big];
    // Asked for ×30: big would be 30,000 wide. The first limit hit is big's width at ×20.
    const s = clampScale({ x: 30, y: 30 }, rects, [10, STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(s).toEqual({ x: 20, y: 20 });
    const from = unionRects(rects)!;
    const to = scaleRectFrom(from, 'se', s);
    const out = rects.map((r) => scaleWithin(r, from, to));
    expect(out[1].width).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(out[0]).toEqual({ x: 0, y: 0, width: 2000, height: 1200 });
    expect(out[1].x - (out[0].x + out[0].width)).toBe(20 * 100); // the gap scaled with them
    // Boundary: MAX + 1 is refused, exactly MAX is allowed.
    const exact = clampScale({ x: 20, y: 20 }, [big], [0], MAX_OBJECT_SIZE_WORLD);
    expect(exact.x * big.width).toBe(MAX_OBJECT_SIZE_WORLD);
    const plusOne = clampScale({ x: 20.001, y: 20.001 }, [big], [0], MAX_OBJECT_SIZE_WORLD);
    expect(plusOne.x * big.width).toBe(MAX_OBJECT_SIZE_WORLD);
  });

  it('clampScale keeps independent axes independent when not uniform', () => {
    const s = clampScale({ x: 0.1, y: 1 }, [{ x: 0, y: 0, width: 100, height: 100 }], [10], MAX_OBJECT_SIZE_WORLD, false);
    expect(s).toEqual({ x: 0.1, y: 1 });
    const t = clampScale({ x: 0.05, y: 1 }, [{ x: 0, y: 0, width: 100, height: 100 }], [10], MAX_OBJECT_SIZE_WORLD, false);
    expect(t).toEqual({ x: 0.1, y: 1 });
  });

  it('TC-04 two 200-unit notes 100 apart, box twice as wide → each 400 wide, gap 200', () => {
    const a = note(0, 0);
    const b = note(300, 0);
    const from = unionRects([a, b])!;
    const to = resizeRect(from, 'e', { x: from.width, y: 0 }, true);
    expect(to.width).toBe(1000);
    const [a2, b2] = [a, b].map((r) => scaleWithin(r, from, to));
    expect(a2.width).toBe(400);
    expect(a2.height).toBe(400);
    expect(b2.width).toBe(400);
    expect(b2.x - (a2.x + a2.width)).toBe(200);
  });
});
