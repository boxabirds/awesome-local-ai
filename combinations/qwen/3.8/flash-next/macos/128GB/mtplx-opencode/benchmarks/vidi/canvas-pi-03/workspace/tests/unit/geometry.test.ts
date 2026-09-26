import { describe, it, expect } from 'vitest';
import {
  isFiniteRect,
  unionRect,
  unionAll,
  rectContainsPoint,
  rectsIntersect,
  normalizeRect,
  resizeRectFromHandle,
  aspectResize,
  clampScale,
  scaleWithin,
  type Rect,
} from '../../src/shared/geometry';

describe('geometry', () => {
  it('unionRect merges corners and keeps the valid one when the other is null', () => {
    const a: Rect = { x: 0, y: 0, width: 10, height: 10 };
    const b: Rect = { x: 5, y: 5, width: 10, height: 10 };
    expect(unionRect(a, b)).toEqual({ x: 0, y: 0, width: 15, height: 15 });
    expect(unionRect(a, null)).toEqual(a);
    expect(unionRect(null, b)).toEqual(b);
    expect(unionRect(null, null)).toBeNull();
  });

  it('isFiniteRect rejects zero, negative and non-finite sizes', () => {
    expect(isFiniteRect({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isFiniteRect({ x: 0, y: 0, width: 0, height: 5 })).toBe(false);
    expect(isFiniteRect({ x: 0, y: 0, width: -1, height: 5 })).toBe(false);
    expect(isFiniteRect({ x: NaN, y: 0, width: 5, height: 5 })).toBe(false);
  });

  it('a malformed selection contains nothing', () => {
    expect(rectContainsPoint(null, { x: 0, y: 0 })).toBe(false);
    expect(rectContainsPoint({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0 })).toBe(false);
    expect(rectContainsPoint({ x: 0, y: 0, width: NaN, height: NaN }, { x: 1, y: 1 })).toBe(false);
    expect(rectContainsPoint({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5 })).toBe(true);
  });

  it('unionAll of many rects', () => {
    expect(unionAll([])).toBeNull();
    const u = unionAll([
      { x: 0, y: 0, width: 4, height: 4 },
      { x: 2, y: 6, width: 4, height: 4 },
    ]);
    expect(u).toEqual({ x: 0, y: 0, width: 6, height: 10 });
  });

  it('rectsIntersect / point-inside', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectContainsPoint({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 5 })).toBe(false);
  });

  it('normalizeRect from any drag direction', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('resizeRectFromHandle pins the opposite edge and stays positive', () => {
    const base: Rect = { x: 0, y: 0, width: 100, height: 100 };
    // Dragging 'se' outward grows width/height.
    expect(resizeRectFromHandle(base, 'se', { x: 150, y: 150 })).toEqual({ x: 0, y: 0, width: 150, height: 150 });
    // Dragging 'nw' past the opposite corner clamps to zero, never negative.
    const flipped = resizeRectFromHandle(base, 'nw', { x: 200, y: 200 });
    expect(flipped.width).toBeGreaterThanOrEqual(0);
    expect(flipped.height).toBeGreaterThanOrEqual(0);
    // Pure edge handle: 'e' changes width only.
    expect(resizeRectFromHandle(base, 'e', { x: 120, y: 999 })).toEqual({ x: 0, y: 0, width: 120, height: 100 });
  });

  it('aspectResize keeps the aspect ratio', () => {
    const base: Rect = { x: 10, y: 10, width: 100, height: 50 };
    const out = aspectResize(base, 'se', { x: 200, y: 60 });
    expect(out.width / out.height).toBeCloseTo(base.width / base.height, 5);
  });

  it('aspectResize with a null corner degrades to a free resize (negative)', () => {
    const base: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const out = aspectResize(base, null, { x: 120, y: 40 });
    expect(out.width).toBe(120);
    expect(out.height).toBe(40);
  });

  it('unionAll tolerates NaN rects, matching the malformed-selection rule', () => {
    const bad: Rect = { x: 0, y: 0, width: NaN, height: NaN };
    const good: Rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(unionAll([bad, good])).toEqual(good);
  });
});
describe('size limits (sel.size_limits)', () => {
  it('TC-03: growth stops at the FIRST object to reach the maximum, uniformly', () => {
    // A would hit the 1000-unit ceiling at scale 2, B only at scale 5, so the
    // whole selection must stop at 2 — one factor for everybody.
    const limits = [
      { rect: { x: 0, y: 0, width: 500, height: 500 }, minSize: 50, maxSize: 1000 },
      { rect: { x: 700, y: 0, width: 200, height: 200 }, minSize: 50, maxSize: 1000 },
    ];
    const scale = clampScale(3, limits);
    expect(scale).toBeCloseTo(2);
    expect(500 * scale).toBeCloseTo(1000);
    expect(200 * scale).toBeCloseTo(400);
  });

  it('TC-02: shrinking below the minimum stops at the minimum, for the whole group', () => {
    const limits = [{ rect: { x: 0, y: 0, width: 200, height: 200 }, minSize: 50, maxSize: 20000 }];
    // Just inside the limit and exactly at it both land on 50x50.
    expect(200 * clampScale(0.24, limits)).toBeCloseTo(50);
    expect(200 * clampScale(0.25, limits)).toBeCloseTo(50);
    // A scale that needs no clamping passes through untouched.
    expect(clampScale(0.5, limits)).toBeCloseTo(0.5);
    expect(clampScale(1, limits)).toBeCloseTo(1);
  });

  it('a non-finite or non-positive scale leaves the group untouched', () => {
    const limits = [{ rect: { x: 0, y: 0, width: 200, height: 200 }, minSize: 50, maxSize: 20000 }];
    expect(clampScale(Number.NaN, limits)).toBe(1);
    expect(clampScale(Infinity, limits)).toBe(1);
    expect(clampScale(-2, limits)).toBe(1);
    expect(clampScale(2, [])).toBe(2);
  });

  it('an object already over the maximum is not grown further', () => {
    const limits = [{ rect: { x: 0, y: 0, width: 500, height: 400 }, minSize: 50, maxSize: 500 }];
    expect(clampScale(1.5, limits)).toBeCloseTo(1);
  });

  it('TC-04: scaling the box maps each object offset and size (gap 100 -> 200)', () => {
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 400 };
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const na = scaleWithin(a, from, to);
    const nb = scaleWithin(b, from, to);
    // Each 200-unit note doubles to 400 and the 100-unit gap doubles to 200.
    expect(na.width).toBeCloseTo(400);
    expect(nb.width).toBeCloseTo(400);
    expect(nb.x - (na.x + na.width)).toBeCloseTo(200);
  });

  it('scaleWithin keeps a pinned corner pinned', () => {
    const from: Rect = { x: 100, y: 100, width: 200, height: 200 };
    // Shrinking from the top-left pins the bottom-right corner at 300,300.
    const to: Rect = { x: 200, y: 200, width: 100, height: 100 };
    const out = scaleWithin({ x: 100, y: 100, width: 200, height: 200 }, from, to);
    expect(out.x + out.width).toBeCloseTo(300);
    expect(out.y + out.height).toBeCloseTo(300);
  });
});
