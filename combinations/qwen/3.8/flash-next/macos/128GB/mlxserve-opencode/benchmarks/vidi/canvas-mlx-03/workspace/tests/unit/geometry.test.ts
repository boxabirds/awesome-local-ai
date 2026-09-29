// Story 7, contract `sel.geometry_ops` — unit tests TC-01..TC-04 (plus the
// containment / union helpers the marquee and bounding box are built from).
// Pure maths in, pure maths out: no DOM, no Yjs.

import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  HANDLES,
  HANDLE_LABELS,
  type Rect,
  type Handle,
} from '../../src/shared/geometry.ts';
import {
  STICKY_MIN_SIZE_WORLD,
  MAX_OBJECT_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config.ts';

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe('geometry.rect', () => {
  it('rectContains is an extent test: inside true, touching true, partly false, outside false', () => {
    const box = r(0, 0, 100, 100);
    expect(rectContains(box, r(10, 10, 20, 20))).toBe(true);
    expect(rectContains(box, r(0, 0, 100, 100))).toBe(true); // same box counts as inside
    expect(rectContains(box, r(90, 90, 20, 20))).toBe(false); // hangs over
    expect(rectContains(box, r(-1, 0, 10, 10))).toBe(false);
    expect(rectContains(box, r(200, 200, 10, 10))).toBe(false);
  });

  it('rectContains rejects non-finite input', () => {
    expect(rectContains(r(0, 0, 100, 100), r(NaN, 0, 10, 10))).toBe(false);
    expect(rectContains(r(0, 0, 100, 100), r(0, 0, Infinity, 10))).toBe(false);
  });

  it('unionRects is the bounding box of the list and null when there is nothing to bound', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([r(10, 20, 30, 40)])).toEqual(r(10, 20, 30, 40));
    expect(unionRects([r(0, 0, 10, 10), r(30, 40, 10, 10)])).toEqual(r(0, 0, 40, 50));
  });

  it('normalizeRect turns two opposite corners into a positive rect in any drag direction', () => {
    expect(normalizeRect({ x: 0, y: 0 }, { x: 40, y: 30 })).toEqual(r(0, 0, 40, 30));
    expect(normalizeRect({ x: 40, y: 30 }, { x: 0, y: 0 })).toEqual(r(0, 0, 40, 30));
    expect(normalizeRect({ x: -10, y: 5 }, { x: -30, y: -25 })).toEqual(r(-30, -25, 20, 30));
  });
});

describe('geometry.resize', () => {
  it('TC-01 resizeRect from the bottom-right corner of a 200x200 box, aspect locked, +100/+40 → 300x300', () => {
    const start = r(0, 0, 200, 200);
    const got = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(got.width).toBeCloseTo(300, 6);
    expect(got.height).toBeCloseTo(300, 6);
    // The opposite corner (the top-left) is the anchor and never moves.
    expect(got.x).toBeCloseTo(0, 6);
    expect(got.y).toBeCloseTo(0, 6);
  });

  it('resizeRect without the aspect lock changes only what the handle touches', () => {
    const start = r(0, 0, 200, 200);
    // Right edge: width only.
    expect(resizeRect(start, 'e', { x: 100, y: 77 }, false)).toEqual(r(0, 0, 300, 200));
    // Top edge: height only, the bottom edge stays put.
    expect(resizeRect(start, 'n', { x: 77, y: -50 }, false)).toEqual(r(0, 200 - 250, 200, 250));
    // Top-left corner: both axes, the bottom-right corner stays put.
    expect(resizeRect(start, 'nw', { x: -20, y: 20 }, false)).toEqual(r(-20, 20, 220, 180));
  });

  it('resizeRect returns the start box for non-finite input (error path)', () => {
    const start = r(1, 2, 200, 100);
    expect(resizeRect(start, 'se', { x: NaN, y: 5 }, true)).toEqual(start);
    expect(resizeRect(r(0, 0, NaN, 10), 'e', { x: 5, y: 5 }, false)).toEqual(r(0, 0, NaN, 10));
  });

  it('TC-02 shrinking a sticky below its minimum stops exactly at STICKY_MIN_SIZE_WORLD (boundary)', () => {
    const start = r(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD);
    const minScale = STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD;

    // One board unit below the minimum: requested 199x199 of 200 → clamped to 50x50.
    const tooSmall = resizeRect(start, 'se', { x: -(STICKY_SIZE_WORLD - STICKY_MIN_SIZE_WORLD + 1), y: 0 }, true);
    expect(tooSmall.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD - 1, 6);
    const clamped = clampScale(
      { x: tooSmall.width / start.width, y: tooSmall.height / start.height },
      [start],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    const box = {
      x: start.x,
      y: start.y,
      width: start.width * clamped.x,
      height: start.height * clamped.y,
    };
    expect(box.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(box.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(clamped.x).toBeCloseTo(minScale, 6);

    // Exactly the minimum is allowed, not pushed further in.
    const exact = clampScale(
      { x: minScale, y: minScale },
      [start],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(start.width * exact.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(start.height * exact.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
  });

  it('TC-03 clampScale stops the whole selection at the first limit and keeps the layout', () => {
    // A wide box and a tall box, both 10 units minimum: a uniform x3 request is
    // only legal up to x2 (20 000 / 10 000), so everything stops at x2.
    const wide = r(0, 0, 10_000, 100);
    const tall = r(0, 100, 100, 10_000);
    const scale = clampScale(
      { x: 3, y: 3 },
      [wide, tall],
      [10, 10],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(scale.x).toBeCloseTo(2, 6);
    expect(scale.y).toBeCloseTo(2, 6);

    // One uniform scale applied to every object: relative layout preserved.
    const from = unionRects([wide, tall])!;
    const to = r(from.x, from.y, from.width * scale.x, from.height * scale.y);
    const a = scaleWithin(wide, from, to);
    const b = scaleWithin(tall, from, to);
    expect(a.width).toBeCloseTo(20_000, 6);
    expect(b.height).toBeCloseTo(20_000, 6);
    expect(a.x).toBeCloseTo(from.x, 6);
    expect(b.y).toBeCloseTo(100 * scale.y, 6); // positions scale from the same anchor

    // A non-uniform request is clamped per axis, and the clamped axis stops for
    // every object (nothing may cross MAX_OBJECT_SIZE_WORLD).
    const perAxis = clampScale({ x: 1.5, y: 1 }, [r(0, 0, 200, 200), r(0, 0, 20_000, 10)], [50, 10], MAX_OBJECT_SIZE_WORLD);
    expect(perAxis.x).toBeCloseTo(1, 6); // 20 000 * 1.5 would be over the limit
    expect(perAxis.y).toBeCloseTo(1, 6);
  });

  it('clampScale applies the most restrictive object limit to the whole group', () => {
    const a = r(0, 0, 200, 200); // min 50 → may not go under x0.25
    const b = r(300, 0, 60, 40); // min 10 → may not go under x0.1667 on width
    const s = clampScale({ x: 0.1, y: 0.1 }, [a, b], [50, 10], MAX_OBJECT_SIZE_WORLD);
    // The whole selection stops at the first object's limit, so nothing stops
    // mid-way and the layout cannot distort.
    expect(s.x).toBeCloseTo(0.25, 6);
    expect(s.y).toBeCloseTo(0.25, 6);
    expect(a.width * s.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(b.width * s.x).toBeCloseTo(15, 6);
  });

  it('clampScale returns the neutral scale for a non-finite request (error path)', () => {
    expect(clampScale({ x: NaN, y: 2 }, [r(0, 0, 10, 10)], [1], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1,
      y: 1,
    });
    expect(clampScale({ x: 2, y: Infinity }, [r(0, 0, 10, 10)], [1], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 1,
      y: 1,
    });
    // An unusable rect is simply not clamped by: the request passes through.
    expect(clampScale({ x: 2, y: 2 }, [r(0, 0, Infinity, 10)], [1], MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 2,
      y: 2,
    });
  });

  it('TC-04 two 200-unit notes 100 apart, box width x2 → each 400 wide with a 200 gap', () => {
    const a = r(0, 0, 200, 200);
    const b = r(300, 0, 200, 200); // a ends at 200, b starts at 300 → 100 apart
    const from = unionRects([a, b])!;
    expect(from).toEqual(r(0, 0, 500, 200));
    const to = r(from.x, from.y, from.width * 2, from.height);
    const ra = scaleWithin(a, from, to);
    const rb = scaleWithin(b, from, to);
    expect(ra.width).toBeCloseTo(400, 6);
    expect(rb.width).toBeCloseTo(400, 6);
    expect(rb.x - (ra.x + ra.width)).toBeCloseTo(200, 6);
    // Untouched axis keeps its sizes.
    expect(ra.height).toBeCloseTo(200, 6);
    expect(ra.y).toBeCloseTo(0, 6);
  });

  it('scaleWithin keeps the child where it is for a zero-sized source box (error path)', () => {
    const child = r(10, 10, 20, 20);
    expect(scaleWithin(child, r(0, 0, 0, 0), r(0, 0, 100, 100))).toEqual(child);
  });

  it('every handle has a screen-reader label and a cursor', () => {
    expect([...HANDLES].sort()).toEqual(
      ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'].sort(),
    );
    for (const h of HANDLES as readonly Handle[]) {
      expect(typeof HANDLE_LABELS[h]).toBe('string');
      expect(HANDLE_LABELS[h].length).toBeGreaterThan(0);
    }
    expect(HANDLE_LABELS.nw).toBe('top-left');
    expect(HANDLE_LABELS.e).toBe('right');
  });
});
