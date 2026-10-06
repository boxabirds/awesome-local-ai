import { describe, expect, it } from "vitest";
import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Rect,
} from "../../src/shared/geometry";
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from "../../src/shared/config";

/**
 * Story 7, task 6 (TC-01 to TC-04) — the pure geometry behind selection:
 * containment for the marquee, the bounding box, handle resize maths and the
 * single clamped scale a group resize applies.
 *
 * All numbers are board (world) units.
 */

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

describe("sel.geometry_ops: containment and bounding boxes", () => {
  it("rectContains is true only when all four edges of the inner rect lie inside", () => {
    const box = rect(0, 0, 500, 500);

    expect(rectContains(box, rect(10, 10, 100, 100))).toBe(true);
    // Exactly coincident edges count as fully inside (the marquee's boundary).
    expect(rectContains(box, rect(0, 0, 500, 500))).toBe(true);
    expect(rectContains(box, rect(0, 0, 100, 100))).toBe(true);
    // Partly inside, or touching the edge from outside: not contained.
    expect(rectContains(box, rect(450, 450, 100, 100))).toBe(false);
    expect(rectContains(box, rect(500, 0, 100, 100))).toBe(false);
    expect(rectContains(box, rect(-1, 0, 100, 100))).toBe(false);
    expect(rectContains(box, rect(200, 200, 600, 100))).toBe(false);
  });

  it("rectContains rejects unusable input instead of throwing", () => {
    expect(rectContains(rect(0, 0, 100, 100), rect(Number.NaN, 0, 10, 10))).toBe(false);
    expect(rectContains(rect(0, 0, Number.POSITIVE_INFINITY, 100), rect(0, 0, 10, 10))).toBe(false);
  });

  it("unionRects of no rects is null (an empty selection has no box)", () => {
    expect(unionRects([])).toBeNull();
  });

  it("unionRects covers every rect and skips unusable ones", () => {
    const box = unionRects([rect(10, 20, 100, 50), rect(-30, 5, 20, 20), rect(0, 0, 1, 1)]);
    expect(box).toEqual(rect(-30, 0, 140, 70));
    expect(unionRects([rect(0, 0, 10, 10), rect(Number.NaN, 0, 10, 10)])).toEqual(rect(0, 0, 10, 10));
  });

  it("normalizeRect turns two drag points into a positive rect, either direction", () => {
    expect(normalizeRect({ x: 100, y: 200 }, { x: 40, y: 60 })).toEqual(rect(40, 60, 60, 140));
    expect(normalizeRect({ x: 40, y: 60 }, { x: 100, y: 200 })).toEqual(rect(40, 60, 60, 140));
    // A press without movement is an empty rect, not a negative one.
    expect(normalizeRect({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual(rect(10, 10, 0, 0));
  });
});

describe("sel.geometry_ops: resizeRect (TC-01)", () => {
  const square = rect(0, 0, 200, 200);

  it("TC-01 corner handle with aspect lock: 200x200 with delta (100,40) becomes 300x300", () => {
    const box = resizeRect(square, "se", { x: 100, y: 40 }, true);
    expect(box.width).toBeCloseTo(300, 6);
    expect(box.height).toBeCloseTo(300, 6);
    // The opposite corner (top-left) is the anchor.
    expect(box.x).toBeCloseTo(0, 6);
    expect(box.y).toBeCloseTo(0, 6);
  });

  it("corner handle without aspect lock resizes both axes independently", () => {
    const box = resizeRect(square, "se", { x: 100, y: 40 }, false);
    expect(box.width).toBeCloseTo(300, 6);
    expect(box.height).toBeCloseTo(240, 6);
    expect(box.x).toBeCloseTo(0, 6);
    expect(box.y).toBeCloseTo(0, 6);
  });

  it("the anchor is always the opposite corner: nw drags move the bottom-right", () => {
    const box = resizeRect(square, "nw", { x: -50, y: -20 }, false);
    expect(box.width).toBeCloseTo(250, 6);
    expect(box.height).toBeCloseTo(220, 6);
    // Bottom-right corner stays put.
    expect(box.x + box.width).toBeCloseTo(200, 6);
    expect(box.y + box.height).toBeCloseTo(200, 6);
  });

  it("edge handles change one axis only (TC-24 geometry)", () => {
    const east = resizeRect(square, "e", { x: 120, y: 999 }, false);
    expect([east.width, east.height]).toEqual([320, 200]);
    expect([east.x, east.y]).toEqual([0, 0]);

    const north = resizeRect(square, "n", { x: 999, y: -60 }, false);
    expect([north.width, north.height]).toEqual([200, 260]);
    // Bottom edge stays put.
    expect(north.y + north.height).toBeCloseTo(200, 6);
  });

  it("an edge handle with aspect lock keeps the box's ratio and centres the other axis", () => {
    const box = resizeRect(square, "e", { x: 200, y: 0 }, true);
    expect(box.width).toBeCloseTo(400, 6);
    expect(box.height).toBeCloseTo(400, 6);
    expect(box.x).toBeCloseTo(0, 6);
    // Height grew symmetrically about the box's vertical centre.
    expect(box.y).toBeCloseTo(-100, 6);
  });

  it("a handle dragged past the anchor never inverts the box", () => {
    const box = resizeRect(square, "se", { x: -400, y: -400 }, false);
    expect(box.width).toBeGreaterThanOrEqual(0);
    expect(box.height).toBeGreaterThanOrEqual(0);
  });

  it("unusable input leaves the box unchanged instead of producing NaN", () => {
    expect(resizeRect(square, "se", { x: Number.NaN, y: 0 }, false)).toEqual(square);
    expect(resizeRect(rect(0, 0, 0, 200), "se", { x: 10, y: 10 }, true).width).toBe(0);
  });
});

describe("sel.geometry_ops: clamping the group scale (TC-02, TC-03)", () => {
  it("TC-02 one unit under the minimum is clamped back to the minimum (boundary)", () => {
    const note = rect(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD);
    const under = clampScale(
      { x: (STICKY_MIN_SIZE_WORLD - 1) / STICKY_SIZE_WORLD, y: (STICKY_MIN_SIZE_WORLD - 1) / STICKY_SIZE_WORLD },
      [note],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(under.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, 9);
    expect(under.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, 9);
    const shrunk = scaleWithin(note, note, rect(0, 0, note.width * under.x, note.height * under.y));
    expect([shrunk.width, shrunk.height]).toEqual([STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD]);
  });

  it("TC-02 exactly at the minimum is not clamped (boundary)", () => {
    const note = rect(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD);
    const exact = clampScale(
      { x: STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, y: STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD },
      [note],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(exact.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, 9);
    expect(exact.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD, 9);
  });

  it("TC-03 the whole selection stops when the first object would pass the maximum", () => {
    const small = rect(0, 0, 100, 100);
    const large = rect(200, 0, 5_000, 5_000);
    const scale = clampScale(
      { x: 5, y: 5 },
      [small, large],
      [STICKY_MIN_SIZE_WORLD, 10],
      MAX_OBJECT_SIZE_WORLD,
    );
    // 5 would make the large rect 25,000 wide: the shared scale stops at 4.
    expect(scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 5_000, 9);
    expect(scale.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 5_000, 9);

    // The same scale is applied to every object, so the layout is unchanged.
    const from = rect(0, 0, 5_200, 5_000);
    const to = rect(0, 0, from.width * scale.x, from.height * scale.y);
    const smallAfter = scaleWithin(small, from, to);
    const largeAfter = scaleWithin(large, from, to);
    expect(largeAfter.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 6);
    expect(smallAfter.width).toBeCloseTo(400, 6);
    // Relative position and gap keep their ratio to the box.
    expect(smallAfter.x / to.width).toBeCloseTo(small.x / from.width, 9);
    expect(largeAfter.x - (smallAfter.x + smallAfter.width)).toBeCloseTo(100 * scale.x, 6);
    expect(largeAfter.y - smallAfter.y).toBeCloseTo(0, 6);
  });

  it("a free (non-uniform) resize clamps each axis on its own", () => {
    const note = rect(0, 0, 200, 400);
    const scale = clampScale({ x: 400, y: 0.01 }, [note], [50], MAX_OBJECT_SIZE_WORLD);
    expect(scale.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 200, 9);
    expect(scale.y).toBeCloseTo(50 / 400, 9);
  });

  it("unusable scales return 'no change' rather than NaN", () => {
    const note = rect(0, 0, 200, 200);
    expect(clampScale({ x: Number.NaN, y: 1 }, [note], [50], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
    expect(clampScale({ x: 2, y: 2 }, [], [], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 2, y: 2 });
  });
});

describe("sel.geometry_ops: scaleWithin (TC-04)", () => {
  it("TC-04 two 200-unit notes 100 apart, box twice as wide: 400 wide, gap 200", () => {
    const a = rect(0, 0, 200, 200);
    const b = rect(300, 0, 200, 200);
    const from = rect(0, 0, 500, 200);
    const to = rect(0, 0, 1_000, 400);

    const aAfter = scaleWithin(a, from, to);
    const bAfter = scaleWithin(b, from, to);

    expect(aAfter.width).toBeCloseTo(400, 6);
    expect(aAfter.height).toBeCloseTo(400, 6);
    expect(bAfter.width).toBeCloseTo(400, 6);
    expect(bAfter.height).toBeCloseTo(400, 6);
    expect(bAfter.x - (aAfter.x + aAfter.width)).toBeCloseTo(200, 6);
  });

  it("an unchanged box leaves every object exactly where it was", () => {
    const a = rect(120, -40, 200, 200);
    const from = rect(0, 0, 1_000, 500);
    expect(scaleWithin(a, from, from)).toEqual(a);
  });

  it("a degenerate box cannot be scaled (no division by zero)", () => {
    const a = rect(0, 0, 200, 200);
    expect(scaleWithin(a, rect(0, 0, 0, 200), rect(0, 0, 500, 500))).toEqual(a);
    expect(scaleWithin(a, rect(0, 0, 500, 500), rect(0, 0, 500, 500))).toEqual(a);
  });
});
