/**
 * Unit tests for stroke model and geometry (story 11).
 * TC-01 through TC-08.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';

import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import type { Point } from '../../src/shared/board-model';
import { handwrittenLoop } from '../fixtures/pen-paths';

describe('simplify (TC-01, TC-02)', () => {
  it('TC-01: simplify handwritten loop at tolerance 1 → every raw point within 1 unit of result, fewer points', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 1);

    // Result has fewer points
    expect(result.length).toBeLessThan(raw.length);
    expect(result.length).toBeGreaterThanOrEqual(2);

    // Every raw point lies within 1 unit of the result polyline
    for (const p of raw) {
      const dist = distanceToPolyline(result, p);
      expect(dist).toBeLessThanOrEqual(1.0001); // small fp tolerance
    }
  });

  it('TC-02: simplify at tolerance 0.5 (zoom 200%) → every raw point within 0.5 units', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 0.5);

    expect(result.length).toBeLessThan(raw.length);
    expect(result.length).toBeGreaterThanOrEqual(2);

    for (const p of raw) {
      const dist = distanceToPolyline(result, p);
      expect(dist).toBeLessThanOrEqual(0.5001);
    }
  });
});

describe('splitPoints (TC-03)', () => {
  it('TC-03: STROKE_MAX_POINTS - 1 → 1 part; exactly → 1 part; +1 → 2 parts; part 2 starts with part 1 last point', () => {
    const pts: Point[] = [];
    for (let i = 0; i < STROKE_MAX_POINTS + 1; i++) {
      pts.push({ x: i, y: i * 2 });
    }

    // STROKE_MAX_POINTS - 1 → 1 part
    const result1 = splitPoints(pts.slice(0, STROKE_MAX_POINTS - 1), STROKE_MAX_POINTS);
    expect(result1.length).toBe(1);
    expect(result1[0].length).toBe(STROKE_MAX_POINTS - 1);

    // Exactly STROKE_MAX_POINTS → 1 part
    const result2 = splitPoints(pts.slice(0, STROKE_MAX_POINTS), STROKE_MAX_POINTS);
    expect(result2.length).toBe(1);
    expect(result2[0].length).toBe(STROKE_MAX_POINTS);

    // STROKE_MAX_POINTS + 1 → 2 parts
    const result3 = splitPoints(pts, STROKE_MAX_POINTS);
    expect(result3.length).toBe(2);
    // Part 2 starts with part 1's last point (shared join point)
    const lastOfPart1 = result3[0][result3[0].length - 1];
    const firstOfPart2 = result3[1][0];
    expect(firstOfPart2.x).toBe(lastOfPart1.x);
    expect(firstOfPart2.y).toBe(lastOfPart1.y);
  });
});

describe('createStroke (TC-04, TC-05)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-04: single point, thick → bbox = thickness square, points length 2 (dot)', () => {
    const thickness = PEN_THICKNESS_WORLD['thick']; // 8
    const id = createStroke(doc, {
      points: [{ x: 50, y: 50 }],
      color: 'black',
      thickness: 'thick',
    }, 'local');

    expect(id).not.toBeNull();

    // Read back
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const entry = objects.get(id!)!;
    expect(entry.get('type')).toBe('stroke');
    expect(entry.get('width')).toBe(thickness);
    expect(entry.get('height')).toBe(thickness);
    const pts = entry.get('points') as number[];
    expect(pts.length).toBe(2); // one point → [x, y]
  });

  it('TC-05: empty points → null, zero updates', () => {
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    const result = createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'local');
    expect(result).toBeNull();
    expect(updateCount).toBe(0);
  });

  it('TC-05: NaN point → null, zero updates', () => {
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    const result = createStroke(doc, {
      points: [{ x: NaN, y: 10 }],
      color: 'black',
      thickness: 'medium',
    }, 'local');
    expect(result).toBeNull();
    expect(updateCount).toBe(0);
  });

  it('TC-05: unknown colour "pink" → null, zero updates', () => {
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    const result = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      color: 'pink' as any,
      thickness: 'medium',
    }, 'local');
    expect(result).toBeNull();
    expect(updateCount).toBe(0);
  });

  it('TC-05: unknown thickness "huge" → null, zero updates', () => {
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    const result = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      color: 'black',
      thickness: 'huge' as any,
    }, 'local');
    expect(result).toBeNull();
    expect(updateCount).toBe(0);
  });
});

describe('scaledPoints (TC-06)', () => {
  it('TC-06: width and height doubled → coordinates doubled, thickness unchanged', () => {
    const snap: StrokeSnap = {
      id: 'test',
      type: 'stroke',
      x: 10,
      y: 20,
      z: 1,
      width: 200,
      height: 100,
      points: [5, 10, 15, 20, 25, 30], // 3 points relative to origin: (5,10), (15,20), (25,30)
      baseWidth: 100,
      baseHeight: 50,
      color: 'black',
      thickness: 'medium',
    };

    const pts = scaledPoints(snap);
    expect(pts.length).toBe(3);
    // Scale: x * (200/100) = x*2, y * (100/50) = y*2
    expect(pts[0]).toEqual({ x: 10, y: 20 });
    expect(pts[1]).toEqual({ x: 30, y: 40 });
    expect(pts[2]).toEqual({ x: 50, y: 60 });
    // Thickness is still medium (unchanged)
    expect(snap.thickness).toBe('medium');
  });
});

describe('distanceToPolyline on scaledPoints (TC-07)', () => {
  it('TC-07: at 0, 5.9, 6.1 units → within/within/outside STROKE_HIT_TOLERANCE_PX at zoom 1', () => {
    // A horizontal line from (0,0) to (100,0)
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    // Point directly on the line: distance = 0
    const d0 = distanceToPolyline(pts, { x: 50, y: 0 });
    expect(d0).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);

    // Point 5.9 units above: distance = 5.9 ≤ 6
    const d1 = distanceToPolyline(pts, { x: 50, y: 5.9 });
    expect(d1).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);

    // Point 6.1 units above: distance = 6.1 > 6
    const d2 = distanceToPolyline(pts, { x: 50, y: 6.1 });
    expect(d2).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });
});

describe('smoothPath (TC-08)', () => {
  it('TC-08: smoothPath of 3 points → deterministic string starting with M and using Q segments', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const path = smoothPath(pts);

    expect(path).toMatch(/^M /);
    expect(path).toContain(' Q ');

    // Deterministic: calling again gives same result
    expect(smoothPath(pts)).toBe(path);
  });
});
