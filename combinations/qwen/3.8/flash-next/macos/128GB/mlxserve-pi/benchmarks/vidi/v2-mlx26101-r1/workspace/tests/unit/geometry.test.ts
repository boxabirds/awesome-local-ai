import { describe, expect, it } from 'vitest';
import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

const r = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

describe('geometry.rect', () => {
  it('rectContains is true only when the inner rect is entirely inside', () => {
    const box = r(0, 0, 100, 100);
    expect(rectContains(box, r(10, 10, 20, 20))).toBe(true);
    // Touching the edge from inside counts as inside.
    expect(rectContains(box, r(0, 0, 100, 100))).toBe(true);
    // Partly inside: the right edge crosses outside.
    expect(rectContains(box, r(90, 10, 20, 20))).toBe(false);
    // Merely touching the edge from outside is not inside.
    expect(rectContains(box, r(100, 10, 20, 20))).toBe(false);
  });

  it('unionRects is null for no rects and encloses every finite rect', () => {
    expect(unionRects([])).toBeNull();
    const u = unionRects([r(0, 0, 10, 10), r(30, 40, 20, 5)]);
    expect(u).toEqual(r(0, 0, 50, 45));
  });

  it('normalizeRect turns two opposite corners into a positive rect', () => {
    expect(normalizeRect({ x: 10, y: 30 }, { x: 40, y: 5 })).toEqual(
      r(10, 5, 30, 25),
    );
  });
});

describe('geometry.resizeRect', () => {
  // TC-01: corner handle with the aspect ratio locked, 200×200 + (100,40).
  it('TC-01 keeps the ratio on a corner drag, driven by the dominant axis', () => {
    const start = r(0, 0, 200, 200);
    const out = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(out.width).toBeCloseTo(300, 6);
    expect(out.height).toBeCloseTo(300, 6);
    // The opposite corner (top-left) never moves.
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('an edge handle without an aspect lock changes one axis only', () => {
    const start = r(0, 0, 200, 200);
    const out = resizeRect(start, 'e', { x: 100, y: 0 }, false);
    expect(out).toEqual(r(0, 0, 300, 200));
  });

  it('a west handle drags the left edge and pins the right one', () => {
    const start = r(100, 0, 200, 200);
    const out = resizeRect(start, 'w', { x: 30, y: 0 }, false);
    expect(out.x).toBeCloseTo(130, 6);
    expect(out.width).toBeCloseTo(170, 6);
    expect(out.x + out.width).toBeCloseTo(300, 6);
  });
});

describe('geometry.clampScale', () => {
  // TC-02: shrinking a sticky below its minimum, boundary at −1 and exact.
  it('TC-02 stops a shrink at STICKY_MIN_SIZE_WORLD (50×50)', () => {
    const box = r(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD);
    const rects = [box];
    const mins = [STICKY_MIN_SIZE_WORLD];

    // −1: trying to reach a 49-unit side is clamped back to exactly 50.
    const below = 49 / STICKY_SIZE_WORLD;
    const clampedBelow = clampScale(
      { x: below, y: below },
      rects,
      mins,
      MAX_OBJECT_SIZE_WORLD,
    );
    const afterBelow = scaleWithin(box, box, {
      x: 0,
      y: 0,
      width: box.width * clampedBelow.x,
      height: box.height * clampedBelow.y,
    });
    expect(afterBelow.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(afterBelow.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);

    // exact: asking for exactly 50 is allowed through untouched.
    const exact = STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD;
    const clampedExact = clampScale(
      { x: exact, y: exact },
      rects,
      mins,
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(clampedExact.x).toBeCloseTo(exact, 6);
    expect(clampedExact.y).toBeCloseTo(exact, 6);
  });

  // TC-03: a mixed selection stops the *whole* selection at MAX when the first
  // object reaches it, keeping the relative layout.
  it('TC-03 clamps the whole selection when the first object would exceed the maximum', () => {
    const wide = r(0, 0, 1000, 100);
    const narrow = r(2000, 0, 500, 100);
    const rects = [wide, narrow];
    const mins = [10, 10];
    // Ask to triple the width: the 1000-wide object would hit 30000 > 20000.
    const out = clampScale(
      { x: 30, y: 1 },
      rects,
      mins,
      MAX_OBJECT_SIZE_WORLD,
    );
    // The widest object is stopped exactly at the maximum, the other scaled by
    // the same factor, so their gap and relative sizes are preserved.
    expect(out.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 1000, 6);
    expect(wide.width * out.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
    expect(narrow.width * out.x).toBeCloseTo(500 * 20, 6);
  });
});

describe('geometry.scaleWithin', () => {
  // TC-04: two 200-unit notes 100 apart, the box doubled in width.
  it('TC-04 doubles each note and the gap between them', () => {
    const box = r(0, 0, 500, 200); // A 0..200, gap 200..300, B 300..500
    const a = r(0, 0, 200, 200);
    const b = r(300, 0, 200, 200);
    const to = r(0, 0, 1000, 400); // ×2 in both axes (aspect-locked sticky resize)
    const na = scaleWithin(a, box, to);
    const nb = scaleWithin(b, box, to);
    expect(na.width).toBeCloseTo(400, 6);
    expect(na.height).toBeCloseTo(400, 6);
    expect(nb.width).toBeCloseTo(400, 6);
    expect(nb.x).toBeCloseTo(600, 6);
    // The gap between the two notes doubled from 100 to 200.
    expect(nb.x - (na.x + na.width)).toBeCloseTo(200, 6);
  });
});
