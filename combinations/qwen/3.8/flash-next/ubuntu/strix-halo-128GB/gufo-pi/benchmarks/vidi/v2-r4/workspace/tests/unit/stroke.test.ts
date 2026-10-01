/**
 * Unit tests for stroke model and geometry (story 11).
 * TC-01 through TC-08.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { STROKE_MAX_POINTS, STROKE_HIT_TOLERANCE_PX, PEN_THICKNESS_WORLD } from '../../src/shared/config';
import { handwrittenLoop } from '../fixtures/pen-paths';
import type { Point } from '../../src/client/canvas/camera';

describe('simplify (RDP)', () => {
  it('TC-01: simplify loop at tolerance 1 → every raw point within 1 unit of result, fewer points', () => {
    const pts = handwrittenLoop();
    const result = simplify(pts, 1);
    // Result should have fewer points
    expect(result.length).toBeLessThan(pts.length);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Every raw point must be within 1 unit of the result polyline
    for (const p of pts) {
      const dist = distanceToPolyline(result, p);
      expect(dist).toBeLessThanOrEqual(1);
    }
  });

  it('TC-02: simplify at tolerance 0.5 (zoom 200%) → every raw point within 0.5', () => {
    const pts = handwrittenLoop();
    const result = simplify(pts, 0.5);
    expect(result.length).toBeLessThanOrEqual(pts.length);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Every raw point must be within 0.5 units of the result polyline
    for (const p of pts) {
      const dist = distanceToPolyline(result, p);
      expect(dist).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('splitPoints', () => {
  it('TC-03: splitPoints at STROKE_MAX_POINTS − 1 / exactly / + 1', () => {
    // Create points at various lengths
    const pts: Point[] = Array.from({ length: STROKE_MAX_POINTS + 1 }, (_, i) => ({ x: i, y: i }));

    // STROKE_MAX_POINTS - 1: single part
    const result1 = splitPoints(pts.slice(0, STROKE_MAX_POINTS - 1));
    expect(result1).toHaveLength(1);
    expect(result1[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    // Exactly STROKE_MAX_POINTS: single part
    const result2 = splitPoints(pts.slice(0, STROKE_MAX_POINTS));
    expect(result2).toHaveLength(1);
    expect(result2[0]).toHaveLength(STROKE_MAX_POINTS);

    // STROKE_MAX_POINTS + 1: two parts
    const result3 = splitPoints(pts);
    expect(result3).toHaveLength(2);
    // First part ends with the same point that second part starts with
    const lastOfFirst = result3[0]![result3[0]!.length - 1]!;
    const firstOfSecond = result3[1]![0]!;
    expect(lastOfFirst.x).toBe(firstOfSecond.x);
    expect(lastOfFirst.y).toBe(firstOfSecond.y);
  });
});

describe('createStroke', () => {
  it('TC-04: single point thick → bbox = thickness square, points length 2 (dot)', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: [{ x: 100, y: 200 }], color: 'black', thickness: 'thick' }, 'user1');
    expect(id).not.toBeNull();
    // Read back the object
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(id!)!;
    const width = obj.get('width') as number;
    const height = obj.get('height') as number;
    const thickness = PEN_THICKNESS_WORLD.thick;
    expect(width).toBe(thickness);
    expect(height).toBe(thickness);
    const points = obj.get('points') as number[];
    expect(points).toHaveLength(2);
  });

  it('TC-05: empty points, NaN point, unknown colour/thickness → null, zero update events', () => {
    const doc = new Y.Doc();
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    // Empty points
    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'u')).toBeNull();

    // NaN point
    expect(createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'medium' }, 'u')).toBeNull();

    // Unknown colour 'pink'
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as any, thickness: 'medium' }, 'u')).toBeNull();

    // Unknown thickness 'huge'
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' as any }, 'u')).toBeNull();

    expect(updateCount).toBe(0);
  });
});

describe('scaledPoints', () => {
  it('TC-06: width 2x and height 2x → coordinates doubled, thickness unchanged', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, {
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 20 }],
      color: 'blue',
      thickness: 'thin',
    }, 'u');
    expect(id).not.toBeNull();

    // Build a snapshot with doubled width/height
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(id!)!;
    const baseWidth = obj.get('baseWidth') as number;
    const baseHeight = obj.get('baseHeight') as number;
    const x = obj.get('x') as number;
    const y = obj.get('y') as number;
    const points = obj.get('points') as number[];

    const snap: StrokeSnap = {
      id: id!,
      type: 'stroke',
      x, y,
      width: baseWidth * 2,
      height: baseHeight * 2,
      points,
      baseWidth,
      baseHeight,
      color: 'blue',
      thickness: 'thin',
      z: 1,
      createdAt: 0,
    };

    const scaled = scaledPoints(snap);
    const original = scaledPoints({ ...snap, width: baseWidth, height: baseHeight });

    // Each scaled coordinate relative to origin should be 2x the original
    for (let i = 0; i < scaled.length; i++) {
      expect(scaled[i]!.x - x).toBeCloseTo((original[i]!.x - x) * 2);
      expect(scaled[i]!.y - y).toBeCloseTo((original[i]!.y - y) * 2);
    }

    // Thickness is unchanged (it's a property of the snap, not scaled)
    expect(snap.thickness).toBe('thin');
  });
});

describe('distanceToPolyline with scaled points (hit test)', () => {
  it('TC-07: distances at 0 / 5.9 / 6.1 units → within / within / outside tolerance at zoom 1', () => {
    // A horizontal line at y=100 from x=0 to x=200
    const pts: Point[] = [{ x: 0, y: 100 }, { x: 200, y: 100 }];

    // Click directly on the line: distance 0
    expect(distanceToPolyline(pts, { x: 100, y: 100 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);

    // Click 5.9 units away: still within tolerance
    expect(distanceToPolyline(pts, { x: 100, y: 105.9 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);

    // Click 6.1 units away: outside tolerance
    expect(distanceToPolyline(pts, { x: 100, y: 106.1 })).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });
});

describe('smoothPath', () => {
  it('TC-08: smoothPath of 3 points → deterministic string starting with M and using Q segments', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const path = smoothPath(pts);
    expect(path).toMatch(/^M/);
    expect(path).toContain('Q');
    // Should be deterministic (call twice, same result)
    expect(smoothPath(pts)).toBe(path);
  });
});
