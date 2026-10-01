// Selection geometry: resizeRect, clampScale, scaleWithin, rectContains,
// unionRects, normalizeRect (TC-01 through TC-04, TC-07).

import { describe, expect, it } from 'vitest';
import {
  anchorBox,
  HANDLES,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  clampScale,
  type Handle,
  type Point,
  type Rect,
} from '../../src/shared/geometry';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

/** The exact pipeline the transform gesture runs every frame. */
function applyResize(
  startBox: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
  rects: Rect[],
  minSizes: number[],
): Rect {
  const target = resizeRect(startBox, handle, delta, aspectLocked);
  const scale = clampScale(
    { x: target.width / startBox.width, y: target.height / startBox.height },
    rects,
    minSizes,
    MAX_OBJECT_SIZE_WORLD,
  );
  return anchorBox(startBox, handle, scale, aspectLocked);
}

describe('geometry', () => {
  // TC-01
  it('resizeRect grows a corner drag at the aspect-locked ratio (200x200 → 300x300)', () => {
    const start: Rect = { x: 10, y: 20, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    const out = resizeRect(start, 'se', { x: 100, y: 40 }, true);

    // the dominant axis decides: 300/200 = 1.5 beats 240/200 = 1.2
    expect(out.width).toBe(300);
    expect(out.height).toBe(300);
    // the opposite corner (the anchor) never moves
    expect(out.x).toBe(start.x);
    expect(out.y).toBe(start.y);
  });

  // TC-01, edge handle without the lock
  it('resizeRect with a corner and no lock follows both axes freely', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(resizeRect(start, 'se', { x: 100, y: 40 }, false)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 240,
    });
    expect(resizeRect(start, 'nw', { x: -10, y: 20 }, false)).toEqual({
      x: -10,
      y: 20,
      width: 210,
      height: 180,
    });
  });

  // TC-02
  it('a shrink below STICKY_MIN_SIZE_WORLD is clamped to exactly 50x50', () => {
    const box: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const rects = [{ x: 0, y: 0, width: 200, height: 200 }];

    // one unit under the minimum, dragging the locked corner in
    const under = applyResize(
      box,
      'se',
      { x: -(200 - STICKY_MIN_SIZE_WORLD) - 1, y: -(200 - STICKY_MIN_SIZE_WORLD) - 1 },
      true,
      rects,
      [STICKY_MIN_SIZE_WORLD],
    );
    expect(under.width).toBe(STICKY_MIN_SIZE_WORLD);
    expect(under.height).toBe(STICKY_MIN_SIZE_WORLD);
    // the anchor corner never moves
    expect(under.x).toBe(0);
    expect(under.y).toBe(0);

    // exactly the minimum
    const exact = applyResize(
      box,
      'se',
      { x: -(200 - STICKY_MIN_SIZE_WORLD), y: -(200 - STICKY_MIN_SIZE_WORLD) },
      true,
      rects,
      [STICKY_MIN_SIZE_WORLD],
    );
    expect(exact.width).toBe(STICKY_MIN_SIZE_WORLD);
    expect(exact.height).toBe(STICKY_MIN_SIZE_WORLD);
  });

  // TC-02, the other edges honour the same bound
  it('clamps the minimum on every axis, not just the dragged one', () => {
    const box: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const rects = [{ x: 100, y: 100, width: 200, height: 200 }];

    const north = applyResize(box, 'n', { x: 0, y: 170 }, false, rects, [STICKY_MIN_SIZE_WORLD]);
    expect(north.height).toBe(STICKY_MIN_SIZE_WORLD);
    // the bottom edge is the anchor
    expect(north.y + north.height).toBe(300);

    const west = applyResize(box, 'w', { x: 170, y: 0 }, false, rects, [STICKY_MIN_SIZE_WORLD]);
    expect(west.width).toBe(STICKY_MIN_SIZE_WORLD);
    expect(west.x + west.width).toBe(300);
  });

  // TC-03
  it('clampScale stops everything uniformly when the first object crosses MAX_OBJECT_SIZE_WORLD', () => {
    const big = { x: 0, y: 0, width: 8000, height: 100 };
    const small = { x: 0, y: 0, width: 4000, height: 100 };

    // the small object alone could grow x5; the big one may only reach x2.5
    const scale = clampScale({ x: 3, y: 1 }, [big, small], [50, 50], MAX_OBJECT_SIZE_WORLD);
    expect(scale.x).toBe(MAX_OBJECT_SIZE_WORLD / 8000);

    // and the single scale is applied to all, preserving relative layout
    const grown = scaleWithin(small, { x: 0, y: 0, width: 8000, height: 100 }, {
      x: 0,
      y: 0,
      width: 8000 * scale.x,
      height: 100,
    });
    expect(grown.width).toBe(4000 * (MAX_OBJECT_SIZE_WORLD / 8000));
    expect(grown.x).toBe(0);
  });

  // TC-03, the minimum bound works the same way
  it('clampScale raises the scale to the largest minimum any object needs', () => {
    const wide = { x: 0, y: 0, width: 1000, height: 100 };
    const thin = { x: 0, y: 0, width: 1000, height: 60 };

    const scale = clampScale(
      { x: 2, y: 0.5 },
      [wide, thin],
      [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(scale.x).toBe(2);
    // thin's height may not drop under 50: 50/60 beats 0.5
    expect(scale.y).toBe(STICKY_MIN_SIZE_WORLD / 60);
  });

  it('clampScale rejects non-finite input by keeping the scale at 1x1', () => {
    const rects = [{ x: 0, y: 0, width: 100, height: 100 }];
    expect(clampScale({ x: NaN, y: 2 }, rects, [50], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
  });

  // TC-04
  it('scaleWithin doubles both the gap and the object sizes, relative layout kept', () => {
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    const first = { x: 0, y: 0, width: 200, height: 200 };
    const second = { x: 300, y: 0, width: 200, height: 200 };

    const a = scaleWithin(first, from, to);
    const b = scaleWithin(second, from, to);

    // each note doubles, and so does the 100-unit gap between them
    expect(a).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(b).toEqual({ x: 600, y: 0, width: 400, height: 200 });
    expect(b.x - (a.x + a.width)).toBe(200);
  });

  it('scaleWithin returns the child unchanged for a degenerate or non-finite box', () => {
    const child: Rect = { x: 10, y: 10, width: 40, height: 40 };
    expect(scaleWithin(child, { x: 0, y: 0, width: 0, height: 100 }, { x: 0, y: 0, width: 50, height: 50 })).toEqual(
      child,
    );
    expect(
      scaleWithin(child, { x: 0, y: 0, width: 100, height: 100 }, {
        x: NaN,
        y: 0,
        width: 100,
        height: 100,
      }),
    ).toEqual(child);
  });

  // TC-07
  it('rectContains needs all four edges inside; touching from outside is not enough', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };

    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    // fully inside and touching the right edge exactly: still inside
    expect(rectContains(outer, { x: 50, y: 0, width: 50, height: 20 })).toBe(true);
    // one unit past an edge
    expect(rectContains(outer, { x: 10, y: 10, width: 100, height: 20 })).toBe(false);
    // touching the right edge from the outside, enclosing nothing
    expect(rectContains(outer, { x: 100, y: 10, width: 30, height: 10 })).toBe(false);
    // partially intersecting
    expect(rectContains(outer, { x: 90, y: 90, width: 30, height: 30 })).toBe(false);
    // non-finite is never a containment
    expect(rectContains(outer, { x: NaN, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects bounds many rects and survives the bad ones', () => {
    expect(unionRects([])).toBeNull();
    expect(
      unionRects([
        { x: 0, y: 0, width: 100, height: 50 },
        { x: 50, y: 100, width: 50, height: 50 },
      ]),
    ).toEqual({ x: 0, y: 0, width: 100, height: 150 });
    expect(
      unionRects([
        { x: NaN, y: 0, width: 100, height: 100 },
        { x: 10, y: 10, width: 10, height: 10 },
      ]),
    ).toEqual({ x: 10, y: 10, width: 10, height: 10 });
    expect(unionRects([{ x: 0, y: NaN, width: 10, height: 10 }])).toBeNull();
  });

  it('normalizeRect turns two corner points into a positive rect', () => {
    expect(normalizeRect({ x: 10, y: 40 }, { x: 60, y: 90 })).toEqual({ x: 10, y: 40, width: 50, height: 50 });
    expect(normalizeRect({ x: 60, y: 90 }, { x: 10, y: 40 })).toEqual({ x: 10, y: 40, width: 50, height: 50 });
    expect(normalizeRect({ x: 7, y: 9 }, { x: 7, y: 9 })).toEqual({ x: 7, y: 9, width: 0, height: 0 });
    expect(normalizeRect({ x: NaN, y: 1 }, { x: 2, y: 3 })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('every handle anchors the opposite side', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const d = { x: 10, y: 10 };
    for (const handle of HANDLES) {
      const out = resizeRect(start, handle, d, false);
      if (!handle.includes('w')) expect(out.x).toBe(start.x);
      if (!handle.includes('n')) expect(out.y).toBe(start.y);
      if (handle.includes('e')) expect(out.width).toBe(210);
      if (handle.includes('s')) expect(out.height).toBe(210);
      if (handle.includes('w')) expect(out.x).toBe(110);
      if (handle.includes('n')) expect(out.y).toBe(110);
    }
    expect(HANDLES).toHaveLength(8);
  });

  it('resizeRect keeps the start box when anything is non-finite', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(resizeRect(start, 'se', { x: NaN, y: 5 }, false)).toEqual(start);
    expect(resizeRect({ ...start, width: Infinity }, 'se', { x: 5, y: 5 }, true)).toEqual({
      ...start,
      width: Infinity,
    });
  });
});
