// TC-01 to TC-08: stroke geometry and model — RDP simplification bounds,
// point-limit splitting, dot creation, validation, scaled points, hit
// distance and deterministic smoothing.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  markTypeKnown,
  objectSnapshots,
  resizeObjects,
  type ObjectSnapshot,
  type StrokeSnap,
} from '../../src/shared/board-model';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createStroke, scaledPoints, type PenColor, type PenThickness } from '../../src/shared/objects/stroke';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { handwrittenLoop, longSpiral } from '../fixtures/pen-paths';

markTypeKnown('stroke');

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc, fn: () => unknown): { updates: number; result: unknown } {
  let updates = 0;
  const listener = () => updates++;
  doc.on('update', listener);
  try {
    const result = fn();
    return { updates, result };
  } finally {
    doc.off('update', listener);
  }
}

function strokeSnap(doc: Y.Doc, id: string): StrokeSnap {
  const snap = objectSnapshots(doc).find((o: ObjectSnapshot) => o.id === id);
  expect(snap?.type).toBe('stroke');
  return snap as StrokeSnap;
}

describe('stroke geometry', () => {
  it('TC-01: simplify keeps every raw point within tolerance 1 and fewer points', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 1);
    expect(result.length).toBeLessThan(raw.length);
    expect(result[0]).toEqual(raw[0]);
    expect(result[result.length - 1]).toEqual(raw[raw.length - 1]);
    for (const p of raw) {
      expect(distanceToPolyline(result, p)).toBeLessThanOrEqual(1);
    }
  });

  it('TC-02: simplify at zoom-2 tolerance 1/2 keeps every point within 0.5', () => {
    const raw = handwrittenLoop();
    const zoom = 2;
    const result = simplify(raw, 1 / zoom);
    expect(result.length).toBeLessThan(raw.length);
    for (const p of raw) {
      expect(distanceToPolyline(result, p)).toBeLessThanOrEqual(0.5);
    }
  });

  it('TC-03: splitPoints at max-1, max, max+1 yields 1, 1, 2 parts with shared join', () => {
    const oneShort = longSpiral(STROKE_MAX_POINTS - 1);
    const exact = longSpiral(STROKE_MAX_POINTS);
    const oneOver = longSpiral(STROKE_MAX_POINTS + 1);
    expect(splitPoints(oneShort)).toHaveLength(1);
    expect(splitPoints(exact)).toHaveLength(1);
    const parts = splitPoints(oneOver);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    const join = parts[0][parts[0].length - 1];
    expect(parts[1][0]).toEqual(join);
    expect(parts[1]).toHaveLength(2);
  });

  it('TC-08: smoothPath uses M start and Q segments and is deterministic', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
    ];
    const d = smoothPath(pts);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain(' Q ');
    expect(d.endsWith('L 20 10')).toBe(true);
    expect(smoothPath(pts)).toBe(d);
    const dot = smoothPath([{ x: 5, y: 7 }]);
    expect(dot.startsWith('M 5 7')).toBe(true);
    expect(dot).toContain('L 5 7');
    expect(smoothPath([])).toBe('');
  });
});

describe('stroke model', () => {
  it('TC-04: a single thick point commits a thickness-square dot', () => {
    const doc = freshDoc();
    const id = createStroke(doc, { points: [{ x: 100, y: 100 }], color: 'black', thickness: 'thick' }, 'me');
    expect(id).not.toBeNull();
    const s = strokeSnap(doc, id!);
    expect(s.points).toHaveLength(2);
    expect(s.x).toBe(100 - PEN_THICKNESS_WORLD.thick / 2);
    expect(s.y).toBe(100 - PEN_THICKNESS_WORLD.thick / 2);
    expect(s.width).toBe(PEN_THICKNESS_WORLD.thick);
    expect(s.height).toBe(PEN_THICKNESS_WORLD.thick);
    expect(scaledPoints(s)).toEqual([{ x: 100, y: 100 }]);
  });

  it('TC-05: invalid points, colour or thickness write nothing and return null', () => {
    const doc = freshDoc();
    const cases: { points: { x: number; y: number }[]; color: PenColor; thickness: PenThickness }[] = [
      { points: [], color: 'black', thickness: 'medium' },
      { points: [{ x: Number.NaN, y: 10 }], color: 'black', thickness: 'medium' },
      { points: [{ x: 10, y: Number.POSITIVE_INFINITY }], color: 'black', thickness: 'medium' },
      // Deliberately invalid values that must be rejected by validation.
      { points: [{ x: 10, y: 10 }], color: 'pink' as PenColor, thickness: 'medium' },
      { points: [{ x: 10, y: 10 }], color: 'black', thickness: 'huge' as PenThickness },
    ];
    for (const c of cases) {
      const { updates, result } = countUpdates(doc, () => createStroke(doc, c, 'me'));
      expect(result).toBeNull();
      expect(updates).toBe(0);
    }
    expect(objectSnapshots(doc)).toHaveLength(0);
  });

  it('TC-06: scaledPoints double after a 2x resize while thickness is untouched', () => {
    const doc = freshDoc();
    const raw = handwrittenLoop();
    const id = createStroke(doc, { points: raw, color: 'red', thickness: 'thin' }, 'me');
    const before = strokeSnap(doc, id!);
    const beforePts = scaledPoints(before);
    const resized = resizeObjects(doc, new Map([[id!, {
      x: before.x,
      y: before.y,
      width: before.baseWidth * 2,
      height: before.baseHeight * 2,
    }]]));
    expect(resized).toBe(1);
    const after = strokeSnap(doc, id!);
    expect(after.thickness).toBe('thin');
    const afterPts = scaledPoints(after);
    expect(afterPts).toHaveLength(beforePts.length);
    for (let i = 0; i < beforePts.length; i++) {
      expect(afterPts[i].x).toBeCloseTo(after.x + 2 * (before.points[2 * i]), 6);
      expect(afterPts[i].y).toBeCloseTo(after.y + 2 * (before.points[2 * i + 1]), 6);
    }
  });

  it('TC-07: hit distance on scaledPoints is inside/outside tolerance at 0, 5.9, 6.1', () => {
    const doc = freshDoc();
    const id = createStroke(
      doc,
      { points: [{ x: 100, y: 100 }, { x: 200, y: 100 }], color: 'black', thickness: 'thin' },
      'me',
    );
    const s = strokeSnap(doc, id!);
    const tolerance = Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / 1);
    const pts = scaledPoints(s);
    expect(tolerance).toBe(6);
    expect(distanceToPolyline(pts, { x: 150, y: 100 })).toBeLessThanOrEqual(tolerance); // 0
    expect(distanceToPolyline(pts, { x: 150, y: 105.9 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(pts, { x: 150, y: 106.1 })).toBeGreaterThan(tolerance);
  });
});
