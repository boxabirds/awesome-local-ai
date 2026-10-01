import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { snapshot } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { handwrittenLoop } from '../fixtures/pen-paths';

const strokes = (doc: Y.Doc) => snapshot(doc).filter((o) => o.type === 'stroke') as StrokeSnap[];
const line = (n: number): Point[] => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));

describe('stroke.model', () => {
  it('TC-01 simplify keeps every raw point within 1 unit and reduces the count', () => {
    const raw = handwrittenLoop();
    const out = simplify(raw, 1);
    expect(out.length).toBeLessThan(raw.length);
    for (const p of raw) expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(1 + 1e-9);
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it('TC-02 simplify with tolerance 1/zoom = 0.5 keeps every raw point within 0.5', () => {
    const raw = handwrittenLoop();
    const out = simplify(raw, 1 / 2);
    for (const p of raw) expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(out.length).toBeGreaterThan(simplify(raw, 1).length);
  });

  it('TC-03 splitPoints at the limit - 1, exactly and + 1 gives 1, 1 and 2 parts sharing the join point', () => {
    expect(splitPoints(line(STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(line(STROKE_MAX_POINTS))).toHaveLength(1);
    const parts = splitPoints(line(STROKE_MAX_POINTS + 1));
    expect(parts).toHaveLength(2);
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
  });

  it('TC-04 a single point is a dot whose bbox is the thickness square', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: [{ x: 50, y: 60 }], color: 'red', thickness: 'thick' }, 'g_a');
    expect(id).not.toBeNull();
    const [s] = strokes(doc);
    expect(s).toMatchObject({ x: 46, y: 56, width: 8, height: 8, color: 'red', thickness: 'thick' });
    expect(s.points).toHaveLength(2);
  });

  it('TC-05 empty points, NaN, an unknown colour or thickness create nothing', () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => updates++);
    const ok = [{ x: 0, y: 0 }];
    expect(createStroke(doc, { points: [], color: 'red', thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'red', thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: ok, color: 'pink' as never, thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: ok, color: 'red', thickness: 'huge' as never }, 'g')).toBeNull();
    expect(updates).toBe(0);
    expect(strokes(doc)).toHaveLength(0);
  });

  it('TC-06 scaledPoints doubles the coordinates when the size doubles; thickness is unchanged', () => {
    const doc = new Y.Doc();
    createStroke(doc, { points: [{ x: 10, y: 10 }, { x: 30, y: 50 }], color: 'blue', thickness: 'medium' }, 'g');
    const s = strokes(doc)[0];
    const before = scaledPoints(s);
    const big = scaledPoints({ ...s, width: s.width * 2, height: s.height * 2 });
    big.forEach((p, i) => {
      expect(p.x - s.x).toBeCloseTo((before[i].x - s.x) * 2);
      expect(p.y - s.y).toBeCloseTo((before[i].y - s.y) * 2);
    });
    expect(s.thickness).toBe('medium');
    expect(PEN_THICKNESS_WORLD[s.thickness]).toBe(4);
  });

  it('TC-07 distance to the scaled line is 0, 5.9 and 6.1 units at the three probes', () => {
    const doc = new Y.Doc();
    createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'thin' }, 'g');
    const pts = scaledPoints(strokes(doc)[0]);
    const tol = STROKE_HIT_TOLERANCE_PX;
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeLessThanOrEqual(tol);
    expect(distanceToPolyline(pts, { x: 50, y: 5.9 })).toBeLessThanOrEqual(tol);
    expect(distanceToPolyline(pts, { x: 50, y: 6.1 })).toBeGreaterThan(tol);
  });

  it('TC-08 smoothPath of 3 points starts with M, uses Q and is deterministic', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const d = smoothPath(pts);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    expect(smoothPath(pts)).toBe(d);
  });
});
