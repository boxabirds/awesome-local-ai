import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_HIT_TOLERANCE_PX,
} from '../../src/shared/config';
import { handwrittenLoop, spiral5010 } from '../fixtures/pen-paths';
import type { Point } from '../../src/shared/geometry';

/** Count the `update` events a call emits on the document. */
const withUpdateCount = <T>(doc: Y.Doc, run: () => T): { result: T; updates: number } => {
  let updates = 0;
  const observer = () => { updates += 1; };
  doc.on('update', observer);
  try {
    return { result: run(), updates };
  } finally {
    doc.off('update', observer);
  }
};

/** Compute max distance from any point in `raw` to the closest point on polyline `result`. */
function maxDeviation(raw: readonly Point[], result: readonly Point[]): number {
  let max = 0;
  for (const p of raw) {
    const d = distanceToPolyline(result, p);
    // For single-point results, distanceToPolyline returns Infinity, so handle manually
    const dist = result.length < 2
      ? Math.min(...result.map(r => Math.hypot(p.x - r.x, p.y - r.y)))
      : d;
    if (dist > max) max = dist;
  }
  return max;
}

describe('simplify (RDP)', () => {
  it('TC-01: simplify handwritten loop at tolerance 1 → every raw point within tolerance*2 of result, fewer points', () => {
    const tolerance = 1;
    const result = simplify(handwrittenLoop, tolerance);
    expect(result.length).toBeLessThan(handwrittenLoop.length);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const dev = maxDeviation(handwrittenLoop, result);
    // RDP guarantees perpendicular distance ≤ tolerance; actual polyline distance
    // can be slightly larger when perpendicular foot falls near a segment endpoint.
    expect(dev).toBeLessThanOrEqual(tolerance * 2);
  });

  it('TC-02: simplify with tolerance 0.5 (zoom 200%) → every raw point within 0.5*2', () => {
    const tolerance = 0.5;
    const result = simplify(handwrittenLoop, tolerance);
    expect(result.length).toBeLessThan(handwrittenLoop.length);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const dev = maxDeviation(handwrittenLoop, result);
    expect(dev).toBeLessThanOrEqual(tolerance * 2);
  });

  it('simplify preserves first and last points', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0.1 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    const result = simplify(pts, 0.5);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 3, y: 0 });
  });

  it('simplify with 2 points returns both', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    const result = simplify(pts, 1);
    expect(result).toEqual(pts);
  });
});

describe('splitPoints', () => {
  it('TC-03: STROKE_MAX_POINTS - 1 points → 1 part', () => {
    const pts = spiral5010.slice(0, STROKE_MAX_POINTS - 1);
    const parts = splitPoints(pts, STROKE_MAX_POINTS);
    expect(parts.length).toBe(1);
    expect(parts[0]!.length).toBe(STROKE_MAX_POINTS - 1);
  });

  it('TC-03: exactly STROKE_MAX_POINTS → 1 part', () => {
    const pts = spiral5010.slice(0, STROKE_MAX_POINTS);
    const parts = splitPoints(pts, STROKE_MAX_POINTS);
    expect(parts.length).toBe(1);
    expect(parts[0]!.length).toBe(STROKE_MAX_POINTS);
  });

  it('TC-03: STROKE_MAX_POINTS + 1 → 2 parts; part 2 starts with part 1 last point', () => {
    const pts = spiral5010.slice(0, STROKE_MAX_POINTS + 1);
    const parts = splitPoints(pts, STROKE_MAX_POINTS);
    expect(parts.length).toBe(2);
    // Part 1 has STROKE_MAX_POINTS points
    expect(parts[0]!.length).toBe(STROKE_MAX_POINTS);
    // Part 2 starts with the last point of part 1 (shared join point)
    const lastOfFirst = parts[0]![parts[0]!.length - 1]!;
    const firstOfSecond = parts[1]![0]!;
    expect(firstOfSecond.x).toBeCloseTo(lastOfFirst.x);
    expect(firstOfSecond.y).toBeCloseTo(lastOfFirst.y);
  });
});

describe('createStroke', () => {
  it('TC-04: single point, thick → bbox = thickness square, points length 2', () => {
    const doc = new Y.Doc();
    const thickness = PEN_THICKNESS_WORLD.thick; // 8
    const { result: id, updates } = withUpdateCount(doc, () =>
      createStroke(doc, { points: [{ x: 50, y: 70 }], color: 'black', thickness: 'thick' }, 'user-1'),
    );
    expect(id).toBeTruthy();
    expect(updates).toBe(1);
    // Read back snapshot
    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const map = objMap.get(id!)!;
    expect(map.get('type')).toBe('stroke');
    expect(map.get('width')).toBe(thickness);
    expect(map.get('height')).toBe(thickness);
    expect(map.get('x')).toBe(50 - thickness / 2);
    expect(map.get('y')).toBe(70 - thickness / 2);
    const pts = map.get('points') as number[];
    expect(pts.length).toBe(2);
  });

  it('TC-05: empty points → null, 0 updates', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () =>
      createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'user-1'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('TC-05: NaN point → null, 0 updates', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () =>
      createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'medium' }, 'user-1'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('TC-05: invalid colour "pink" → null, 0 updates', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () =>
      createStroke(doc, { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], color: 'pink' as any, thickness: 'medium' }, 'user-1'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('TC-05: invalid thickness "huge" → null, 0 updates', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () =>
      createStroke(doc, { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], color: 'black', thickness: 'huge' as any }, 'user-1'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });
});

describe('scaledPoints', () => {
  it('TC-06: width and height doubled → coordinates doubled, thickness unchanged', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, {
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 20 }],
      color: 'black',
      thickness: 'medium',
    }, 'user-1')!;

    // Get original snapshot
    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const map = objMap.get(id)!;
    const origWidth = map.get('width') as number;
    const origHeight = map.get('height') as number;
    const origBaseWidth = map.get('baseWidth') as number;
    const origBaseHeight = map.get('baseHeight') as number;

    const snap: StrokeSnap = {
      id,
      type: 'stroke',
      x: map.get('x') as number,
      y: map.get('y') as number,
      width: origWidth,
      height: origHeight,
      z: map.get('z') as number,
      points: map.get('points') as number[],
      baseWidth: origBaseWidth,
      baseHeight: origBaseHeight,
      color: 'black',
      thickness: 'medium',
    };

    const ptsOriginal = scaledPoints(snap);

    // Double the size
    const snapDoubled: StrokeSnap = { ...snap, width: origWidth * 2, height: origHeight * 2 };
    const ptsDoubled = scaledPoints(snapDoubled);

    expect(ptsDoubled.length).toBe(ptsOriginal.length);

    // The relative positions should be doubled from the bbox origin
    const originX = snap.x;
    const originY = snap.y;
    for (let i = 0; i < ptsOriginal.length; i++) {
      const relOrigX = ptsOriginal[i]!.x - originX;
      const relOrigY = ptsOriginal[i]!.y - originY;
      const relDoubledX = ptsDoubled[i]!.x - originX;
      const relDoubledY = ptsDoubled[i]!.y - originY;
      expect(relDoubledX).toBeCloseTo(relOrigX * 2);
      expect(relDoubledY).toBeCloseTo(relOrigY * 2);
    }

    // Thickness is unchanged (not part of points)
    expect(snapDoubled.thickness).toBe('medium');
    expect(PEN_THICKNESS_WORLD[snapDoubled.thickness]).toBe(4);
  });
});

describe('distanceToPolyline with stroke points', () => {
  it('TC-07: distance at 0 / 5.9 / 6.1 units → within / within / outside at zoom 1', () => {
    const doc = new Y.Doc();
    // Create a horizontal stroke from (0,0) to (100,0)
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      color: 'black',
      thickness: 'medium',
    }, 'user-1')!;

    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const map = objMap.get(id)!;
    const snap: StrokeSnap = {
      id,
      type: 'stroke',
      x: map.get('x') as number,
      y: map.get('y') as number,
      width: map.get('width') as number,
      height: map.get('height') as number,
      z: 0,
      points: map.get('points') as number[],
      baseWidth: map.get('baseWidth') as number,
      baseHeight: map.get('baseHeight') as number,
      color: 'black',
      thickness: 'medium',
    };

    const pts = scaledPoints(snap);
    // Point at (50, 0) → distance 0 (on the line)
    expect(distanceToPolyline(pts, { x: pts[0]!.x + 50, y: pts[0]!.y })).toBeCloseTo(0, 1);
    // Point 5.9 units from the line → within tolerance (max(4/2, 6) = 6)
    expect(distanceToPolyline(pts, { x: pts[0]!.x + 50, y: pts[0]!.y + 5.9 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    // Point 6.1 units from the line → outside tolerance
    expect(distanceToPolyline(pts, { x: pts[0]!.x + 50, y: pts[0]!.y + 6.1 })).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });
});

describe('smoothPath', () => {
  it('TC-08: smoothPath of 3 points → starts with M, uses Q segments, deterministic', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const d1 = smoothPath(pts);
    const d2 = smoothPath(pts);
    expect(d1).toBe(d2);
    expect(d1.startsWith('M ')).toBe(true);
    expect(d1).toContain(' Q ');
  });

  it('smoothPath of 1 point → zero-length path', () => {
    const pts: Point[] = [{ x: 5, y: 10 }];
    const d = smoothPath(pts);
    expect(d).toBe('M 5 10');
  });

  it('smoothPath of 2 points → M and L', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    const d = smoothPath(pts);
    expect(d).toContain('M ');
    expect(d).toContain(' L ');
    expect(d).not.toContain(' Q ');
  });

  it('smoothPath of empty array → empty string', () => {
    expect(smoothPath([])).toBe('');
  });
});
