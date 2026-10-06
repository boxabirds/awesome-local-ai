/**
 * Geometry unit tests (TC-01 to TC-04).
 * Pure maths: no Y.Doc, no DOM.
 */
import { describe, expect, test } from 'vitest';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  normalizeRect,
  rectContains,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

describe('resizeRect', () => {
  // TC-01: se handle, aspectLocked, 200×200 + (100,40) → 300×300
  test('TC-01: se handle with aspectLocked preserves ratio', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    // aspect locked: use the larger relative change (width: +100/200=0.5, height: +40/200=0.2)
    // scale = 1.5, so 200*1.5 = 300, height = 300/1 = 300
    expect(result.width).toBeCloseTo(300);
    expect(result.height).toBeCloseTo(300);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  test('se handle without aspect lock resizes independently', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, false);
    expect(result.width).toBeCloseTo(300);
    expect(result.height).toBeCloseTo(240);
  });

  test('nw handle adjusts x and y', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const result = resizeRect(start, 'nw', { x: -50, y: -30 }, false);
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(70);
    expect(result.width).toBeCloseTo(250);
    expect(result.height).toBeCloseTo(230);
  });

  test('e handle changes width only', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 100 };
    const result = resizeRect(start, 'e', { x: 50, y: 0 }, false);
    expect(result.width).toBeCloseTo(250);
    expect(result.height).toBeCloseTo(100);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  test('n handle changes height only, moves y', () => {
    const start: Rect = { x: 0, y: 100, width: 200, height: 100 };
    const result = resizeRect(start, 'n', { x: 0, y: -20 }, false);
    expect(result.height).toBeCloseTo(120);
    expect(result.y).toBeCloseTo(80);
    expect(result.width).toBeCloseTo(200);
  });
});

describe('clampScale', () => {
  // TC-02: shrink below STICKY_MIN_SIZE_WORLD → clamped to 50×50
  test('TC-02: clamps to minimum size', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 100, height: 100 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD]; // 50
    // We want to shrink to width=49 → scale = 0.49, but min is 50 → scale = 0.5
    const scale = { x: 0.49, y: 0.49 };
    const result = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(result.x).toBeCloseTo(0.5);
    expect(result.y).toBeCloseTo(0.5);
    // Verify: 100 * 0.5 = 50 = STICKY_MIN_SIZE_WORLD
    expect(rects[0]!.width * result.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD);
  });

  test('TC-02 boundary: exactly min size is not clamped', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 100, height: 100 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    const scale = { x: 0.5, y: 0.5 };
    const result = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(result.x).toBeCloseTo(0.5);
  });

  // TC-03: clampScale stops all when first hits MAX_OBJECT_SIZE_WORLD
  test('TC-03: clamps to max size uniformly', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 300, y: 0, width: 400, height: 400 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // Scale of 51 would make the 400-wide object 20400 > 20000
    // Max scale for the 400-wide object: 20000/400 = 50
    const scale = { x: 51, y: 51 };
    const result = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(50);
    // Verify: 400 * 50 = 20000 = MAX
    expect(rects[1]!.width * result.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD);
    // 200 * 50 = 10000, well within limits
    expect(rects[0]!.width * result.x).toBeCloseTo(10000);
  });
});

describe('scaleWithin', () => {
  // TC-04: two 200-unit notes 100 apart, bounding box ×2 width → each note 400 wide, gap 200
  test('TC-04: proportional scaling preserves relative positions and gaps', () => {
    const note1: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const note2: Rect = { x: 300, y: 0, width: 200, height: 200 };
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };

    const result1 = scaleWithin(note1, from, to);
    const result2 = scaleWithin(note2, from, to);

    // Each note is 400 wide (scaleX = 2)
    expect(result1.width).toBeCloseTo(400);
    expect(result2.width).toBeCloseTo(400);
    // Gap between note1 right (400) and note2 left (600) = 200
    expect(result2.x - (result1.x + result1.width)).toBeCloseTo(200);
    // Heights unchanged (scaleY = 1)
    expect(result1.height).toBeCloseTo(200);
    expect(result2.height).toBeCloseTo(200);
  });
});

describe('normalizeRect', () => {
  test('produces positive width and height regardless of point order', () => {
    const r = normalizeRect({ x: 100, y: 200 }, { x: 50, y: 80 });
    expect(r.x).toBe(50);
    expect(r.y).toBe(80);
    expect(r.width).toBe(50);
    expect(r.height).toBe(120);
  });
});

describe('rectContains', () => {
  test('fully inside → true', () => {
    const outer: Rect = { x: 0, y: 0, width: 500, height: 500 };
    const inner: Rect = { x: 10, y: 10, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  test('partly outside → false', () => {
    const outer: Rect = { x: 0, y: 0, width: 500, height: 500 };
    const inner: Rect = { x: 450, y: 10, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  test('touching edge from outside → false', () => {
    const outer: Rect = { x: 0, y: 0, width: 500, height: 500 };
    const inner: Rect = { x: 500, y: 10, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(false);
  });
});

describe('unionRects', () => {
  test('empty array → null', () => {
    expect(unionRects([])).toBeNull();
  });

  test('multiple rects → bounding box', () => {
    const rects: Rect[] = [
      { x: 10, y: 20, width: 100, height: 50 },
      { x: 200, y: 5, width: 80, height: 200 },
    ];
    const result = unionRects(rects)!;
    expect(result.x).toBe(10);
    expect(result.y).toBe(5);
    expect(result.width).toBe(270);
    expect(result.height).toBe(200);
  });
});
