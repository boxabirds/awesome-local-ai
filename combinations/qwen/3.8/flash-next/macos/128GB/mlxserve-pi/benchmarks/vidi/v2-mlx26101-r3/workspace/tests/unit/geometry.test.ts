import { describe, expect, it } from 'vitest';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  HANDLES,
  HANDLE_POSITION,
  clampScale,
  normalizeRect,
  rectContains,
  rectContainsPoint,
  resizeAnchor,
  resizeRect,
  scaleRect,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';

/**
 * Geometry unit tests (TC-01 to TC-04 of story 7, plus the boundaries around them).
 *
 * Nothing here needs a document or a browser: this is the maths that decides what a drag of a
 * handle does to a box, and it is the part of the story that can be wrong in a way nobody sees
 * until a resize has quietly skewed a layout - which is exactly why it is tested with round
 * numbers, at the edges, and with the answer written out rather than computed by the test.
 */

const SQUARE: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };

describe('geometry.rectContains (sel.geometry_ops)', () => {
  it('TC-07a holds a box that lies completely inside, edges included (boundary)', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    // Exactly on the edge is in: the rule is "completely within", and an object whose edge is
    // the box's edge has nothing of itself outside the box.
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(rectContains(outer, { x: 0, y: 0, width: 50, height: 100 })).toBe(true);
  });

  it('TC-07b rejects a box that hangs over by any amount, and one merely touching (negative)', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 90.5 })).toBe(false);
    expect(rectContains(outer, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
    // A box that contains the object's centre is still not a marquee selection.
    expect(rectContains({ x: 20, y: 20, width: 10, height: 10 }, outer)).toBe(false);
    // Not a rectangle at all, so it contains nothing rather than everything.
    expect(rectContains({ x: 0, y: 0, width: Number.NaN, height: 100 }, outer)).toBe(false);
  });
});

describe('geometry.unionRects and normalizeRect', () => {
  it('makes the smallest box around several boxes', () => {
    expect(
      unionRects([
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 300, y: 200, width: 100, height: 50 },
      ]),
    ).toEqual({ x: 0, y: 0, width: 400, height: 250 });
  });

  it('has no box for nothing at all, and no opinion about a broken one', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 }])).toBeNull();
  });

  it('TC-20a puts a marquee the wrong way round the right way round', () => {
    // Dragged from bottom-right to top-left, the box is still the box between those points.
    expect(normalizeRect({ x: 400, y: 300 }, { x: 100, y: 50 })).toEqual({
      x: 100,
      y: 50,
      width: 300,
      height: 250,
    });
  });
});

describe('geometry.resizeRect (sel.resize)', () => {
  it('TC-01 keeps a locked box in proportion, driven by the axis that moved further', () => {
    const result = resizeRect(SQUARE, 'se', { x: 100, y: 40 }, true);
    // 300 wide, not 300x240: the height follows the width, because the note stays a square.
    expect(result).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('TC-01b changes both axes of an unlocked corner and neither it does not touch', () => {
    expect(resizeRect(SQUARE, 'se', { x: 100, y: 40 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 240,
    });
    // TC-24: an edge handle changes one axis and leaves the other alone.
    expect(resizeRect(SQUARE, 'e', { x: 60, y: 0 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 260,
      height: 200,
    });
    expect(resizeRect(SQUARE, 's', { x: 0, y: -20 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 180,
    });
  });

  it('TC-01c keeps the anchor still: the box grows away from the corner being dragged', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const dragged = resizeRect(start, 'nw', { x: 50, y: 50 }, false);
    // Dragging the top-left corner down and right moves that corner; the bottom-right stays.
    expect(dragged.x + dragged.width).toBe(start.x + start.width);
    expect(dragged.y + dragged.height).toBe(start.y + start.height);
    expect(dragged).toEqual({ x: 150, y: 150, width: 150, height: 150 });
  });

  it('TC-01d drives both axes from an edge handle when the proportions are locked', () => {
    // A locked type still has handles on its edges; the edge that moved decides the ratio,
    // which is what makes an edge handle usable on a square object at all.
    // The anchor of an edge handle is the middle of the opposite edge, so a locked resize grows
    // evenly both ways from the middle rather than only downwards.
    expect(resizeRect(SQUARE, 'e', { x: 100, y: 0 }, true)).toEqual({
      x: 0,
      y: -50,
      width: 300,
      height: 300,
    });
    expect(resizeRect(SQUARE, 'n', { x: 0, y: -50 }, true)).toEqual({
      x: -25,
      y: -50,
      width: 250,
      height: 250,
    });
  });

  it('TC-01e never reports a negative box, however far the handle is dragged past', () => {
    const result = resizeRect(SQUARE, 'se', { x: -400, y: -400 }, false);
    expect(result).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    // A box with no width has no width to hold to its minimum, so the clamp has nothing to say
    // about it; the minimum is applied to the objects that have a size (TC-02).
    expect(clampScale({ x: 0.1, y: 0.1 }, [result], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD)).toEqual(
      { x: 0.1, y: 0.1 },
    );
  });

  it('TC-01f hands back what it was given when the numbers cannot be used', () => {
    expect(resizeRect(SQUARE, 'se', { x: Number.NaN, y: 10 }, true)).toEqual(SQUARE);
    // A box with no proportions of its own has no ratio to keep, so it simply grows.
    expect(resizeRect({ x: 0, y: 0, width: 0, height: 0 }, 'se', { x: 10, y: 10 }, true)).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
  });

  it('names the point that does not move for every handle', () => {
    const box: Rect = { x: 10, y: 20, width: 100, height: 40 };
    expect(resizeAnchor('se', box)).toEqual({ x: 10, y: 20 });
    expect(resizeAnchor('nw', box)).toEqual({ x: 110, y: 60 });
    expect(resizeAnchor('e', box)).toEqual({ x: 10, y: 40 });
    expect(resizeAnchor('n', box)).toEqual({ x: 60, y: 60 });
    // The anchor is always a point of the box it was made from.
    for (const handle of HANDLES) {
      expect(rectContainsPoint(box, resizeAnchor(handle, box))).toBe(true);
    }
  });
});

describe('geometry.clampScale (sel.size_limits)', () => {
  it('TC-02 stops a shrink at the minimum size, at the boundary and past it', () => {
    const min = STICKY_MIN_SIZE_WORLD;
    // Wanted: 40x40 out of 200x200, which is below the note's floor of 50.
    expect(clampScale({ x: 0.2, y: 0.2 }, [SQUARE], [min], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 0.25,
      y: 0.25,
    });
    // Exactly on the floor: not clamped, because it is not past it (boundary).
    expect(clampScale({ x: 0.25, y: 0.25 }, [SQUARE], [min], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 0.25,
      y: 0.25,
    });
    // And the resulting box is exactly the minimum.
    const clamped = clampScale({ x: 0.1, y: 0.1 }, [SQUARE], [min], MAX_OBJECT_SIZE_WORLD);
    expect(SQUARE.width * clamped.x).toBe(min);
    expect(SQUARE.height * clamped.y).toBe(min);
  });

  it('TC-02b holds a type to its own minimum, not to the sticky note\'s', () => {
    // A type whose floor is 10 may shrink to a tenth of a 100-unit box; one whose floor is 50
    // may not. The number comes from the registry, which is the only place a type's size
    // limits are stated.
    expect(clampScale({ x: 0.1, y: 0.1 }, [SQUARE], [10], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 0.1,
      y: 0.1,
    });
    expect(clampScale({ x: 0.1, y: 0.1 }, [{ x: 0, y: 0, width: 100, height: 100 }], [50], MAX_OBJECT_SIZE_WORLD)).toEqual(
      { x: 0.5, y: 0.5 },
    );
  });

  it('TC-03 stops the whole selection where the first object reaches the maximum', () => {
    const wide: Rect = { x: 0, y: 0, width: 15_000, height: 15_000 };
    const small: Rect = { x: 16_000, y: 0, width: 200, height: 200 };
    const scale = clampScale({ x: 2, y: 2 }, [wide, small], [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    // The big object hits 20,000 at 4/3, and the selection stops there - the small one is not
    // allowed to run on ahead to 400, because then the gap between them would change.
    expect(scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 15_000, 10);
    expect(scale.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 15_000, 10);
    expect(wide.width * scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
    expect(small.width * scale.x).toBeCloseTo((200 * 20_000) / 15_000, 6);
  });

  it('TC-03b keeps the ratio of a selection whose objects have different floors', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const b: Rect = { x: 300, y: 0, width: 60, height: 60 };
    // Growing: the object that reaches the maximum first stops both of them.
    expect(clampScale({ x: 2, y: 2 }, [a, b], [50, 50], 400)).toEqual({ x: 2, y: 2 });
    expect(clampScale({ x: 3, y: 3 }, [a, b], [50, 50], 400)).toEqual({ x: 2, y: 2 });
    // Shrinking: b is 60 wide with a floor of 50, so it reaches its own floor at 5/6 and the
    // whole selection stops there - a scale of a half would have left it at 30.
    expect(clampScale({ x: 0.9, y: 0.9 }, [a, b], [50, 50], 400)).toEqual({ x: 0.9, y: 0.9 });
    expect(clampScale({ x: 0.5, y: 0.5 }, [a, b], [50, 50], 400)).toEqual({
      x: 50 / 60,
      y: 50 / 60,
    });
    // What that gives each object: neither is below its floor, and the gap between them has
    // scaled by the same factor as both boxes.
    expect(a.width * 50 / 60).toBeGreaterThan(50);
    expect(b.width * 50 / 60).toBeCloseTo(50, 10);
  });

  it('clamps each axis on its own, which is what an edge handle asks for', () => {
    // Dragging the west handle scales the width only; the height must not be clamped along
    // with it, or a resize of one axis would move the other.
    expect(clampScale({ x: 0.1, y: 1 }, [SQUARE], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD)).toEqual(
      { x: 0.25, y: 1 },
    );
  });

  it('lets a scale that is already inside the limits through untouched, and ignores nonsense', () => {
    expect(clampScale({ x: 1, y: 1 }, [SQUARE], [50], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
    // Not a scale at all: the box stays the size it is rather than becoming nothing.
    expect(clampScale({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, [SQUARE], [50], MAX_OBJECT_SIZE_WORLD)).toEqual(
      { x: 1, y: 1 },
    );
    // No objects: nothing to clamp.
    expect(clampScale({ x: 9, y: 9 }, [], [], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 9, y: 9 });
  });

  it('prefers the minimum over the maximum when a box cannot honour both', () => {
    // A box already bigger than the maximum: shrinking it to the maximum would be fine, but a
    // scale that tries to take it below its own minimum must not be allowed to.
    const big: Rect = { x: 0, y: 0, width: 30_000, height: 30_000 };
    const scale = clampScale({ x: 0.001, y: 0.001 }, [big], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(big.width * scale.x).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
  });
});

describe('geometry.scaleWithin (sel.group_resize)', () => {
  it('TC-04 scales positions as well as sizes, so gaps keep their proportion', () => {
    // Two 200-unit notes with a 100-unit gap between them.
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1_000, height: 200 };
    const left = scaleWithin({ x: 0, y: 0, width: 200, height: 200 }, from, to);
    const right = scaleWithin({ x: 300, y: 0, width: 200, height: 200 }, from, to);
    expect(left).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(right.x).toBe(600);
    expect(right.width).toBe(400);
    // The gap doubled with everything else: the arrangement is the same, only bigger.
    expect(right.x - (left.x + left.width)).toBe(200);
  });

  it('keeps the objects at the corners of the box at the corners of the box', () => {
    const from: Rect = { x: 0, y: 0, width: 400, height: 400 };
    const to: Rect = { x: 100, y: 0, width: 200, height: 100 };
    expect(scaleWithin({ x: 0, y: 0, width: 40, height: 40 }, from, to)).toEqual({
      x: 100,
      y: 0,
      width: 20,
      height: 10,
    });
    expect(
      scaleWithin({ x: 360, y: 360, width: 40, height: 40 }, from, to),
    ).toEqual({ x: 280, y: 90, width: 20, height: 10 });
  });

  it('leaves a child alone when it has no box to be scaled against (error path)', () => {
    const child: Rect = { x: 10, y: 10, width: 20, height: 20 };
    expect(scaleWithin(child, { x: 0, y: 0, width: 0, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })).toEqual(
      child,
    );
    expect(
      scaleWithin(child, { x: 0, y: 0, width: 100, height: 100 }, {
        x: 0,
        y: 0,
        width: Number.NaN,
        height: 100,
      }),
    ).toEqual(child);
  });
});

describe('geometry.scaleRect', () => {
  it('scales a box about the point that must not move', () => {
    const box: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(scaleRect(box, { x: 2, y: 3 }, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 600,
    });
    // The bottom-right corner is the anchor: it is the one point the box keeps.
    const anchored = scaleRect(box, { x: 2, y: 2 }, resizeAnchor('nw', box));
    expect(anchored.x + anchored.width).toBe(box.x + box.width);
    expect(anchored.y + anchored.height).toBe(box.y + box.height);
  });

  it('gives back the box when the scale cannot be used (error path)', () => {
    const box: Rect = { x: 1, y: 2, width: 3, height: 4 };
    expect(scaleRect(box, { x: Number.NaN, y: 2 }, { x: 0, y: 0 })).toEqual(box);
  });
});

describe('geometry.handling', () => {
  it('names all eight handles, in order, each with the words its label is made from', () => {
    expect(HANDLES).toHaveLength(8);
    expect(HANDLES).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    for (const handle of HANDLES) {
      // TC-24: the accessible name is "Resize <position>", so the position is a phrase.
      expect(HANDLE_POSITION[handle]).toMatch(/^[a-z-]+$/);
    }
    expect(HANDLE_POSITION.se).toBe('bottom-right');
    expect(HANDLE_POSITION.nw).toBe('top-left');
  });
});
