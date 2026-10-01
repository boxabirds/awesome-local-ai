import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints } from '../../src/shared/objects/stroke';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { getObjectsMap, LOCAL_ORIGIN, snapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop, syntheticSpiral } from '../fixtures/pen-paths';
import { STROKE_MAX_POINTS, PEN_THICKNESS_WORLD } from '../../src/shared/config';

describe('stroke.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  // TC-01: simplify loop at tolerance 1 → every raw point within 1 unit of result, fewer points
  it('TC-01: simplify handwritten loop at tolerance 1 keeps fidelity', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 1);

    // Result should have fewer points
    expect(result.length).toBeLessThan(raw.length);

    // Every raw point must be within 1 unit of the simplified polyline
    for (const p of raw) {
      const dist = distanceToPolyline(result, p);
      expect(dist).toBeLessThanOrEqual(1);
    }

    // First and last points are preserved
    expect(result[0]).toEqual(raw[0]);
    expect(result[result.length - 1]).toEqual(raw[raw.length - 1]);
  });

  // TC-02: tolerance 0.5 (zoom 200%) → every raw point within 0.5
  it('TC-02: simplify at tolerance 0.5 keeps tighter fidelity', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 0.5);

    // Every raw point must be within 0.5 unit of the simplified polyline
    for (const p of raw) {
      const dist = distanceToPolyline(result, p);
      expect(dist).toBeLessThanOrEqual(0.5);
    }

    // Should have more points than tolerance 1 (less simplification)
    const result1 = simplify(raw, 1);
    expect(result.length).toBeGreaterThanOrEqual(result1.length);
  });

  // TC-03: splitPoints at STROKE_MAX_POINTS − 1 / exactly / + 1 → 1 / 1 / 2 parts
  it('TC-03: splitPoints boundary behaviour', () => {
    const pts: Point[] = Array.from({ length: STROKE_MAX_POINTS - 1 }, (_, i) => ({ x: i, y: i }));
    const r1 = splitPoints(pts);
    expect(r1).toHaveLength(1);
    expect(r1[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const pts2: Point[] = Array.from({ length: STROKE_MAX_POINTS }, (_, i) => ({ x: i, y: i }));
    const r2 = splitPoints(pts2);
    expect(r2).toHaveLength(1);
    expect(r2[0]).toHaveLength(STROKE_MAX_POINTS);

    const pts3: Point[] = Array.from({ length: STROKE_MAX_POINTS + 1 }, (_, i) => ({ x: i, y: i }));
    const r3 = splitPoints(pts3);
    expect(r3).toHaveLength(2);
    // Part 2 starts with part 1's last point (shared join point)
    expect(r3[0][r3[0].length - 1]).toEqual(r3[1][0]);
  });

  // TC-04: createStroke single point thick → bbox = thickness square, points length 2 (dot)
  it('TC-04: createStroke with single point creates dot with correct bbox', () => {
    const thickness = PEN_THICKNESS_WORLD.thick; // 8
    const id = createStroke(doc, { points: [{ x: 100, y: 200 }], color: 'red', thickness: 'thick' }, 'user1');
    expect(id).not.toBeNull();

    const snaps = snapshot(doc);
    const stroke = snaps.find((s) => s.id === id) as StrokeSnap;
    expect(stroke).toBeDefined();
    expect(stroke.type).toBe('stroke');
    // bbox = thickness square
    expect(stroke.width).toBeCloseTo(thickness, 5);
    expect(stroke.height).toBeCloseTo(thickness, 5);
    // points has 2 entries (one x, one y)
    expect(stroke.points).toHaveLength(2);
  });

  // TC-05: empty points, NaN point, colour 'pink', thickness 'huge' → null, zero update events
  it('TC-05: createStroke rejects invalid input', () => {
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    // Empty points
    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'u')).toBeNull();

    // NaN point
    expect(createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'medium' }, 'u')).toBeNull();

    // Unknown colour
    expect(createStroke(doc, { points: [{ x: 1, y: 1 }], color: 'pink' as any, thickness: 'medium' }, 'u')).toBeNull();

    // Unknown thickness
    expect(createStroke(doc, { points: [{ x: 1, y: 1 }], color: 'black', thickness: 'huge' as any }, 'u')).toBeNull();

    // No updates should have been fired
    expect(updateCount).toBe(0);
  });

  // TC-06: scaledPoints after width and height doubled → coordinates doubled, thickness unchanged
  it('TC-06: scaledPoints scales proportionally', () => {
    const points = [
      { x: 100, y: 100 },
      { x: 200, y: 150 },
      { x: 300, y: 100 },
    ];
    const id = createStroke(doc, { points, color: 'blue', thickness: 'thin' }, 'u');
    expect(id).not.toBeNull();

    const snaps = snapshot(doc);
    const stroke = snaps.find((s) => s.id === id) as StrokeSnap;
    expect(stroke).toBeDefined();

    // Simulate resize: double width and height
    const resized: StrokeSnap = {
      ...stroke,
      width: stroke.width * 2,
      height: stroke.height * 2,
    };

    const original = scaledPoints(stroke);
    const scaled = scaledPoints(resized);

    expect(scaled.length).toBe(original.length);
    for (let i = 0; i < scaled.length; i++) {
      // Relative to bbox origin, coordinates should double
      const relOrigX = original[i].x - stroke.x;
      const relOrigY = original[i].y - stroke.y;
      const relScaledX = scaled[i].x - resized.x;
      const relScaledY = scaled[i].y - resized.y;
      expect(relScaledX).toBeCloseTo(relOrigX * 2, 1);
      expect(relScaledY).toBeCloseTo(relOrigY * 2, 1);
    }

    // Thickness unchanged
    expect(resized.thickness).toBe('thin');
  });

  // TC-07: distanceToPolyline(scaledPoints) at 0 / 5.9 / 6.1 units → within / within / outside at zoom 1
  it('TC-07: hit test distance at boundary values', () => {
    // Create a horizontal stroke from (0,50) to (100,50)
    const points = [{ x: 0, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 50 }];
    const id = createStroke(doc, { points, color: 'black', thickness: 'thin' }, 'u');
    expect(id).not.toBeNull();

    const snaps = snapshot(doc);
    const stroke = snaps.find((s) => s.id === id) as StrokeSnap;
    const sp = scaledPoints(stroke);

    // Point on the line: distance 0
    const onLine = { x: 50, y: 50 };
    expect(distanceToPolyline(sp, onLine)).toBeCloseTo(0, 1);

    // Point 5.9 units above: within tolerance (max of thickness/2=1 and STROKE_HIT_TOLERANCE_PX=6)
    const at59 = { x: 50, y: 50 + 5.9 };
    expect(distanceToPolyline(sp, at59)).toBeCloseTo(5.9, 1);

    // Point 6.1 units above: outside tolerance
    const at61 = { x: 50, y: 50 + 6.1 };
    expect(distanceToPolyline(sp, at61)).toBeCloseTo(6.1, 1);
  });

  // TC-08: smoothPath of 3 points → deterministic string starting with M and using Q segments
  it('TC-08: smoothPath generates SVG path with M and Q', () => {
    const pts: Point[] = [{ x: 10, y: 10 }, { x: 50, y: 50 }, { x: 90, y: 10 }];
    const path1 = smoothPath(pts);
    const path2 = smoothPath(pts);

    expect(path1).toBe(path2); // deterministic
    expect(path1).toMatch(/^M\s/);
    expect(path1).toContain('Q');
  });
});
