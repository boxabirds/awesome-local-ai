import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot, resizeObjects } from '../../src/shared/board-model';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  STROKE_MAX_POINTS,
  STROKE_HIT_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop, longSpiral } from '../fixtures/pen-paths';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function strokeIn(doc: Y.Doc): StrokeSnap {
  const s = snapshot(doc).find((o) => o.type === 'stroke') as StrokeSnap | undefined;
  if (!s) throw new Error('no stroke in doc');
  return s;
}

// Max distance from any raw point to the simplified polyline.
function maxDeviation(raw: readonly Point[], simplified: readonly Point[]): number {
  let max = 0;
  for (const p of raw) {
    const d = distanceToPolyline(simplified, p);
    if (d > max) max = d;
  }
  return max;
}

describe('stroke.model unit tests', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-01: simplify the handwritten loop at tolerance 1 → every raw point
  // within 1 unit of the result; the result has fewer points.
  it('TC-01: simplify keeps every point within tolerance 1 and removes points', () => {
    const loop = handwrittenLoop();
    const result = simplify(loop, 1);
    expect(result.length).toBeGreaterThan(1);
    expect(result.length).toBeLessThan(loop.length);
    expect(maxDeviation(loop, result)).toBeLessThanOrEqual(1 + 1e-9);
    // First and last points are kept
    expect(result[0]).toEqual(loop[0]);
    expect(result[result.length - 1]).toEqual(loop[loop.length - 1]);
  });

  // TC-02: the same at tolerance 0.5 (zoom 200%: 1 screen px / zoom 2) →
  // every raw point within 0.5 units.
  it('TC-02: simplify at tolerance 0.5 keeps every point within 0.5', () => {
    const loop = handwrittenLoop();
    const result = simplify(loop, 0.5);
    expect(result.length).toBeGreaterThan(1);
    expect(maxDeviation(loop, result)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  // TC-03: splitPoints at STROKE_MAX_POINTS − 1 / exactly / + 1 →
  // 1 / 1 / 2 parts; part 2 starts with part 1's last point (boundary).
  it('TC-03: splitPoints boundary at the point limit', () => {
    const spiral = longSpiral();
    expect(spiral.length).toBe(STROKE_MAX_POINTS + 10);

    const below = splitPoints(spiral.slice(0, STROKE_MAX_POINTS - 1));
    expect(below).toHaveLength(1);
    expect(below[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const exact = splitPoints(spiral.slice(0, STROKE_MAX_POINTS));
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(STROKE_MAX_POINTS);

    const over = splitPoints(spiral);
    expect(over).toHaveLength(2);
    expect(over[0]).toHaveLength(STROKE_MAX_POINTS);
    // Part 2 starts with part 1's last point (shared join point)
    expect(over[1][0]).toEqual(over[0][over[0].length - 1]);
  });

  // TC-04: createStroke with a single point, thickness thick → the object's
  // bbox is a thickness square and the stored points have length 2 (a dot).
  it('TC-04: single point creates a dot with a thickness-square bbox', () => {
    const t = PEN_THICKNESS_WORLD.thick;
    const id = createStroke(doc, { points: [{ x: 100, y: 50 }], color: 'black', thickness: 'thick' }, 'user1');
    expect(id).not.toBeNull();

    const s = strokeIn(doc);
    expect(s.width).toBe(t);
    expect(s.height).toBe(t);
    expect(s.x).toBe(100 - t / 2);
    expect(s.y).toBe(50 - t / 2);
    expect(s.points).toHaveLength(2);
    // The stored point sits at the centre of the bbox
    expect(s.points[0]).toBeCloseTo(t / 2);
    expect(s.points[1]).toBeCloseTo(t / 2);
  });

  // TC-05: empty points, a NaN point, unknown colour, unknown thickness →
  // null and zero update events (negative, error paths).
  it('TC-05: invalid input creates nothing and no updates', () => {
    const objects = doc.getMap('objects');
    let updates = 0;
    objects.observeDeep(() => {
      updates++;
    });

    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'user1')).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }, { x: NaN, y: 5 }], color: 'black', thickness: 'medium' }, 'user1'),
    ).toBeNull();
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], color: 'pink' as never, thickness: 'medium' }, 'user1')).toBeNull();
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], color: 'black', thickness: 'huge' as never }, 'user1')).toBeNull();

    expect(updates).toBe(0);
    expect(snapshot(doc).filter((o) => o.type === 'stroke')).toHaveLength(0);
  });

  // TC-06: scaledPoints after width and height are doubled → coordinates
  // doubled, thickness unchanged (proportional resize).
  it('TC-06: scaledPoints scale with the bbox; thickness is unchanged', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    createStroke(doc, { points: pts, color: 'blue', thickness: 'medium' }, 'user1');
    const before = strokeIn(doc);
    const beforePts = scaledPoints(before);
    expect(beforePts).toHaveLength(4);

    // Double the size about the origin
    resizeObjects(doc, new Map([[before.id, { x: before.x * 2, y: before.y * 2, width: before.width * 2, height: before.height * 2 }]]));
    const after = strokeIn(doc);
    const afterPts = scaledPoints(after);

    for (let i = 0; i < beforePts.length; i++) {
      expect(afterPts[i].x).toBeCloseTo(beforePts[i].x * 2);
      expect(afterPts[i].y).toBeCloseTo(beforePts[i].y * 2);
    }
    expect(after.thickness).toBe('medium');
    expect(after.baseWidth).toBe(before.baseWidth);
    expect(after.baseHeight).toBe(before.baseHeight);
  });

  // TC-07: distanceToPolyline on scaledPoints at 0 / 5.9 / 6.1 units →
  // within / within / outside STROKE_HIT_TOLERANCE_PX at zoom 1.
  it('TC-07: hit distance around the line at the 6px boundary', () => {
    createStroke(doc, {
      points: [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
      ],
      color: 'black',
      thickness: 'medium',
    }, 'user1');
    const s = strokeIn(doc);
    const line = scaledPoints(s);

    const zoom = 1;
    const tolerance = Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
    expect(tolerance).toBe(STROKE_HIT_TOLERANCE_PX);

    expect(distanceToPolyline(line, { x: 60, y: 10 })).toBe(0);
    expect(distanceToPolyline(line, { x: 60, y: 15.9 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(line, { x: 60, y: 16.1 })).toBeGreaterThan(tolerance);
  });

  // TC-08: smoothPath of 3 points → deterministic string starting with M and
  // using Q segments.
  it('TC-08: smoothPath is a deterministic M/Q path', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const d1 = smoothPath(pts);
    const d2 = smoothPath(pts);
    expect(d1).toBe(d2);
    expect(d1.startsWith('M ')).toBe(true);
    expect(d1).toContain('Q ');
    // A single point is a zero-length path (round dot)
    const dot = smoothPath([{ x: 5, y: 5 }]);
    expect(dot.startsWith('M ')).toBe(true);
  });
});
