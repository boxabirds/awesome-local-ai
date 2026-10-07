/**
 * Task 6: Unit tests for sel.geometry_ops (TC-01 to TC-10).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  rectContains,
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
} from '@/shared/geometry';
import { initDoc } from '@/shared/board-model';
import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '@/shared/config';

function countUpdateEvents(doc: Y.Doc, cb: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  cb();
  doc.off('update', handler);
  return count;
}

describe('geometry unit tests', () => {
  // ---- TC-01: resizeRect se handle aspectLocked → corner resize square ----
  it('TC-01: resizeRect(se, +100,+40, true) on 200x200 → 300x300', () => {
    const result = resizeRect({ x: 0, y: 0, width: 200, height: 200 }, 'se', { x: 100, y: 40 }, true);
    expect(result.width).toBe(300);
    expect(result.height).toBe(300);
  });

  // ---- TC-02: shrink below min size → clamped to 50x50 ----
  it('TC-02: clampScale shrinking to < 50 → clamped at 50×50 (boundary)', () => {
    const rects = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    // Scale factor of 0.2 → 40 wide, below minimum 50
    const result = clampScale({ x: 0.2, y: 0.2 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // Should be clamped up: minScaleX = 50/200 = 0.25
    expect(result.x).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200, 5);
    expect(result.y).toBeCloseTo(STICKY_MIN_SIZE_WORLD / 200, 5);
  });

  it('TC-02b: exact boundary — scale exactly at min → accepted', () => {
    const rects = [{ x: 0, y: 0, width: 100, height: 100 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    const result = clampScale({ x: 0.5, y: 0.5 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(result.x).toBe(0.5);
    expect(result.y).toBe(0.5);
  });

  // ---- TC-03: clampScale stops uniformly when first hits MAX_OBJECT_SIZE_WORLD ----
  it('TC-03: clampScale mixed rects stops at max when one exceeds 20000', () => {
    const rects = [
      { x: 0, y: 0, width: 500, height: 500 },   // can scale up to 40x
      { x: 100, y: 100, width: 800, height: 800 }, // can scale up to 25x
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // Unconstrained scale is 30x → but second rect only allows 25x
    const result = clampScale({ x: 30, y: 30 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(result.x).toBe(MAX_OBJECT_SIZE_WORLD / 800);
    expect(result.y).toBe(MAX_OBJECT_SIZE_WORLD / 800);
  });

  // ---- TC-04: scaleWithin preserves gaps ----
  it('TC-04: two 200-unit notes 100 apart, box ×2 width → gap 200', () => {
    // First note: x=0..200, Second note: x=300..500 (gap of 100)
    // Bounding box: x=0, y=0, w=500, h=200
    // After doubling: x=0, y=0, w=1000, h=400
    // First note scaled: 200*2=400 wide, position unchanged
    // Second note scaled: 200*2=400 wide, gap = 400+400 to 300*2 = new gap...
    // Actually scaleWithin applies per-object relative to bounding box origin
    const bbox = { x: 0, y: 0, width: 500, height: 200 };
    const bboxScaled = { x: 0, y: 0, width: 1000, height: 400 };
    const note1 = { x: 0, y: 0, width: 200, height: 200 };
    const note2 = { x: 300, y: 0, width: 200, height: 200 };

    const s1 = scaleWithin(note1, bbox, bboxScaled);
    const s2 = scaleWithin(note2, bbox, bboxScaled);

    expect(s1.width).toBe(400);
    expect(s2.width).toBe(400);
    // Gap between them: note2.start - (note1.start + note1.width)
    const gap = s2.x - (s1.x + s1.width);
    expect(gap).toBe(200);
  });

  // ---- TC-07: objectsInRect equivalent — fully inside only ----
  it('TC-07: rectContains: A fully inside, B partly, C outside → only A selected', () => {
    const marquee = { x: 100, y: 100, width: 200, height: 200 };

    // A: fully inside (0..99 overlap with 100..299) — actually let's make A fully inside
    const aInside = { x: 110, y: 110, width: 50, height: 50 };
    expect(rectContains(marquee, aInside)).toBe(true);

    // B: partially inside (half overlaps)
    const bPartial = { x: 150, y: 150, width: 200, height: 200 }; // extends past marquee right/bottom
    expect(rectContains(marquee, bPartial)).toBe(false);

    // C: completely outside
    const cOutside = { x: 400, y: 400, width: 50, height: 50 };
    expect(rectContains(marquee, cOutside)).toBe(false);
  });

  // ---- TC-08: allObjectIds — skip unknown types (tested in board-model-group.test.ts) ----

  // ---- Test unionRects helper ----
  it('unionRects: empty → null', () => {
    expect(unionRects([])).toBeNull();
  });

  it('unionRects: single rect returned', () => {
    const r = { x: 10, y: 20, width: 100, height: 50 };
    expect(unionRects([r])).toEqual(r);
  });

  it('unionRects: multiple rects → bounding rectangle', () => {
    const rects = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 150, y: 150, width: 50, height: 50 },
    ];
    const result = unionRects(rects);
    expect(result).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });

  // ---- Test normalizeRect ----
  it('normalizeRect: both orderings produce same rect', () => {
    const a = { x: 10, y: 20 };
    const b = { x: 100, y: 200 };
    expect(normalizeRect(a, b)).toEqual({ x: 10, y: 20, width: 90, height: 180 });
    expect(normalizeRect(b, a)).toEqual({ x: 10, y: 20, width: 90, height: 180 });
  });

  // ---- Edge handle tests ----
  it('resizeRect edge handle "e" changes width only', () => {
    const result = resizeRect({ x: 0, y: 0, width: 200, height: 100 }, 'e', { x: 50, y: 10 }, false);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(250);
    expect(result.height).toBe(100);
  });

  it('resizeRect edge handle "n" changes y and height only', () => {
    const result = resizeRect({ x: 0, y: 0, width: 200, height: 100 }, 'n', { x: 10, y: -30 }, false);
    expect(result.x).toBe(0);
    expect(result.y).toBe(-30);
    expect(result.width).toBe(200);
    expect(result.height).toBe(130);
  });

  it('resizeRect corner handle "nw" changes x,y,width,height', () => {
    const result = resizeRect({ x: 0, y: 0, width: 200, height: 100 }, 'nw', { x: -20, y: -10 }, false);
    expect(result.x).toBe(-20);
    expect(result.y).toBe(-10);
    expect(result.width).toBe(220);
    expect(result.height).toBe(110);
  });

  // ---- aspectLocked tests ----
  it('resizeRect with aspectLocked preserves ratio for corner handle ne', () => {
    const start = { x: 0, y: 0, width: 200, height: 100 }; // aspect ratio 2:1
    const delta = { x: 100, y: 50 };
    const result = resizeRect(start, 'ne', delta, true);
    // Width = 200+100 = 300, aspect ratio preserved: height should be 300/2 = 150
    expect(result.width).toBe(300);
    expect(result.height).toBe(150);
  });

  it('scaleWithin: child maintains proportional scaling', () => {
    const child = { x: 50, y: 25, width: 100, height: 50 };
    const from = { x: 0, y: 0, width: 200, height: 100 };
    const to = { x: 0, y: 0, width: 400, height: 200 };
    const result = scaleWithin(child, from, to);
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
    expect(result.x).toBe(100);
    expect(result.y).toBe(50);
  });

  // ---- Error path: non-finite values ----
  it('scaleWithin with zero-width from returns original child', () => {
    const child = { x: 10, y: 10, width: 20, height: 20 };
    const from = { x: 0, y: 0, width: 0, height: 100 };
    const to = { x: 0, y: 0, width: 100, height: 200 };
    expect(scaleWithin(child, from, to)).toEqual(child);
  });
});
