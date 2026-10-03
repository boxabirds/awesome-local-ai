import { describe, it, expect } from 'vitest';
import {
  unionRects,
  normalizeRect,
  resizeRect,
  clampScale,
  scaleWithin,
  handleLabel,
  type Rect,
  type Point,
} from '../../src/shared/geometry';

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, width: w, height: h });

describe('geometry (story 7)', () => {
  describe('unionRects', () => {
    it('TC-01: empty input → null', () => {
      expect(unionRects([])).toBeNull();
    });

    it('TC-01: single rect → that rect', () => {
      expect(unionRects([R(10, 20, 30, 40)])).toEqual(R(10, 20, 30, 40));
    });

    it('TC-01: multiple rects → min/max bounding box (overlapping and apart)', () => {
      expect(unionRects([R(0, 0, 10, 10), R(5, 5, 10, 10)])).toEqual(R(0, 0, 15, 15));
      expect(unionRects([R(100, 50, 10, 10), R(-20, -30, 8, 4)])).toEqual(R(-20, -30, 130, 90));
    });
  });

  describe('resizeRect', () => {
    const start = R(100, 100, 100, 100);

    it('TC-02: corner handles drag the opposite corner/edge as the fixed point', () => {
      // se: bottom-right follows the pointer
      expect(resizeRect(start, 'se', { x: 40, y: -25 })).toEqual(R(100, 100, 140, 75));
      // nw: top-left follows
      expect(resizeRect(start, 'nw', { x: 40, y: -25 })).toEqual(R(140, 75, 60, 125));
      // ne: top-right
      expect(resizeRect(start, 'ne', { x: 40, y: -25 })).toEqual(R(100, 75, 140, 125));
      // sw: bottom-left
      expect(resizeRect(start, 'sw', { x: 40, y: -25 })).toEqual(R(140, 100, 60, 75));
    });

    it('TC-02: edge handles resize one dimension only', () => {
      expect(resizeRect(start, 'e', { x: 30, y: 999 })).toEqual(R(100, 100, 130, 100));
      expect(resizeRect(start, 'w', { x: -20, y: 999 })).toEqual(R(80, 100, 120, 100));
      expect(resizeRect(start, 's', { x: 999, y: 15 })).toEqual(R(100, 100, 100, 115));
      expect(resizeRect(start, 'n', { x: 999, y: -35 })).toEqual(R(100, 65, 100, 135));
    });

    it('TC-02: aspectLocked keeps a uniform scale (1:1 start stays square)', () => {
      const out = resizeRect(start, 'se', { x: 60, y: 10 }, true);
      expect(out.width).toBe(out.height);
      expect(out.width).toBe(160); // max(100+60, 100+10)
    });

    it('TC-02: aspectLocked with a non-1:1 start follows the axis with the larger relative change', () => {
      const wide = R(0, 0, 200, 100);
      const out = resizeRect(wide, 'se', { x: 50, y: -60 }, true);
      // sx = 250/200 = 1.25 (Δ 0.25), sy = 40/100 = 0.4 (Δ 0.6) → follow sy → 80×40
      expect(out).toEqual(R(0, 0, 80, 40));
    });

    it('TC-02: a zero-delta resize returns the start rect unchanged', () => {
      expect(resizeRect(start, 'nw', { x: 0, y: 0 })).toEqual(start);
    });

    it('normalizeRect: a start point + current point → rect in any direction', () => {
      const a: Point = { x: 300, y: 200 };
      const b: Point = { x: 100, y: 50 };
      expect(normalizeRect(a, b)).toEqual(R(100, 50, 200, 150));
      expect(normalizeRect(b, a)).toEqual(R(100, 50, 200, 150));
    });
  });

  describe('clampScale', () => {
    const start = R(100, 100, 100, 100);

    it('TC-03: clamps to the object minimum size', () => {
      // 100 * 0.2 = 20 < 50 → clamped to 0.5 → 50×50
      expect(clampScale({ x: 0.2, y: 0.2 }, [start], [50], 20_000)).toEqual({ x: 0.5, y: 0.5 });
    });

    it('TC-03: clamps to the global maximum size', () => {
      // 100 * 500 = 50 000 > 20 000 → clamped to 200
      expect(clampScale({ x: 500, y: 500 }, [start], [50], 20_000)).toEqual({ x: 200, y: 200 });
    });

    it('TC-03: in-range scales pass through unchanged', () => {
      expect(clampScale({ x: 2, y: 0.6 }, [start], [50], 20_000)).toEqual({ x: 2, y: 0.6 });
    });

    it('TC-03: with several objects, the tightest constraint wins', () => {
      const small = R(0, 0, 50, 50); // min 50 → cannot shrink at all (max scale 1)
      const big = R(0, 0, 400, 400); // max 20000 → scale ≤ 50
      const s = clampScale({ x: 0.1, y: 0.1 }, [small, big], [50, 50], 20_000);
      expect(s).toEqual({ x: 1, y: 1 }); // small object at its minimum
    });

    it('TC-03: zero start dimensions leave the axis unclamped', () => {
      expect(clampScale({ x: 0.1, y: 2 }, [R(0, 0, 0, 100)], [50], 20_000)).toEqual({ x: 0.1, y: 2 });
    });
  });

  describe('scaleWithin', () => {
    it('TC-03: maps a start rect into its proportional position in the new box', () => {
      const from = R(0, 0, 200, 200);
      const to = R(10, 20, 400, 200);
      // object at start (50, 50) size 100×100 → x: 10 + 50/200*400 = 110, y: 20 + 50/200*200 = 70, 200×100
      const out = scaleWithin(R(50, 50, 100, 100), from, to);
      expect(out).toEqual(R(110, 70, 200, 100));
    });
  });

  it('handleLabel: accessible names for all 8 handles', () => {
    expect(handleLabel('nw')).toBe('Resize top-left');
    expect(handleLabel('n')).toBe('Resize top');
    expect(handleLabel('ne')).toBe('Resize top-right');
    expect(handleLabel('e')).toBe('Resize right');
    expect(handleLabel('se')).toBe('Resize bottom-right');
    expect(handleLabel('s')).toBe('Resize bottom');
    expect(handleLabel('sw')).toBe('Resize bottom-left');
    expect(handleLabel('w')).toBe('Resize left');
  });
});
