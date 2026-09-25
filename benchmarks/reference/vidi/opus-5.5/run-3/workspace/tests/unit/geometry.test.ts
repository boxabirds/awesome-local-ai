import { describe, expect, it } from 'vitest';
import {
  clampScale,
  handleScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleFromHandle,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

const note = (x: number, y: number, size = 200): Rect => ({ x, y, width: size, height: size });

describe('geometry (sel.geometry_ops)', () => {
  it('TC-01 resizeRect se corner, aspect locked: 200×200 dragged by (100, 40) → 300×300 from the nw corner', () => {
    expect(resizeRect(note(0, 0), 'se', { x: 100, y: 40 }, true)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('resizeRect without aspect lock: corners change both axes, edges one; the opposite side stays put', () => {
    expect(resizeRect(note(0, 0), 'se', { x: 100, y: 40 }, false)).toEqual({ x: 0, y: 0, width: 300, height: 240 });
    expect(resizeRect(note(0, 0), 'e', { x: 100, y: 40 }, false)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(resizeRect(note(0, 0), 'n', { x: 100, y: -50 }, false)).toEqual({ x: 0, y: -50, width: 200, height: 250 });
    expect(resizeRect(note(0, 0), 'nw', { x: 50, y: 20 }, false)).toEqual({ x: 50, y: 20, width: 150, height: 180 });
    expect(resizeRect(note(0, 0), 'w', { x: -100, y: 0 }, false)).toEqual({ x: -100, y: 0, width: 300, height: 200 });
  });

  it('an aspect-locked edge handle scales the other axis about the centre', () => {
    expect(resizeRect(note(0, 0), 'e', { x: 200, y: 0 }, true)).toEqual({ x: 0, y: -100, width: 400, height: 400 });
  });

  it('dragging past the opposite side never flips the rect', () => {
    expect(handleScale(note(0, 0), 'se', { x: -500, y: -500 }, false)).toEqual({ x: 0, y: 0 });
  });

  it.each([
    [STICKY_MIN_SIZE_WORLD - 1, STICKY_MIN_SIZE_WORLD],
    [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD],
  ])('TC-02 shrinking a note to %i is clamped to %i×%i', (target, expected) => {
    const start = note(0, 0);
    const scale = handleScale(start, 'se', { x: target - 200, y: target - 200 }, true);
    const clamped = clampScale(scale, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(scaleFromHandle(start, 'se', clamped)).toEqual({ x: 0, y: 0, width: expected, height: expected });
  });

  it('TC-03 clampScale stops the whole group when the first object reaches MAX_OBJECT_SIZE_WORLD', () => {
    const small = note(0, 0, 100);
    const big = note(300, 0, 1000);
    const from = unionRects([small, big])!;
    const clamped = clampScale({ x: 30, y: 30 }, [small, big], [10, 10], MAX_OBJECT_SIZE_WORLD);
    expect(clamped).toEqual({ x: MAX_OBJECT_SIZE_WORLD / 1000, y: MAX_OBJECT_SIZE_WORLD / 1000 });
    const to = scaleFromHandle(from, 'se', clamped);
    const a = scaleWithin(small, from, to);
    const b = scaleWithin(big, from, to);
    expect(b.width).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(a.width).toBe(2000);
    // Relative layout preserved: the gap and the size ratio scale with the group.
    expect(b.x - a.x).toBe(300 * 20);
    expect(b.width / a.width).toBe(10);
    // Just past the limit (MAX + 1) is clamped too; below the limit is untouched.
    expect(clampScale({ x: (MAX_OBJECT_SIZE_WORLD + 1) / 1000, y: 1 }, [big], [10], MAX_OBJECT_SIZE_WORLD).x).toBe(20);
    expect(clampScale({ x: 2, y: 2 }, [small, big], [10, 10], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 2, y: 2 });
  });

  it('clampScale uses the most restrictive minimum of the group', () => {
    const rects = [note(0, 0, 100), note(200, 0, 400)];
    expect(clampScale({ x: 0.1, y: 0.1 }, rects, [50, 50], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 0.5, y: 0.5 });
    // Per axis when the aspect is free.
    expect(clampScale({ x: 0.1, y: 1 }, rects, [50, 50], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 0.5, y: 1 });
  });

  it('TC-04 two 200-unit notes 100 apart: box twice as wide (aspect locked) → 400 wide, gap 200', () => {
    const a = note(0, 0);
    const b = note(300, 0);
    const from = unionRects([a, b])!;
    expect(from).toEqual({ x: 0, y: 0, width: 500, height: 200 });
    const to = resizeRect(from, 'e', { x: 500, y: 0 }, true);
    const a2 = scaleWithin(a, from, to);
    const b2 = scaleWithin(b, from, to);
    expect(a2.width).toBe(400);
    expect(a2.height).toBe(400);
    expect(b2.width).toBe(400);
    expect(b2.x - (a2.x + a2.width)).toBe(200);
  });

  it('rectContains counts touching edges as inside, overhang as outside', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(rectContains(outer, { x: 1, y: 1, width: 100, height: 10 })).toBe(false);
  });

  it('unionRects is null for no rects; normalizeRect accepts corners in any order', () => {
    expect(unionRects([])).toBeNull();
    expect(normalizeRect({ x: 10, y: 50 }, { x: -10, y: 0 })).toEqual({ x: -10, y: 0, width: 20, height: 50 });
  });

  it('clampScale does not force a side already below its minimum to grow (story 11 thin straight strokes)', () => {
    // A thin horizontal stroke: 200 x 2 with a minimum side of 4.
    const thin = { x: 0, y: 0, width: 200, height: 2 };
    expect(clampScale({ x: 1.1, y: 1.1 }, [thin], [4], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1.1, y: 1.1 });
    expect(clampScale({ x: 0.5, y: 0.5 }, [thin], [4], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
  });
});
