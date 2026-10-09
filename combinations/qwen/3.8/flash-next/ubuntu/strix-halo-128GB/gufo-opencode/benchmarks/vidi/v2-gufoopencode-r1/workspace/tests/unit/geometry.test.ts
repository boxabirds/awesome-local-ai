import { describe, expect, test } from 'vitest';
import {
  clampScale,
  normalizeRect,
  rectContains,
  resizeRect,
  scaleWithin,
  unionRects,
  type Rect
} from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

describe('sel.geometry_ops', () => {
  test('TC-01 resizeRect corner with aspectLocked: 200×200 → 300×300', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(resizeRect(start, 'se', { x: 100, y: 100 }, true)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  test('TC-01b resizeRect corners anchor the opposite corner; edge handles affect one axis', () => {
    const start: Rect = { x: 10, y: 20, width: 200, height: 200 };
    expect(resizeRect(start, 'nw', { x: -50, y: -50 }, true)).toEqual({ x: -40, y: -30, width: 250, height: 250 });
    expect(resizeRect(start, 'e', { x: 100, y: 999 }, false)).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    expect(resizeRect(start, 'n', { x: 999, y: -50 }, false)).toEqual({ x: 10, y: -30, width: 200, height: 250 });
    // Corner, not aspect-locked: axes are independent.
    expect(resizeRect(start, 'se', { x: 100, y: 10 }, false)).toEqual({ x: 10, y: 20, width: 300, height: 210 });
  });

  test('TC-02 shrink to STICKY_MIN_SIZE_WORLD − 1 → clamped to 50×50', () => {
    const rect: Rect = { x: 0, y: 0, width: STICKY_MIN_SIZE_WORLD * 4, height: STICKY_MIN_SIZE_WORLD * 4 };
    const shrink = STICKY_MIN_SIZE_WORLD * 4 - (STICKY_MIN_SIZE_WORLD - 1);
    const target = resizeRect(rect, 'nw', { x: shrink, y: 0 }, false);
    // Raw target is 49×200 before clamping.
    expect(target.width).toBe(STICKY_MIN_SIZE_WORLD - 1);
    const clamped = clampScale(
      { x: target.width / rect.width, y: target.height / rect.height },
      [rect],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD
    );
    expect(clamped.x * rect.width).toBe(STICKY_MIN_SIZE_WORLD);
    expect(clamped.y * rect.height).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
    // The uniform (aspect-locked sticky) path stops at exactly 50×50.
    const target2 = resizeRect(rect, 'nw', { x: shrink, y: shrink }, true);
    expect(target2.width).toBe(STICKY_MIN_SIZE_WORLD - 1);
    const clamped2 = clampScale(
      { x: target2.width / rect.width, y: target2.height / rect.height },
      [rect],
      [STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD
    );
    expect({ w: clamped2.x * rect.width, h: clamped2.x * rect.height }).toEqual({ w: 50, h: 50 });
  });

  test('TC-03 clampScale stops everything when the first rect hits MAX_OBJECT_SIZE_WORLD; layout preserved', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 10_000, height: 10_000 },
      { x: 20_000, y: 0, width: 10_000, height: 500 }
    ];
    const scale = clampScale({ x: 2.1, y: 2.1 }, rects, [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    // The first rect would reach 21,000 > 20,000, so the whole selection stops at 2.
    expect(scale).toEqual({ x: 2, y: 2 });
    const from = unionRects(rects) as Rect;
    const to = { x: from.x, y: from.y, width: from.width * scale.x, height: from.height * scale.y };
    const scaled = rects.map((r) => scaleWithin(r, from, to));
    // Relative layout: the gap doubles exactly like the sizes.
    expect(scaled[1].x - (scaled[0].x + scaled[0].width)).toBe(20_000);
    expect(scaled[1].width).toBe(20_000);
    expect(scaled[0].width).toBe(20_000);
  });

  test('TC-04 scaleWithin: 2 notes 100 apart, box width ×2 → 400 wide, gap 200', () => {
    const a: Rect = { x: 0, y: 0, width: 50, height: 50 };
    const b: Rect = { x: 150, y: 0, width: 50, height: 50 };
    const from = unionRects([a, b]) as Rect;
    expect(from).toEqual({ x: 0, y: 0, width: 200, height: 50 });
    const to = { x: 0, y: 0, width: 400, height: 100 };
    const sa = scaleWithin(a, from, to);
    const sb = scaleWithin(b, from, to);
    expect(sa).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(sb).toEqual({ x: 300, y: 0, width: 100, height: 100 });
    expect(sb.x - (sa.x + sa.width)).toBe(200);
  });

  test('TC-04b rectContains is the strict all-edges-inside rule; normalizeRect and unionRects basics', () => {
    const box: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(box, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(rectContains(box, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(rectContains(box, { x: 10, y: 10, width: 100, height: 20 })).toBe(false);
    expect(rectContains(box, { x: -0.0001, y: 10, width: 10, height: 10 })).toBe(false);
    expect(normalizeRect({ x: 30, y: 40 }, { x: 10, y: 5 })).toEqual({ x: 10, y: 5, width: 20, height: 35 });
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 1, y: 2, width: 3, height: 4 }])).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});
