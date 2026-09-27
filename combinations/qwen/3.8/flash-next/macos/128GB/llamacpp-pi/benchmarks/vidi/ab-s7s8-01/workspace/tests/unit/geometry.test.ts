// Story 7 — pure geometry (sel.geometry_ops). Unit level: no DOM, no React.
// TC-01 to TC-04 live here; TC-02's clamping is split between `resizeRect`
// (the requested rect) and `clampScale` (where the selection stops).

import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  anchorRect,
  clampScale,
  scaleWithin,
  HANDLES,
  HANDLE_LABELS,
  type Rect,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

function scaled(start: Rect, handle: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw', delta: { x: number; y: number }, aspect: boolean, minSizes: number[], rects: Rect[]): Rect {
  const target = resizeRect(start, handle, delta, aspect);
  const scale = clampScale(
    { x: target.width / start.width, y: target.height / start.height },
    rects,
    minSizes,
    MAX_OBJECT_SIZE_WORLD,
  );
  return anchorRect(start, handle, start.width * scale.x, start.height * scale.y);
}

describe('rectContains (marquee containment)', () => {
  it('TC-07a a rect fully inside another contains it', () => {
    expect(rectContains(r(0, 0, 100, 100), r(10, 10, 20, 20))).toBe(true);
  });

  it('TC-07b touching the outer edges still counts as inside', () => {
    expect(rectContains(r(0, 0, 100, 100), r(0, 0, 100, 100))).toBe(true);
  });

  it('TC-07c a partly-covered rect is NOT contained (negative)', () => {
    expect(rectContains(r(0, 0, 100, 100), r(90, 0, 100, 100))).toBe(false);
    expect(rectContains(r(0, 0, 100, 100), r(-1, 0, 10, 10))).toBe(false);
  });

  it('a rect with non-finite numbers is never contained (error path)', () => {
    expect(rectContains(r(0, 0, 100, 100), r(NaN, 0, 10, 10))).toBe(false);
    expect(rectContains(r(0, 0, Infinity, 100), r(1, 1, 2, 2))).toBe(false);
  });
});

describe('unionRects / normalizeRect', () => {
  it('unionRects of nothing is null (no box, no handles)', () => {
    expect(unionRects([])).toBeNull();
  });

  it('unionRects of one rect is that rect', () => {
    expect(unionRects([r(5, 6, 7, 8)])).toEqual(r(5, 6, 7, 8));
  });

  it('unionRects spans several rects', () => {
    expect(unionRects([r(0, 0, 200, 200), r(300, 100, 200, 200)])).toEqual(r(0, 0, 500, 300));
  });

  it('normalizeRect normalises a reversed drag', () => {
    expect(normalizeRect({ x: 100, y: 80 }, { x: 20, y: 10 })).toEqual(r(20, 10, 80, 70));
  });

  it('normalizeRect of a zero drag has zero size', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual(r(5, 5, 0, 0));
  });
});

describe('resizeRect', () => {
  it('TC-01 corner handle with aspectLocked: 200×200 + (100,40) → 300×300', () => {
    expect(resizeRect(r(0, 0, 200, 200), 'se', { x: 100, y: 40 }, true)).toEqual(r(0, 0, 300, 300));
  });

  it('corner handle without aspect lock scales the axes independently', () => {
    expect(resizeRect(r(0, 0, 200, 200), 'se', { x: 100, y: 40 }, false)).toEqual(r(0, 0, 300, 240));
  });

  it('top-left handle keeps the BOTTOM-RIGHT corner fixed', () => {
    const out = resizeRect(r(100, 100, 200, 200), 'nw', { x: 20, y: -10 }, false);
    expect(out.width).toBeCloseTo(180);
    expect(out.height).toBeCloseTo(210);
    expect(out.x).toBeCloseTo(120);
    expect(out.y).toBeCloseTo(90);
    expect(out.x + out.width).toBeCloseTo(300);
    expect(out.y + out.height).toBeCloseTo(300);
  });

  it('edge handles resize in ONE direction only', () => {
    expect(resizeRect(r(0, 0, 200, 100), 'e', { x: 50, y: 0 }, false)).toEqual(r(0, 0, 250, 100));
    expect(resizeRect(r(0, 0, 200, 100), 'w', { x: 50, y: 0 }, false)).toEqual(r(50, 0, 150, 100));
    expect(resizeRect(r(0, 0, 200, 100), 's', { x: 0, y: -20 }, false)).toEqual(r(0, 0, 200, 80));
    const n = resizeRect(r(0, 0, 200, 100), 'n', { x: 0, y: 20 }, false);
    expect(n).toEqual(r(0, 20, 200, 80));
  });

  it('an edge handle with aspect lock grows BOTH dimensions from one axis', () => {
    // 200×100 dragged +100 wide with the ratio locked → 300×150.
    expect(resizeRect(r(0, 0, 200, 100), 'e', { x: 100, y: 0 }, true)).toEqual(r(0, 0, 300, 150));
  });

  it('a non-finite delta leaves the rect unchanged (error path)', () => {
    expect(resizeRect(r(0, 0, 200, 200), 'se', { x: NaN, y: 0 }, false)).toEqual(r(0, 0, 200, 200));
    expect(resizeRect(r(0, 0, 200, 200), 'se', { x: Infinity, y: 0 }, true)).toEqual(r(0, 0, 200, 200));
  });

  it('TC-02 shrinking a 200-unit sticky past the minimum asks for less than 50', () => {
    const start = r(0, 0, 200, 200);
    expect(resizeRect(start, 'se', { x: -151, y: -151 }, true)).toEqual(r(0, 0, 49, 49));
  });

  it('TC-02 …and the clamp stops it at exactly STICKY_MIN_SIZE_WORLD (boundary)', () => {
    const start = r(0, 0, 200, 200);
    const rects = [start];
    // One world unit below the minimum.
    expect(scaled(start, 'se', { x: -151, y: -151 }, true, [STICKY_MIN_SIZE_WORLD], rects)).toEqual({
      x: 0,
      y: 0,
      width: STICKY_MIN_SIZE_WORLD,
      height: STICKY_MIN_SIZE_WORLD,
    });
    // Exactly the minimum is allowed.
    expect(scaled(start, 'se', { x: -150, y: -150 }, true, [STICKY_MIN_SIZE_WORLD], rects)).toEqual({
      x: 0,
      y: 0,
      width: STICKY_MIN_SIZE_WORLD,
      height: STICKY_MIN_SIZE_WORLD,
    });
    // Shrinking from the top-left (a drag toward the box's interior) clamps the
    // same way, and keeps the BOTTOM-RIGHT corner anchored.
    const clamped = scaled(start, 'nw', { x: 151, y: 151 }, true, [STICKY_MIN_SIZE_WORLD], rects);
    expect(clamped.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
    expect(clamped.x + clamped.width).toBeCloseTo(200);
    expect(clamped.y + clamped.height).toBeCloseTo(200);
  });
});

describe('clampScale', () => {
  it('TC-03 the whole selection stops when the FIRST object hits MAX_OBJECT_SIZE_WORLD', () => {
    const rects = [r(0, 0, 1000, 1000), r(2000, 0, 100, 100)];
    const out = clampScale({ x: 25, y: 25 }, rects, [50, 10], MAX_OBJECT_SIZE_WORLD);
    // 1000 × 20 = 20000 (the limit); 100 × 20 = 2000 (well below its own limit).
    expect(out.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 1000);
    expect(out.y).toBeCloseTo(out.x);
    // Uniform: the requested layout is preserved, nothing warps.
    expect(out.x).toBe(out.y);
  });

  it('TC-03b per-axis clamping keeps a non-locked selection free on one axis', () => {
    const rects = [r(0, 0, 1000, 1000)];
    const out = clampScale({ x: 2, y: 20 }, rects, [50], MAX_OBJECT_SIZE_WORLD);
    expect(out.x).toBeCloseTo(2);
    expect(out.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 1000);
  });

  it('a scale that would shrink an object below its minimum is lifted to it', () => {
    const out = clampScale({ x: 0.1, y: 0.1 }, [r(0, 0, 200, 200)], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(out.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200);
    expect(out.y).toBeCloseTo(out.x);
  });

  it('a non-finite or non-positive scale means "no change"', () => {
    expect(clampScale({ x: NaN, y: 1 }, [r(0, 0, 10, 10)], [1], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
    expect(clampScale({ x: 1, y: 0 }, [r(0, 0, 10, 10)], [1], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 1, y: 1 });
    expect(clampScale({ x: 2, y: 2 }, [], [], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 2, y: 2 });
  });
});

describe('scaleWithin', () => {
  it('TC-04 doubling the box width doubles sizes AND gaps', () => {
    const from = r(0, 0, 500, 200); // two 200-wide notes, 100 apart
    const to = r(0, 0, 1000, 200);
    const a = scaleWithin(r(0, 0, 200, 200), from, to);
    const b = scaleWithin(r(300, 0, 200, 200), from, to);
    expect(a.width).toBeCloseTo(400);
    expect(b.width).toBeCloseTo(400);
    expect(a.x).toBeCloseTo(0);
    expect(b.x).toBeCloseTo(600);
    expect(b.x - (a.x + a.width)).toBeCloseTo(200); // the gap doubled too
    // Heights were not part of the request.
    expect(a.height).toBeCloseTo(200);
    expect(b.height).toBeCloseTo(200);
  });

  it('scaling down moves objects toward the anchor', () => {
    const out = scaleWithin(r(300, 0, 200, 200), r(0, 0, 500, 200), r(0, 0, 250, 200));
    expect(out.x).toBeCloseTo(150);
    expect(out.width).toBeCloseTo(100);
  });

  it('a degenerate source box returns the child unchanged (error path)', () => {
    expect(scaleWithin(r(1, 2, 3, 4), r(0, 0, 0, 10), r(0, 0, 100, 100))).toEqual(r(1, 2, 3, 4));
  });
});

describe('handle names', () => {
  it('all eight handles exist and every one has an accessible name', () => {
    expect([...HANDLES].sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    for (const h of HANDLES) expect(HANDLE_LABELS[h]).toMatch(/^Resize /);
    expect(HANDLE_LABELS.nw).toBe('Resize top-left');
    expect(HANDLE_LABELS.se).toBe('Resize bottom-right');
  });
});
