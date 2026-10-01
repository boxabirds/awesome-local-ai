import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { snapshotObjects } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type PenColor, type PenThickness, type StrokeSnap } from '../../src/shared/objects/stroke';
import { handwrittenLoop } from '../fixtures/pen-paths';
import { newBoardDoc } from './helpers/peer';

const strokes = (doc: Y.Doc) => snapshotObjects(doc).filter((o): o is StrokeSnap => o.type === 'stroke');
const line = (n: number): Point[] => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));

describe('simplify', () => {
  it('TC-01 keeps every raw point within 1 unit of the result and uses fewer points', () => {
    const raw = handwrittenLoop();
    const out = simplify(raw, 1);
    expect(out.length).toBeLessThan(raw.length);
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
    for (const p of raw) expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('TC-02 tolerance 0.5 (zoom 200%) keeps every raw point within 0.5', () => {
    const raw = handwrittenLoop();
    const out = simplify(raw, 1 / 2);
    expect(out.length).toBeGreaterThan(simplify(raw, 1).length);
    for (const p of raw) expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('handles 0, 1 and 2 points and long collinear input without recursion limits', () => {
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([{ x: 1, y: 1 }], 1)).toEqual([{ x: 1, y: 1 }]);
    expect(simplify(line(100_000), 0.5)).toHaveLength(2);
  });
});

describe('splitPoints', () => {
  it('TC-03 yields 1 / 1 / 2 parts at max - 1 / max / max + 1; part 2 starts at part 1\'s last point', () => {
    expect(splitPoints(line(STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(line(STROKE_MAX_POINTS))).toHaveLength(1);
    const parts = splitPoints(line(STROKE_MAX_POINTS + 1));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
    expect(parts[1]).toHaveLength(2);
  });
});

describe('createStroke', () => {
  it('TC-04 a single point with thick is a thickness-sized square with 2 stored numbers', () => {
    const doc = newBoardDoc();
    createStroke(doc, { points: [{ x: 50, y: 60 }], color: 'red', thickness: 'thick' }, 'g_a');
    const [s] = strokes(doc);
    const t = PEN_THICKNESS_WORLD.thick;
    expect(s).toMatchObject({ x: 50 - t / 2, y: 60 - t / 2, width: t, height: t, color: 'red', thickness: 'thick' });
    expect(s.points).toHaveLength(2);
  });

  it('TC-05 empty points, a NaN point, an unknown colour or thickness return null and write nothing', () => {
    const doc = newBoardDoc();
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    const ok = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
    expect(createStroke(doc, { points: [], color: 'red', thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'red', thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: ok, color: 'pink' as PenColor, thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: ok, color: 'red', thickness: 'huge' as PenThickness }, 'g')).toBeNull();
    expect(updates).toBe(0);
    expect(strokes(doc)).toHaveLength(0);
  });

  it('a stroke is one transaction, on top of existing objects, with bbox padded by half the thickness', () => {
    const doc = newBoardDoc();
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    createStroke(doc, { points: [{ x: 10, y: 10 }, { x: 110, y: 60 }], color: 'blue', thickness: 'medium' }, 'g');
    createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: 'blue', thickness: 'thin' }, 'g');
    expect(updates).toBe(2);
    const [a, b] = strokes(doc);
    expect(a).toMatchObject({ x: 8, y: 8, width: 104, height: 54, baseWidth: 104, baseHeight: 54 });
    expect(b.z).toBeGreaterThan(a.z);
  });
});

describe('scaledPoints', () => {
  it('TC-06 doubling width and height doubles the coordinates and leaves thickness alone', () => {
    const doc = newBoardDoc();
    createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 40, y: 20 }], color: 'black', thickness: 'medium' }, 'g');
    const s = strokes(doc)[0];
    const base = scaledPoints(s);
    const big = scaledPoints({ ...s, width: s.width! * 2, height: s.height! * 2 });
    big.forEach((p, i) => {
      expect(p.x).toBeCloseTo(base[i].x * 2);
      expect(p.y).toBeCloseTo(base[i].y * 2);
    });
    expect(s.thickness).toBe('medium');
  });

  it('TC-07 distanceToPolyline on scaled points is within at 0 and 5.9 and outside at 6.1 units', () => {
    const doc = newBoardDoc();
    createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], color: 'black', thickness: 'thin' }, 'g');
    const s = strokes(doc)[0];
    const pts = scaledPoints(s);
    const y = pts[0].y;
    const within = (d: number) => distanceToPolyline(pts, { x: 100, y: y + d }) <= STROKE_HIT_TOLERANCE_PX;
    expect(within(0)).toBe(true);
    expect(within(5.9)).toBe(true);
    expect(within(6.1)).toBe(false);
  });
});

describe('smoothPath', () => {
  it('TC-08 three points give a deterministic path starting with M and using Q', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const d = smoothPath(pts);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    expect(smoothPath(pts)).toBe(d);
    expect(d).toBe('M0 0Q10 10 15 5L20 0');
  });

  it('a single point is a zero-length segment so a round cap draws a dot', () => {
    expect(smoothPath([{ x: 3, y: 4 }])).toBe('M3 4L3 4');
  });
});
