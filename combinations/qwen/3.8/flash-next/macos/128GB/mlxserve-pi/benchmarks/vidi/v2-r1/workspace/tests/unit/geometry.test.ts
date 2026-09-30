/**
 * The rectangle maths every selection gesture is built on (`sel.geometry_ops`).
 *
 * Unit level because all of it is pure numbers: what a handle drag means as a
 * rectangle, what a rectangle means as a scale, and where each object of a
 * selection lands when that scale is applied.
 *
 * Specs: spec/stories/007-select-move-resize-and-delete-several-objects-at-o/
 * design.md, sel.geometry_ops (TC-01 to TC-04).
 */
import { describe, expect, it } from 'vitest';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';
import type { Handle, Rect } from '../../src/shared/geometry';
import {
  askedResizeScale,
  clampScale,
  handlePosition,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
} from '../../src/shared/geometry';

const NOTE = STICKY_SIZE_WORLD;

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

describe('geometry: rectContains (the marquee containment rule)', () => {
  const marquee = rect(0, 0, 300, 300);

  it('is true for an object wholly inside and false for one the edge only touches', () => {
    expect(rectContains(marquee, rect(10, 10, 100, 100))).toBe(true);
    // Wholly inside up to the edge: edges coinciding still counts as inside.
    expect(rectContains(marquee, rect(0, 0, 300, 300))).toBe(true);
    // Half inside, and half outside from the other side.
    expect(rectContains(marquee, rect(250, 100, 100, 100))).toBe(false);
    expect(rectContains(marquee, rect(-50, 100, 100, 100))).toBe(false);
    // Outside on one edge only, on the far side of the rectangle.
    expect(rectContains(marquee, rect(400, 400, 10, 10))).toBe(false);
  });

  it('is false for a rectangle with nothing in it', () => {
    // A marquee the person only clicked has no size: it contains no note.
    expect(rectContains(rect(100, 100, 0, 0), rect(50, 50, 100, 100))).toBe(false);
  });

  it('is false when the surrounding rectangle is not a usable size', () => {
    expect(rectContains(rect(0, 0, Number.NaN, 300), rect(10, 10, 10, 10))).toBe(false);
    expect(rectContains(rect(0, 0, 300, Number.POSITIVE_INFINITY), rect(10, 10, 10, 10))).toBe(false);
  });
});

describe('geometry: unionRects', () => {
  it('is null for nothing and the smallest box around one rectangle', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([rect(3, 4, 10, 20)])).toEqual(rect(3, 4, 10, 20));
  });

  it('grows to cover rectangles set apart, and ignores unusable ones', () => {
    const box = unionRects([rect(0, 0, 100, 100), rect(300, 200, 100, 50)]);
    expect(box).toEqual(rect(0, 0, 400, 250));
    const withJunk = unionRects([
      rect(0, 0, 100, 100),
      rect(0, 0, Number.NaN, 100),
      rect(50, 50, 0, 0),
    ]);
    expect(withJunk).toEqual(rect(0, 0, 100, 100));
  });
});

describe('geometry: normalizeRect', () => {
  it('turns either pair of opposite corners into the same rectangle', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 60, y: 90 })).toEqual(rect(10, 20, 50, 70));
    expect(normalizeRect({ x: 60, y: 90 }, { x: 10, y: 20 })).toEqual(rect(10, 20, 50, 70));
  });

  it('is an empty rectangle for a click and for numbers that are not numbers', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual(rect(5, 5, 0, 0));
    expect(normalizeRect({ x: Number.NaN, y: 1 }, { x: 5, y: 5 }).width).toBe(0);
  });
});

describe('geometry: resizeRect (TC-01)', () => {
  const note = rect(0, 0, NOTE, NOTE);

  // TC-01: a corner drag on a proportion-locked object takes one scale.
  it('TC-01 keeps the starting ratio from the opposite corner', () => {
    const grown = resizeRect(note, 'se', { x: 100, y: 40 }, true);
    expect(grown.width).toBeCloseTo(300, 6);
    expect(grown.height).toBeCloseTo(300, 6);
    // The opposite corner (top-left) is where it stays anchored.
    expect(grown.x).toBe(0);
    expect(grown.y).toBe(0);
    expect(grown.width / grown.height).toBeCloseTo(note.width / note.height, 9);
  });

  it('takes the axis that moved more, whichever way the handle goes', () => {
    // Same drag on the opposite corner: anchored bottom-right, same ratio.
    const grown = resizeRect(note, 'nw', { x: -100, y: -40 }, true);
    expect(grown.width).toBeCloseTo(300, 6);
    expect(grown.height).toBeCloseTo(300, 6);
    expect(grown.x + grown.width).toBeCloseTo(NOTE, 6);
    expect(grown.y + grown.height).toBeCloseTo(NOTE, 6);
    // The other axis driving it.
    expect(resizeRect(note, 'se', { x: 10, y: 100 }, true).width).toBeCloseTo(300, 6);
  });

  it('changes one axis for an edge handle and both for a corner handle', () => {
    const east = resizeRect(note, 'e', { x: 100, y: 0 }, false);
    expect(east.width).toBeCloseTo(300, 6);
    expect(east.height).toBeCloseTo(NOTE, 6);
    // The opposite edge stays where it was.
    expect(east.x).toBe(0);
    const north = resizeRect(note, 'n', { x: 0, y: -50 }, false);
    expect(north.height).toBeCloseTo(250, 6);
    expect(north.width).toBeCloseTo(NOTE, 6);
    expect(north.y + north.height).toBeCloseTo(NOTE, 6);
    const corner = resizeRect(note, 'sw', { x: -20, y: 20 }, false);
    expect(corner.width).toBeCloseTo(220, 6);
    expect(corner.height).toBeCloseTo(220, 6);
    expect(corner.x).toBeCloseTo(-20, 6);
    expect(corner.y).toBe(0);
  });

  it('keeps an edge handle on its own line', () => {
    // Dragging the east handle of a note must not slide it up or down.
    const east = resizeRect(note, 'e', { x: 50, y: 0 }, false);
    expect(east.y).toBeCloseTo(0, 9);
    const north = resizeRect(note, 'n', { x: 0, y: 20 }, false);
    expect(north.x).toBeCloseTo(0, 9);
  });

  it('shrinks with a drag back over the object', () => {
    const shrunk = resizeRect(note, 'se', { x: -50, y: -50 }, false);
    expect(shrunk.width).toBeCloseTo(150, 6);
    expect(shrunk.height).toBeCloseTo(150, 6);
  });

  it('refuses to write down an unusable rectangle or a nonsense drag', () => {
    const broken = rect(0, 0, 0, NOTE);
    expect(resizeRect(broken, 'se', { x: 10, y: 10 }, false)).toEqual(broken);
    // A drag that is not a number changes nothing about the size.
    const same = resizeRect(note, 'se', { x: Number.NaN, y: Number.NaN }, false);
    expect(same.width).toBe(NOTE);
    expect(same.height).toBe(NOTE);
  });

  it('never turns an object inside out when a handle is dragged past its anchor', () => {
    for (const handle of ['e', 's', 'se', 'w', 'n', 'nw'] as const) {
      const flipped = resizeRect(note, handle, { x: -10_000, y: -10_000 }, false);
      expect(flipped.width, `handle ${handle}`).toBeGreaterThan(0);
      expect(flipped.height, `handle ${handle}`).toBeGreaterThan(0);
    }
  });
});

describe('geometry: askedResizeScale', () => {
  it('is the factor resizeRect applies, before any limit', () => {
    const note = rect(0, 0, NOTE, NOTE);
    expect(askedResizeScale(note, 'se', { x: 100, y: 100 }, false)).toEqual({ x: 1.5, y: 1.5 });
    expect(askedResizeScale(note, 'e', { x: 100, y: 999 }, false)).toEqual({ x: 1.5, y: 1 });
    // Locked: the axis that moved more is the one both take.
    expect(askedResizeScale(note, 'se', { x: 100, y: 40 }, true)).toEqual({ x: 1.5, y: 1.5 });
  });
});

describe('geometry: clampScale (TC-02, TC-03, sel.size_limits)', () => {
  const one = [rect(0, 0, NOTE, NOTE)];
  const min = [STICKY_MIN_SIZE_WORLD];

  // TC-02: the minimum stops the shrink, at the boundary and past it.
  it('TC-02 stops a shrink at the minimum size', () => {
    // One unit short of the minimum: the selection stops at the minimum.
    const justPast = (STICKY_MIN_SIZE_WORLD - 1) / NOTE;
    expect(clampScale({ x: justPast, y: justPast }, one, min, MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: STICKY_MIN_SIZE_WORLD / NOTE,
      y: STICKY_MIN_SIZE_WORLD / NOTE,
    });
    const far = (STICKY_MIN_SIZE_WORLD - 1) / NOTE;
    const clamped = clampScale({ x: far, y: far }, one, min, MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / NOTE, 9);
    expect(clamped.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / NOTE, 9);
    // Exactly at the minimum is not past it.
    expect(clampScale({ x: 0.25, y: 0.25 }, one, min, MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 0.25,
      y: 0.25,
    });
  });

  it('leaves a scale within both limits alone', () => {
    expect(clampScale({ x: 2, y: 2 }, one, min, MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 2, y: 2 });
  });

  // TC-03: the first object to reach a limit stops the whole selection.
  it('TC-03 stops the whole selection where the first object reaches the maximum', () => {
    const big = rect(0, 0, 4_000, 4_000);
    const small = rect(4_200, 0, NOTE, NOTE);
    const scale = clampScale(
      { x: 6, y: 6 },
      [small, big],
      [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    // The 4,000-unit object may reach 20,000 and no further: five times, not six.
    expect(scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 4_000, 9);
    // One scale for the whole selection, so it stays uniform and the layout too.
    expect(scale.y).toBe(scale.x);
    expect(small.width * scale.x).toBeLessThan(MAX_OBJECT_SIZE_WORLD);
  });

  it('is stopped by the tightest minimum across the selection, on either axis', () => {
    const wide = rect(0, 0, 1_000, 100);
    const scale = clampScale(
      { x: 0.05, y: 0.05 },
      [wide, rect(2_000, 0, NOTE, NOTE)],
      [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    // The short object hits 50 tall first: the selection stops there.
    expect(scale.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 100, 9);
    expect(scale.x).toBe(scale.y);
    expect(wide.height * scale.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
  });

  it('clamps an unbalanced scale axis by axis', () => {
    const scale = clampScale(
      { x: 100, y: 0.01 },
      [rect(0, 0, NOTE, NOTE)],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / NOTE, 9);
    expect(scale.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / NOTE, 9);
  });

  it('gives a type with no minimum no floor, but still a ceiling', () => {
    const scale = clampScale({ x: 0.0001, y: 1000 }, [rect(0, 0, NOTE, NOTE)], [0], MAX_OBJECT_SIZE_WORLD);
    expect(scale.x).toBeCloseTo(0.0001, 9);
    expect(scale.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / NOTE, 9);
  });

  it('does not move at all for numbers that are not numbers', () => {
    expect(clampScale({ x: Number.NaN, y: 2 }, one, min, MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
    expect(clampScale({ x: 2, y: Number.POSITIVE_INFINITY }, one, min, MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1,
      y: 1,
    });
  });
});

describe('geometry: scaleWithin (TC-04, sel.resize)', () => {
  // TC-04: two notes 100 apart, the box twice as wide: 400 wide, 200 apart.
  it('TC-04 spreads a selection so sizes and gaps both double', () => {
    const a = rect(0, 0, NOTE, NOTE);
    const b = rect(NOTE + 100, 0, NOTE, NOTE);
    const box = unionRects([a, b]) as Rect;
    expect(box.width).toBe(500);
    const destination = rect(0, 0, box.width * 2, box.height);
    const grownA = scaleWithin(a, box, destination);
    const grownB = scaleWithin(b, box, destination);
    expect(grownA.width).toBeCloseTo(400, 6);
    expect(grownB.width).toBeCloseTo(400, 6);
    expect(grownB.x - (grownA.x + grownA.width)).toBeCloseTo(200, 6);
    // Nothing selected is left behind the box it was scaled inside.
    expect(grownA.x).toBeCloseTo(0, 6);
    expect(grownB.x + grownB.width).toBeCloseTo(destination.width, 6);
  });

  it('keeps an object where it was when the box did not move or grow', () => {
    const a = rect(500, 500, 100, 100);
    const box = rect(0, 0, 1_000, 1_000);
    expect(scaleWithin(a, box, box)).toEqual(a);
  });

  it('shrinks towards the anchor, keeping relative places', () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(300, 0, 100, 100);
    const box = rect(0, 0, 400, 100);
    const half = rect(0, 0, 200, 100);
    const shrunkA = scaleWithin(a, box, half);
    const shrunkB = scaleWithin(b, box, half);
    expect(shrunkA.width).toBeCloseTo(50, 6);
    expect(shrunkB.x).toBeCloseTo(150, 6);
    // The 200-unit gap halved with everything else, it did not close up.
    expect(shrunkB.x - (shrunkA.x + shrunkA.width)).toBeCloseTo(100, 6);
  });

  it('hands back the object when the box it is in has no size to scale by', () => {
    const a = rect(0, 0, 100, 100);
    expect(scaleWithin(a, rect(0, 0, 0, 0), rect(0, 0, 100, 100))).toEqual(a);
    expect(scaleWithin(a, rect(0, 0, 100, 100), rect(0, 0, 100, 0))).toEqual(a);
  });
});

describe('geometry: handles', () => {
  it('names every handle for the edge or corner it sits on', () => {
    const handles: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    expect(handles).toHaveLength(8);
    const box = rect(0, 0, 200, 100);
    expect(handles.map((handle) => handlePosition(box, handle))).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 50 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 50 },
    ]);
  });

  it('moves the edge a handle is named for, and only that one', () => {
    const box = rect(0, 0, 200, 100);
    // Dragging the east handle out makes the box wider with its left edge still
    // where it was; nothing about the top and bottom edges changes.
    const east = resizeRect(box, 'e', { x: 40, y: 0 }, false);
    expect(east.x).toBe(0);
    expect(east.width).toBeCloseTo(240, 6);
    expect(east.y).toBe(0);
    expect(east.height).toBeCloseTo(100, 6);
    // The north handle dragged up makes it taller from the top, no wider.
    const north = resizeRect(box, 'n', { x: 0, y: -40 }, false);
    expect(north.y).toBeCloseTo(-40, 6);
    expect(north.height).toBeCloseTo(140, 6);
    expect(north.x).toBe(0);
    expect(north.width).toBeCloseTo(200, 6);
  });
});
