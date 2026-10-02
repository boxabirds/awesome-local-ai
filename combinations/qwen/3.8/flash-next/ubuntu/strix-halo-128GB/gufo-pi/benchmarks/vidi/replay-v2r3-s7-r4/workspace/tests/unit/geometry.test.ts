import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  type Rect,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('geometry — rectContains / unionRects / normalizeRect', () => {
  it('rectContains is true only when every edge of the inner rect lies inside', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    // Touching from inside counts as fully inside.
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    // Half outside is not contained.
    expect(rectContains(outer, { x: 90, y: 10, width: 20, height: 20 })).toBe(false);
    // Touching the edge from outside is not contained.
    expect(rectContains(outer, { x: 100, y: 10, width: 20, height: 20 })).toBe(false);
  });

  it('unionRects bounds every rect and returns null for an empty list', () => {
    expect(unionRects([])).toBeNull();
    const u = unionRects([
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 300, y: 50, width: 100, height: 40 },
    ]);
    expect(u).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });

  it('normalizeRect yields a positive rect between two corners', () => {
    expect(normalizeRect({ x: 10, y: 40 }, { x: -30, y: 0 })).toEqual({
      x: -30,
      y: 0,
      width: 40,
      height: 40,
    });
  });
});

describe('geometry — resizeRect', () => {
  it('TC-01 corner (se) with aspect locked keeps the ratio (200×200 + (100,40) → 300×300)', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const r = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(r.width).toBeCloseTo(300, 6);
    expect(r.height).toBeCloseTo(300, 6);
    // Anchor is the opposite (top-left) corner.
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeCloseTo(0, 6);
  });

  it('an edge handle changes one axis only (e → width only)', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const r = resizeRect(start, 'e', { x: 100, y: 40 }, false);
    expect(r.width).toBeCloseTo(300, 6);
    expect(r.height).toBeCloseTo(200, 6);
  });

  it('a west handle keeps the right edge fixed', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const r = resizeRect(start, 'w', { x: -50, y: 0 }, false);
    expect(r.width).toBeCloseTo(250, 6);
    expect(r.x).toBeCloseTo(-50, 6);
  });
});

describe('geometry — clampScale + scaleWithin', () => {
  it('TC-02 shrinking below STICKY_MIN_SIZE_WORLD stops at 50×50 (boundary)', () => {
    const note: Rect = { x: 0, y: 0, width: 200, height: 200 };
    // Drag the se corner to a target 1 unit under the minimum (49).
    const shrunk = resizeRect(note, 'se', { x: -151, y: -151 }, true);
    const scale = { x: shrunk.width / note.width, y: shrunk.height / note.height };
    const clamped = clampScale(scale, [note], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200, 6);
    expect(clamped.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200, 6);
    const to: Rect = { x: 0, y: 0, width: note.width * clamped.x, height: note.height * clamped.y };
    const result = scaleWithin(note, note, to);
    expect(result.width).toBeCloseTo(50, 6);
    expect(result.height).toBeCloseTo(50, 6);
  });

  it('TC-02 boundary: exactly the minimum is allowed (no clamp)', () => {
    const note: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const clamped = clampScale({ x: 0.25, y: 0.25 }, [note], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(0.25, 6);
    expect(clamped.y).toBeCloseTo(0.25, 6);
  });

  it('TC-03 stops uniformly when the first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 };
    // Grow the whole selection hugely; the 200-unit object must hit max first.
    const clamped = clampScale({ x: 100, y: 100 }, [a, b], [50, 50], MAX_OBJECT_SIZE_WORLD);
    // Uniform scale (layout preserved): both axes stop at 20_000 / 200.
    expect(clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 200, 6);
    expect(clamped.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 200, 6);
    expect(clamped.x).toBeCloseTo(clamped.y, 6);
    // Relative layout: b lands exactly at the max, a strictly under it.
    const from: Rect = { x: 0, y: 0, width: 400, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 400 * clamped.x, height: 200 * clamped.y };
    expect(scaleWithin(b, from, to).width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 3);
    expect(scaleWithin(a, from, to).width).toBeLessThan(MAX_OBJECT_SIZE_WORLD);
  });

  it('TC-04 two 200-unit notes 100 apart, box ×2 → each 400 wide, gap 200', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    const a2 = scaleWithin(a, from, to);
    const b2 = scaleWithin(b, from, to);
    expect(a2.width).toBeCloseTo(400, 6);
    expect(b2.width).toBeCloseTo(400, 6);
    expect(b2.x - (a2.x + a2.width)).toBeCloseTo(200, 6);
  });
});
