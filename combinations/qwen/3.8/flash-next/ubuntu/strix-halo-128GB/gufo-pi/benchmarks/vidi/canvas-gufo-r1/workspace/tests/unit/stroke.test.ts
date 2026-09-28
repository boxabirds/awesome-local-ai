/**
 * Unit tests for stroke model and geometry (TC-01 to TC-08).
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { handwrittenLoop } from '../fixtures/pen-paths';
import { STROKE_MAX_POINTS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { initDoc } from '../../src/shared/board-model';
import type { Point } from '../../src/shared/geometry';

describe('simplify', () => {
  // TC-01: simplify handwritten loop at tolerance 1 → every raw point within 1 unit, fewer points
  it('TC-01: simplify loop at tolerance 1', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 1);
    expect(result.length).toBeLessThan(raw.length);
    // Every raw point must be within tolerance of the result polyline
    for (const p of raw) {
      const d = distanceToPolyline(result, p);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  // TC-02: tolerance 0.5 (zoom 200%) → every raw point within 0.5
  it('TC-02: simplify loop at tolerance 0.5', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 0.5);
    // May or may not reduce points at this tight tolerance
    for (const p of raw) {
      const d = distanceToPolyline(result, p);
      expect(d).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('splitPoints', () => {
  // TC-03: splitPoints at STROKE_MAX_POINTS - 1, exactly, + 1
  it('TC-03: boundary at STROKE_MAX_POINTS - 1, exactly, + 1', () => {
    const pts: Point[] = Array.from({ length: STROKE_MAX_POINTS - 1 }, (_, i) => ({ x: i, y: i }));
    const parts = splitPoints(pts);
    expect(parts.length).toBe(1);

    const pts2: Point[] = Array.from({ length: STROKE_MAX_POINTS }, (_, i) => ({ x: i, y: i }));
    const parts2 = splitPoints(pts2);
    expect(parts2.length).toBe(1);

    const pts3: Point[] = Array.from({ length: STROKE_MAX_POINTS + 1 }, (_, i) => ({ x: i, y: i }));
    const parts3 = splitPoints(pts3);
    expect(parts3.length).toBe(2);
    // Part 2 starts with part 1's last point
    expect(parts3[1][0].x).toBe(parts3[0][parts3[0].length - 1].x);
    expect(parts3[1][0].y).toBe(parts3[0][parts3[0].length - 1].y);
  });
});

describe('createStroke', () => {
  // TC-04: single point thick → bbox = thickness square, points length 2
  it('TC-04: single point creates a dot with correct bbox', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const thickness = 'thick';
    const tWorld = PEN_THICKNESS_WORLD[thickness];
    const id = createStroke(doc, { points: [{ x: 100, y: 200 }], color: 'red', thickness }, 'user1');
    expect(id).not.toBeNull();

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id!);
    expect(obj).toBeDefined();
    expect(obj!.get('width')).toBe(tWorld);
    expect(obj!.get('height')).toBe(tWorld);
    const pts = obj!.get('points') as number[];
    expect(pts.length).toBe(2);
  });

  // TC-05: empty points, NaN point, colour 'pink', thickness 'huge' → null
  it('TC-05: invalid inputs return null, no doc updates', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    expect(createStroke(doc, { points: [], color: 'red', thickness: 'thin' }, 'u')).toBeNull();
    expect(createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'red', thickness: 'thin' }, 'u')).toBeNull();
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as any, thickness: 'thin' }, 'u')).toBeNull();
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'red', thickness: 'huge' as any }, 'u')).toBeNull();

    expect(updateCount).toBe(0);
  });
});

describe('scaledPoints', () => {
  // TC-06: width and height doubled → coordinates doubled, thickness unchanged
  it('TC-06: scaled points after resize', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(doc, {
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      color: 'blue',
      thickness: 'thin',
    }, 'u');
    expect(id).not.toBeNull();

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id!);
    // Now simulate resize: double width and height
    const origW = obj!.get('width') as number;
    const origH = obj!.get('height') as number;
    obj!.set('width', origW * 2);
    obj!.set('height', origH * 2);

    const snap: StrokeSnap = {
      id: id!,
      type: 'stroke',
      x: obj!.get('x') as number,
      y: obj!.get('y') as number,
      width: obj!.get('width') as number,
      height: obj!.get('height') as number,
      z: 0,
      createdAt: 0,
      createdBy: 'u',
      points: obj!.get('points') as readonly number[],
      baseWidth: obj!.get('baseWidth') as number,
      baseHeight: obj!.get('baseHeight') as number,
      color: 'blue',
      thickness: 'thin',
      text: '',
    };
    const pts = scaledPoints(snap);
    expect(pts.length).toBe(2);
    // Verify coordinates doubled relative to bbox origin
    const sx = snap.width / snap.baseWidth;
    const sy = snap.height / snap.baseHeight;
    expect(sx).toBeCloseTo(2);
    expect(sy).toBeCloseTo(2);
    expect(pts[0].x).toBeCloseTo(snap.x + snap.points[0] * 2);
    expect(pts[0].y).toBeCloseTo(snap.y + snap.points[1] * 2);
  });

  // TC-07: distanceToPolyline on scaledPoints at 0, 5.9, 6.1 units
  it('TC-07: hit test boundary at tolerance', () => {
    // Create a simple horizontal stroke
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    // distance at 0 from line = 0 (on line)
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeCloseTo(0);
    // distance at 5.9 from line
    expect(distanceToPolyline(pts, { x: 50, y: 5.9 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    // distance at 6.1 from line
    expect(distanceToPolyline(pts, { x: 50, y: 6.1 })).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });
});

describe('smoothPath', () => {
  // TC-08: smoothPath of 3 points → deterministic string starting with M, using Q segments
  it('TC-08: smoothPath produces Q segments', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const path = smoothPath(pts);
    expect(path).toMatch(/^M/);
    expect(path).toContain('Q');
    // Deterministic
    expect(smoothPath(pts)).toBe(path);
  });
});
