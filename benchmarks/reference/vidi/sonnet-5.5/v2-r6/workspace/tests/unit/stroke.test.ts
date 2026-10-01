import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { handwrittenLoop } from '../fixtures/pen-paths';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  const state = { updates: 0 };
  doc.on('update', () => { state.updates += 1; });
  return { doc, state };
}
const strokeOf = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id) as StrokeSnap;
const line = (n: number): Point[] => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));

describe('stroke model', () => {
  it('TC-01 simplify keeps every raw point within 1 unit of the result and drops points', () => {
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

  it('TC-03 splitPoints gives 1, 1, 2 parts at the limit and the second part starts at the first part\'s end', () => {
    expect(splitPoints(line(STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(line(STROKE_MAX_POINTS))).toHaveLength(1);
    const parts = splitPoints(line(STROKE_MAX_POINTS + 1));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
    expect(parts[1]).toHaveLength(2);
  });

  it('TC-04 one point makes a dot: the box is the thickness square and one point is stored', () => {
    const { doc } = newDoc();
    const id = createStroke(doc, { points: [{ x: 50, y: 60 }], color: 'red', thickness: 'thick' }, 'g') as string;
    const s = strokeOf(doc, id);
    const t = PEN_THICKNESS_WORLD.thick;
    expect([s.x, s.y, s.width, s.height]).toEqual([50 - t / 2, 60 - t / 2, t, t]);
    expect(s.points).toHaveLength(2);
    expect(s).toMatchObject({ type: 'stroke', color: 'red', thickness: 'thick', baseWidth: t, baseHeight: t });
  });

  it('TC-05 empty points, a NaN point, an unknown colour or thickness create nothing', () => {
    const { doc, state } = newDoc();
    state.updates = 0;
    const ok = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
    expect(createStroke(doc, { points: [], color: 'red', thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'red', thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: ok, color: 'pink' as never, thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: ok, color: 'red', thickness: 'huge' as never }, 'g')).toBeNull();
    expect(state.updates).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('TC-06 scaledPoints doubles the coordinates when width and height double; thickness is unchanged', () => {
    const { doc } = newDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 10, y: 20 }], color: 'blue', thickness: 'medium' }, 'g') as string;
    const s = strokeOf(doc, id);
    const base = scaledPoints(s).map((p) => ({ x: p.x - s.x, y: p.y - s.y }));
    const big = scaledPoints({ ...s, width: s.width * 2, height: s.height * 2 }).map((p) => ({ x: p.x - s.x, y: p.y - s.y }));
    big.forEach((p, i) => {
      expect(p.x).toBeCloseTo(base[i].x * 2);
      expect(p.y).toBeCloseTo(base[i].y * 2);
    });
    expect(s.thickness).toBe('medium');
  });

  it('TC-07 distance to the scaled line is within at 0 and 5.9 units and outside at 6.1', () => {
    const { doc } = newDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'thin' }, 'g') as string;
    const pts = scaledPoints(strokeOf(doc, id));
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(distanceToPolyline(pts, { x: 50, y: 5.9 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(distanceToPolyline(pts, { x: 50, y: 6.1 })).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });

  it('TC-08 smoothPath of 3 points starts with M and uses a Q segment, deterministically', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const d = smoothPath(pts);
    expect(d).toMatch(/^M/);
    expect(d).toContain('Q');
    expect(smoothPath(pts)).toBe(d);
    expect(d).toBe('M0 0Q10 10 20 0');
  });
});
