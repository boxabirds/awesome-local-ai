import { describe, expect, it } from 'vitest';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  type Rect,
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleFromHandle,
  scaleWithin,
  unionRects,
} from '../../src/shared/geometry';

const note = (x: number, y: number, size = STICKY_SIZE_WORLD): Rect => ({ x, y, width: size, height: size });

describe('sel.geometry_ops geometry', () => {
  it('rectContains is inclusive of edges and false for partial overlap', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(rectContains(outer, { x: 50, y: 50, width: 60, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects spans all rects and is null for none', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([note(0, 0), note(300, -50)])).toEqual({ x: 0, y: -50, width: 500, height: 250 });
  });

  it('normalizeRect accepts corners in any order', () => {
    expect(normalizeRect({ x: 10, y: 50 }, { x: -10, y: 20 })).toEqual({ x: -10, y: 20, width: 20, height: 30 });
  });

  it('TC-01 corner resize with aspect lock: 200×200 + (100, 40) → 300×300 from the opposite corner', () => {
    expect(resizeRect(note(0, 0), 'se', { x: 100, y: 40 }, true)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    // nw handle keeps the bottom-right corner fixed.
    expect(resizeRect(note(0, 0), 'nw', { x: -100, y: -40 }, true)).toEqual({ x: -100, y: -100, width: 300, height: 300 });
  });

  it('edge handles change one axis without aspect lock; corners change both', () => {
    expect(resizeRect(note(0, 0), 'e', { x: 50, y: 70 }, false)).toEqual({ x: 0, y: 0, width: 250, height: 200 });
    expect(resizeRect(note(0, 0), 'n', { x: 50, y: 20 }, false)).toEqual({ x: 0, y: 20, width: 200, height: 180 });
    expect(resizeRect(note(0, 0), 'sw', { x: 20, y: 30 }, false)).toEqual({ x: 20, y: 0, width: 180, height: 230 });
  });

  it('edge handle with aspect lock scales the other axis around its centre', () => {
    expect(resizeRect(note(0, 0), 'e', { x: 200, y: 0 }, true)).toEqual({ x: 0, y: -100, width: 400, height: 400 });
  });

  it('TC-02 shrinking a sticky below STICKY_MIN_SIZE_WORLD clamps to 50×50', () => {
    const start = note(0, 0);
    for (const target of [STICKY_MIN_SIZE_WORLD - 1, 1]) {
      const to = resizeRect(start, 'se', { x: target - 200, y: target - 200 }, true);
      const s = to.width / start.width;
      const clamped = clampScale({ x: s, y: s }, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      const final = scaleFromHandle(start, 'se', clamped);
      expect(final).toEqual({ x: 0, y: 0, width: STICKY_MIN_SIZE_WORLD, height: STICKY_MIN_SIZE_WORLD });
    }
    // Exactly the minimum is allowed unchanged.
    const exact = STICKY_MIN_SIZE_WORLD / 200;
    expect(clampScale({ x: exact, y: exact }, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: exact,
      y: exact,
    });
  });

  it('TC-03 clampScale stops every object when the first reaches MAX_OBJECT_SIZE_WORLD, keeping the layout', () => {
    const small = { x: 0, y: 0, width: 100, height: 50 };
    const big = { x: 200, y: 0, width: 1000, height: 400 };
    const box = unionRects([small, big])!;
    const wanted = (MAX_OBJECT_SIZE_WORLD + 1) / 1000;
    const s = clampScale({ x: wanted, y: wanted }, [small, big], [10, STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(s).toEqual({ x: MAX_OBJECT_SIZE_WORLD / 1000, y: MAX_OBJECT_SIZE_WORLD / 1000 });
    const to = scaleFromHandle(box, 'se', s);
    const a = scaleWithin(small, box, to);
    const b = scaleWithin(big, box, to);
    expect(b.width).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(a.width).toBe(2000);
    // Relative layout: gap and ratios scale by the same factor.
    expect(b.x - (a.x + a.width)).toBeCloseTo(100 * 20);
    expect(a.width / b.width).toBeCloseTo(small.width / big.width);
    // Non-uniform scales clamp per axis.
    expect(clampScale({ x: 300, y: 0.01 }, [small], [10], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 200, y: 0.2 });
    // Collapsed to zero on both axes without aspect lock: each axis stops at its own limit.
    expect(clampScale({ x: 0, y: 0 }, [small], [10], MAX_OBJECT_SIZE_WORLD, false)).toEqual({ x: 0.1, y: 0.2 });
  });

  it('TC-04 two 200-unit notes 100 apart, box twice as wide → 400 wide, gap 200', () => {
    const a = note(0, 0);
    const b = note(300, 0);
    const box = unionRects([a, b])!;
    const to = resizeRect(box, 'e', { x: box.width, y: 0 }, true);
    expect(to.width).toBe(1000);
    const a2 = scaleWithin(a, box, to);
    const b2 = scaleWithin(b, box, to);
    expect(a2.width).toBe(400);
    expect(a2.height).toBe(400);
    expect(b2.width).toBe(400);
    expect(b2.x - (a2.x + a2.width)).toBe(200);
  });
});
