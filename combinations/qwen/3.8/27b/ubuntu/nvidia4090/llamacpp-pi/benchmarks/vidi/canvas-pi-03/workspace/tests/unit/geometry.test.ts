import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  type Rect,
} from '@/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '@/shared/config';

/**
 * Story 7 unit tests for the pure geometry (sel.geometry_ops, TC-01 to TC-04
 * plus boundary and negative cases). No Y.Doc involved: pure maths.
 */

const R = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe('geometry: rectContains / unionRects / normalizeRect', () => {
  it('rectContains: fully inside (including exact fit) is true', () => {
    expect(rectContains(R(0, 0, 100, 100), R(10, 10, 50, 50))).toBe(true);
    expect(rectContains(R(0, 0, 100, 100), R(0, 0, 100, 100))).toBe(true);
  });

  it('rectContains: partly inside or outside is false (marquee negative rule)', () => {
    // B is half inside the outer rect.
    expect(rectContains(R(0, 0, 100, 100), R(50, 0, 100, 100))).toBe(false);
    // C is fully outside.
    expect(rectContains(R(0, 0, 100, 100), R(100, 100, 10, 10))).toBe(false);
    // Touching an edge without being enclosed.
    expect(rectContains(R(0, 0, 100, 100), R(-10, 0, 20, 100))).toBe(false);
  });

  it('unionRects: empty list is null; otherwise the bounding rect', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([R(10, 20, 30, 40)])).toEqual(R(10, 20, 30, 40));
    expect(unionRects([R(10, 20, 30, 40), R(0, 0, 5, 5), R(50, 60, 10, 10)])).toEqual(R(0, 0, 60, 70));
  });

  it('normalizeRect: order-independent, non-negative size', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 30, y: 10 })).toEqual(R(10, 10, 20, 10));
    expect(normalizeRect({ x: 30, y: 10 }, { x: 10, y: 20 })).toEqual(R(10, 10, 20, 10));
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual(R(5, 5, 0, 0));
  });
});

describe('geometry: resizeRect (TC-01)', () => {
  it('TC-01: se handle with aspectLocked: 200x200 + (100,40) -> 300x300', () => {
    const out = resizeRect(R(0, 0, 200, 200), 'se', { x: 100, y: 40 }, true);
    expect(out.width).toBe(300);
    expect(out.height).toBe(300);
    // Anchored at the opposite (top-left) corner.
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('corner handle without aspect: both axes change', () => {
    expect(resizeRect(R(0, 0, 200, 100), 'se', { x: 50, y: 25 }, false)).toEqual(R(0, 0, 250, 125));
    // nw handle anchors at bottom-right.
    expect(resizeRect(R(0, 0, 200, 100), 'nw', { x: -50, y: -25 }, false)).toEqual(R(-50, -25, 250, 125));
  });

  it('edge handles change one axis only', () => {
    expect(resizeRect(R(0, 0, 200, 100), 'e', { x: 50, y: 999 }, false)).toEqual(R(0, 0, 250, 100));
    expect(resizeRect(R(0, 0, 200, 100), 'n', { x: 999, y: -20 }, false)).toEqual(R(0, -20, 200, 120));
  });

  it('w/s handles anchor at the opposite edge', () => {
    expect(resizeRect(R(100, 100, 200, 100), 'w', { x: -40, y: 0 }, false)).toEqual(R(60, 100, 240, 100));
    expect(resizeRect(R(100, 100, 200, 100), 's', { x: 0, y: 30 }, false)).toEqual(R(100, 100, 200, 130));
  });

  it('aspectLocked edge handles: the pointer-driven axis sets the scale (both grow and shrink)', () => {
    // 'e' out: width 200->300 (scale 1.5) -> height 100->150, top-anchored.
    expect(resizeRect(R(0, 0, 200, 100), 'e', { x: 100, y: 999 }, true)).toEqual(R(0, 0, 300, 150));
    // 'e' in: width 200->100 (scale 0.5) -> height 100->50, ratio preserved on shrink too.
    expect(resizeRect(R(0, 0, 200, 100), 'e', { x: -100, y: 0 }, true)).toEqual(R(0, 0, 100, 50));
    // 'n' drives the height axis, anchored at the bottom edge.
    expect(resizeRect(R(0, 100, 200, 100), 'n', { x: 0, y: -50 }, true)).toEqual(R(0, 50, 300, 150));
  });
});

describe('geometry: clampScale (TC-02, TC-03)', () => {
  it('TC-02: shrinking below STICKY_MIN_SIZE_WORLD - 1 clamps to exactly 50x50', () => {
    const note = R(0, 0, 200, 200);
    // Requested scale for a 49-unit note (STICKY_MIN_SIZE_WORLD - 1).
    const tooSmall = clampScale({ x: 49 / 200, y: 49 / 200 }, [note], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(200 * tooSmall.x).toBe(STICKY_MIN_SIZE_WORLD);
    expect(200 * tooSmall.y).toBe(STICKY_MIN_SIZE_WORLD);
    // The exact minimum is allowed.
    const exact = clampScale({ x: STICKY_MIN_SIZE_WORLD / 200, y: STICKY_MIN_SIZE_WORLD / 200 }, [note], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(200 * exact.x).toBe(STICKY_MIN_SIZE_WORLD);
    expect(200 * exact.y).toBe(STICKY_MIN_SIZE_WORLD);
  });

  it('TC-03: mixed rects stop uniformly when the first object hits MAX_OBJECT_SIZE_WORLD; layout preserved', () => {
    // A small rect and a large rect: the large one (500 wide) reaches
    // MAX_OBJECT_SIZE_WORLD at scale 40, far before the small one (100 wide,
    // which would reach it at scale 200). The whole selection must stop at 40.
    const small = R(0, 0, 100, 100);
    const large = R(200, 0, 500, 500);
    const clamped = clampScale({ x: 100, y: 100 }, [small, large], [10, 10], MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBe(40);
    expect(clamped.y).toBe(40);
    // Relative layout preserved: both scaled by the same factor.
    expect(large.width * clamped.x).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(small.width * clamped.x).toBe(4000);
  });

  it('the axis scales independently; a request inside the range is untouched', () => {
    const note = R(0, 0, 200, 200);
    const free = clampScale({ x: 1.5, y: 0.5 }, [note], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(free.x).toBe(1.5);
    expect(free.y).toBe(0.5);
    // X clamped to max, Y left alone.
    const xMax = clampScale({ x: 1e9, y: 1.2 }, [note], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(note.width * xMax.x).toBe(MAX_OBJECT_SIZE_WORLD);
    expect(xMax.y).toBe(1.2);
  });

  it('empty rect list: no constraint, scale returned unchanged (except non-finite)', () => {
    expect(clampScale({ x: 3, y: 4 }, [], [10], MAX_OBJECT_SIZE_WORLD)).toEqual({ x: 3, y: 4 });
  });
});

describe('geometry: scaleWithin (TC-04)', () => {
  it('TC-04: two 200-unit notes 100 apart, box width x2 -> 400 wide, gap 200', () => {
    // Bounding box of two 200-wide notes with a 100 gap: 500 wide.
    const box = R(0, 0, 500, 200);
    const a = R(0, 0, 200, 200);
    const b = R(300, 0, 200, 200);
    const to = R(0, 0, 1000, 200); // width doubled, height unchanged
    const a2 = scaleWithin(a, box, to);
    const b2 = scaleWithin(b, box, to);
    expect(a2.width).toBe(400);
    expect(b2.width).toBe(400);
    expect(a2.height).toBe(200);
    // Gap doubles from 100 to 200.
    expect(b2.x - (a2.x + a2.width)).toBe(200);
    expect(a2.x).toBe(0);
  });

  it('scales in both axes from the box origin', () => {
    const box = R(0, 0, 100, 100);
    const child = R(25, 25, 50, 50);
    const out = scaleWithin(child, box, R(0, 0, 200, 100));
    expect(out).toEqual(R(50, 25, 100, 50));
  });
});
