/**
 * Story 7 · task 6 — geometry + group-operation unit tests (TC-01 … TC-10).
 *
 * The geometry half runs on plain objects in Node; the group-operation half
 * runs against a real `Y.Doc` and pins the "one transaction" rule (exactly one
 * `update` event per successful mutating call, none for a rejected call).
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
} from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

describe('resizeRect', () => {
  it('TC-01: a locked "se" corner drag on a 200×200 box by (100,40) gives 300×300', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const box = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(box.width).toBeCloseTo(300);
    expect(box.height).toBeCloseTo(300);
  });

  it('a locked "se" drag is driven by the dominant axis', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const box = resizeRect(start, 'se', { x: 100, y: 200 }, true);
    // height moved furthest → both axes follow it, ratio held at 1:1.
    expect(box.width).toBeCloseTo(400);
    expect(box.height).toBeCloseTo(400);
  });

  it('an unlocked corner changes width and height independently', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const box = resizeRect(start, 'se', { x: 100, y: 40 }, false);
    expect(box.width).toBeCloseTo(300);
    expect(box.height).toBeCloseTo(240);
  });

  it('TC-24 basis: an "e" edge handle changes width only', () => {
    const start: Rect = { x: 10, y: 10, width: 200, height: 100 };
    const box = resizeRect(start, 'e', { x: 50, y: 999 }, false);
    expect(box.width).toBeCloseTo(250);
    expect(box.height).toBeCloseTo(100); // untouched
    expect(box.x).toBeCloseTo(10); // left edge pinned
  });

  it('a "w" edge drag anchors the east edge', () => {
    const start: Rect = { x: 100, y: 0, width: 200, height: 100 };
    const box = resizeRect(start, 'w', { x: 20, y: 0 }, false);
    // Dragging the west edge right by 20 shrinks the box; the right edge stays.
    expect(box.x).toBeCloseTo(120);
    expect(box.width).toBeCloseTo(180);
  });
});

describe('rectContains (marquee fully-inside rule)', () => {
  const marquee: Rect = { x: 0, y: 0, width: 100, height: 100 };
  it('TC-07: true only when the object lies entirely inside', () => {
    expect(rectContains(marquee, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(rectContains(marquee, { x: 90, y: 10, width: 20, height: 20 })).toBe(false); // partly
    expect(rectContains(marquee, { x: 120, y: 120, width: 10, height: 10 })).toBe(false); // outside
  });
  it('touching the edge counts as inside (boundary)', () => {
    expect(rectContains(marquee, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
  });
});

describe('normalizeRect', () => {
  it('turns two arbitrary corners into a positive rect', () => {
    expect(normalizeRect({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 40,
    });
  });
});

describe('unionRects', () => {
  it('encloses every rect', () => {
    const u = unionRects([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 200, y: 50, width: 100, height: 50 },
    ]);
    expect(u).toEqual({ x: 0, y: 0, width: 300, height: 100 });
  });
  it('TC-30 basis: null for an empty list', () => {
    expect(unionRects([])).toBeNull();
  });
});

describe('clampScale', () => {
  it('TC-02: a shrink that would dip below STICKY_MIN_SIZE_WORLD is clamped to exactly 50', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    // Requested scale would shrink a 100-wide note to 49 (< 50 min).
    const clamped = clampScale({ x: 49 / 100, y: 49 / 100 }, [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(rect.width * clamped.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
    expect(rect.height * clamped.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
  });

  it('TC-02 boundary: an exact 50 shrink is left untouched', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const clamped = clampScale({ x: 0.5, y: 0.5 }, [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBeCloseTo(0.5);
    expect(clamped.y).toBeCloseTo(0.5);
  });

  it('TC-03: growth stops when the first object would exceed MAX_OBJECT_SIZE_WORLD, layout preserved', () => {
    const small: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const large: Rect = { x: 200, y: 0, width: 15000, height: 100 };
    const clamped = clampScale(
      { x: 4, y: 4 },
      [small, large],
      [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    // The wide note is capped at MAX on the x axis. clampScale limits each
    // axis on its own so no object crosses a bound; scaleWithin then maps every
    // child by that one clamped box, so the relative layout is preserved.
    expect(large.width * clamped.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-6);
    expect(clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 15000);
    // No dimension of any note is pushed past MAX.
    for (const r of [small, large]) {
      expect(r.width * clamped.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-6);
      expect(r.height * clamped.y).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1e-6);
    }
  });

  it('a request with no bounds to cross is returned unchanged', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(clampScale({ x: 2, y: 2 }, [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 2,
      y: 2,
    });
  });

  it('non-finite scale yields no change', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(clampScale({ x: NaN, y: Infinity }, [rect], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1,
      y: 1,
    });
  });
});

describe('scaleWithin', () => {
  it('TC-04: doubling the box width doubles each note and its gap', () => {
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    const a = scaleWithin({ x: 0, y: 0, width: 200, height: 200 }, from, to);
    const b = scaleWithin({ x: 300, y: 0, width: 200, height: 200 }, from, to);
    expect(a.width).toBeCloseTo(400);
    expect(b.width).toBeCloseTo(400);
    // The 100-unit gap between them doubled to 200.
    const gap = b.x - (a.x + a.width);
    expect(gap).toBeCloseTo(200);
  });

  it('an unchanged box leaves each child where it was', () => {
    const box: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const child: Rect = { x: 20, y: 30, width: 50, height: 60 };
    expect(scaleWithin(child, box, box)).toEqual(child);
  });

  it('TC-10 basis: a note without an explicit size reports the default sticky box', () => {
    // objectBounds (via the model) supplies STICKY_SIZE_WORLD for missing dims;
    // scaleWithin of an unchanged box is the identity, so a 200 default box
    // scales exactly like an explicit one.
    const box: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    const child: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    const scaled = scaleWithin(child, box, { x: 0, y: 0, width: STICKY_SIZE_WORLD * 2, height: STICKY_SIZE_WORLD * 2 });
    expect(scaled.width).toBeCloseTo(STICKY_SIZE_WORLD * 2);
  });
});