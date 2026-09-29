// Story 11, task 1: unit tests for the stroke model and geometry (TC-01..
// TC-08). Covers the RDP simplification, the long-stroke split, the smoothed
// path, createStroke (valid + invalid inputs), proportional scaling and the
// line-distance hit test applied to scaled points.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  simplify,
  smoothPath,
  splitPoints,
} from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Point } from '../../src/shared/geometry';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import { objectSnapshot, resizeObjects } from '../../src/shared/board-model';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { handwrittenLoop, longSpiral, underline } from '../fixtures/pen-paths';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects');
  return doc;
}

/** Count Y.Doc update events (a rejected mutation emits none). */
function countUpdates(doc: Y.Doc): () => number {
  let n = 0;
  doc.on('update', () => {
    n += 1;
  });
  return () => n;
}

/** A straight polyline of `n` evenly spaced points (for split tests). */
function linePoints(n: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) pts.push({ x: i, y: (i % 7) - 3 });
  return pts;
}

describe('story 11: stroke model (TC-01..TC-08)', () => {
  it('TC-01: simplifying the handwritten loop at tolerance 1 keeps every raw point within 1 unit and reduces the count', () => {
    const loop = handwrittenLoop();
    const result = simplify(loop, 1);
    expect(result.length).toBeLessThan(loop.length);
    // The first and last points are always kept.
    expect(result[0]).toEqual(loop[0]);
    expect(result[result.length - 1]).toEqual(loop[loop.length - 1]);
    // Every raw point lies within the tolerance of the simplified polyline.
    for (const p of loop) {
      expect(distanceToPolyline(result, p)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('TC-02: tolerance 0.5 (zoom 200%) keeps every raw point within 0.5', () => {
    const underlinePts = underline();
    const result = simplify(underlinePts, 0.5);
    for (const p of underlinePts) {
      expect(distanceToPolyline(result, p)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('TC-03: splitPoints yields 1 / 1 / 2 parts at max-1 / max / max+1, joining at the boundary', () => {
    const minus1 = splitPoints(linePoints(STROKE_MAX_POINTS - 1));
    expect(minus1).toHaveLength(1);

    const exact = splitPoints(linePoints(STROKE_MAX_POINTS));
    expect(exact).toHaveLength(1);

    const plus1 = splitPoints(linePoints(STROKE_MAX_POINTS + 1));
    expect(plus1).toHaveLength(2);
    // Part 2 starts with part 1's last point (a seamless join).
    const part1 = plus1[0];
    const part2 = plus1[1];
    expect(part2[0]).toEqual(part1[part1.length - 1]);
    // The parts share exactly one point and cover the input in order.
    expect(part1.length + part2.length - 1).toBe(STROKE_MAX_POINTS + 1);
  });

  it('TC-04: a single thick point is a dot whose bbox is the thickness square', () => {
    const doc = freshDoc();
    const t = PEN_THICKNESS_WORLD.thick;
    const id = createStroke(doc, { points: [{ x: 50, y: 60 }], color: 'red', thickness: 'thick' }, 'tester');
    expect(id).not.toBeNull();
    const snap = objectSnapshot(doc).find((o) => o.id === id) as StrokeSnap;
    expect(snap.width).toBeCloseTo(t);
    expect(snap.height).toBeCloseTo(t);
    // One point, flattened to two numbers, centred in the bbox.
    expect(snap.points).toHaveLength(2);
    expect(snap.points[0]).toBeCloseTo(t / 2);
    expect(snap.points[1]).toBeCloseTo(t / 2);
  });

  it('TC-05: empty points, a NaN point, a bad colour and a bad thickness are rejected with no transaction', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    expect(createStroke(doc, { points: [], color: 'red', thickness: 'thick' }, 't')).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'red', thickness: 'thick' }, 't'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as never, thickness: 'thick' }, 't'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'red', thickness: 'huge' as never }, 't'),
    ).toBeNull();
    expect(updates()).toBe(0);
    expect(objectSnapshot(doc)).toHaveLength(0);
  });

  it('TC-06: doubling the width and height doubles the scaled points, thickness unchanged', () => {
    const doc = freshDoc();
    const created = createStroke(doc, { points: handwrittenLoop(), color: 'blue', thickness: 'medium' }, 't');
    expect(created).not.toBeNull();
    const id = created as string;
    const before = objectSnapshot(doc).find((o) => o.id === id) as StrokeSnap;
    const beforePts = scaledPoints(before);
    resizeObjects(
      doc,
      new Map([[id, { x: before.x, y: before.y, width: (before.width ?? 0) * 2, height: (before.height ?? 0) * 2 }]]),
    );
    const after = objectSnapshot(doc).find((o) => o.id === id) as StrokeSnap;
    const afterPts = scaledPoints(after);
    expect(afterPts).toHaveLength(beforePts.length);
    for (let i = 0; i < beforePts.length; i++) {
      expect(afterPts[i].x).toBeCloseTo(beforePts[i].x * 2);
      expect(afterPts[i].y).toBeCloseTo(beforePts[i].y * 2);
    }
    // The thickness is not scaled by the resize.
    expect(after.thickness).toBe('medium');
  });

  it('TC-07: distanceToPolyline on scaled points is within 6 units at 0 / 5.9 and outside at 6.1 (zoom 1)', () => {
    const doc = freshDoc();
    const t = PEN_THICKNESS_WORLD.thin;
    const id = createStroke(
      doc,
      { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'red', thickness: 'thin' },
      't',
    );
    const snap = objectSnapshot(doc).find((o) => o.id === id) as StrokeSnap;
    const pts = scaledPoints(snap);
    const lineY = t / 2; // the horizontal line sits at the bbox vertical centre
    const x = 50 + t / 2;
    // 0 units: on the line.
    expect(distanceToPolyline(pts, { x, y: lineY })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    // 5.9 units: within.
    expect(distanceToPolyline(pts, { x, y: lineY + 5.9 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    // 6.1 units: outside.
    expect(distanceToPolyline(pts, { x, y: lineY + 6.1 })).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });

  it('TC-08: smoothPath of three points is a deterministic M..Q.. path', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ];
    const d = smoothPath(pts);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(' Q ');
    // Deterministic: the same input yields the identical string.
    expect(smoothPath(pts)).toBe(d);
    // Ends at the last point.
    expect(d.endsWith('L 20 0')).toBe(true);
  });

  it('a 5,010-point spiral splits into two parts that join at the boundary', () => {
    const spiral = longSpiral();
    expect(spiral.length).toBe(STROKE_MAX_POINTS + 10);
    const parts = splitPoints(spiral);
    expect(parts).toHaveLength(2);
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
    // Reconstructing the parts (minus the shared join) reproduces the input.
    const reconstructed = [...parts[0], ...parts[1].slice(1)];
    expect(reconstructed).toHaveLength(spiral.length);
  });
});
