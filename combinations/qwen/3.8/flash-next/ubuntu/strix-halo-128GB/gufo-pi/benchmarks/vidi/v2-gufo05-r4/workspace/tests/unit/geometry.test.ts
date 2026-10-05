/**
 * Story 7 unit tests for the rectangle maths (`sel.geometry_ops`): TC-01 to TC-04
 * plus the helpers the marquee, the bounding box and the resize gesture stand on.
 *
 * Everything here is pure world-unit arithmetic, so there is nothing to mock and
 * nothing to wait for; the boundary values in the design (a sticky note's minimum
 * size minus one and exactly, `MAX_OBJECT_SIZE_WORLD` plus one) are asserted at the
 * boundary rather than either side of a fudge factor.
 */

import { describe, expect, it } from 'vitest';
import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  anchorScaleRect,
  type Rect
} from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

const NOTE = 200;

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

describe('rectContains (sel.marquee)', () => {
  it('TC-07 support: an object entirely inside counts, one that overhangs does not', () => {
    const box = rect(0, 0, 1000, 1000);
    expect(rectContains(box, rect(10, 10, 100, 100))).toBe(true);
    // Half inside: not selected.
    expect(rectContains(box, rect(950, 10, 100, 100))).toBe(false);
    // Completely outside.
    expect(rectContains(box, rect(2000, 2000, 50, 50))).toBe(false);
    // Bigger than the box and straddling it.
    expect(rectContains(box, rect(-10, -10, 1020, 1020))).toBe(false);
  });

  it('an object that shares an edge with the box counts as inside', () => {
    const box = rect(0, 0, 1000, 1000);
    expect(rectContains(box, rect(0, 0, 100, 100))).toBe(true);
    expect(rectContains(box, rect(900, 900, 100, 100))).toBe(true);
    expect(rectContains(box, box)).toBe(true);
  });

  it('a rectangle with a non-finite number in it contains nothing', () => {
    expect(rectContains(rect(0, 0, 1000, 1000), rect(Number.NaN, 0, 10, 10))).toBe(false);
    expect(rectContains(rect(0, 0, Number.POSITIVE_INFINITY, 1000), rect(0, 0, 10, 10))).toBe(false);
  });
});

describe('unionRects and normalizeRect', () => {
  it('TC-13 support: the union of a selection covers every object in it', () => {
    const union = unionRects([rect(100, 100, 200, 200), rect(600, 400, 200, 200)]);
    expect(union).toEqual(rect(100, 100, 700, 500));
  });

  it('an empty selection has no bounding box', () => {
    expect(unionRects([])).toBeNull();
  });

  it('rects that are not numbers are left out', () => {
    const good = rect(0, 0, 10, 10);
    expect(unionRects([good, rect(Number.NaN, 0, 10, 10)])).toEqual(good);
    expect(unionRects([rect(Number.NaN, 0, 10, 10)])).toBeNull();
  });

  it('normalizeRect turns two dragged corners into a positive rectangle', () => {
    expect(normalizeRect({ x: 10, y: 40 }, { x: 60, y: 90 })).toEqual(rect(10, 40, 50, 50));
    expect(normalizeRect({ x: 60, y: 90 }, { x: 10, y: 40 })).toEqual(rect(10, 40, 50, 50));
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual(rect(5, 5, 0, 0));
  });
});

describe('resizeRect (sel.resize, sel.aspect)', () => {
  it('TC-01: a corner handle with the aspect locked keeps the box square', () => {
    expect(resizeRect(rect(0, 0, NOTE, NOTE), 'se', { x: 100, y: 40 }, true)).toEqual(
      rect(0, 0, 300, 300)
    );
  });

  it('a corner handle without the aspect lock moves one corner and nothing else', () => {
    expect(resizeRect(rect(0, 0, NOTE, NOTE), 'se', { x: 100, y: 40 }, false)).toEqual(
      rect(0, 0, 300, 240)
    );
    // The opposite corner is the anchor: dragging north-west moves the top-left,
    // the bottom-right stays put.
    expect(resizeRect(rect(0, 0, NOTE, NOTE), 'nw', { x: -50, y: -50 }, false)).toEqual(
      rect(-50, -50, 250, 250)
    );
  });

  it('an edge handle changes one axis only', () => {
    const start = rect(0, 0, NOTE, NOTE);
    expect(resizeRect(start, 'e', { x: 100, y: 77 }, false)).toEqual(rect(0, 0, 300, 200));
    expect(resizeRect(start, 'w', { x: -100, y: 77 }, false)).toEqual(rect(-100, 0, 300, 200));
    expect(resizeRect(start, 'n', { x: 999, y: -20 }, false)).toEqual(rect(0, -20, 200, 220));
    expect(resizeRect(start, 's', { x: 999, y: 20 }, false)).toEqual(rect(0, 0, 200, 220));
  });

  it('an edge handle with the aspect locked scales both axes from the same anchor', () => {
    const start = rect(0, 0, NOTE, NOTE);
    // Width 300, so a square becomes 300x300 with the left edge still where it was
    // and the growth shared above and below.
    expect(resizeRect(start, 'e', { x: 100, y: 77 }, true)).toEqual(rect(0, -50, 300, 300));
    expect(resizeRect(start, 'w', { x: -100, y: 77 }, true)).toEqual(rect(-100, -50, 300, 300));
  });

  it('a delta that is not a number changes nothing', () => {
    const start = rect(10, 20, NOTE, NOTE);
    expect(resizeRect(start, 'se', { x: Number.NaN, y: 10 }, false)).toEqual(start);
    expect(resizeRect(start, 'se', { x: 10, y: Number.POSITIVE_INFINITY }, false)).toEqual(start);
  });
});

describe('anchorScaleRect', () => {
  it('scales a box from the anchor implied by the handle', () => {
    const start = rect(0, 0, NOTE, NOTE);
    expect(anchorScaleRect(start, 'se', { x: 2, y: 1 })).toEqual(rect(0, 0, 400, 200));
    expect(anchorScaleRect(start, 'nw', { x: 2, y: 2 })).toEqual(rect(-200, -200, 400, 400));
    expect(anchorScaleRect(start, 'e', { x: 2, y: 2 })).toEqual(rect(0, -100, 400, 400));
    // A handle that does not drive an axis still scales it (aspect lock), centred.
    expect(anchorScaleRect(start, 'n', { x: 2, y: 2 })).toEqual(rect(-100, -200, 400, 400));
    expect(anchorScaleRect(start, 'e', { x: 1, y: 1 })).toEqual(start);
  });
});

describe('clampScale (sel.size_limits)', () => {
  it('TC-02: shrinking a sticky note stops at STICKY_MIN_SIZE_WORLD', () => {
    const note = [rect(0, 0, NOTE, NOTE)];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    // "Shrink it to one unit below the minimum" and "shrink it to exactly the
    // minimum", as scales of the 200-unit note.
    const justTooSmall = (STICKY_MIN_SIZE_WORLD - 1) / NOTE;
    const exact = STICKY_MIN_SIZE_WORLD / NOTE;

    expect(clampScale({ x: justTooSmall, y: justTooSmall }, note, minSizes, MAX_OBJECT_SIZE_WORLD)).toEqual(
      { x: 0.25, y: 0.25 }
    );
    // Exactly the minimum is allowed, and it is still 50x50.
    expect(clampScale({ x: exact, y: exact }, note, minSizes, MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: exact,
      y: exact
    });
    expect(scaleWithin(note[0] as Rect, note[0] as Rect, rect(0, 0, 50, 50))).toEqual(rect(0, 0, 50, 50));
  });

  it('TC-03: a mixed selection stops as one, where its first object reaches the maximum', () => {
    // A big note and a small one, moved by the same hand.
    const rects = [rect(0, 0, 5000, 5000), rect(6000, 0, 100, 100)];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // Big enough that the 5000-unit note would pass MAX_OBJECT_SIZE_WORLD by itself,
    // while the small one is nowhere near either limit.
    const wanted = (MAX_OBJECT_SIZE_WORLD + 1) / 5000;

    const clamped = clampScale({ x: wanted, y: wanted }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // One scale for the whole selection, and the biggest object lands exactly on the
    // maximum rather than past it.
    expect(clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 5000, 10);
    expect(clamped.y).toBe(clamped.x);

    // The relative layout is preserved: both notes move and grow by the same factor,
    // so the gap between them doubles with everything else.
    const from = unionRects(rects) as Rect;
    const to = anchorScaleRect(from, 'se', clamped);
    const moved = rects.map((r) => scaleWithin(r, from, to));
    expect(moved[0]?.width).toBeCloseTo(5000 * clamped.x, 6);
    expect(moved[1]?.width).toBeCloseTo(100 * clamped.x, 6);
    const gapBefore = rects[1]!.x - (rects[0]!.x + rects[0]!.width);
    const gapAfter = (moved[1]?.x ?? 0) - ((moved[0]?.x ?? 0) + (moved[0]?.width ?? 0));
    expect(gapAfter).toBeCloseTo(gapBefore * clamped.x, 6);
  });

  it('shrinking stops where the smallest object reaches its own minimum', () => {
    // The 100-unit note reaches 50 first, so the 1000-unit note stops at 500.
    const rects = [rect(0, 0, 1000, 1000), rect(2000, 0, 100, 100)];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    const clamped = clampScale({ x: 0.1, y: 0.1 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(0.5, 10);
    expect(clamped.y).toBeCloseTo(0.5, 10);
  });

  it('an axis may grow while the other is held back, and no-change is always allowed', () => {
    const rects = [rect(0, 0, 200, NOTE)];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    // Width can double; height is already at a size where doubling is fine too.
    expect(clampScale({ x: 2, y: 1 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 2, y: 1 });
    // A height that would pass the maximum is refused while the width is not.
    const tooTall = (MAX_OBJECT_SIZE_WORLD + 1) / NOTE;
    const clamped = clampScale({ x: 1.5, y: tooTall }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBe(1.5);
    expect(clamped.y).toBe(MAX_OBJECT_SIZE_WORLD / NOTE);
    // A scale of 1 with an object already past a limit changes nothing.
    const alreadyHuge = [rect(0, 0, MAX_OBJECT_SIZE_WORLD * 2, MAX_OBJECT_SIZE_WORLD * 2)];
    expect(clampScale({ x: 1, y: 1 }, alreadyHuge, minSizes, MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1,
      y: 1
    });
  });

  it('a scale that is not a number leaves the selection alone', () => {
    const rects = [rect(0, 0, NOTE, NOTE)];
    expect(clampScale({ x: Number.NaN, y: 2 }, rects, [50], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1,
      y: 1
    });
    expect(clampScale({ x: 1, y: 1 }, [], [], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
  });
});

describe('scaleWithin (sel.resize)', () => {
  it('TC-04: doubling the width of a box doubles every note and every gap', () => {
    // Two 200-unit notes with a 100-unit gap between them.
    const a = rect(0, 0, NOTE, NOTE);
    const b = rect(300, 0, NOTE, NOTE);
    const from = unionRects([a, b]) as Rect;
    expect(from).toEqual(rect(0, 0, 500, 200));

    // Drag the east handle until the box is twice as wide (height untouched).
    const to = anchorScaleRect(from, 'e', { x: 2, y: 1 });
    const scaledA = scaleWithin(a, from, to);
    const scaledB = scaleWithin(b, from, to);

    expect(scaledA.width).toBe(400);
    expect(scaledB.width).toBe(400);
    expect(scaledB.x - (scaledA.x + scaledA.width)).toBe(200);
    expect(scaledA.height).toBe(200);
    expect(scaledB.height).toBe(200);
  });

  it('a box with no size cannot be scaled into', () => {
    const child = rect(0, 0, NOTE, NOTE);
    expect(scaleWithin(child, rect(5, 5, 0, 10), rect(0, 0, 100, 100))).toEqual(child);
    expect(scaleWithin(child, child, rect(0, 0, Number.NaN, 100))).toEqual(child);
  });

  it('the identity box leaves an object where it was', () => {
    const child = rect(10, 20, 30, 40);
    const from = rect(0, 0, 100, 100);
    expect(scaleWithin(child, from, from)).toEqual(child);
  });
});
