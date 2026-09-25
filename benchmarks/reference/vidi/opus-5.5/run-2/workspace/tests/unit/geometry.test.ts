import { describe, expect, it } from 'vitest';
import {
  applyScale,
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

const NOTE: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };

describe('sel.geometry_ops: rect helpers', () => {
  it('rectContains: inside, touching edges inside, partly outside', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(rectContains(outer, { x: 90, y: 10, width: 20, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: 200, y: 200, width: 1, height: 1 })).toBe(false);
  });

  it('unionRects: null for no rects, bounding box otherwise', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([NOTE, { x: 300, y: -50, width: 10, height: 10 }])).toEqual({ x: 0, y: -50, width: 310, height: 250 });
  });

  it('normalizeRect works for any drag direction', () => {
    expect(normalizeRect({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 40, height: 60 });
  });
});

describe('sel.geometry_ops: resizeRect', () => {
  it('TC-01 se corner, aspect locked: 200×200 dragged by (100, 40) → 300×300 from the top-left', () => {
    expect(resizeRect(NOTE, 'se', { x: 100, y: 40 }, true)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('edge handles change one axis only when not locked', () => {
    expect(resizeRect(NOTE, 'e', { x: 50, y: 999 }, false)).toEqual({ x: 0, y: 0, width: 250, height: 200 });
    expect(resizeRect(NOTE, 'n', { x: 999, y: 50 }, false)).toEqual({ x: 0, y: 50, width: 200, height: 150 });
  });

  it('west / north handles keep the opposite edge fixed', () => {
    const r = resizeRect(NOTE, 'nw', { x: -100, y: -100 }, false);
    expect(r).toEqual({ x: -100, y: -100, width: 300, height: 300 });
  });

  it('aspect-locked edge handle scales both axes about the centre of the other axis', () => {
    expect(resizeRect(NOTE, 'e', { x: 200, y: 0 }, true)).toEqual({ x: 0, y: -100, width: 400, height: 400 });
  });

  it('dragging past the opposite edge does not flip (size 0)', () => {
    expect(resizeRect(NOTE, 'e', { x: -500, y: 0 }, false).width).toBe(0);
  });
});

describe('sel.geometry_ops: clampScale', () => {
  it('TC-02 shrinking to STICKY_MIN_SIZE_WORLD − 1 is clamped to 50×50; exactly the minimum is kept', () => {
    const below = (STICKY_MIN_SIZE_WORLD - 1) / STICKY_SIZE_WORLD;
    const s = clampScale({ x: below, y: below }, [NOTE], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(applyScale(NOTE, 'se', s)).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    const exact = STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD;
    expect(clampScale({ x: exact, y: exact }, [NOTE], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: exact,
      y: exact,
    });
  });

  it('TC-03 the whole group stops when the first object would exceed MAX_OBJECT_SIZE_WORLD; layout preserved', () => {
    const small: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const big: Rect = { x: 200, y: 0, width: 1000, height: 1000 };
    const box = unionRects([small, big])!;
    // Asked: ×30 → the big one would be 30,000 (+1 beyond the limit is also refused).
    const s = clampScale({ x: 30, y: 30 }, [small, big], [10, 10], MAX_OBJECT_SIZE_WORLD);
    expect(s).toEqual({ x: 20, y: 20 });
    const to = applyScale(box, 'se', s);
    const a = scaleWithin(small, box, to);
    const b = scaleWithin(big, box, to);
    expect(b.width).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(a.width).toBe(2000); // same factor for every object
    expect(b.x - a.x).toBe(20 * (big.x - small.x));
    const justOver = (MAX_OBJECT_SIZE_WORLD + 1) / big.width;
    expect(clampScale({ x: justOver, y: justOver }, [big], [10], MAX_OBJECT_SIZE_WORLD).x).toBe(20);
  });

  it('non-uniform scales clamp per axis', () => {
    const s = clampScale({ x: 0.01, y: 1 }, [{ x: 0, y: 0, width: 100, height: 40 }], [10], MAX_OBJECT_SIZE_WORLD);
    expect(s).toEqual({ x: 0.1, y: 1 });
  });
});

describe('sel.geometry_ops: scaleWithin', () => {
  it('TC-04 two 200-unit notes 100 apart, box twice as wide → 400 wide each, gap 200', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const from = unionRects([a, b])!;
    // Sticky notes lock the aspect ratio, so the right edge scales both axes.
    const to = resizeRect(from, 'e', { x: from.width, y: 0 }, true);
    const a2 = scaleWithin(a, from, to);
    const b2 = scaleWithin(b, from, to);
    expect(a2.width).toBe(400);
    expect(a2.height).toBe(400);
    expect(b2.width).toBe(400);
    expect(b2.x - (a2.x + a2.width)).toBe(200);
  });
});
