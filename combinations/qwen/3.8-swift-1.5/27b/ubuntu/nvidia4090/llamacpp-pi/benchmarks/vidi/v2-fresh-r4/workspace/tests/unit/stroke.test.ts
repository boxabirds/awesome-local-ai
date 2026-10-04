/**
 * Unit tests for stroke.model (story 11): TC-01 to TC-08.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_HIT_TOLERANCE_PX,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';
import { snapshot } from '../../src/shared/board-model';

describe('stroke.model', () => {
  describe('simplify (RDP)', () => {
    it('TC-01: simplify handwritten loop at tolerance 1 → every raw point within 1 unit, fewer points', () => {
      const raw = handwrittenLoop();
      const result = simplify(raw, 1);

      // Fewer points than input
      expect(result.length).toBeLessThan(raw.length);
      expect(result.length).toBeGreaterThanOrEqual(2);

      // Every raw point is within 1 unit of the result polyline
      for (const p of raw) {
        const d = distanceToPolyline(result, p);
        expect(d).toBeLessThanOrEqual(1 + 1e-9);
      }
    });

    it('TC-02: simplify at tolerance 0.5 (zoom 200%) → every raw point within 0.5', () => {
      const raw = underline();
      const result = simplify(raw, 0.5);

      expect(result.length).toBeLessThan(raw.length);
      expect(result.length).toBeGreaterThanOrEqual(2);

      for (const p of raw) {
        const d = distanceToPolyline(result, p);
        expect(d).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    });
  });

  describe('splitPoints', () => {
    it('TC-03: splitPoints at STROKE_MAX_POINTS - 1 / exactly / + 1', () => {
      // -1: should be 1 part
      const pts1: Point[] = Array.from({ length: STROKE_MAX_POINTS - 1 }, (_, i) => ({ x: i, y: 0 }));
      const parts1 = splitPoints(pts1);
      expect(parts1.length).toBe(1);
      expect(parts1[0].length).toBe(STROKE_MAX_POINTS - 1);

      // Exactly: should be 1 part
      const pts2: Point[] = Array.from({ length: STROKE_MAX_POINTS }, (_, i) => ({ x: i, y: 0 }));
      const parts2 = splitPoints(pts2);
      expect(parts2.length).toBe(1);
      expect(parts2[0].length).toBe(STROKE_MAX_POINTS);

      // +1: should be 2 parts, part 2 starts with part 1's last point
      const pts3: Point[] = Array.from({ length: STROKE_MAX_POINTS + 1 }, (_, i) => ({ x: i, y: 0 }));
      const parts3 = splitPoints(pts3);
      expect(parts3.length).toBe(2);
      // Part 1 has STROKE_MAX_POINTS points
      expect(parts3[0].length).toBe(STROKE_MAX_POINTS);
      // Part 2 starts with part 1's last point (shared join)
      expect(parts3[1][0]).toEqual(parts3[0][parts3[0].length - 1]);
    });
  });

  describe('createStroke', () => {
    it('TC-04: single point thick → bbox = thickness square, points length 2', () => {
      const doc = new Y.Doc();
      const thick = PEN_THICKNESS_WORLD.thick; // 8
      const id = createStroke(doc, {
        points: [{ x: 100, y: 200 }],
        color: 'red',
        thickness: 'thick',
      }, 'user1');

      expect(id).not.toBeNull();
      const snaps = snapshot(doc);
      const stroke = snaps.find(s => s.id === id) as StrokeSnap;
      expect(stroke).toBeDefined();
      expect(stroke.type).toBe('stroke');
      expect(stroke.width).toBe(thick);
      expect(stroke.height).toBe(thick);
      expect(stroke.points.length).toBe(2); // one point = 2 numbers
      expect(stroke.color).toBe('red');
      expect(stroke.thickness).toBe('thick');
    });

    it('TC-05: empty points, NaN point, colour pink, thickness huge → null', () => {
      const doc = new Y.Doc();
      let updateCount = 0;
      doc.on('update', () => updateCount++);

      // Empty points
      expect(createStroke(doc, { points: [], color: 'red', thickness: 'medium' }, 'u1')).toBeNull();

      // NaN point
      expect(createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'red', thickness: 'medium' }, 'u1')).toBeNull();

      // Unknown colour
      expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as any, thickness: 'medium' }, 'u1')).toBeNull();

      // Unknown thickness
      expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'red', thickness: 'huge' as any }, 'u1')).toBeNull();

      expect(updateCount).toBe(0);
    });
  });

  describe('scaledPoints', () => {
    it('TC-06: after width and height doubled → coordinates doubled, thickness unchanged', () => {
      const doc = new Y.Doc();
      const points: Point[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      const id = createStroke(doc, { points, color: 'blue', thickness: 'thin' }, 'u1');
      expect(id).not.toBeNull();

      let snaps = snapshot(doc);
      let stroke = snaps.find(s => s.id === id) as StrokeSnap;
      const origW = stroke.width!;
      const origH = stroke.height!;
      const origScaled = scaledPoints(stroke);

      // Double the size
      const objects = doc.getMap('objects');
      const obj = objects.get(id!) as Y.Map<unknown>;
      doc.transact(() => {
        obj.set('width', origW * 2);
        obj.set('height', origH * 2);
      });

      snaps = snapshot(doc);
      stroke = snaps.find(s => s.id === id) as StrokeSnap;
      const newScaled = scaledPoints(stroke);

      // The key check: the spread between points is doubled
      const origSpread = origScaled[1].x - origScaled[0].x;
      const newSpread = newScaled[1].x - newScaled[0].x;
      expect(newSpread).toBeCloseTo(origSpread * 2);

      const origSpreadY = origScaled[2].y - origScaled[0].y;
      const newSpreadY = newScaled[2].y - newScaled[0].y;
      expect(newSpreadY).toBeCloseTo(origSpreadY * 2);

      // Thickness is unchanged
      expect(stroke.thickness).toBe('thin');
      expect(PEN_THICKNESS_WORLD[stroke.thickness]).toBe(PEN_THICKNESS_WORLD.thin);
    });
  });

  describe('hit test (distanceToPolyline)', () => {
    it('TC-07: distanceToPolyline at 0, 5.9, 6.1 units → within/within/outside at zoom 1', () => {
      // A horizontal line from (0,0) to (100,0)
      const line: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

      // Distance 0: on the line
      const d0 = distanceToPolyline(line, { x: 50, y: 0 });
      expect(d0).toBe(0);
      expect(d0 <= STROKE_HIT_TOLERANCE_PX).toBe(true);

      // Distance 5.9: within tolerance (6)
      const d59 = distanceToPolyline(line, { x: 50, y: 5.9 });
      expect(d59).toBeCloseTo(5.9);
      expect(d59 <= STROKE_HIT_TOLERANCE_PX).toBe(true);

      // Distance 6.1: outside tolerance
      const d61 = distanceToPolyline(line, { x: 50, y: 6.1 });
      expect(d61).toBeCloseTo(6.1);
      expect(d61 <= STROKE_HIT_TOLERANCE_PX).toBe(false);
    });
  });

  describe('smoothPath', () => {
    it('TC-08: 3 points → deterministic string starting with M and using Q segments', () => {
      const pts: Point[] = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ];
      const path = smoothPath(pts);

      expect(path).toMatch(/^M 0 0/);
      expect(path).toContain('Q');
      // Deterministic
      expect(smoothPath(pts)).toBe(path);
    });
  });
});
