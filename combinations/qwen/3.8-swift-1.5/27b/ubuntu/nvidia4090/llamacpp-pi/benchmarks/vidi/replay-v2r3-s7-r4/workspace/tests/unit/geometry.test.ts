import { describe, it, expect } from 'vitest';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  type Rect,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

describe('sel.geometry_ops (pure geometry)', () => {
  const NOTE = STICKY_SIZE_WORLD; // 200

  // TC-01
  it('TC-01: resizeRect se corner with aspectLocked: 200×200 + (100, 40) → 300×300', () => {
    const start: Rect = { x: 0, y: 0, width: NOTE, height: NOTE };
    const out = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(out.width).toBe(300);
    expect(out.height).toBe(300);
    // Anchored at the opposite (nw) corner.
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('resizeRect without aspect lock follows each axis independently', () => {
    const start: Rect = { x: 10, y: 20, width: 200, height: 100 };
    const out = resizeRect(start, 'se', { x: 50, y: -25 }, false);
    expect(out).toEqual({ x: 10, y: 20, width: 250, height: 75 });
  });

  it('resizeRect edge handles change one axis only; opposite edge is the anchor', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(resizeRect(start, 'e', { x: 60, y: 999 }, false)).toEqual({ x: 0, y: 0, width: 260, height: 200 });
    expect(resizeRect(start, 'w', { x: -40, y: 999 }, false)).toEqual({ x: -40, y: 0, width: 240, height: 200 });
    expect(resizeRect(start, 'n', { x: 999, y: -30 }, false)).toEqual({ x: 0, y: -30, width: 200, height: 230 });
    expect(resizeRect(start, 's', { x: 999, y: 30 }, false)).toEqual({ x: 0, y: 0, width: 200, height: 230 });
  });

  it('resizeRect aspectLocked keeps the ratio from the opposite anchor (nw handle)', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
    // Drag nw down-right: width shrinks 50%, height grows 100% → dominant scale 2.
    const out = resizeRect(start, 'nw', { x: 100, y: -100 }, true);
    expect(out.width).toBe(400);
    expect(out.height).toBe(200);
    // Anchored at the opposite (se) corner: x + w and y + h are unchanged.
    expect(out.x + out.width).toBe(200);
    expect(out.y + out.height).toBe(100);
  });

  // TC-02
  it('TC-02: shrinking a sticky below STICKY_MIN_SIZE_WORLD is clamped to 50×50 (boundary)', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: NOTE, height: NOTE }];
    // Target 49×49 → scale 49/200 < 50/200 → clamped to exactly the minimum.
    const s49 = clampScale({ x: 49 / NOTE, y: 49 / NOTE }, rects, [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(NOTE * s49.x).toBe(STICKY_MIN_SIZE_WORLD);
    expect(NOTE * s49.y).toBe(STICKY_MIN_SIZE_WORLD);
    // Exactly the minimum passes through unchanged.
    const s50 = clampScale({ x: STICKY_MIN_SIZE_WORLD / NOTE, y: STICKY_MIN_SIZE_WORLD / NOTE }, rects, [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(s50.x).toBe(STICKY_MIN_SIZE_WORLD / NOTE);
    expect(s50.y).toBe(STICKY_MIN_SIZE_WORLD / NOTE);
  });

  // TC-03
  it('TC-03: clampScale stops the whole selection when the first object hits MAX_OBJECT_SIZE_WORLD', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 300, y: 0, width: 100, height: 100 },
    ];
    const minSizes = [10, 10];
    // Unclamped, the 200-wide object would become 100 000 wide.
    const clamped = clampScale({ x: 500, y: 500 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(rects[0].width * clamped.x).toBe(MAX_OBJECT_SIZE_WORLD); // first object exactly at the limit
    expect(rects[1].width * clamped.x).toBe(MAX_OBJECT_SIZE_WORLD / 2);
    // Relative layout preserved: the 2:1 width ratio is unchanged.
    expect((rects[0].width * clamped.x) / (rects[1].width * clamped.x)).toBe(2);
    // Nothing exceeds the limit.
    for (const [i, r] of rects.entries()) {
      expect(r.width * clamped.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
      expect(r.height * clamped.y).toBeGreaterThanOrEqual(minSizes[i]);
    }
    // A scale already inside the limits passes through unchanged.
    const free = clampScale({ x: 1.5, y: 1.5 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(free).toEqual({ x: 1.5, y: 1.5 });
  });

  // TC-04
  it('TC-04: two 200-unit notes 100 apart, box width ×2 → 400 wide, gap 200', () => {
    const note1: Rect = { x: 0, y: 0, width: NOTE, height: NOTE };
    const note2: Rect = { x: NOTE + 100, y: 0, width: NOTE, height: NOTE };
    const box = unionRects([note1, note2]);
    expect(box).not.toBeNull();
    const doubled: Rect = { x: box!.x, y: box!.y, width: box!.width * 2, height: box!.height };
    const out1 = scaleWithin(note1, box!, doubled);
    const out2 = scaleWithin(note2, box!, doubled);
    expect(out1.width).toBe(400);
    expect(out2.width).toBe(400);
    // Gap doubles from 100 to 200.
    expect(out2.x - (out1.x + out1.width)).toBe(200);
  });

  it('rectContains: fully inside true; touching edge from outside false; partly inside false', () => {
    const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    // On the edge counts as inside.
    expect(rectContains(outer, { x: 80, y: 0, width: 20, height: 20 })).toBe(true);
    // Partly inside.
    expect(rectContains(outer, { x: 90, y: 10, width: 20, height: 20 })).toBe(false);
    // Touching the edge from outside.
    expect(rectContains(outer, { x: 100, y: 0, width: 20, height: 20 })).toBe(false);
    // Outside.
    expect(rectContains(outer, { x: 120, y: 120, width: 10, height: 10 })).toBe(false);
  });

  it('unionRects: empty list → null; multiple rects → bounding rect', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 5, y: 5, width: 10, height: 10 }])).toEqual({ x: 5, y: 5, width: 10, height: 10 });
    expect(unionRects([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: -5, width: 15, height: 30 },
    ])).toEqual({ x: 0, y: -5, width: 35, height: 30 });
  });

  it('normalizeRect works in every quadrant', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(normalizeRect({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});
