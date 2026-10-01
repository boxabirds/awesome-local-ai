import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { initDoc, objects, resizeObjects, objectBounds } from '../../src/shared/board-model';
import {
  createStroke,
  scaledPoints,
  localScaledPoints,
  type StrokeSnap,
  type PenColor,
  type PenThickness,
} from '../../src/shared/objects/stroke';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  STROKE_MAX_POINTS,
  STROKE_HIT_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
} from '../../src/shared/config';
import { handwrittenLoop } from '../fixtures/pen-paths';
import type { Point } from '../../src/shared/geometry';

/** Every raw point must lie within `tol` of the simplified polyline. */
function withinTolerance(raw: readonly Point[], result: readonly Point[], tol: number): void {
  for (const p of raw) {
    expect(distanceToPolyline(result, p), `point (${p.x}, ${p.y})`).toBeLessThanOrEqual(tol + 1e-9);
  }
}

function firstStroke(doc: Y.Doc, id: string | null): StrokeSnap {
  expect(id, 'createStroke should return an id').not.toBeNull();
  const snap = objects(doc).find((o) => o.id === id);
  expect(snap, 'stroke should be in objects()').toBeDefined();
  return snap as StrokeSnap;
}

describe('TC-01: simplify keeps the stroke faithful (tolerance 1)', () => {
  it('every raw point of the handwritten loop is within 1 unit of the result; the result has fewer points', () => {
    const result = simplify(handwrittenLoop, 1);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThan(handwrittenLoop.length);
    withinTolerance(handwrittenLoop, result, 1);
  });
});

describe('TC-02: simplify at tolerance 0.5 (zoom 200%)', () => {
  it('every raw point is within 0.5 units of the result', () => {
    const result = simplify(handwrittenLoop, 0.5);
    expect(result.length).toBeGreaterThanOrEqual(2);
    withinTolerance(handwrittenLoop, result, 0.5);
  });
});

describe('TC-03: splitPoints at the point-limit boundary', () => {
  it('STROKE_MAX_POINTS - 1 points → 1 part', () => {
    const pts = Array.from({ length: STROKE_MAX_POINTS - 1 }, (_, i) => ({ x: i, y: 0 }));
    const parts = splitPoints(pts);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS - 1);
  });

  it('STROKE_MAX_POINTS points exactly → 1 part', () => {
    const pts = Array.from({ length: STROKE_MAX_POINTS }, (_, i) => ({ x: i, y: 0 }));
    const parts = splitPoints(pts);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
  });

  it('STROKE_MAX_POINTS + 1 points → 2 parts; part 2 starts with part 1’s last point', () => {
    const pts = Array.from({ length: STROKE_MAX_POINTS + 1 }, (_, i) => ({ x: i, y: 0 }));
    const parts = splitPoints(pts);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
  });
});

describe('TC-04: createStroke with a single point (dot)', () => {
  it('a single point with thickness thick → bbox = thickness square, points length 2', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(doc, { points: [{ x: 10, y: 20 }], color: 'black', thickness: 'thick' }, 'u');
    const snap = firstStroke(doc, id);
    const t = PEN_THICKNESS_WORLD.thick;
    expect(objectBounds(snap)).toEqual({
      x: 10 - t / 2,
      y: 20 - t / 2,
      width: t,
      height: t,
    });
    expect(snap.points).toHaveLength(2);
    expect(snap.points).toEqual([t / 2, t / 2]);
    expect(scaledPoints(snap)).toEqual([{ x: 10, y: 20 }]);
  });
});

describe('TC-05: createStroke rejects invalid input with no transaction', () => {
  const cases: Array<[string, { points: readonly Point[]; color: PenColor; thickness: PenThickness }]> = [
    ['empty points', { points: [], color: 'black', thickness: 'medium' }],
    ['NaN point', { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'medium' }],
    ['Infinity point', { points: [{ x: 1, y: 0 }, { x: 2, y: Infinity }], color: 'black', thickness: 'medium' }],
    ["colour 'pink'", { points: [{ x: 0, y: 0 }], color: 'pink' as PenColor, thickness: 'medium' }],
    ["thickness 'huge'", { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' as PenThickness }],
  ];

  for (const [label, a] of cases) {
    it(`${label} → null, zero update events`, () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const updates = vi.fn();
      doc.on('update', updates);
      const id = createStroke(doc, a, 'u');
      expect(id).toBeNull();
      expect(updates).not.toHaveBeenCalled();
      expect(objects(doc)).toHaveLength(0);
    });
  }
});

describe('TC-06: scaledPoints after a proportional resize', () => {
  it('width and height doubled → coordinates doubled, thickness unchanged', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(
      doc,
      { points: [{ x: 0, y: 0 }, { x: 100, y: 50 }], color: 'black', thickness: 'medium' },
      'u',
    )!;
    const before = firstStroke(doc, id);
    const b = objectBounds(before);
    resizeObjects(doc, new Map([[id, { x: b.x, y: b.y, width: b.width * 2, height: b.height * 2 }]]));
    const after = objects(doc).find((o) => o.id === id) as StrokeSnap;

    const p0 = scaledPoints(before)[0];
    const p1 = scaledPoints(before)[1];
    const q0 = scaledPoints(after)[0];
    const q1 = scaledPoints(after)[1];
    // Same origin, doubled size: every offset from the origin doubles.
    expect(q0.x).toBeCloseTo(before.x + (p0.x - before.x) * 2);
    expect(q0.y).toBeCloseTo(before.y + (p0.y - before.y) * 2);
    expect(q1.x).toBeCloseTo(before.x + (p1.x - before.x) * 2);
    expect(q1.y).toBeCloseTo(before.y + (p1.y - before.y) * 2);
    expect(after.thickness).toBe('medium');
    // localScaledPoints = scaledPoints re-based on the bbox origin (for SVG
    // rendering in the object's local coordinate system).
    expect(localScaledPoints(before)[0].x).toBeCloseTo(p0.x - before.x);
    expect(localScaledPoints(before)[0].y).toBeCloseTo(p0.y - before.y);
    expect(localScaledPoints(after)[1].x).toBeCloseTo(q1.x - after.x);
    expect(localScaledPoints(after)[1].y).toBeCloseTo(q1.y - after.y);
  });
});

describe('TC-07: hit distance on scaled points (zoom 1)', () => {
  it('distanceToPolyline at 0 / 5.9 / 6.1 units → within / within / outside', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(
      doc,
      { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' },
      'u',
    );
    const snap = firstStroke(doc, id);
    const pts = scaledPoints(snap);
    const zoom = 1;
    const tol = Math.max(
      PEN_THICKNESS_WORLD[snap.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / zoom,
    );
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeLessThanOrEqual(tol);
    expect(distanceToPolyline(pts, { x: 50, y: 5.9 })).toBeLessThanOrEqual(tol);
    expect(distanceToPolyline(pts, { x: 50, y: 6.1 })).toBeGreaterThan(tol);
  });
});

describe('TC-08: smoothPath output', () => {
  it('3 points → deterministic string starting with M and using Q segments', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 10 },
    ];
    const a = smoothPath(pts);
    const b = smoothPath(pts);
    expect(a).toBe(b);
    expect(a.startsWith('M ')).toBe(true);
    expect(a).toContain(' Q ');
  });

  it('a single point → zero-length path (round dot)', () => {
    const d = smoothPath([{ x: 5, y: 7 }]);
    expect(d).toBe('M 5 7 L 5 7');
  });
});
