/**
 * Unit tests for the stroke model and geometry (story 11, stroke.model).
 * TC-01 to TC-08.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, objects, LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  simplify,
  splitPoints,
  smoothPath,
} from '../../src/shared/geometry/simplify';
import {
  createStroke,
  scaledPoints,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  STROKE_MAX_POINTS,
  STROKE_HIT_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
  PEN_COLORS,
} from '../../src/shared/config';
import { handwrittenLoop, underline, longSpiral } from '../fixtures/pen-paths';
import type { Point } from '../../src/shared/geometry';

/** Distance from point p to the closest segment of polyline pts. */
function maxDeviation(raw: Point[], simplified: Point[]): number {
  let max = 0;
  for (const p of raw) {
    const d = distanceToPolyline(simplified, p);
    if (d > max) max = d;
  }
  return max;
}

describe('stroke.model', () => {
  // TC-01: simplify loop at tolerance 1 → every raw point within 1 unit, fewer points.
  it('TC-01: simplify handwritten loop at tolerance 1', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 1);
    expect(result.length).toBeLessThan(raw.length);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Every raw point must be within 1 unit of the simplified polyline
    const dev = maxDeviation(raw, result);
    expect(dev).toBeLessThanOrEqual(1 + 1e-9);
  });

  // TC-02: tolerance 0.5 (zoom 200%) → every raw point within 0.5.
  it('TC-02: simplify with tolerance 0.5 (zoom 200%)', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 0.5);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const dev = maxDeviation(raw, result);
    expect(dev).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  // TC-03: splitPoints at STROKE_MAX_POINTS - 1 / exactly / + 1
  it('TC-03: splitPoints at boundary values', () => {
    // Exactly STROKE_MAX_POINTS points → 1 part
    const exact = longSpiral(STROKE_MAX_POINTS);
    const parts1 = splitPoints(exact);
    expect(parts1.length).toBe(1);
    expect(parts1[0].length).toBe(STROKE_MAX_POINTS);

    // STROKE_MAX_POINTS - 1 points → 1 part
    const under = longSpiral(STROKE_MAX_POINTS - 1);
    const parts0 = splitPoints(under);
    expect(parts0.length).toBe(1);

    // STROKE_MAX_POINTS + 1 points → 2 parts; part 2 starts with part 1's last point
    const over = longSpiral(STROKE_MAX_POINTS + 1);
    const parts2 = splitPoints(over);
    expect(parts2.length).toBe(2);
    // Part 2 starts with part 1's last point
    expect(parts2[1][0].x).toBe(parts2[0][parts2[0].length - 1].x);
    expect(parts2[1][0].y).toBe(parts2[0][parts2[0].length - 1].y);
  });

  // TC-04: createStroke single point thick → bbox = thickness square, points length 2.
  it('TC-04: createStroke single point (dot) with thick', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const thick = PEN_THICKNESS_WORLD.thick; // 8
    const id = createStroke(doc, {
      points: [{ x: 100, y: 200 }],
      color: 'black',
      thickness: 'thick',
    }, 'user-1');
    expect(id).not.toBeNull();

    const snaps = objects(doc);
    const stroke = snaps.find((s) => s.id === id) as unknown as StrokeSnap;
    expect(stroke).toBeDefined();
    // bbox = thickness square
    expect(stroke.width).toBe(thick);
    expect(stroke.height).toBe(thick);
    // points length 2 (one point flattened: [x, y])
    expect(stroke.points.length).toBe(2);
  });

  // TC-05: empty points, NaN point, colour 'pink', thickness 'huge' → null
  it('TC-05: invalid input returns null, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    // Empty points
    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'user-1')).toBeNull();
    // NaN point
    expect(createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'medium' }, 'user-1')).toBeNull();
    // Unknown colour
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as any, thickness: 'medium' }, 'user-1')).toBeNull();
    // Unknown thickness
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' as any }, 'user-1')).toBeNull();

    expect(updateCount).toBe(0);
  });

  // TC-06: scaledPoints after width and height doubled → coordinates doubled, thickness unchanged.
  it('TC-06: scaledPoints after proportional resize', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const pts: Point[] = [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 10 },
    ];
    const id = createStroke(doc, { points: pts, color: 'blue', thickness: 'medium' }, 'user-1');
    expect(id).not.toBeNull();

    // Get the stroke snapshot
    let snaps = objects(doc);
    let stroke = snaps.find((s) => s.id === id) as unknown as StrokeSnap;
    const origBaseWidth = stroke.baseWidth;
    const origBaseHeight = stroke.baseHeight;
    const origWidth = stroke.width;
    const origHeight = stroke.height;

    // Double the size
    const objMap = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    doc.transact(() => {
      objMap.set('width', (origWidth ?? 1) * 2);
      objMap.set('height', (origHeight ?? 1) * 2);
    }, LOCAL_ORIGIN);

    snaps = objects(doc);
    stroke = snaps.find((s) => s.id === id) as unknown as StrokeSnap;

    const scaled = scaledPoints(stroke);
    const origScaled = scaledPoints({ ...stroke, width: origWidth, height: origHeight } as StrokeSnap);

    // Coordinates relative to bbox origin should be doubled
    for (let i = 0; i < scaled.length; i++) {
      const relOrigX = origScaled[i].x - stroke.x;
      const relOrigY = origScaled[i].y - stroke.y;
      const relNewX = scaled[i].x - stroke.x;
      const relNewY = scaled[i].y - stroke.y;
      expect(relNewX).toBeCloseTo(relOrigX * 2, 5);
      expect(relNewY).toBeCloseTo(relOrigY * 2, 5);
    }
    // Thickness unchanged
    expect(stroke.thickness).toBe('medium');
  });

  // TC-07: distanceToPolyline(scaledPoints) at 0 / 5.9 / 6.1 units → within / within / outside.
  it('TC-07: hit test distances at boundary', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // A simple horizontal line from (0,0) to (100,0)
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const id = createStroke(doc, { points: pts, color: 'black', thickness: 'medium' }, 'user-1');
    expect(id).not.toBeNull();

    const snaps = objects(doc);
    const stroke = snaps.find((s) => s.id === id) as unknown as StrokeSnap;
    const scaled = scaledPoints(stroke);

    // Point on the line: distance 0
    const d0 = distanceToPolyline(scaled, { x: 50, y: 0 });
    expect(d0).toBe(0);

    // Point 5.9 units away: within STROKE_HIT_TOLERANCE_PX (6)
    const d59 = distanceToPolyline(scaled, { x: 50, y: 5.9 });
    expect(d59).toBeCloseTo(5.9, 5);
    expect(d59).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);

    // Point 6.1 units away: outside STROKE_HIT_TOLERANCE_PX (6)
    const d61 = distanceToPolyline(scaled, { x: 50, y: 6.1 });
    expect(d61).toBeCloseTo(6.1, 5);
    expect(d61).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });

  // TC-08: smoothPath of 3 points → starts with M, uses Q segments, deterministic.
  it('TC-08: smoothPath produces valid SVG path', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const path = smoothPath(pts);
    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('Q');
    // Deterministic: same input → same output
    expect(smoothPath(pts)).toBe(path);
  });
});
