// TC-01 to TC-05: geometry helpers for group selection, move and resize.

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

describe('TC-01 resizeRect', () => {
  const start: Rect = { x: 100, y: 50, width: 200, height: 100 };

  it('se handle grows from top-left anchor', () => {
    expect(resizeRect(start, 'se', { x: 40, y: 25 }, false)).toEqual({
      x: 100, y: 50, width: 240, height: 125,
    });
  });

  it('nw handle moves top-left, keeps bottom-right fixed', () => {
    expect(resizeRect(start, 'nw', { x: 30, y: -20 }, false)).toEqual({
      x: 130, y: 30, width: 170, height: 120,
    });
  });

  it('e handle changes only width', () => {
    expect(resizeRect(start, 'e', { x: 50, y: -999 }, false)).toEqual({
      x: 100, y: 50, width: 250, height: 100,
    });
  });

  it('s handle changes only height', () => {
    expect(resizeRect(start, 's', { x: 999, y: 10 }, false)).toEqual({
      x: 100, y: 50, width: 200, height: 110,
    });
  });

  it('aspectLocked: 200×200 with se + (100,40) → 300×300 (spec example)', () => {
    const sq: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(resizeRect(sq, 'se', { x: 100, y: 40 }, true)).toEqual({
      x: 0, y: 0, width: 300, height: 300,
    });
  });

  it('aspectLocked: vertical movement decides when |dy| > |dx|', () => {
    const sq: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(resizeRect(sq, 'se', { x: 10, y: 100 }, true)).toEqual({
      x: 0, y: 0, width: 300, height: 300,
    });
  });

  it('aspectLocked: 2:1 box with e handle grows from centre vertically', () => {
    const wide: Rect = { x: 0, y: 0, width: 200, height: 100 };
    expect(resizeRect(wide, 'e', { x: 100, y: 0 }, true)).toEqual({
      x: 0, y: -25, width: 300, height: 150,
    });
  });

  it('non-finite delta returns start unchanged', () => {
    expect(resizeRect(start, 'se', { x: NaN, y: 5 }, false)).toBe(start);
    expect(resizeRect(start, 'se', { x: 5, y: Infinity }, true)).toBe(start);
  });
});

describe('TC-02 clampScale: min size', () => {
  it('clamps shrink to STICKY_MIN_SIZE_WORLD (50) for a 200-unit note', () => {
    // scale 0.245 → 49×49 < 50 → clamped to 0.25 → exactly 50×50
    const s = clampScale({ x: 0.245, y: 0.245 }, [{ x: 0, y: 0, width: 200, height: 200 }], [50], 20000);
    expect(s.x).toBeCloseTo(0.25, 10);
    expect(s.y).toBeCloseTo(0.25, 10);
  });

  it('exact min size is allowed (scale 0.25 → 50×50)', () => {
    const s = clampScale({ x: 0.25, y: 0.25 }, [{ x: 0, y: 0, width: 200, height: 200 }], [50], 20000);
    expect(s.x).toBe(0.25);
    expect(s.y).toBe(0.25);
  });

  it('scale below zero is clamped to the min size', () => {
    const s = clampScale({ x: -3, y: 0.5 }, [{ x: 0, y: 0, width: 200, height: 200 }], [50], 20000);
    expect(s.x).toBeCloseTo(0.25, 10);
    expect(s.y).toBe(0.5);
  });
});

describe('TC-03 clampScale: max size', () => {
  it('clamps growth so no object exceeds MAX_OBJECT_SIZE_WORLD', () => {
    const s = clampScale(
      { x: 10, y: 10 },
      [
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 0, y: 0, width: 3000, height: 3000 },
      ],
      [10, 10],
      20000,
    );
    // 3000 * 10 = 30000 > 20000 → clamped to 20000/3000
    expect(s.x).toBeCloseTo(20000 / 3000, 10);
    expect(s.y).toBeCloseTo(20000 / 3000, 10);
    // The small object stays within limits too
    expect(100 * s.x).toBeLessThanOrEqual(20000);
    expect(100 * s.x).toBeGreaterThanOrEqual(10);
  });

  it('independent x/y clamping', () => {
    const s = clampScale(
      { x: 50, y: 0.1 },
      [{ x: 0, y: 0, width: 500, height: 400 }],
      [80, 80],
      20000,
    );
    expect(s.x).toBe(40); // 20000/500
    expect(s.y).toBe(0.2); // 80/400
  });
});

describe('TC-04 scaleWithin', () => {
  it('scales children so relative layout is preserved', () => {
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    const noteA: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const noteB: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const a = scaleWithin(noteA, from, to);
    const b = scaleWithin(noteB, from, to);
    // each note doubles width; gap doubles 100 → 200
    expect(a).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(b).toEqual({ x: 600, y: 0, width: 400, height: 200 });
    expect(b.x - (a.x + a.width)).toBe(200);
  });

  it('translates and scales together', () => {
    const from: Rect = { x: 10, y: 20, width: 100, height: 100 };
    const to: Rect = { x: 110, y: 120, width: 200, height: 100 };
    const child: Rect = { x: 30, y: 40, width: 20, height: 10 };
    expect(scaleWithin(child, from, to)).toEqual({
      x: 150, y: 140, width: 40, height: 10,
    });
  });
});

describe('TC-05 rectContains', () => {
  const outer: Rect = { x: 0, y: 0, width: 100, height: 100 };

  it('fully inside → true', () => {
    expect(rectContains(outer, { x: 10, y: 10, width: 50, height: 50 })).toBe(true);
  });

  it('edges exactly on the boundary → true', () => {
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(rectContains(outer, { x: 25, y: 0, width: 75, height: 100 })).toBe(true);
  });

  it('touching from outside (extends past an edge) → false', () => {
    expect(rectContains(outer, { x: -1, y: 10, width: 50, height: 50 })).toBe(false);
    expect(rectContains(outer, { x: 50, y: 10, width: 60, height: 50 })).toBe(false);
    expect(rectContains(outer, { x: 10, y: 50, width: 50, height: 60 })).toBe(false);
  });

  it('completely outside → false', () => {
    expect(rectContains(outer, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe('marquee helpers', () => {
  it('normalizeRect: any drag direction yields a positive rect', () => {
    expect(normalizeRect({ x: 100, y: 50 }, { x: 40, y: 90 })).toEqual({
      x: 40, y: 50, width: 60, height: 40,
    });
    expect(normalizeRect({ x: 40, y: 90 }, { x: 100, y: 50 })).toEqual({
      x: 40, y: 50, width: 60, height: 40,
    });
  });

  it('unionRects: bounding box of several rects', () => {
    expect(unionRects([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 50, width: 100, height: 50 },
      { x: -20, y: 10, width: 30, height: 20 },
    ])).toEqual({ x: -20, y: 0, width: 170, height: 100 });
  });

  it('unionRects: empty list → null', () => {
    expect(unionRects([])).toBeNull();
  });

  it('unionRects: zero-size rects (single object) work', () => {
    expect(unionRects([{ x: 5, y: 6, width: 0, height: 0 }])).toEqual({
      x: 5, y: 6, width: 0, height: 0,
    });
  });
});
