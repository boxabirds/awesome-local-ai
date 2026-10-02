import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  anchoredRect,
  clampScale,
  scaleWithin,
  HANDLES,
} from '../../src/shared/geometry';
import type { Point, Rect } from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

/**
 * The full resize pipeline of the transform gesture: resize the bounding box,
 * clamp the scale against the objects' size limits, then map every object into
 * the clamped box.
 */
function resizeGroup(
  box: Rect,
  handle: Parameters<typeof resizeRect>[1],
  delta: Point,
  aspectLocked: boolean,
  objects: Rect[],
  minSizes: number[],
  maxSize: number = MAX_OBJECT_SIZE_WORLD,
): { box: Rect; objects: Rect[] } {
  const target = resizeRect(box, handle, delta, aspectLocked);
  const clamped = clampScale(
    { x: target.width / box.width, y: target.height / box.height },
    objects,
    minSizes,
    maxSize,
  );
  if (aspectLocked) {
    // Stop the whole selection at the first limit it reaches.
    const s = Math.abs(clamped.x - 1) <= Math.abs(clamped.y - 1) ? clamped.x : clamped.y;
    const to = anchoredRect(box, handle, box.width * s, box.height * s, true);
    return { box: to, objects: objects.map((r) => scaleWithin(r, box, to)) };
  }
  const to = anchoredRect(box, handle, box.width * clamped.x, box.height * clamped.y, false);
  return { box: to, objects: objects.map((r) => scaleWithin(r, box, to)) };
}

describe('geometry — rectContains', () => {
  const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };

  it('accepts a rect fully inside and one exactly on the edges', () => {
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
  });

  it('rejects a rect that is partly outside or touches across an edge', () => {
    expect(rectContains(outer, { x: 90, y: 10, width: 20, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: -1, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectContains(outer, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('rejects non-finite input instead of throwing', () => {
    expect(rectContains(outer, { x: Number.NaN, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe('geometry — unionRects and normalizeRect', () => {
  it('returns null for an empty list', () => {
    expect(unionRects([])).toBeNull();
  });

  it('unions rects, filling the gap between them', () => {
    const box = unionRects([
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 300, y: 400, width: 100, height: 50 },
    ]);
    expect(box).toEqual({ x: 0, y: 0, width: 400, height: 450 });
  });

  it('normalises a drag rectangle in every direction', () => {
    expect(normalizeRect({ x: 10, y: 30 }, { x: 40, y: 5 })).toEqual({ x: 10, y: 5, width: 30, height: 25 });
    expect(normalizeRect({ x: 40, y: 5 }, { x: 10, y: 30 })).toEqual({ x: 10, y: 5, width: 30, height: 25 });
  });
});

describe('geometry — resizeRect', () => {
  const square: Rect = { x: 100, y: 100, width: 200, height: 200 };

  it('TC-01: a locked corner drag keeps the ratio, following the longer axis', () => {
    expect(resizeRect(square, 'se', { x: 100, y: 40 }, true)).toEqual({
      x: 100,
      y: 100,
      width: 300,
      height: 300,
    });
    expect(resizeRect(square, 'se', { x: 20, y: 60 }, true)).toEqual({
      x: 100,
      y: 100,
      width: 260,
      height: 260,
    });
  });

  it('resizes only the moved axis when the ratio is free', () => {
    expect(resizeRect(square, 'e', { x: 50, y: 999 }, false)).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 200,
    });
    expect(resizeRect(square, 's', { x: 999, y: -20 }, false)).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 180,
    });
  });

  it('keeps the corner opposite the handle anchored', () => {
    const nw = resizeRect(square, 'nw', { x: 20, y: 30 }, false);
    expect(nw.x).toBeCloseTo(120, 6);
    expect(nw.y).toBeCloseTo(130, 6);
    expect(nw.width).toBeCloseTo(180, 6);
    expect(nw.height).toBeCloseTo(170, 6);
    // Bottom-right corner did not move.
    expect(nw.x + nw.width).toBeCloseTo(300, 6);
    expect(nw.y + nw.height).toBeCloseTo(300, 6);
  });

  it('centres an aspect-locked edge resize across the axis it does not move', () => {
    const wide: Rect = { x: 0, y: 0, width: 400, height: 200 };
    const grown = resizeRect(wide, 'e', { x: 200, y: 0 }, true);
    expect(grown.width).toBeCloseTo(600, 6);
    expect(grown.height).toBeCloseTo(300, 6);
    expect(grown.y).toBeCloseTo(-50, 6);
  });

  it('never returns a zero or negative edge', () => {
    const flipped = resizeRect(square, 'se', { x: -1000, y: -1000 }, false);
    expect(flipped.width).toBeGreaterThan(0);
    expect(flipped.height).toBeGreaterThan(0);
  });

  it('every handle is finite for a finite drag', () => {
    for (const handle of HANDLES) {
      const r = resizeRect(square, handle, { x: 37, y: -12 }, false);
      expect(Number.isFinite(r.x) && Number.isFinite(r.y)).toBe(true);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
  });
});

describe('geometry — clampScale', () => {
  it('TC-02: a shrink stops exactly at the minimum size (boundary)', () => {
    const box: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    const one = resizeGroup(box, 'se', { x: -150, y: -150 }, true, [box], [STICKY_MIN_SIZE_WORLD]);
    expect(one.box.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(one.box.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);

    // One unit below the minimum is still clamped to the minimum.
    const below = resizeGroup(box, 'se', { x: -151, y: -151 }, true, [box], [STICKY_MIN_SIZE_WORLD]);
    expect(below.box.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(below.objects[0].width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(below.objects[0].height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
  });

  it('TC-03: growth stops uniformly when the first object reaches the maximum', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 100, height: 100 };
    const box = unionRects([a, b])!;
    expect(box).toEqual({ x: 0, y: 0, width: 400, height: 200 });

    // A drag asking for a box 1000 times wider: `a` hits the 20 000 limit first.
    const grown = resizeGroup(box, 'e', { x: box.width * 999, y: 0 }, false, [a, b], [50, 10]);
    const scale = MAX_OBJECT_SIZE_WORLD / 200;
    expect(grown.objects[0].width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 3);
    expect(grown.objects[1].width).toBeCloseTo(100 * scale, 3);
    // The layout is scaled, not distorted: the gap scaled by the same factor.
    expect(grown.objects[1].x - (grown.objects[0].x + grown.objects[0].width)).toBeCloseTo(
      100 * scale,
      3,
    );
    // The axis that was not dragged is untouched.
    expect(grown.objects[0].height).toBeCloseTo(200, 6);
  });

  it('returns the requested scale when nothing is at a limit', () => {
    const scale = clampScale({ x: 2, y: 3 }, [{ x: 0, y: 0, width: 100, height: 100 }], [50], MAX_OBJECT_SIZE_WORLD);
    expect(scale).toEqual({ x: 2, y: 3 });
  });

  it('survives a non-finite request without writing nonsense', () => {
    const scale = clampScale(
      { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      [{ x: 0, y: 0, width: 100, height: 100 }],
      [50],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(Number.isFinite(scale.x) && Number.isFinite(scale.y)).toBe(true);
    expect(scale.x).toBeGreaterThanOrEqual(0.5);
    expect(scale.y).toBeLessThanOrEqual(200);
  });
});

describe('geometry — scaleWithin', () => {
  it('TC-04: doubling the box doubles every note and every gap', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const box = unionRects([a, b])!;
    expect(box.width).toBe(500);

    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    const scaled = [a, b].map((r) => scaleWithin(r, box, to));

    expect(scaled[0].width).toBeCloseTo(400, 6);
    expect(scaled[1].width).toBeCloseTo(400, 6);
    expect(scaled[1].x - (scaled[0].x + scaled[0].width)).toBeCloseTo(200, 6);
    // Sticky notes stay square because the box kept its square objects' height.
    expect(scaled[0].height).toBeCloseTo(200, 6);
  });

  it('maps a child to the target box when it fills the source box', () => {
    const box: Rect = { x: 10, y: 10, width: 100, height: 50 };
    expect(scaleWithin(box, box, { x: 0, y: 0, width: 200, height: 100 })).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it('is a no-op when the boxes are equal', () => {
    const r: Rect = { x: 3, y: 4, width: 5, height: 6 };
    expect(scaleWithin(r, r, r)).toEqual(r);
  });
});
