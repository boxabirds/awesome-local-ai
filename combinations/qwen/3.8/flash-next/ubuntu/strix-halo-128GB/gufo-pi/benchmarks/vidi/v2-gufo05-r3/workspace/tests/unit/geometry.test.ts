import { describe, expect, it } from 'vitest';
import {
  applyResizeScale,
  clampScale,
  HANDLE_LABELS,
  normalizeRect,
  rectContains,
  resizeAnchor,
  resizeRect,
  resizeScale,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

describe('geometry: containment and unions', () => {
  it('rectContains is true only when all four edges lie inside', () => {
    const box = rect(0, 0, 100, 100);
    expect(rectContains(box, rect(10, 10, 20, 20))).toBe(true);
    // Touching the edge from the inside still counts as inside.
    expect(rectContains(box, rect(0, 0, 100, 100))).toBe(true);
    // Partly outside, in each direction.
    expect(rectContains(box, rect(90, 10, 20, 20))).toBe(false);
    expect(rectContains(box, rect(10, -1, 20, 20))).toBe(false);
    // Merely touching the edge from outside is NOT inside (PRD sel.marquee).
    expect(rectContains(box, rect(100, 0, 20, 20))).toBe(false);
    expect(rectContains(box, rect(-20, 0, 20, 20))).toBe(false);
    // Invalid input never throws.
    expect(rectContains(box, rect(Number.NaN, 0, 10, 10))).toBe(false);
  });

  it('unionRects spans every rectangle and is null for an empty list', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([rect(-10, 5, 20, 20), rect(100, -40, 50, 10)])).toEqual(
      rect(-10, -40, 160, 65),
    );
    // Non-finite rectangles are skipped rather than poisoning the result.
    expect(
      unionRects([rect(0, 0, 10, 10), rect(Number.NaN, 0, 10, 10)]),
    ).toEqual(rect(0, 0, 10, 10));
    expect(unionRects([rect(Number.NaN, 0, 10, 10)])).toBeNull();
  });

  it('normalizeRect turns two drag points into a box, in any corner order', () => {
    expect(normalizeRect({ x: 0, y: 0 }, { x: 40, y: -30 })).toEqual(rect(0, -30, 40, 30));
    expect(normalizeRect({ x: 40, y: -30 }, { x: 0, y: 0 })).toEqual(rect(0, -30, 40, 30));
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual(rect(5, 5, 0, 0));
  });
});

describe('geometry: resizeRect (TC-01)', () => {
  const start = rect(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD);

  it('TC-01 a corner handle with the aspect locked keeps the ratio', () => {
    expect(resizeRect(start, 'se', { x: 100, y: 40 }, true)).toEqual(
      rect(0, 0, 300, 300),
    );
  });

  it('a corner handle without the aspect lock scales each axis on its own', () => {
    expect(resizeRect(start, 'se', { x: 100, y: 40 }, false)).toEqual(
      rect(0, 0, 300, 240),
    );
  });

  it('the anchor is the opposite corner, so nw grows up and left from a fixed bottom-right', () => {
    const box = rect(100, 100, 200, 200);
    expect(resizeAnchor(box, 'nw')).toEqual({ x: 300, y: 300 });
    expect(resizeRect(box, 'nw', { x: -50, y: -50 }, false)).toEqual(
      rect(50, 50, 250, 250),
    );
    expect(resizeRect(box, 'se', { x: -50, y: 20 }, false)).toEqual(
      rect(100, 100, 150, 220),
    );
  });

  it('an edge handle changes one axis, or both about the middle when locked', () => {
    const box = rect(0, 0, 200, 100);
    // Right edge: width only.
    expect(resizeRect(box, 'e', { x: 200, y: 0 }, false)).toEqual(rect(0, 0, 400, 100));
    // Right edge with the ratio locked: the height follows, centred.
    expect(resizeRect(box, 'e', { x: 200, y: 0 }, true)).toEqual(rect(0, -50, 400, 200));
    // Bottom edge: height only.
    expect(resizeRect(box, 's', { x: 0, y: 100 }, false)).toEqual(rect(0, 0, 200, 200));
    // Bottom edge with the ratio locked: the width follows, centred.
    expect(resizeRect(box, 's', { x: 0, y: 100 }, true)).toEqual(rect(-100, 0, 400, 200));
    // The top edge grows upwards from a fixed bottom edge.
    expect(resizeRect(box, 'n', { x: 0, y: -50 }, false)).toEqual(rect(0, -50, 200, 150));
    expect(resizeRect(box, 'n', { x: 0, y: 40 }, false)).toEqual(rect(0, 40, 200, 60));
  });

  it('invalid input leaves the box alone instead of throwing', () => {
    expect(resizeRect(rect(0, 0, 0, 100), 'se', { x: 10, y: 10 }, false)).toEqual(
      rect(0, 0, 0, 100),
    );
    expect(resizeRect(start, 'se', { x: Number.NaN, y: 10 }, true)).toEqual(start);
  });

  it('applyResizeScale and resizeScale describe the same resize as resizeRect', () => {
    const scale = resizeScale(start, 'nw', { x: -60, y: -20 }, false);
    expect(scale).toEqual({ x: 1.3, y: 1.1 });
    const scaled = applyResizeScale(start, 'nw', scale);
    const direct = resizeRect(start, 'nw', { x: -60, y: -20 }, false);
    expect(scaled.x).toBeCloseTo(direct.x, 6);
    expect(scaled.y).toBeCloseTo(direct.y, 6);
    expect(scaled.width).toBeCloseTo(direct.width, 6);
    expect(scaled.height).toBeCloseTo(direct.height, 6);
  });

  it('a plain resize never flips the box past the opposite edge', () => {
    const box = rect(100, 100, 200, 200);
    // Dragging the left edge 500 units to the right stops at the right edge.
    expect(resizeRect(box, 'w', { x: 500, y: 0 }, false)).toEqual(rect(300, 100, 0, 200));
    expect(resizeRect(box, 'n', { x: 0, y: 500 }, false)).toEqual(rect(100, 300, 200, 0));
  });
});

describe('geometry: size limits (TC-02, TC-03)', () => {
  const note = rect(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD);

  it('TC-02 shrinking one unit below the minimum stops at the minimum', () => {
    // 200 -> 49 world units is a scale of 0.245; the floor is 50/200 = 0.25.
    const tooSmall = STICKY_MIN_SIZE_WORLD - 1;
    const asked = tooSmall / STICKY_SIZE_WORLD;
    const clamped = clampScale(
      { x: asked, y: asked },
      [note],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    const box = applyResizeScale(note, 'se', clamped);
    expect([box.width, box.height]).toEqual([STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD]);

    // Exactly the minimum is allowed through unchanged (boundary).
    const exact = clampScale(
      { x: 0.25, y: 0.25 },
      [note],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(exact).toEqual({ x: 0.25, y: 0.25 });
  });

  it('a box already smaller than the minimum cannot be shrunk further, nor grown by the clamp', () => {
    const tiny = rect(0, 0, 40, 40);
    expect(
      clampScale({ x: 0.5, y: 0.5 }, [tiny], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD),
    ).toEqual({ x: 1, y: 1 });
    expect(
      clampScale({ x: 2, y: 2 }, [tiny], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD),
    ).toEqual({ x: 2, y: 2 });
  });

  it('TC-03 growth stops for the whole selection when the first object reaches the maximum', () => {
    // The 5,000-wide object reaches MAX_OBJECT_SIZE_WORLD at a scale of 4.
    const rects = [rect(0, 0, 5_000, 100), rect(6_000, 200, 100, 50)];
    const minSizes = [STICKY_MIN_SIZE_WORLD, 10];
    const clamped = clampScale({ x: 5, y: 5 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped).toEqual({ x: 4, y: 4 });

    // Relative layout survives: the same scale is applied to every object and
    // nothing is past either limit.
    const scaled = rects.map((r) => ({
      ...r,
      width: r.width * clamped.x,
      height: r.height * clamped.y,
    }));
    expect(scaled.map((r) => r.width)).toEqual([20_000, 400]);
    for (const r of scaled) {
      expect(r.width).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
      expect(r.height).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
    }
    // Further pointer movement past the limit changes nothing.
    expect(clampScale({ x: 100, y: 100 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD)).toEqual({
      x: 4,
      y: 4,
    });
  });

  it('shrinking a mixed selection stops at the smallest object limit', () => {
    // The 100-wide object with a 50 minimum reaches its floor at 0.5.
    const rects = [rect(0, 0, 100, 100), rect(200, 0, 400, 400)];
    const clamped = clampScale({ x: 0.2, y: 0.2 }, rects, [50, 10], MAX_OBJECT_SIZE_WORLD);
    expect(clamped).toEqual({ x: 0.5, y: 0.5 });
    expect(rects.map((r) => r.width * clamped.x)).toEqual([50, 200]);
  });

  it('a non-uniform scale is clamped per axis and keeps its other axis', () => {
    const rects = [rect(0, 0, 200, 200)];
    const clamped = clampScale(
      { x: 0.1, y: 3 },
      rects,
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(clamped).toEqual({ x: 0.25, y: 3 });
  });

  it('no objects at all means the requested scale passes through', () => {
    expect(clampScale({ x: 2, y: 2 }, [], [], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 2, y: 2 });
    expect(clampScale({ x: Number.NaN, y: 1 }, [rect(0, 0, 10, 10)], [1], 100)).toEqual({
      x: 1,
      y: 1,
    });
  });
});

describe('geometry: scaleWithin (TC-04)', () => {
  it('TC-04 doubling the box width doubles each note and the gap between them', () => {
    // Two 200-unit notes, 100 units apart, ratio locked to a box twice as wide.
    const a = rect(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD);
    const b = rect(300, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD);
    const from = unionRects([a, b])!;
    expect(from).toEqual(rect(0, 0, 500, 200));

    const to = resizeRect(from, 'e', { x: 500, y: 0 }, true);
    const aNext = scaleWithin(a, from, to);
    const bNext = scaleWithin(b, from, to);

    expect(aNext.width).toBeCloseTo(400, 6);
    expect(aNext.height).toBeCloseTo(400, 6);
    expect(bNext.width).toBeCloseTo(400, 6);
    expect(bNext.height).toBeCloseTo(400, 6);
    // 600 - 400: the gap doubled with everything else.
    expect(bNext.x - (aNext.x + aNext.width)).toBeCloseTo(200, 6);
  });

  it('a scale of 1 maps a rectangle onto itself', () => {
    const box = rect(10, 20, 300, 200);
    const child = rect(60, 40, 100, 50);
    expect(scaleWithin(child, box, box)).toEqual(child);
  });

  it('an empty box does not divide by zero', () => {
    const child = rect(0, 0, 100, 100);
    expect(scaleWithin(child, rect(0, 0, 0, 0), rect(0, 0, 500, 500))).toEqual(
      rect(0, 0, 100, 100),
    );
  });
});

describe('geometry: handle labels', () => {
  it('every handle has an accessible name of the form "Resize <position>"', () => {
    expect(Object.values(HANDLE_LABELS).sort()).toEqual(
      [
        'Resize bottom',
        'Resize bottom-left',
        'Resize bottom-right',
        'Resize left',
        'Resize right',
        'Resize top',
        'Resize top-left',
        'Resize top-right',
      ].sort(),
    );
  });
});
