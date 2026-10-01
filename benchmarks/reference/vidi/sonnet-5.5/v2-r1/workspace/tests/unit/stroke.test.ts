import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MAX_POINTS, STROKE_SIMPLIFY_TOLERANCE_PX } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints } from '../../src/shared/objects/stroke';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { handwrittenLoop } from '../fixtures/pen-paths';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}
const strokes = (doc: Y.Doc) => snapshot(doc).filter((o) => o.type === 'stroke') as unknown as StrokeSnap[];
const line = (n: number): Point[] => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));

describe('stroke model', () => {
  it('TC-01 simplify keeps every raw point within 1 unit and reduces the point count', () => {
    const raw = handwrittenLoop();
    const out = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(out.length).toBeLessThan(raw.length);
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
    for (const p of raw) expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('TC-02 at 200% zoom the tolerance is 0.5 units', () => {
    const raw = handwrittenLoop();
    const out = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX / 2);
    for (const p of raw) expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(out.length).toBeGreaterThan(simplify(raw, 1).length);
  });

  it('TC-03 splitPoints at the limit boundaries', () => {
    expect(splitPoints(line(STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(line(STROKE_MAX_POINTS))).toHaveLength(1);
    const parts = splitPoints(line(STROKE_MAX_POINTS + 1));
    expect(parts).toHaveLength(2);
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
  });

  it('simplify copes with a very long straight path without recursion problems', () => {
    expect(simplify(line(50_000), 1)).toHaveLength(2);
  });

  it('TC-04 a single point is a dot whose box is the thickness square', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 100, y: 50 }], color: 'red', thickness: 'thick' }, 'u');
    expect(id).not.toBeNull();
    const [s] = strokes(doc);
    const t = PEN_THICKNESS_WORLD.thick;
    expect([s.x, s.y, s.width, s.height]).toEqual([100 - t / 2, 50 - t / 2, t, t]);
    expect(s.points).toHaveLength(2);
    expect(s.color).toBe('red');
    expect(s.thickness).toBe('thick');
  });

  it('TC-05 invalid input creates nothing and emits no update', () => {
    const doc = newDoc();
    let updates = 0;
    doc.on('update', () => updates++);
    const ok = [{ x: 0, y: 0 }];
    expect(createStroke(doc, { points: [], color: 'red', thickness: 'thin' }, 'u')).toBeNull();
    expect(createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'red', thickness: 'thin' }, 'u')).toBeNull();
    expect(createStroke(doc, { points: ok, color: 'pink' as never, thickness: 'thin' }, 'u')).toBeNull();
    expect(createStroke(doc, { points: ok, color: 'red', thickness: 'huge' as never }, 'u')).toBeNull();
    expect(updates).toBe(0);
    expect(strokes(doc)).toHaveLength(0);
  });

  it('TC-06 scaledPoints scales the line with the box and leaves thickness alone', () => {
    const doc = newDoc();
    createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 40, y: 20 }], color: 'blue', thickness: 'medium' }, 'u');
    const s = strokes(doc)[0];
    const before = scaledPoints(s);
    const doubled = scaledPoints({ ...s, width: s.width! * 2, height: s.height! * 2 });
    expect(doubled[1].x - doubled[0].x).toBeCloseTo((before[1].x - before[0].x) * 2);
    expect(doubled[1].y - doubled[0].y).toBeCloseTo((before[1].y - before[0].y) * 2);
    expect(s.thickness).toBe('medium');
  });

  it('TC-07 distance to the scaled line is within tolerance at 5.9 and outside at 6.1 units', () => {
    const doc = newDoc();
    createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'thin' }, 'u');
    const pts = scaledPoints(strokes(doc)[0]);
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(distanceToPolyline(pts, { x: 50, y: 5.9 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(distanceToPolyline(pts, { x: 50, y: 6.1 })).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });

  it('TC-08 smoothPath is deterministic and uses quadratic segments', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const d = smoothPath(pts);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    expect(smoothPath(pts)).toBe(d);
    expect(smoothPath([{ x: 1, y: 2 }])).toBe('M 1 2 L 1 2');
  });
});
