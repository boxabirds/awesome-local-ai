import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '@shared/geometry/simplify';
import { createStroke, scaledPoints } from '@shared/objects/stroke';
import { distanceToPolyline } from '@shared/geometry/polyline';
import type { Point } from '@shared/geometry';
import { STROKE_MAX_POINTS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '@shared/config';
import { handwrittenLoop, spiral } from '../fixtures/pen-paths';

describe('stroke.model', () => {
  // TC-01: simplify loop at tolerance 1 → every raw point within 1 unit of result, fewer points
  describe('TC-01 simplify tolerance 1', () => {
    it('every raw point within 1 unit of result and fewer points', () => {
      const pts = handwrittenLoop(400);
      const result = simplify(pts, 1);
      expect(result.length).toBeLessThan(pts.length);
      expect(result.length).toBeGreaterThanOrEqual(2);
      // Every raw point must be within tolerance of the simplified path
      for (const p of pts) {
        const dist = distanceToPolyline(result, p);
        expect(dist).toBeLessThanOrEqual(1);
      }
    });
  });

  // TC-02: tolerance 0.5 (zoom 200%) → every raw point within 0.5
  describe('TC-02 simplify tolerance 0.5', () => {
    it('every raw point within 0.5 unit of result', () => {
      const pts = handwrittenLoop(400);
      const result = simplify(pts, 0.5);
      expect(result.length).toBeLessThan(pts.length);
      expect(result.length).toBeGreaterThanOrEqual(2);
      for (const p of pts) {
        const dist = distanceToPolyline(result, p);
        expect(dist).toBeLessThanOrEqual(0.5);
      }
    });
  });

  // TC-03: splitPoints at STROKE_MAX_POINTS-1, exactly, +1
  describe('TC-03 splitPoints boundaries', () => {
    it('STROKE_MAX_POINTS - 1 → 1 part', () => {
      const pts = spiral(STROKE_MAX_POINTS - 1);
      const parts = splitPoints(pts);
      expect(parts).toHaveLength(1);
      expect(parts[0]).toHaveLength(STROKE_MAX_POINTS - 1);
    });

    it('exactly STROKE_MAX_POINTS → 1 part', () => {
      const pts = spiral(STROKE_MAX_POINTS);
      const parts = splitPoints(pts);
      expect(parts).toHaveLength(1);
      expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    });

    it('STROKE_MAX_POINTS + 1 → 2 parts; part 2 starts with part 1 last point', () => {
      const pts = spiral(STROKE_MAX_POINTS + 1);
      const parts = splitPoints(pts);
      expect(parts).toHaveLength(2);
      expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
      // Part 2 starts with the last point of part 1
      const lastOfFirst = parts[0][parts[0].length - 1];
      expect(parts[1][0].x).toBeCloseTo(lastOfFirst.x);
      expect(parts[1][0].y).toBeCloseTo(lastOfFirst.y);
    });
  });

  // TC-04: createStroke single point thick → bbox = thickness square, points length 2
  describe('TC-04 createStroke dot', () => {
    it('single point thick creates thickness-sized bbox with 2 values in points', () => {
      const doc = new Y.Doc();
      const thicknessPx = PEN_THICKNESS_WORLD['thick'];
      const id = createStroke(doc, {
        points: [{ x: 100, y: 200 }],
        color: 'black',
        thickness: 'thick',
      }, 'test');
      expect(id).not.toBeNull();

      // Check bbox from snapshot
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id!);
      expect(obj).toBeDefined();
      const width = obj!.get('width') as number;
      const height = obj!.get('height') as number;
      expect(width).toBe(thicknessPx);
      expect(height).toBe(thicknessPx);

      const points = obj!.get('points') as number[];
      expect(points).toHaveLength(2);
    });
  });

  // TC-05: empty points, NaN point, invalid colour, invalid thickness → null
  describe('TC-05 invalid inputs return null', () => {
    it('empty points → null', () => {
      const doc = new Y.Doc();
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = createStroke(doc, {
        points: [],
        color: 'black',
        thickness: 'medium',
      }, 'test');
      expect(result).toBeNull();
      expect(updateCount).toBe(0);
    });

    it('NaN point → null', () => {
      const doc = new Y.Doc();
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = createStroke(doc, {
        points: [{ x: NaN, y: 5 }],
        color: 'black',
        thickness: 'medium',
      }, 'test');
      expect(result).toBeNull();
      expect(updateCount).toBe(0);
    });

    it('invalid colour → null (type assertion bypass)', () => {
      const doc = new Y.Doc();
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = createStroke(doc, {
        points: [{ x: 1, y: 2 }],
        color: 'pink' as any,
        thickness: 'medium',
      }, 'test');
      expect(result).toBeNull();
      expect(updateCount).toBe(0);
    });

    it('invalid thickness → null (type assertion bypass)', () => {
      const doc = new Y.Doc();
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = createStroke(doc, {
        points: [{ x: 1, y: 2 }],
        color: 'black',
        thickness: 'huge' as any,
      }, 'test');
      expect(result).toBeNull();
      expect(updateCount).toBe(0);
    });
  });

  // TC-06: scaledPoints after width and height doubled → coordinates doubled
  describe('TC-06 scaledPoints proportional resize', () => {
    it('doubled width/height doubles point coordinates, thickness unchanged', () => {
      const doc = new Y.Doc();
      const pts: Point[] = [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
        { x: 50, y: 60 },
      ];
      const id = createStroke(doc, { points: pts, color: 'black', thickness: 'medium' }, 'test');
      expect(id).not.toBeNull();

      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id!);

      // Get the original snapshot
      const snap = {
        id: id!,
        type: 'stroke' as const,
        x: obj!.get('x') as number,
        y: obj!.get('y') as number,
        width: obj!.get('width') as number,
        height: obj!.get('height') as number,
        z: 1,
        createdAt: Date.now(),
        createdBy: 'test',
        points: obj!.get('points') as readonly number[],
        baseWidth: obj!.get('baseWidth') as number,
        baseHeight: obj!.get('baseHeight') as number,
        color: 'black' as const,
        thickness: 'medium' as const,
      };

      const origScaled = scaledPoints(snap);

      // Double width and height
      const doubled = { ...snap, width: snap.width * 2, height: snap.height * 2 };
      const newScaled = scaledPoints(doubled);

      // The points relative to origin should be doubled
      for (let i = 0; i < origScaled.length; i++) {
        const relX = origScaled[i].x - snap.x;
        const relY = origScaled[i].y - snap.y;
        const newRelX = newScaled[i].x - snap.x;
        const newRelY = newScaled[i].y - snap.y;
        expect(newRelX).toBeCloseTo(relX * 2);
        expect(newRelY).toBeCloseTo(relY * 2);
      }

      // Thickness is not in scaledPoints (it's a property of the object, not the points)
      expect(doubled.thickness).toBe('medium');
    });
  });

  // TC-07: distanceToPolyline(scaledPoints) at 0, 5.9, 6.1 units
  describe('TC-07 distanceToPolyline hit tolerance', () => {
    it('within tolerance at 0, 5.9 and outside at 6.1', () => {
      const doc = new Y.Doc();
      // Create a horizontal line from (100, 100) to (200, 100)
      const pts: Point[] = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ];
      const id = createStroke(doc, { points: pts, color: 'black', thickness: 'thin' }, 'test');
      expect(id).not.toBeNull();

      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id!);
      const snap = {
        id: id!,
        type: 'stroke' as const,
        x: obj!.get('x') as number,
        y: obj!.get('y') as number,
        width: obj!.get('width') as number,
        height: obj!.get('height') as number,
        z: 1,
        createdAt: Date.now(),
        createdBy: 'test',
        points: obj!.get('points') as readonly number[],
        baseWidth: obj!.get('baseWidth') as number,
        baseHeight: obj!.get('baseHeight') as number,
        color: 'black' as const,
        thickness: 'thin' as const,
      };

      const scaled = scaledPoints(snap);

      // Distance 0: on the line
      expect(distanceToPolyline(scaled, { x: 150, y: 100 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);

      // Distance 5.9: within tolerance (6)
      expect(distanceToPolyline(scaled, { x: 150, y: 105.9 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);

      // Distance 6.1: outside tolerance
      expect(distanceToPolyline(scaled, { x: 150, y: 106.1 })).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
    });
  });

  // TC-08: smoothPath of 3 points → deterministic, starts with M, uses Q segments
  describe('TC-08 smoothPath output', () => {
    it('starts with M and uses Q segments', () => {
      const pts: Point[] = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ];
      const d1 = smoothPath(pts);
      const d2 = smoothPath(pts);
      expect(d1).toBe(d2); // deterministic
      expect(d1).toMatch(/^M/); // starts with M
      expect(d1).toContain('Q'); // uses Q segments
    });

    it('single point produces valid path', () => {
      const pts: Point[] = [{ x: 5, y: 5 }];
      const d = smoothPath(pts);
      expect(d).toMatch(/^M/);
    });

    it('empty points produces empty string', () => {
      expect(smoothPath([])).toBe('');
    });
  });
});
