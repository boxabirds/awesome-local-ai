/**
 * Unit tests for the stroke model and geometry (story 11, stroke.model).
 * TC-01 to TC-08. Real Y.Doc; deterministic fixtures from pen-paths.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, objectSnapshot } from '../../src/shared/board-model';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_HIT_TOLERANCE_PX,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop, underline, longSpiral } from '../fixtures/pen-paths';

function trackUpdates(doc: Y.Doc): { count: () => number; cleanup: () => void } {
  let count = 0;
  const handler = () => { count += 1; };
  doc.on('update', handler);
  return {
    count: () => count,
    cleanup: () => doc.off('update', handler),
  };
}

/** Max distance from every raw point to the simplified polyline. */
function maxDeviation(raw: readonly Point[], simplified: readonly Point[]): number {
  let max = 0;
  for (const p of raw) {
    const d = distanceToPolyline(simplified, p);
    if (d > max) max = d;
  }
  return max;
}

function snapOf(doc: Y.Doc, id: string): StrokeSnap {
  const snap = objectSnapshot(doc).find((o) => o.id === id) as StrokeSnap | undefined;
  if (!snap) throw new Error(`stroke ${id} not in snapshot`);
  return snap;
}

describe('stroke.model (TC-01 to TC-08)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('TC-01: simplify the handwritten loop at tolerance 1 → every raw point within 1 unit, fewer points', () => {
    const result = simplify(handwrittenLoop, 1);
    expect(result.length).toBeLessThan(handwrittenLoop.length);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // First and last kept.
    expect(result[0]).toEqual(handwrittenLoop[0]);
    expect(result[result.length - 1]).toEqual(handwrittenLoop[handwrittenLoop.length - 1]);
    // Smoothing faithfulness: no raw point farther than 1 unit from the result.
    expect(maxDeviation(handwrittenLoop, result)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('TC-02: simplify at tolerance 0.5 (zoom 200% → 1/zoom) → every raw point within 0.5 units', () => {
    const result = simplify(underline, 0.5);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(maxDeviation(underline, result)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('TC-03: splitPoints at STROKE_MAX_POINTS − 1 / exactly / + 1 → 1 / 1 / 2 parts; shared join point', () => {
    const base: Point[] = longSpiral.slice(0, STROKE_MAX_POINTS + 1);

    const below = splitPoints(base.slice(0, STROKE_MAX_POINTS - 1));
    expect(below).toHaveLength(1);
    expect(below[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const exact = splitPoints(base.slice(0, STROKE_MAX_POINTS));
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(STROKE_MAX_POINTS);

    const over = splitPoints(base);
    expect(over).toHaveLength(2);
    expect(over[0]).toHaveLength(STROKE_MAX_POINTS);
    // Part 2 starts with part 1's last point (seamless join).
    expect(over[1][0]).toEqual(over[0][over[0].length - 1]);
  });

  it('TC-04: createStroke with one point, thickness thick → bbox = thickness square, points length 2 (dot)', () => {
    const t = PEN_THICKNESS_WORLD.thick;
    const id = createStroke(doc, { points: [{ x: 42, y: -7 }], color: 'black', thickness: 'thick' }, 'u1');
    expect(id).not.toBeNull();
    const s = snapOf(doc, id!);
    expect(s.width).toBe(t);
    expect(s.height).toBe(t);
    expect(s.x).toBe(42 - t / 2);
    expect(s.y).toBe(-7 - t / 2);
    expect(s.points).toHaveLength(2);
    // The single relative point is the centre of the square.
    expect(s.points[0]).toBeCloseTo(t / 2);
    expect(s.points[1]).toBeCloseTo(t / 2);
    // scaledPoints round-trips to the original world point.
    const pts = scaledPoints(s);
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBeCloseTo(42);
    expect(pts[0].y).toBeCloseTo(-7);
  });

  it('TC-05: empty points, NaN point, unknown colour, unknown thickness → null and zero update events', () => {
    const tracker = trackUpdates(doc);
    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'u1')).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }, { x: NaN, y: 1 }], color: 'black', thickness: 'medium' }, 'u1')
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: 'pink' as never, thickness: 'medium' }, 'u1')
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: 'black', thickness: 'huge' as never }, 'u1')
    ).toBeNull();
    expect(tracker.count()).toBe(0);
    expect(objectSnapshot(doc)).toHaveLength(0);
    tracker.cleanup();
  });

  it('TC-06: scaledPoints after width and height doubled → coordinates doubled, thickness unchanged', () => {
    const id = createStroke(doc, { points: underline, color: 'blue', thickness: 'medium' }, 'u1');
    const before = snapOf(doc, id!);
    const ptsBefore = scaledPoints(before);

    // Resize 2x in both dimensions (story 7 resizeObjects).
    doc.transact(() => {
      const obj = (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).get(id!);
      if (!obj) return;
      obj.set('x', before.x * 2);
      obj.set('y', before.y * 2);
      obj.set('width', before.width * 2);
      obj.set('height', before.height * 2);
    });

    const after = snapOf(doc, id!);
    const ptsAfter = scaledPoints(after);
    expect(ptsAfter).toHaveLength(ptsBefore.length);
    for (let i = 0; i < ptsBefore.length; i++) {
      expect(ptsAfter[i].x).toBeCloseTo(ptsBefore[i].x * 2, 6);
      expect(ptsAfter[i].y).toBeCloseTo(ptsBefore[i].y * 2, 6);
    }
    // Thickness is a stored name and is never scaled.
    expect(after.thickness).toBe(before.thickness);
  });

  it('TC-07: distanceToPolyline(scaledPoints) at 0 / 5.9 / 6.1 units → within / within / outside at zoom 1', () => {
    // A straight horizontal line from (0,0) to (100,0), medium thickness.
    const line: Point[] = [];
    for (let i = 0; i <= 10; i++) line.push({ x: i * 10, y: 0 });
    const id = createStroke(doc, { points: line, color: 'black', thickness: 'medium' }, 'u1');
    const s = snapOf(doc, id!);
    const pts = scaledPoints(s);

    const zoom = 1;
    const tolerance = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / zoom);
    expect(tolerance).toBe(STROKE_HIT_TOLERANCE_PX);

    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(pts, { x: 50, y: 0 }) <= tolerance).toBe(true);
    expect(distanceToPolyline(pts, { x: 50, y: 5.9 })).toBeCloseTo(5.9, 6);
    expect(distanceToPolyline(pts, { x: 50, y: 5.9 }) <= tolerance).toBe(true);
    expect(distanceToPolyline(pts, { x: 50, y: 6.1 })).toBeCloseTo(6.1, 6);
    expect(distanceToPolyline(pts, { x: 50, y: 6.1 }) <= tolerance).toBe(false);
  });

  it('TC-08: smoothPath of 3 points → deterministic string starting with M and using Q segments', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 5 }];
    const d1 = smoothPath(pts);
    const d2 = smoothPath(pts);
    expect(d1).toBe(d2);
    expect(d1.startsWith('M ')).toBe(true);
    expect(d1).toContain(' Q ');
    // Passes through the first point and ends exactly at the last point.
    expect(d1).toMatch(/^M 0 0 /);
    expect(d1.endsWith('30 5')).toBe(true);
    // Edge cases.
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 4, y: 4 }])).toBe('M 4 4 L 4 4');
  });
});
