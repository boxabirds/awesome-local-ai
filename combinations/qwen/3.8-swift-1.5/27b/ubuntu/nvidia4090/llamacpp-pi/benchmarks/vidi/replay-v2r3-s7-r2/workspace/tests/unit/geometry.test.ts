import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  boxFromAnchor,
  type Rect,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

/**
 * Story 7, sel.geometry_ops: pure geometry (unit level).
 * TC-01 to TC-04 plus the supporting primitives (rectContains, unionRects,
 * normalizeRect, boxFromAnchor).
 */

describe('geometry.rectContains (fully-inside rule, sel.marquee)', () => {
  it('true when the inner rect lies entirely inside the outer', () => {
    const outer: Rect = { x: 50, y: 50, width: 300, height: 300 };
    const inner: Rect = { x: 100, y: 100, width: 200, height: 200 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('true when the inner rect touches the outer edges from inside', () => {
    const outer: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const inner: Rect = { x: 100, y: 100, width: 200, height: 200 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('false when the inner rect is only partly inside (negative)', () => {
    const outer: Rect = { x: 50, y: 50, width: 300, height: 300 };
    const inner: Rect = { x: 280, y: 100, width: 200, height: 200 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it('false when the inner rect touches the edge from outside (negative)', () => {
    const outer: Rect = { x: 50, y: 50, width: 300, height: 300 };
    // Right edge of inner at 350 == right edge of outer, body outside.
    const inner: Rect = { x: 350, y: 100, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it('false when the inner rect is outside', () => {
    const outer: Rect = { x: 50, y: 50, width: 300, height: 300 };
    const inner: Rect = { x: 600, y: 100, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(false);
  });
});

describe('geometry.unionRects', () => {
  it('null for an empty list', () => {
    expect(unionRects([])).toBeNull();
  });

  it('single rect → that rect', () => {
    const r: Rect = { x: 1, y: 2, width: 3, height: 4 };
    expect(unionRects([r])).toEqual(r);
  });

  it('multiple rects → bounding box', () => {
    const rects: Rect[] = [
      { x: 10, y: 20, width: 100, height: 50 },
      { x: 60, y: -10, width: 80, height: 90 },
      { x: -30, y: 40, width: 40, height: 20 },
    ];
    // x: -30..110 → 170; y: -10..80 → 90.
    expect(unionRects(rects)).toEqual({ x: -30, y: -10, width: 170, height: 90 });
  });
});

describe('geometry.normalizeRect', () => {
  it('orders two arbitrary points into a positive rect', () => {
    expect(normalizeRect({ x: 100, y: 50 }, { x: 30, y: 90 })).toEqual({
      x: 30,
      y: 50,
      width: 70,
      height: 40,
    });
  });

  it('identical points → zero-size rect', () => {
    expect(normalizeRect({ x: 5, y: 6 }, { x: 5, y: 6 })).toEqual({
      x: 5,
      y: 6,
      width: 0,
      height: 0,
    });
  });
});

describe('geometry.resizeRect (sel.resize, sel.aspect)', () => {
  // TC-01
  it('TC-01: se handle, aspectLocked, 200×200 + (100,40) → 300×300', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(resizeRect(start, 'se', { x: 100, y: 40 }, true)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
  });

  it('corner handle without aspect lock changes both axes independently', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
    expect(resizeRect(start, 'se', { x: 50, y: -25 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 250,
      height: 75,
    });
  });

  it('edge handle changes one axis only', () => {
    const start: Rect = { x: 10, y: 20, width: 100, height: 50 };
    // East: width grows, height unchanged, x unchanged.
    expect(resizeRect(start, 'e', { x: 30, y: 15 }, false)).toEqual({
      x: 10,
      y: 20,
      width: 130,
      height: 50,
    });
    // West: x moves, width shrinks.
    expect(resizeRect(start, 'w', { x: 20, y: -5 }, false)).toEqual({
      x: 30,
      y: 20,
      width: 80,
      height: 50,
    });
    // North: y moves, height shrinks.
    expect(resizeRect(start, 'n', { x: -5, y: 10 }, false)).toEqual({
      x: 10,
      y: 30,
      width: 100,
      height: 40,
    });
    // South: height grows.
    expect(resizeRect(start, 's', { x: 15, y: 20 }, false)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 70,
    });
  });

  it('aspect-locked corner handles anchor on the opposite corner', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 100 };
    // nw: opposite (se) corner stays at (300, 200); the x-axis drives the
    // factor: (200 + 50) / 200 = 1.25 → 250×125 anchored on (300, 200).
    expect(resizeRect(start, 'nw', { x: -50, y: 40 }, true)).toEqual({
      x: 50,
      y: 75,
      width: 250,
      height: 125,
    });
  });
});

describe('geometry.clampScale (sel.size_limits)', () => {
  // TC-02 (boundary: STICKY_MIN_SIZE_WORLD − 1 and exact)
  it('TC-02: shrinking below STICKY_MIN_SIZE_WORLD clamps to exactly 50×50', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
    // Proposed shrink to 49 (below the 50 minimum) → clamped to 50.
    let s = clampScale({ x: 49 / 200, y: 49 / 200 }, rects, [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(200 * s.x).toBe(STICKY_MIN_SIZE_WORLD);
    expect(200 * s.y).toBe(STICKY_MIN_SIZE_WORLD);
    // Proposed shrink to exactly 50 → unchanged.
    s = clampScale({ x: 50 / 200, y: 50 / 200 }, rects, [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(200 * s.x).toBe(STICKY_MIN_SIZE_WORLD);
    expect(200 * s.y).toBe(STICKY_MIN_SIZE_WORLD);
  });

  // TC-03 (mixed sizes: stops uniformly when the first object hits the max)
  it('TC-03: growth stops uniformly when the first object reaches MAX_OBJECT_SIZE_WORLD', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 500, height: 500 },
    ];
    const s = clampScale({ x: 100, y: 100 }, rects, [10, 10], MAX_OBJECT_SIZE_WORLD);
    // The 500-unit object hits the max first: scale = 20000/500 = 40.
    expect(s.x).toBe(40);
    expect(s.y).toBe(40);
    // Relative layout preserved: one uniform scale for the whole selection.
    expect(100 * s.x).toBe(4000);
    expect(500 * s.x).toBe(MAX_OBJECT_SIZE_WORLD);
  });

  it('a scale within the limits is unchanged', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
    const s = clampScale({ x: 1.5, y: 1.5 }, rects, [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(s).toEqual({ x: 1.5, y: 1.5 });
  });

  it('growth is clamped independently per axis', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 100, height: 4000 }];
    const s = clampScale({ x: 100, y: 100 }, rects, [10, 10], MAX_OBJECT_SIZE_WORLD);
    expect(100 * s.x).toBe(10000); // x under the max → unchanged
    expect(4000 * s.y).toBe(MAX_OBJECT_SIZE_WORLD); // y clamped by the 4000-tall
  });
});

describe('geometry.scaleWithin (sel.resize verification)', () => {
  // TC-04: two 200-unit notes 100 apart, box width ×2 → 400 wide, gap 200.
  it('TC-04: box width ×2 doubles each note width and the gap', () => {
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    const noteA = scaleWithin({ x: 0, y: 0, width: 200, height: 200 }, from, to);
    const noteB = scaleWithin({ x: 300, y: 0, width: 200, height: 200 }, from, to);
    expect(noteA).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(noteB).toEqual({ x: 600, y: 0, width: 400, height: 200 });
    // The 100-unit gap becomes 200.
    expect(noteB.x - (noteA.x + noteA.width)).toBe(200);
  });

  it('scales from an offset box to a moved+grown box', () => {
    const from: Rect = { x: 10, y: 20, width: 100, height: 50 };
    const to: Rect = { x: 30, y: 40, width: 200, height: 100 };
    const child = scaleWithin({ x: 10, y: 20, width: 50, height: 25 }, from, to);
    expect(child).toEqual({ x: 30, y: 40, width: 100, height: 50 });
  });
});

describe('geometry.boxFromAnchor (consistent with resizeRect)', () => {
  it('rebuilds the aspect-locked resize result from the anchor and a scale', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 100 };
    // se: anchor (100,100)
    expect(boxFromAnchor(start, 'se', 250, 125)).toEqual({ x: 100, y: 100, width: 250, height: 125 });
    // nw: anchor (300,200)
    expect(boxFromAnchor(start, 'nw', 250, 125)).toEqual({ x: 50, y: 75, width: 250, height: 125 });
    // e: anchor is the middle of the west edge (100, 150)
    expect(boxFromAnchor(start, 'e', 250, 125)).toEqual({ x: 100, y: 87.5, width: 250, height: 125 });
    // n: anchor is the middle of the south edge (200, 200)
    expect(boxFromAnchor(start, 'n', 250, 125)).toEqual({ x: 75, y: 75, width: 250, height: 125 });
  });
});
