import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  HANDLE_LABEL,
  type Handle,
  type Rect,
} from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

describe('geometry (TC-01 to TC-04)', () => {
  it('TC-01: resizeRect on a corner handle with the aspect lock uses the dominant scale', () => {
    // 200×200 dragged by (+100, +40) on "se": dominant scale = 300/200 = 1.5
    const out = resizeRect({ x: 0, y: 0, width: 200, height: 200 }, 'se', { x: 100, y: 40 }, true);
    expect(out).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('TC-02: shrinking past the minimum clamps to STICKY_MIN_SIZE_WORLD (−1 and exact)', () => {
    const from: Rect = { x: 0, y: 0, width: 100, height: 100 };
    // Drag "nw" inward so the raw size would be 49×49 and exactly 50×50.
    for (const delta of [{ x: 51, y: 51 }, { x: 50, y: 50 }]) {
      const proposed = resizeRect(from, 'nw', delta, false);
      const sx = proposed.width / from.width;
      const sy = proposed.height / from.height;
      const clamped = clampScale({ x: sx, y: sy }, [from], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
      expect(from.width * clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
      expect(from.height * clamped.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    }
  });

  it('TC-03: clampScale stops the whole selection when one object would exceed the max', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 10000, height: 10000 }, // the binding object
      { x: 0, y: 0, width: 5000, height: 5000 },
    ];
    // Asking for ×3 would push the first object to 30 000 > MAX_OBJECT_SIZE_WORLD.
    const out = clampScale({ x: 3, y: 3 }, rects, [10, 10], MAX_OBJECT_SIZE_WORLD);
    // uniform stop at 20 000 / 10 000 = 2 on both axes
    expect(out).toEqual({ x: 2, y: 2 });
    // relative layout is preserved because both axes use the same scale
    expect(rects[1]!.width * out.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
  });

  it('TC-03: clampScale clamps each axis independently to the per-type minimum', () => {
    const out = clampScale(
      { x: 0.05, y: 0.5 },
      [{ x: 0, y: 0, width: 200, height: 100 }],
      [20, 20],
      MAX_OBJECT_SIZE_WORLD,
    );
    // lowX = 20/200 = 0.1 (0.05 clamped up), lowY = 20/100 = 0.2 (0.5 kept)
    expect(out).toEqual({ x: 0.1, y: 0.5 });
  });

  it('TC-04: scaleWithin ×2 width keeps the gap proportional', () => {
    // two 200-unit notes 100 apart inside a 500-wide box, scaled ×2 → 400 apart
    const from: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 400, height: 200 };
    const a = scaleWithin({ x: 0, y: 0, width: 200, height: 200 }, from, to);
    const b = scaleWithin({ x: 300, y: 0, width: 200, height: 200 }, from, to);
    expect(a.width).toBe(400);
    expect(b.x - (a.x + a.width)).toBeCloseTo(200, 6); // the 100-unit gap doubled
  });
});

describe('geometry primitives (support)', () => {
  it('rectContains is inclusive of edges and excludes clipped rects', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(rectContains(outer, { x: 90, y: 0, width: 20, height: 20 })).toBe(false);
    expect(rectContains(outer, { x: -1, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects is the smallest enclosing box, null when empty', () => {
    expect(
      unionRects([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 30, width: 40, height: 50 },
      ]),
    ).toEqual({ x: 0, y: 0, width: 60, height: 80 });
    expect(unionRects([])).toBeNull();
  });

  it('normalizeRect accepts opposite corners in any order', () => {
    expect(normalizeRect({ x: 30, y: 40 }, { x: 10, y: 5 })).toEqual({ x: 10, y: 5, width: 20, height: 35 });
  });

  it('resizeRect keeps the opposite edge anchored for edge handles', () => {
    expect(resizeRect({ x: 10, y: 10, width: 100, height: 100 }, 'w', { x: 20, y: 0 }, false)).toEqual({
      x: 30,
      y: 10,
      width: 80,
      height: 100,
    });
  });

  it('scaleWithin never returns NaN for a degenerate from-box', () => {
    const out = scaleWithin(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 5, y: 5, width: 50, height: 50 },
    );
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.width)).toBe(true);
  });

  it('HANDLE_LABEL covers all eight handles', () => {
    const handles: Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    for (const h of handles) expect(typeof HANDLE_LABEL[h]).toBe('string');
    expect(HANDLE_LABEL.se).toBe('bottom-right');
  });
});
