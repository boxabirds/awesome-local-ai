/**
 * sel.geometry_ops unit tests (TC-01 to TC-04, and the pure half of TC-02).
 *
 * These exercise the rectangle maths in `geometry.ts` directly - the maths the
 * transform gesture and the marquee are built on - plus the two resize boundary
 * values the design calls out (STICKY_MIN_SIZE_WORLD and MAX_OBJECT_SIZE_WORLD).
 */

import { describe, expect, it } from 'vitest';

import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry.js';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config.js';

/** A rectangle with an explicit size, for readability in the assertions. */
const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

const close = (value: number, expected: number): void => {
  expect(value).toBeCloseTo(expected, 6);
};

describe('rectContains (the marquee containment rule)', () => {
  it('selects only a rectangle that lies fully inside', () => {
    const marquee = rect(0, 0, 100, 100);
    // TC-07's shape, checked on the primitive: fully / partly / outside.
    expect(rectContains(marquee, rect(10, 10, 20, 20))).toBe(true); // fully inside
    expect(rectContains(marquee, rect(90, 90, 20, 20))).toBe(false); // pokes past the edge
    expect(rectContains(marquee, rect(200, 200, 20, 20))).toBe(false); // outside
  });

  it('counts a rectangle that exactly touches the border as inside', () => {
    expect(rectContains(rect(0, 0, 100, 100), rect(0, 0, 100, 100))).toBe(true);
  });
});

describe('unionRects', () => {
  it('is null for no rectangles', () => {
    expect(unionRects([])).toBeNull();
  });

  it('is the smallest box around them all', () => {
    // The two rectangles reach to x=400 and y=340; the box must span both.
    const box = unionRects([rect(0, 0, 200, 200), rect(300, 40, 100, 300)]);
    expect(box).toEqual(rect(0, 0, 400, 340));
  });
});

describe('normalizeRect', () => {
  it('turns two opposite corners into a positive rectangle in any drag order', () => {
    expect(normalizeRect({ x: 10, y: 40 }, { x: 60, y: 90 })).toEqual(rect(10, 40, 50, 50));
    // Dragged up and to the left: the same box.
    expect(normalizeRect({ x: 60, y: 90 }, { x: 10, y: 40 })).toEqual(rect(10, 40, 50, 50));
  });
});

describe('resizeRect (TC-01)', () => {
  it('keeps the ratio from the opposite anchor on a locked corner (TC-01)', () => {
    // 200×200, se handle, +100 right and +40 down, aspect locked → the larger
    // axis (width) drives both, so 300×300 and the top-left stays put.
    const start = rect(0, 0, 200, 200);
    expect(resizeRect(start, 'se', { x: 100, y: 40 }, true)).toEqual(rect(0, 0, 300, 300));
  });

  it('changes only one axis on an unlocked edge handle (TC-24’s rule)', () => {
    const start = rect(10, 10, 200, 200);
    // `e` moves the right edge only: the left edge (the anchor) stays at x=10.
    expect(resizeRect(start, 'e', { x: 60, y: 999 }, false)).toEqual(rect(10, 10, 260, 200));
  });

  it('grows leftwards from the right anchor when the west handle is dragged', () => {
    const start = rect(100, 0, 200, 200);
    // Dragging the west edge left by 50 grows the box left; the right edge (300) holds.
    const out = resizeRect(start, 'w', { x: -50, y: 0 }, false);
    expect(out).toEqual(rect(50, 0, 250, 200));
  });
});

describe('clampScale (TC-02, TC-03)', () => {
  it('will not let a note shrink below STICKY_MIN_SIZE_WORLD (TC-02, boundary)', () => {
    const single = [rect(0, 0, 200, 200)];
    const mins = [STICKY_MIN_SIZE_WORLD];

    // Shrink to one unit below the minimum: the clamp stops at exactly the minimum.
    const below = clampScale({ x: (STICKY_MIN_SIZE_WORLD - 1) / 200, y: (STICKY_MIN_SIZE_WORLD - 1) / 200 }, single, mins, MAX_OBJECT_SIZE_WORLD);
    close(200 * below.x, STICKY_MIN_SIZE_WORLD);
    close(200 * below.y, STICKY_MIN_SIZE_WORLD);

    // Exactly the minimum is allowed and left untouched.
    const exact = clampScale({ x: STICKY_MIN_SIZE_WORLD / 200, y: STICKY_MIN_SIZE_WORLD / 200 }, single, mins, MAX_OBJECT_SIZE_WORLD);
    close(200 * exact.x, STICKY_MIN_SIZE_WORLD);
    close(200 * exact.y, STICKY_MIN_SIZE_WORLD);
  });

  it('stops the whole group the moment the first object reaches the maximum (TC-03)', () => {
    // Two objects of different widths share one scale; the wider one hits the
    // ceiling first, so it caps the scale for both (Key decision 2).
    const rects = [rect(0, 0, 100, 100), rect(150, 0, 150, 150)];
    const mins = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // Ask for a scale that would blow the wide object way past the ceiling.
    const scale = clampScale({ x: 500, y: 500 }, rects, mins, MAX_OBJECT_SIZE_WORLD);
    // The wider object ends at exactly the ceiling...
    close(150 * scale.x, MAX_OBJECT_SIZE_WORLD);
    // ...and the narrower one stops with it, well short of the ceiling.
    expect(100 * scale.x).toBeLessThan(MAX_OBJECT_SIZE_WORLD);
  });

  it('preserves the relative layout when the group grows (TC-03)', () => {
    // Two notes 100 apart; grow the box, clamp it, and lay each object out with
    // scaleWithin - the gap must grow by the very same scale as the objects.
    const noteA = rect(0, 0, 200, 200);
    const noteB = rect(300, 0, 200, 200); // left at 300 → a 100-unit gap after A
    const from = unionRects([noteA, noteB])!; // 0..500
    const scale = clampScale({ x: 2, y: 2 }, [noteA, noteB], [50, 50], MAX_OBJECT_SIZE_WORLD);
    const to = { x: from.x, y: from.y, width: from.width * scale.x, height: from.height * scale.y };
    const a = scaleWithin(noteA, from, to);
    const b = scaleWithin(noteB, from, to);
    close(a.width, 400);
    close(b.width, 400);
    close(b.x - (a.x + a.width), 200); // the gap scaled from 100 to 200
  });

  it('treats a non-finite requested scale as the smallest allowed one', () => {
    const rects = [rect(0, 0, 200, 200)];
    const scale = clampScale({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, rects, [50], MAX_OBJECT_SIZE_WORLD);
    // A non-finite request is never honoured literally. Any non-finite scale is
    // the unsafe case (it could size an object to the maximum or NaN), so it
    // collapses to the shrink floor - the smallest the group is allowed to be.
    close(200 * scale.x, 50);
    close(200 * scale.y, 50);
  });
});

describe('scaleWithin (TC-04)', () => {
  it('scales two notes 100 apart when the box doubles in width (TC-04)', () => {
    const noteA = rect(0, 0, 200, 200);
    const noteB = rect(300, 0, 200, 200);
    const from = rect(0, 0, 500, 200);
    const to = rect(0, 0, 1000, 200);
    const a = scaleWithin(noteA, from, to);
    const b = scaleWithin(noteB, from, to);
    close(a.width, 400);
    close(b.width, 400);
    close(b.x - (a.x + a.width), 200);
  });
});
