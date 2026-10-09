import { describe, expect, it } from 'vitest';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  anchoredRect,
  clampScale,
  handleLabel,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';

/**
 * Story 7, `sel.geometry_ops`: the rectangle maths every object type shares, so a
 * resize behaves the same for a sticky note, a shape (story 10) or an image (story 12).
 * Pure maths, so a real Y.Doc is not needed here — only the numbers.
 */

const NOTE = STICKY_SIZE_WORLD;

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

describe('rectContains (the marquee rule)', () => {
  it('accepts a box whose four edges lie inside and rejects one edge outside', () => {
    const outer = rect(0, 0, 500, 500);
    expect(rectContains(outer, rect(10, 10, 100, 100))).toBe(true);
    // Exactly on the edge counts as inside: nothing sticks out of the rectangle.
    expect(rectContains(outer, rect(0, 0, 500, 500))).toBe(true);
    expect(rectContains(outer, rect(500, 0, 500, 500))).toBe(false);
    expect(rectContains(outer, rect(-1, 0, 100, 100))).toBe(false);
    expect(rectContains(outer, rect(100, 100, 401, 100))).toBe(false);
  });

  it('refuses a box that only touches the rectangle from outside', () => {
    // Its right edge sits on the rectangle's right edge, but its body is outside.
    expect(rectContains(rect(0, 0, 500, 500), rect(500, 0, 100, 100))).toBe(false);
  });

  it('is false for non-finite numbers rather than quietly true', () => {
    expect(rectContains(rect(0, 0, 500, 500), rect(0, 0, Number.NaN, 100))).toBe(false);
    expect(rectContains(rect(0, 0, Number.POSITIVE_INFINITY, 500), rect(0, 0, 10, 10))).toBe(
      false,
    );
  });
});

describe('unionRects and normalizeRect', () => {
  it('returns null for no rectangles (an empty selection has no bounding box)', () => {
    expect(unionRects([])).toBeNull();
  });

  it('bounds several rectangles, whatever order they arrive in', () => {
    const bounds = unionRects([
      rect(300, 300, 200, 200),
      rect(0, 40, NOTE, NOTE),
      rect(40, 0, 100, 50),
    ]);
    expect(bounds).toEqual(rect(0, 0, 500, 500));
  });

  it('ignores a rectangle nobody can draw', () => {
    expect(unionRects([rect(0, 0, 10, 10), rect(0, 0, Number.NaN, 10)])).toEqual(
      rect(0, 0, 10, 10),
    );
    expect(unionRects([rect(0, 0, Number.NaN, 10)])).toBeNull();
  });

  it('normalizes a drag in any direction into a positive box', () => {
    expect(normalizeRect({ x: 100, y: 200 }, { x: 40, y: 60 })).toEqual(rect(40, 60, 60, 140));
    expect(normalizeRect({ x: 40, y: 60 }, { x: 100, y: 200 })).toEqual(rect(40, 60, 60, 140));
  });

  it('refuses non-finite corners rather than inventing a box', () => {
    expect(normalizeRect({ x: Number.NaN, y: 0 }, { x: 10, y: 10 })).toEqual(rect(0, 0, 0, 0));
  });
});

describe('resizeRect (TC-01)', () => {
  it('TC-01: a corner handle grows both axes from the opposite corner', () => {
    expect(resizeRect(rect(0, 0, NOTE, NOTE), 'se', { x: 100, y: 40 }, false)).toEqual(
      rect(0, 0, 300, 240),
    );
    // The top-left corner is the anchor: it stays where it was.
    expect(resizeRect(rect(100, 100, NOTE, NOTE), 'nw', { x: -50, y: -50 }, false)).toEqual(
      rect(50, 50, 250, 250),
    );
  });

  it('TC-01: with the proportions kept, a 200x200 note becomes 300x300', () => {
    // sel.aspect: the axis the pointer moved further decides the scale, and the other
    // axis follows, so the bounding box keeps its 1:1 ratio.
    expect(resizeRect(rect(0, 0, NOTE, NOTE), 'se', { x: 100, y: 40 }, true)).toEqual(
      rect(0, 0, 300, 300),
    );
    expect(resizeRect(rect(0, 0, NOTE, NOTE), 'se', { x: 20, y: 60 }, true)).toEqual(
      rect(0, 0, 260, 260),
    );
  });

  it('an edge handle with the proportions kept scales both axes by the axis it moved', () => {
    // A sticky note's `resizable` types keep their ratio whatever handle is used: the
    // pointer moved the width, so the width decides and the height follows.
    // The right edge follows the pointer; the box grows about its vertical centre.
    expect(resizeRect(rect(0, 0, NOTE, NOTE), 'e', { x: 100, y: 40 }, true)).toEqual(
      rect(0, -50, 300, 300),
    );
    // …including when it shrinks, which is what makes the minimum-size clamp reachable
    // from an edge handle.
    expect(resizeRect(rect(0, 0, NOTE, NOTE), 'e', { x: -100, y: 0 }, true)).toEqual(
      rect(0, 50, 100, 100),
    );
    expect(resizeRect(rect(0, 0, 400, 200), 's', { x: 0, y: -100 }, true)).toEqual(
      rect(100, 0, 200, 100),
    );
  });

  it('an edge handle moves one axis only', () => {
    const start = rect(0, 0, NOTE, NOTE);
    expect(resizeRect(start, 'e', { x: 100, y: 40 }, false)).toEqual(rect(0, 0, 300, 200));
    expect(resizeRect(start, 'w', { x: -50, y: 40 }, false)).toEqual(rect(-50, 0, 250, 200));
    expect(resizeRect(start, 'n', { x: 40, y: -50 }, false)).toEqual(rect(0, -50, 200, 250));
    expect(resizeRect(start, 's', { x: 40, y: 30 }, false)).toEqual(rect(0, 0, 200, 230));
    // A corner keeps two anchors: `ne` holds the bottom-left corner still.
    expect(resizeRect(start, 'ne', { x: 100, y: -20 }, false)).toEqual(rect(0, -20, 300, 220));
  });

  it('shrinks from the anchor the handle is not on', () => {
    // `w` holds the right edge, so shrinking moves the left edge inward.
    const start = rect(0, 0, 400, 200);
    const shrunk = resizeRect(start, 'w', { x: 100, y: 0 }, false);
    expect(shrunk).toEqual(rect(100, 0, 300, 200));
    expect(shrunk.x + shrunk.width).toBeCloseTo(start.x + start.width, 9);
  });

  it('never lets an axis turn inside out', () => {
    // Dragged past the opposite corner: the axis stops at nothing, not at a negative.
    const start = rect(0, 0, NOTE, NOTE);
    expect(resizeRect(start, 'se', { x: -300, y: -300 }, false).width).toBeGreaterThanOrEqual(0);
    expect(resizeRect(start, 'se', { x: -300, y: -300 }, false).height).toBeGreaterThanOrEqual(0);
  });

  it('leaves the box alone for a non-finite delta', () => {
    const start = rect(0, 0, NOTE, NOTE);
    expect(resizeRect(start, 'se', { x: Number.NaN, y: 10 }, false)).toEqual(start);
  });
});

describe('clampScale (TC-02, TC-03)', () => {
  it('TC-02: stops a sticky note at its minimum size, boundary both ways', () => {
    const note = rect(0, 0, NOTE, NOTE);
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    // Exactly the minimum (50 / 200 = 0.25) survives.
    expect(clampScale({ x: 0.25, y: 0.25 }, [note], minSizes, MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 0.25,
      y: 0.25,
    });
    // One unit smaller than the minimum is not applied: 49 board units never appears.
    const almostTooSmall = clampScale(
      { x: (STICKY_MIN_SIZE_WORLD - 1) / NOTE, y: (STICKY_MIN_SIZE_WORLD - 1) / NOTE },
      [note],
      minSizes,
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(note.width * (almostTooSmall.x ?? 0)).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(note.height * (almostTooSmall.y ?? 0)).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    // Shrinking past zero still respects the minimum, so no object disappears.
    expect(
      clampScale({ x: 0, y: 0 }, [note], minSizes, MAX_OBJECT_SIZE_WORLD).x,
    ).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD / NOTE);
  });

  it('TC-03: the whole selection stops when the first object reaches the maximum', () => {
    // Two objects, mixed types: the 20,000-unit one reaches the global maximum first, so
    // the whole selection stops there and no object ends up past the limit.
    const small = rect(0, 0, 1_000, 1_000);
    const big = rect(2_000, 0, MAX_OBJECT_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD);
    const clamped = clampScale(
      { x: 2, y: 2 },
      [small, big],
      [STICKY_MIN_SIZE_WORLD, 10],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(clamped).toEqual({ x: 1, y: 1 });
    // Boundary: the limit itself is reachable, one unit past it is not.
    expect(big.width * clamped.x).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(small.width * clamped.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
    const almost = clampScale(
      { x: 1 + 1e-9, y: 1 + 1e-9 },
      [small, big],
      [STICKY_MIN_SIZE_WORLD, 10],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(big.width * almost.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
    // And with that scale the relative layout is what it was.
    const from = unionRects([small, big]);
    if (!from) throw new Error('two objects must have a bounding box');
    const to = anchoredRect(from, 'se', from.width * clamped.x, from.height * clamped.y);
    expect(scaleWithin(small, from, to)).toEqual(small);
    expect(scaleWithin(big, from, to)).toEqual(big);
  });

  it('leaves the axis nobody dragged alone, which is what an edge handle needs (TC-24)', () => {
    const box = rect(0, 0, 400, 100);
    const minSizes = [10];
    const shrunk = clampScale({ x: 0.5, y: 1 }, [box], minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(shrunk.x).toBeCloseTo(0.5, 9);
    // `y` proposed 1 and stayed 1: the height of the box did not change, so its minimum
    // never entered into it.
    expect(shrunk.y).toBe(1);
    // The axis that is dragged still respects its own minimum, 10 board units.
    const below = clampScale({ x: 10 / 400 - 1e-6, y: 1 }, [box], minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(box.width * below.x).toBeGreaterThanOrEqual(10);
  });

  it('stops each axis at the object that reaches its own limit first', () => {
    const wide = rect(0, 0, 400, 100);
    const narrow = rect(500, 0, STICKY_MIN_SIZE_WORLD, 400);
    const clamped = clampScale(
      { x: 0.1, y: 0.1 },
      [wide, narrow],
      [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    // `narrow` is already at its minimum width, so the width axis cannot shrink at all…
    expect(clamped.x).toBe(1);
    // …while the height axis stops at whichever object reaches 50 units first (100 × 0.5).
    expect(clamped.y).toBeCloseTo(0.5, 9);
    expect(Math.min(wide.width * clamped.x, narrow.width * clamped.x)).toBeGreaterThanOrEqual(
      STICKY_MIN_SIZE_WORLD,
    );
    expect(Math.min(wide.height * clamped.y, narrow.height * clamped.y)).toBeGreaterThanOrEqual(
      STICKY_MIN_SIZE_WORLD,
    );
  });

  it('refuses nonsense instead of multiplying it', () => {
    const note = rect(0, 0, NOTE, NOTE);
    expect(clampScale({ x: Number.NaN, y: 1 }, [note], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD)).toEqual(
      { x: 1, y: 1 },
    );
    expect(clampScale({ x: 2, y: 2 }, [], [], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 2, y: 2 });
  });
});

describe('scaleWithin (TC-04)', () => {
  it('TC-04: doubling the bounding box doubles every note and every gap', () => {
    // sel.resize: two notes of 200 units, 100 units apart, resized until the box is
    // twice as wide.
    const a = rect(0, 0, NOTE, NOTE);
    const b = rect(300, 0, NOTE, NOTE);
    const from = unionRects([a, b]);
    if (!from) throw new Error('two notes must have a bounding box');
    expect(from).toEqual(rect(0, 0, 500, 200));
    const to = rect(0, 0, 1_000, 400);

    const scaledA = scaleWithin(a, from, to);
    const scaledB = scaleWithin(b, from, to);
    expect(scaledA.width).toBeCloseTo(400, 6);
    expect(scaledB.width).toBeCloseTo(400, 6);
    expect(scaledA.height).toBeCloseTo(400, 6);
    expect(scaledB.x).toBeCloseTo(600, 6);
    // The gap between them doubled: 100 became 200.
    expect(scaledB.x - (scaledA.x + scaledA.width)).toBeCloseTo(200, 6);
  });

  it('moves an object that is not on the box edge proportionally too', () => {
    const inner = rect(100, 100, 100, 100);
    const from = rect(0, 0, 400, 400);
    expect(scaleWithin(inner, from, rect(0, 0, 800, 400))).toEqual(rect(200, 100, 200, 100));
  });

  it('does not invent a scale for an empty bounding box', () => {
    const child = rect(0, 0, 100, 100);
    expect(scaleWithin(child, rect(0, 0, 0, 0), rect(0, 0, 200, 200))).toEqual(child);
  });
});

describe('handle labels', () => {
  it('names each handle so its accessible name is spelled out', () => {
    expect(handleLabel('nw')).toBe('Resize top-left');
    expect(handleLabel('n')).toBe('Resize top');
    expect(handleLabel('e')).toBe('Resize right');
    expect(handleLabel('se')).toBe('Resize bottom-right');
  });
});
