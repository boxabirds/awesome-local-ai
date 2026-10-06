/**
 * Unit tests for the pure geometry a selection is made of (design capability
 * `sel.geometry_ops`, cases TC-01 to TC-04).
 *
 * These are the maths behind *resize with handles*, *proportions kept when required*, *size
 * limits* and the *marquee's* containment rule, so they are asserted on numbers rather than on
 * pixels: what a browser can tell is whether the numbers were applied, which is the e2e suite.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleRect,
  scaleWithin,
  unionRects,
  type Point,
  type Rect,
} from '../../src/shared/geometry';

/** A sticky note as it is born: STICKY_SIZE_WORLD on a side. */
const NOTE: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

const point = (x: number, y: number): Point => ({ x, y });

/** The scale a `handle` drag of `delta` on `box` asks for. */
const askedScale = (box: Rect, handle: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw', delta: Point, aspect: boolean): Point => {
  const target = resizeRect(box, handle, delta, aspect);
  return { x: target.width / box.width, y: target.height / box.height };
};

/** The box a handle drag lands on once `scale` is the one the limits allow. */
const applyScale = (
  box: Rect,
  handle: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw',
  scale: Point,
  aspect: boolean,
): Rect =>
  resizeRect(
    box,
    handle,
    { x: box.width * (scale.x - 1), y: box.height * (scale.y - 1) },
    aspect,
  );

describe('rectContains: the marquee selects what is entirely inside', () => {
  const marquee = rect(100, 100, 400, 300);

  it('holds a rect whose four edges are inside', () => {
    expect(rectContains(marquee, rect(120, 120, 100, 100))).toBe(true);
  });

  it('holds a rect that exactly touches the frame from inside', () => {
    expect(rectContains(marquee, rect(100, 100, 400, 300))).toBe(true);
  });

  it('does not hold a rect that is half outside', () => {
    expect(rectContains(marquee, rect(450, 120, 100, 100))).toBe(false);
  });

  it('does not hold a rect that reaches one unit past one edge', () => {
    expect(rectContains(marquee, rect(100, 100, 401, 300))).toBe(false);
  });

  it('does not hold a rect that merely touches the frame from outside', () => {
    expect(rectContains(marquee, rect(500, 120, 100, 100))).toBe(false);
  });

  it('rejects a rect with no area, because nothing is inside a line', () => {
    expect(rectContains(marquee, rect(200, 200, 0, 10))).toBe(false);
    expect(rectContains(rect(0, 0, 0, 0), rect(0, 0, 1, 1))).toBe(false);
  });

  it('rejects a rect that is not a number at all', () => {
    expect(rectContains(marquee, rect(Number.NaN, 120, 10, 10))).toBe(false);
  });
});

describe('unionRects: the bounding box of a selection', () => {
  it('is null when there is nothing to bound', () => {
    expect(unionRects([])).toBeNull();
  });

  it('is the rect itself when there is one', () => {
    expect(unionRects([NOTE])).toEqual(NOTE);
  });

  it('wraps every rect handed to it', () => {
    const a = rect(0, 0, 200, 200);
    const b = rect(300, 400, 100, 50);
    expect(unionRects([a, b])).toEqual(rect(0, 0, 400, 450));
  });

  it('ignores a rect that is not a number rather than bounding the whole plane', () => {
    expect(unionRects([NOTE, rect(Number.NaN, 0, 10, 10)])).toEqual(NOTE);
  });
});

describe('normalizeRect: two pointer points to a rectangle', () => {
  it('puts the corner at the top-left however the points came', () => {
    expect(normalizeRect(point(300, 400), point(100, 200))).toEqual(rect(100, 200, 200, 200));
    expect(normalizeRect(point(100, 200), point(300, 400))).toEqual(rect(100, 200, 200, 200));
  });

  it('is an empty rectangle when the two points are the same', () => {
    expect(normalizeRect(point(5, 5), point(5, 5))).toEqual(rect(5, 5, 0, 0));
  });

  it('is an empty rectangle at the good point when the other is not a number', () => {
    expect(normalizeRect(point(0, 0), point(Number.NaN, 1))).toEqual(rect(0, 0, 0, 0));
  });
});

describe('TC-01 resizeRect: a corner handle, proportions kept', () => {
  it('grows 200×200 to 300×300 from the bottom-right with (100, 40)', () => {
    expect(resizeRect(NOTE, 'se', point(100, 40), true)).toEqual(rect(0, 0, 300, 300));
  });

  it('keeps the opposite corner welded to the board', () => {
    // Bottom-right corner is at (300, 300); dragging the top-left keeps it there.
    const start = rect(100, 100, 200, 200);
    expect(resizeRect(start, 'nw', point(-100, -40), true)).toEqual(rect(0, 0, 300, 300));
  });

  it('shrinks with the same anchor', () => {
    const start = rect(100, 100, 200, 200);
    // The pointer moved further in x (50 of 200 units) than in y (20 of 200), so x decides both
    // sides: 150×150, still welded to the bottom-right corner at (300, 300).
    expect(resizeRect(start, 'nw', point(50, 20), true)).toEqual(rect(150, 150, 150, 150));
  });

  it('is square for a square note however the pointer moves', () => {
    for (const delta of [point(1, 90), point(-90, 1), point(37, 0), point(0, -63)]) {
      const next = resizeRect(NOTE, 'se', delta, true);
      expect(next.width).toBeCloseTo(next.height, 9);
    }
  });
});

describe('resizeRect: an edge handle changes one direction', () => {
  const start = rect(0, 0, 200, 100);

  it('east changes the width only', () => {
    expect(resizeRect(start, 'e', point(50, 999), false)).toEqual(rect(0, 0, 250, 100));
  });

  it('west moves the left edge and keeps the right one', () => {
    const box = rect(100, 50, 200, 100);
    expect(resizeRect(box, 'w', point(30, 0), false)).toEqual(rect(130, 50, 170, 100));
  });

  it('north moves the top edge and keeps the bottom one', () => {
    expect(resizeRect(start, 'n', point(0, 20), false)).toEqual(rect(0, 20, 200, 80));
  });

  it('south changes the height only', () => {
    expect(resizeRect(start, 's', point(999, -10), false)).toEqual(rect(0, 0, 200, 90));
  });

  it('a corner without a proportion lock takes both directions', () => {
    expect(resizeRect(NOTE, 'se', point(100, 40), false)).toEqual(rect(0, 0, 300, 240));
  });

  it('an edge handle with the proportion lock scales the other way about the middle', () => {
    // 200×200 with the east handle pulled 100 out: 300 wide, 300 tall, centred on y = 100.
    expect(resizeRect(NOTE, 'e', point(100, 0), true)).toEqual(rect(0, -50, 300, 300));
  });

  it('never turns a rectangle inside out', () => {
    const tiny = resizeRect(NOTE, 'se', point(-900, -900), false);
    expect(tiny.width).toBeGreaterThanOrEqual(0);
    expect(tiny.height).toBeGreaterThanOrEqual(0);
  });

  it('treats a pointer direction that is not a number as no movement that way', () => {
    expect(resizeRect(NOTE, 'se', point(Number.NaN, 40), false)).toEqual(rect(0, 0, 200, 240));
    expect(resizeRect(NOTE, 'se', point(40, Number.POSITIVE_INFINITY), false)).toEqual(
      rect(0, 0, 240, 200),
    );
    // ... and it cannot make a box that is not a number.
    expect(resizeRect(NOTE, 'nw', point(Number.NaN, Number.NaN), true)).toEqual(NOTE);
  });
});

describe('TC-02 clampScale: nothing goes below its minimum size', () => {
  /** A note that has been shrunk to 60 world units on a side. */
  const small = rect(0, 0, 60, 60);
  const min = STICKY_MIN_SIZE_WORLD;

  it('stops one unit short of the minimum at exactly the minimum', () => {
    const scale = askedScale(small, 'se', point(min - 1 - small.width, min - 1 - small.height), true);
    expect(small.width * scale.x).toBeCloseTo(min - 1, 9);
    const clamped = clampScale(scale, [small], [min], MAX_OBJECT_SIZE_WORLD);
    const box = applyScale(small, 'se', clamped, true);
    expect(box.width).toBeCloseTo(min, 6);
    expect(box.height).toBeCloseTo(min, 6);
  });

  it('lets a resize that lands exactly on the minimum through untouched', () => {
    const scale = askedScale(small, 'se', point(min - small.width, min - small.height), true);
    const clamped = clampScale(scale, [small], [min], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(scale.x, 9);
    expect(clamped.y).toBeCloseTo(scale.y, 9);
  });

  it('clamps the direction the handle moved, not the one it did not', () => {
    // A 60×100 note dragged in at its east handle: the width stops at 50, the height stays.
    const box = rect(0, 0, 60, 100);
    const scale = askedScale(box, 'e', point(1 - box.width, 0), false);
    const clamped = clampScale(scale, [box], [min], MAX_OBJECT_SIZE_WORLD);
    expect(applyScale(box, 'e', clamped, false)).toEqual(rect(0, 0, min, 100));
  });

  it('does not clamp a scale that is already inside the limits', () => {
    expect(clampScale(point(1.5, 1.5), [small], [min], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1.5,
      y: 1.5,
    });
  });

  it('treats a scale that is not a number as no resize at all', () => {
    expect(clampScale(point(Number.NaN, 2), [small], [min], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1,
      y: 1,
    });
  });
});

describe('TC-03 clampScale: one scale for the whole selection, stopped by the first object to hit a limit', () => {
  /** A small note and a big one, the two sizes a selection can hold. */
  const a = rect(0, 0, 100, 100);
  const b = rect(200, 0, 200, 300);
  const mins = [STICKY_MIN_SIZE_WORLD, 10];

  it('stops the whole selection where the first object reaches the maximum', () => {
    const scale = clampScale(point(150, 1), [a, b], mins, MAX_OBJECT_SIZE_WORLD);
    expect(scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 200, 6);
    expect(scale.y).toBe(1);
    // Neither object is past the limit, and the one that got there first is exactly on it.
    expect(b.width * scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
    expect(a.width * scale.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
  });

  it('keeps the relative layout when it stops them', () => {
    const scale = clampScale(point(150, 1), [a, b], mins, MAX_OBJECT_SIZE_WORLD);
    const from = unionRects([a, b]) as Rect;
    const to = rect(from.x, from.y, from.width * scale.x, from.height * scale.y);
    const scaledA = scaleWithin(a, from, to);
    const scaledB = scaleWithin(b, from, to);
    // The gap between them is 100 world units, and it has grown by exactly the same factor.
    expect(scaledB.x - (scaledA.x + scaledA.width)).toBeCloseTo(100 * scale.x, 6);
    expect(scaledA.width).toBeCloseTo(100 * scale.x, 6);
    expect(scaledB.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
  });

  it('stops at whichever object reaches its own minimum first', () => {
    const scale = clampScale(point(0.2, 0.2), [a, b], mins, MAX_OBJECT_SIZE_WORLD);
    // a's 100 units hit 50 at 0.5; b could have gone to 0.05 before reaching 10.
    expect(scale.x).toBeCloseTo(0.5, 9);
    expect(a.width * scale.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(b.width * scale.x).toBeGreaterThan(10);
  });

  it('applies the minimum per object, so a mixed selection stops on the tightest rule', () => {
    const scale = clampScale(point(0.02, 1), [a, b], mins, MAX_OBJECT_SIZE_WORLD);
    expect(scale.x).toBeCloseTo(0.5, 9);
  });

  it('says nothing is a resize when there is nothing selected', () => {
    expect(clampScale(point(3, 3), [], [], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 3, y: 3 });
  });
});

describe('TC-04 scaleWithin: two notes 100 apart, the box twice as wide', () => {
  /** Two 200-unit notes with a 100-unit gap: 0-200 and 300-500. */
  const left = rect(0, 0, 200, 200);
  const right = rect(300, 0, 200, 200);
  const from = unionRects([left, right]) as Rect;

  it('is the same box when the box does not change', () => {
    expect(scaleWithin(left, from, from)).toEqual(left);
    expect(scaleWithin(right, from, from)).toEqual(right);
  });

  it('doubles each note and each gap', () => {
    const to = rect(from.x, from.y, from.width * 2, from.height);
    const a = scaleWithin(left, from, to);
    const b = scaleWithin(right, from, to);
    expect(a).toEqual(rect(0, 0, 400, 200));
    expect(b).toEqual(rect(600, 0, 400, 200));
    expect(b.x - (a.x + a.width)).toBe(200);
  });

  it('moves the far edge of the box, not the near one, when the east handle is dragged', () => {
    // The west edge is welded to the board: what is at x = 0 is still at x = 0.
    const to = rect(from.x, from.y, from.width * 2, from.height);
    expect(scaleWithin(left, from, to).x).toBe(0);
  });

  it('shrinks toward the anchor as well', () => {
    const to = rect(from.x, from.y, from.width / 2, from.height);
    const a = scaleWithin(left, from, to);
    const b = scaleWithin(right, from, to);
    expect(a.width).toBeCloseTo(100, 9);
    expect(b.x).toBeCloseTo(150, 9);
    expect(b.x - (a.x + a.width)).toBeCloseTo(50, 9);
  });

  it('refuses a box with no width rather than dividing by it', () => {
    const flat = rect(0, 0, 0, 200);
    expect(scaleWithin(left, flat, rect(0, 0, 400, 200))).toEqual(left);
  });
});

describe('the box a scale describes (scaleRect)', () => {
  /** The box two notes 100 apart fill: 0-500 wide, 0-200 tall. */
  const box = rect(0, 0, 500, 200);

  it('agrees with resizeRect when nothing had to be stopped', () => {
    // The two ways of getting at the same box — a pointer delta, and the scale it worked out to —
    // have to agree, or a resize that was allowed would land somewhere else depending on which
    // question the code asked.
    for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const) {
      const delta = point(60, 40);
      const dragged = resizeRect(box, handle, delta, false);
      const scaled = scaleRect(box, handle, {
        x: dragged.width / box.width,
        y: dragged.height / box.height,
      });
      expect(scaled).toEqual(dragged);
    }
  });

  it('holds the west edge still and moves the east one, because the pointer pulled the east', () => {
    expect(scaleRect(box, 'e', point(2, 1))).toEqual(rect(0, 0, 1000, 200));
  });

  it('holds the east edge still and moves the west one, because the pointer pulled the west', () => {
    // The west edge was at 0 and the east edge was at 500; halving the width from that handle means
    // the box is now 250-500, not 0-250. The edge the person was holding is the edge that moved.
    expect(scaleRect(box, 'w', point(0.5, 1))).toEqual(rect(250, 0, 250, 200));
  });

  it('holds the bottom when the north edge is pulled, and the top when the south one is', () => {
    expect(scaleRect(box, 'n', point(1, 2))).toEqual(rect(0, -200, 500, 400));
    expect(scaleRect(box, 's', point(1, 2))).toEqual(rect(0, 0, 500, 400));
  });

  it('grows away from the corner that was not touched, for all four corners', () => {
    expect(scaleRect(box, 'se', point(2, 2))).toEqual(rect(0, 0, 1000, 400));
    expect(scaleRect(box, 'nw', point(2, 2))).toEqual(rect(-500, -200, 1000, 400));
    expect(scaleRect(box, 'ne', point(2, 2))).toEqual(rect(0, -200, 1000, 400));
    expect(scaleRect(box, 'sw', point(2, 2))).toEqual(rect(-500, 0, 1000, 400));
  });

  it('is the same box at a scale of 1, and no box at all at 0', () => {
    expect(scaleRect(box, 'se', point(1, 1))).toEqual(box);
    // Squashed to nothing, the box is still where the drag left it: a drag of the far corner leaves
    // it at the near corner, and a drag of the near corner leaves it at the far one.
    expect(scaleRect(box, 'se', point(0, 0))).toEqual(rect(0, 0, 0, 0));
    expect(scaleRect(box, 'nw', point(0, 0))).toEqual(rect(500, 200, 0, 0));
  });

  it('refuses a scale that is not a number, and a rectangle that is not a rectangle', () => {
    // A drag cannot be allowed to write NaN into a shared document, so an axis whose scale is not a
    // number is an axis that keeps the size it had. Each axis is on its own: the one that did get a
    // number still changes, and the box is still a box.
    expect(scaleRect(box, 'e', point(Number.NaN, 2))).toEqual(rect(0, -100, 500, 400));
    expect(scaleRect(box, 'e', point(2, Number.POSITIVE_INFINITY))).toEqual(rect(0, 0, 1000, 200));
    // A rectangle that is not a rectangle has no size to scale, so there is no box to hand back.
    expect(scaleRect(rect(0, 0, Number.NaN, 200), 'e', point(2, 2))).toEqual(rect(0, 0, 0, 0));
  });

  it('never turns a scale into a negative box', () => {
    // A scale below zero is a pointer that crossed the far edge of the box: the box is gone, and it
    // is gone rather than inside out — a negative width would be a NaN waiting to reach the document.
    expect(scaleRect(box, 'e', point(-3, 1))).toEqual(rect(0, 0, 0, 200));
    expect(scaleRect(box, 'w', point(-1, 1))).toEqual(rect(500, 0, 0, 200));
  });
});

describe('objects inside a box whose anchor moved (scaleWithin)', () => {
  const left = rect(0, 0, 200, 200);
  const right = rect(300, 0, 200, 200);
  const from = unionRects([left, right]) as Rect; // 0-500

  it('carries the objects welded to the edge that moved along with it', () => {
    // The west edge was pulled from 0 to 250, and the box halved. The note that was touching the
    // west edge has to be touching it still: an object left behind by the edge it was standing
    // against is a group resize that loses half the group.
    const to = scaleRect(from, 'w', point(0.5, 1));
    const moved = scaleWithin(left, from, to);
    expect(moved).toEqual(rect(250, 0, 100, 200));
    // The note against the east edge stays against the east edge, and the gap between them halved
    // with everything else.
    const kept = scaleWithin(right, from, to);
    expect(kept.x + kept.width).toBeCloseTo(500, 9);
    expect(kept.x - (moved.x + moved.width)).toBeCloseTo(50, 9);
  });

  it('carries its contents when the box moves without scaling', () => {
    // The box went 100 to the right and stayed the same size — which is what a resize that was
    // stopped by a minimum looks like on one axis. Everything in it goes 100 to the right with it,
    // at the same size: the group moved, it did not resize.
    expect(scaleWithin(left, from, rect(from.x + 100, from.y, from.width, from.height))).toEqual(
      rect(100, 0, 200, 200),
    );
    expect(scaleWithin(right, from, rect(from.x + 100, from.y, from.width, from.height))).toEqual(
      rect(400, 0, 200, 200),
    );
  });
});
