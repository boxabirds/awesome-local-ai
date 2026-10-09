/**
 * TC-01 to TC-05: pure geometry (sel.geometry_ops).
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

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe('rectContains (TC-01)', () => {
  it('contains a rect strictly inside', () => {
    expect(rectContains(rect(0, 0, 100, 100), rect(10, 10, 20, 20))).toBe(true);
  });

  it('does not contain a partially outside rect', () => {
    expect(rectContains(rect(0, 0, 100, 100), rect(90, 10, 20, 20))).toBe(false);
    expect(rectContains(rect(0, 0, 100, 100), rect(-10, 10, 20, 20))).toBe(false);
    expect(rectContains(rect(0, 0, 100, 100), rect(10, 10, 20, 95))).toBe(false);
  });

  it('treats shared edges as inside (inclusive)', () => {
    expect(rectContains(rect(0, 0, 100, 100), rect(0, 0, 100, 100))).toBe(true);
    expect(rectContains(rect(0, 0, 100, 100), rect(80, 0, 20, 50))).toBe(true);
    expect(rectContains(rect(0, 0, 100, 100), rect(0, 40, 50, 60))).toBe(true);
  });
});

describe('unionRects (TC-02)', () => {
  it('returns the smallest rect containing every rect', () => {
    expect(unionRects([rect(0, 0, 10, 10), rect(20, 30, 5, 5)])).toEqual(rect(0, 0, 25, 35));
    expect(unionRects([rect(5, 5, 1, 1)])).toEqual(rect(5, 5, 1, 1));
  });

  it('returns null for an empty list', () => {
    expect(unionRects([])).toBeNull();
  });
});

describe('normalizeRect', () => {
  it('normalises reversed endpoints', () => {
    expect(normalizeRect({ x: 30, y: 40 }, { x: 10, y: 10 })).toEqual(rect(10, 10, 20, 30));
  });

  it('allows a zero-size rect (click, not drag)', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual(rect(5, 5, 0, 0));
  });
});

describe('resizeRect (TC-03)', () => {
  const start = rect(0, 0, 100, 50);

  it('corner handles move both axes, anchored at the opposite corner', () => {
    expect(resizeRect(start, 'se', { x: 40, y: 10 }, false)).toEqual(rect(0, 0, 140, 60));
    expect(resizeRect(start, 'nw', { x: -30, y: -10 }, false)).toEqual(rect(-30, -10, 130, 60));
    expect(resizeRect(start, 'ne', { x: 20, y: -5 }, false)).toEqual(rect(0, -5, 120, 55));
    expect(resizeRect(start, 'sw', { x: -20, y: 15 }, false)).toEqual(rect(-20, 0, 120, 65));
  });

  it('edge handles move one axis only', () => {
    expect(resizeRect(start, 'e', { x: 40, y: 99 }, false)).toEqual(rect(0, 0, 140, 50));
    expect(resizeRect(start, 's', { x: 99, y: 10 }, false)).toEqual(rect(0, 0, 100, 60));
    expect(resizeRect(start, 'n', { x: 99, y: -5 }, false)).toEqual(rect(0, -5, 100, 55));
    expect(resizeRect(start, 'w', { x: -30, y: 99 }, false)).toEqual(rect(-30, 0, 130, 50));
  });

  it('aspectLocked corners keep the ratio (dominant axis wins)', () => {
    // start 100x50 (ratio 2). se by (40, 10): sx = 1.4, sy = 1.2 -> sx dominates -> 140 x 70
    expect(resizeRect(start, 'se', { x: 40, y: 10 }, true)).toEqual(rect(0, 0, 140, 70));
    // nw by (40, 10) drags the top-left handle inwards: sx = 0.6, sy = 0.8 -> sx dominates
    // -> 60 x 30, anchored at the bottom-right corner
    expect(resizeRect(start, 'nw', { x: 40, y: 10 }, true)).toEqual(rect(40, 10, 60, 30));
  });

  it('aspectLocked edges follow the perpendicular axis', () => {
    expect(resizeRect(start, 'e', { x: 40, y: 0 }, true)).toEqual(rect(0, 0, 140, 70));
    expect(resizeRect(start, 's', { x: 0, y: 10 }, true)).toEqual(rect(0, 0, 120, 60));
    expect(resizeRect(start, 'w', { x: -30, y: 0 }, true)).toEqual(rect(-30, 0, 130, 65));
  });

  it('degenerate: zero start size is handled without division by zero', () => {
    expect(resizeRect(rect(0, 0, 0, 50), 'e', { x: 30, y: 0 }, false)).toEqual(rect(0, 0, 30, 50));
    expect(resizeRect(rect(0, 0, 0, 0), 'se', { x: 10, y: 10 }, true)).toEqual(rect(0, 0, 10, 10));
  });
});

describe('clampScale (TC-04)', () => {
  it('allows scales that keep every object within the limits', () => {
    expect(clampScale({ x: 1.5, y: 1.5 }, [rect(0, 0, 100, 100)], [50], 2000)).toEqual({ x: 1.5, y: 1.5 });
  });

  it('shrinks: stops at the smallest scale at which no object goes below its minimum', () => {
    // 200x200 (min 50) and 100x100 (min 50); scale 0.4 would make the small one 40 < 50
    expect(
      clampScale({ x: 0.4, y: 0.4 }, [rect(0, 0, 200, 200), rect(0, 0, 100, 100)], [50, 50], 2000),
    ).toEqual({ x: 0.5, y: 0.5 });
  });

  it('grows: stops at the largest scale at which no object exceeds maxSize', () => {
    // 100x100, max 2000 -> scale 20
    expect(clampScale({ x: 300, y: 300 }, [rect(0, 0, 100, 100)], [1], 2000)).toEqual({ x: 20, y: 20 });
  });

  it('clamps x and y independently', () => {
    // 100x50, min 50: shrinking to (0.4, 0.4): x -> 40 < 50 (limit 0.5), y -> 20 < 50 (limit 1.0)
    expect(clampScale({ x: 0.4, y: 0.4 }, [rect(0, 0, 100, 50)], [50], 2000)).toEqual({ x: 0.5, y: 1 });
  });

  it('keeps zero-size rects and non-finite inputs from poisoning the result', () => {
    expect(clampScale({ x: 0.4, y: 0.4 }, [rect(0, 0, 0, 0)], [50], 2000)).toEqual({ x: 0.4, y: 0.4 });
    expect(clampScale({ x: NaN, y: 2 }, [rect(0, 0, 100, 100)], [50], 2000)).toEqual({ x: 2, y: 2 });
    expect(clampScale({ x: 1, y: 1 }, [], [50], 2000)).toEqual({ x: 1, y: 1 });
  });
});

describe('scaleWithin (TC-05)', () => {
  it('repositions and rescales proportionally', () => {
    // from (0,0,200,100) to (10,20,400,200): child (50,25,100,50) sits at 25%/25% -> (110,70,200,100)
    expect(scaleWithin(rect(50, 25, 100, 50), rect(0, 0, 200, 100), rect(10, 20, 400, 200))).toEqual(
      rect(110, 70, 200, 100),
    );
  });

  it('handles zero-sized boxes without division by zero', () => {
    expect(scaleWithin(rect(0, 0, 0, 0), rect(0, 0, 0, 0), rect(10, 10, 100, 100))).toEqual(rect(10, 10, 0, 0));
  });
});
