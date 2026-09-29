/**
 * Unit tests for stroke model and geometry (TC-01 to TC-08).
 * Uses a real Y.Doc.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { initDoc } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { handwrittenLoop } from '../fixtures/pen-paths';
import type { Point } from '../../src/shared/geometry';

/** Max distance from any raw point to the simplified polyline. */
function maxDeviation(raw: readonly Point[], simplified: readonly Point[]): number {
  let max = 0;
  for (const p of raw) {
    const d = distanceToPolyline(simplified, p);
    if (d > max) max = d;
  }
  return max;
}

describe('simplify', () => {
  // TC-01: simplify handwritten loop at tolerance 1 → every raw point within 1 unit of result, fewer points
  it('TC-01: simplify loop at tolerance 1 stays faithful and reduces points', () => {
    const result = simplify(handwrittenLoop, 1);
    // Every raw point within 1 unit of the simplified polyline
    expect(maxDeviation(handwrittenLoop, result)).toBeLessThanOrEqual(1);
    // Fewer points in result
    expect(result.length).toBeLessThan(handwrittenLoop.length);
    // Keeps first and last
    expect(result[0]).toEqual(handwrittenLoop[0]);
    expect(result[result.length - 1]).toEqual(handwrittenLoop[handwrittenLoop.length - 1]);
  });

  // TC-02: tolerance 0.5 (zoom 200%) → every raw point within 0.5
  it('TC-02: simplify loop at tolerance 0.5 stays within 0.5', () => {
    const result = simplify(handwrittenLoop, 0.5);
    expect(maxDeviation(handwrittenLoop, result)).toBeLessThanOrEqual(0.5);
    expect(result.length).toBeLessThan(handwrittenLoop.length);
    // Should retain more points than tolerance 1 (finer)
    const coarse = simplify(handwrittenLoop, 1);
    expect(result.length).toBeGreaterThanOrEqual(coarse.length);
  });
});

describe('splitPoints', () => {
  // TC-03: splitPoints at STROKE_MAX_POINTS - 1 / exactly / + 1 → 1 / 1 / 2 parts; part 2 starts with part 1's last point
  it('TC-03: boundary values around STROKE_MAX_POINTS', () => {
    const pts: Point[] = [];
    for (let i = 0; i < STROKE_MAX_POINTS + 1; i++) {
      pts.push({ x: i, y: 0 });
    }

    // STROKE_MAX_POINTS - 1 → 1 part
    const r1 = splitPoints(pts.slice(0, STROKE_MAX_POINTS - 1));
    expect(r1.length).toBe(1);
    expect(r1[0].length).toBe(STROKE_MAX_POINTS - 1);

    // STROKE_MAX_POINTS → 1 part
    const r2 = splitPoints(pts.slice(0, STROKE_MAX_POINTS));
    expect(r2.length).toBe(1);
    expect(r2[0].length).toBe(STROKE_MAX_POINTS);

    // STROKE_MAX_POINTS + 1 → 2 parts
    const r3 = splitPoints(pts);
    expect(r3.length).toBe(2);
    // Part 2 starts with part 1's last point (shared join)
    expect(r3[1][0]).toEqual(r3[0][r3[0].length - 1]);
    // Total unique points is preserved (one overlap at join)
    let total = 0;
    for (const part of r3) total += part.length;
    expect(total).toBe(pts.length + 1); // +1 for shared join point
  });
});

describe('createStroke', () => {
  let doc: Y.Doc;
  let updateCount: number;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    updateCount = 0;
    doc.on('update', () => { updateCount++; });
  });

  // TC-04: createStroke single point thick → bbox = thickness square, points length 2 (dot)
  it('TC-04: single point creates dot with thickness square bbox', () => {
    const pt: Point = { x: 100, y: 200 };
    const id = createStroke(doc, { points: [pt], color: 'black', thickness: 'thick' }, 'user1');
    expect(id).not.toBeNull();
    expect(updateCount).toBe(1);

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id!);
    expect(obj).toBeDefined();
    expect(obj!.get('type')).toBe('stroke');
    const thickness = PEN_THICKNESS_WORLD.thick;
    const w = obj!.get('width') as number;
    const h = obj!.get('height') as number;
    expect(w).toBe(thickness);
    expect(h).toBe(thickness);
    const pts = obj!.get('points') as number[];
    expect(pts.length).toBe(2); // one point → two values
  });

  // TC-05: empty points, NaN point, colour 'pink', thickness 'huge' → null each; zero updates
  it('TC-05: invalid inputs return null with no transaction', () => {
    updateCount = 0;

    // Empty points
    expect(createStroke(doc, { points: [], color: 'black', thickness: 'thin' }, 'user')).toBeNull();

    // NaN point
    expect(createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'thin' }, 'user')).toBeNull();

    // Non-finite y
    expect(createStroke(doc, { points: [{ x: 0, y: Infinity }], color: 'black', thickness: 'thin' }, 'user')).toBeNull();

    // Unknown colour
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as any, thickness: 'thin' }, 'user')).toBeNull();

    // Unknown thickness
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' as any }, 'user')).toBeNull();

    expect(updateCount).toBe(0);
  });
});

describe('scaledPoints', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-06: scaledPoints after width and height doubled → coordinates doubled, thickness unchanged
  it('TC-06: scaled points are proportional to width/height ratio', () => {
    const points: Point[] = [{ x: 10, y: 20 }, { x: 50, y: 60 }, { x: 90, y: 40 }];
    const id = createStroke(doc, { points, color: 'black', thickness: 'medium' }, 'user')!;
    expect(id).not.toBeNull();

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id)!;
    const baseWidth = obj.get('baseWidth') as number;
    const baseHeight = obj.get('baseHeight') as number;
    const origWidth = obj.get('width') as number;
    const origHeight = obj.get('height') as number;

    // Double the width and height
    doc.transact(() => {
      obj.set('width', origWidth * 2);
      obj.set('height', origHeight * 2);
    });

    const snap: StrokeSnap = {
      id,
      type: 'stroke',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      width: origWidth * 2,
      height: origHeight * 2,
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
      points: obj.get('points') as number[],
      baseWidth,
      baseHeight,
      color: obj.get('color') as any,
      thickness: obj.get('thickness') as any,
    };

    const scaled = scaledPoints(snap);
    const origScaled = scaledPoints({
      ...snap,
      width: origWidth,
      height: origHeight,
    });

    // Each scaled coordinate's offset from origin should be approximately doubled
    for (let i = 0; i < scaled.length; i++) {
      const origOffsetX = origScaled[i].x - snap.x;
      const origOffsetY = origScaled[i].y - snap.y;
      expect(scaled[i].x - snap.x).toBeCloseTo(origOffsetX * 2, 1);
      expect(scaled[i].y - snap.y).toBeCloseTo(origOffsetY * 2, 1);
    }

    // Thickness is unchanged
    expect(snap.thickness).toBe('medium');
    expect(PEN_THICKNESS_WORLD[snap.thickness]).toBe(4);
  });
});

describe('hit test via distanceToPolyline', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-07: distanceToPolyline on scaledPoints at 0, 5.9, 6.1 units → within / within / outside tolerance at zoom 1
  it('TC-07: hit tolerance boundaries on a horizontal line', () => {
    // Create a horizontal stroke
    const points: Point[] = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }];
    const id = createStroke(doc, { points, color: 'black', thickness: 'thin' }, 'user')!;

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id)!;
    const baseWidth = obj.get('baseWidth') as number;
    const baseHeight = obj.get('baseHeight') as number;

    const snap: StrokeSnap = {
      id,
      type: 'stroke',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      width: obj.get('width') as number,
      height: obj.get('height') as number,
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
      points: obj.get('points') as number[],
      baseWidth,
      baseHeight,
      color: 'black',
      thickness: 'thin',
    };

    const scaled = scaledPoints(snap);

    // At zoom 1, tolerance = max(thickness/2, STROKE_HIT_TOLERANCE_PX/1) = max(1, 6) = 6
    const tolerance = Math.max(PEN_THICKNESS_WORLD.thin / 2, STROKE_HIT_TOLERANCE_PX / 1);

    // On the line → distance ≈ 0 → within tolerance
    expect(distanceToPolyline(scaled, { x: 200, y: 100 })).toBeLessThanOrEqual(tolerance);

    // 5.9 units away → within tolerance (6)
    expect(distanceToPolyline(scaled, { x: 200, y: 105.9 })).toBeLessThanOrEqual(tolerance);

    // 6.1 units away → outside tolerance (6)
    expect(distanceToPolyline(scaled, { x: 200, y: 106.1 })).toBeGreaterThan(tolerance);
  });
});

describe('smoothPath', () => {
  // TC-08: smoothPath of 3 points → deterministic string starting with M and using Q segments
  it('TC-08: generates SVG path with M and Q', () => {
    const pts: Point[] = [{ x: 10, y: 20 }, { x: 50, y: 60 }, { x: 90, y: 40 }];
    const path = smoothPath(pts);
    expect(path).toMatch(/^M/);
    expect(path).toContain('Q');
    // Deterministic: same input → same output
    expect(smoothPath(pts)).toBe(path);
    // Single point → zero-length path (M only, for round dot)
    const dot = smoothPath([{ x: 10, y: 20 }]);
    expect(dot).toMatch(/^M/);
  });
});
