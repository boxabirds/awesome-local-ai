// stroke.model (TC-01 to TC-08): simplification, splitting, smoothing, stroke creation and
// scaling, on a real Y.Doc.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { type StrokeSnap, createStroke, scaledPoints } from '../../src/shared/objects/stroke';
import { HANDWRITTEN_LOOP, UNDERLINE } from '../fixtures/pen-paths';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const strokesOf = (doc: Y.Doc) => objectsSnapshot(doc).filter((o): o is StrokeSnap => o.type === 'stroke');

function maxDeviation(raw: readonly Point[], result: readonly Point[]) {
  return Math.max(...raw.map((p) => distanceToPolyline(result, p)));
}

function countUpdates(doc: Y.Doc) {
  const counter = { n: 0 };
  doc.on('update', () => counter.n++);
  return counter;
}

describe('stroke.model simplify', () => {
  it('TC-01 loop at tolerance 1: every raw point within 1 unit, fewer points', () => {
    const out = simplify(HANDWRITTEN_LOOP, 1);
    expect(out.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    expect(maxDeviation(HANDWRITTEN_LOOP, out)).toBeLessThanOrEqual(1);
    expect(out[0]).toEqual(HANDWRITTEN_LOOP[0]);
    expect(out.at(-1)).toEqual(HANDWRITTEN_LOOP.at(-1));
  });

  it('TC-02 tolerance 1/zoom at 200% = 0.5: every raw point within 0.5 units', () => {
    for (const path of [HANDWRITTEN_LOOP, UNDERLINE]) {
      const out = simplify(path, 1 / 2);
      expect(maxDeviation(path, out)).toBeLessThanOrEqual(0.5);
      expect(out.length).toBeLessThan(path.length);
    }
    // A finer tolerance keeps at least as many points.
    expect(simplify(HANDWRITTEN_LOOP, 0.5).length).toBeGreaterThanOrEqual(simplify(HANDWRITTEN_LOOP, 1).length);
  });
});

describe('stroke.model splitPoints', () => {
  const line = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: i % 7 }));

  it('TC-03 at STROKE_MAX_POINTS - 1, exactly and + 1: 1, 1 and 2 parts sharing the join point', () => {
    expect(splitPoints(line(STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(line(STROKE_MAX_POINTS))).toHaveLength(1);
    const parts = splitPoints(line(STROKE_MAX_POINTS + 1));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1][0]).toEqual(parts[0].at(-1));
    expect(parts[1].at(-1)).toEqual({ x: STROKE_MAX_POINTS, y: STROKE_MAX_POINTS % 7 });
  });
});

describe('stroke.model createStroke', () => {
  it('TC-04 one point, thick: a dot whose box is a thickness square, 2 coordinates', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 100, y: 50 }], color: 'black', thickness: 'thick' }, 'g_test');
    expect(id).not.toBeNull();
    const [s] = strokesOf(doc);
    const t = PEN_THICKNESS_WORLD.thick;
    expect(s).toMatchObject({ id, x: 100 - t / 2, y: 50 - t / 2, width: t, height: t, color: 'black', thickness: 'thick' });
    expect(s.points).toHaveLength(2);
    expect(scaledPoints(s)).toEqual([{ x: 100, y: 50 }]);
  });

  it('a drag: box = bounds padded by half the thickness, on top, points relative to the box', () => {
    const doc = newDoc();
    const pts = [{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 0 }];
    createStroke(doc, { points: pts, color: 'red', thickness: 'medium' }, 'g_test');
    const [s] = strokesOf(doc);
    expect(s).toMatchObject({ x: -2, y: -2, width: 104, height: 24, baseWidth: 104, baseHeight: 24, color: 'red' });
    expect(s.points).toEqual([2, 2, 52, 22, 102, 2]);
    expect(scaledPoints(s)).toEqual(pts);
  });

  it('TC-05 empty points, a NaN point, colour "pink", thickness "huge": null and no update', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);
    const ok = { points: [{ x: 1, y: 1 }], color: 'black' as const, thickness: 'thin' as const };
    expect(createStroke(doc, { ...ok, points: [] }, 'g')).toBeNull();
    expect(createStroke(doc, { ...ok, points: [{ x: 1, y: 1 }, { x: Number.NaN, y: 2 }] }, 'g')).toBeNull();
    expect(createStroke(doc, { ...ok, points: [{ x: Infinity, y: 2 }] }, 'g')).toBeNull();
    expect(createStroke(doc, { ...ok, color: 'pink' as never }, 'g')).toBeNull();
    expect(createStroke(doc, { ...ok, thickness: 'huge' as never }, 'g')).toBeNull();
    expect(updates.n).toBe(0);
    expect(strokesOf(doc)).toHaveLength(0);
  });

  it('one stroke is one update', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);
    createStroke(doc, { points: UNDERLINE, color: 'blue', thickness: 'thin' }, 'g');
    expect(updates.n).toBe(1);
  });
});

describe('stroke.model scaledPoints', () => {
  it('TC-06 width and height doubled: coordinates (relative to the box) doubled, thickness unchanged', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: UNDERLINE, color: 'green', thickness: 'thick' }, 'g')!;
    const [before] = strokesOf(doc);
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    doc.transact(() => {
      obj.set('width', before.width * 2);
      obj.set('height', before.height * 2);
    });
    const [after] = strokesOf(doc);
    const a = scaledPoints(before);
    const b = scaledPoints(after);
    b.forEach((p, i) => {
      expect(p.x - after.x).toBeCloseTo((a[i].x - before.x) * 2, 9);
      expect(p.y - after.y).toBeCloseTo((a[i].y - before.y) * 2, 9);
    });
    expect(after.thickness).toBe('thick');
    expect(after.baseWidth).toBe(before.baseWidth);
  });

  it('TC-07 distanceToPolyline on scaled points at 0, 5.9 and 6.1 units: within, within, outside at zoom 1', () => {
    const doc = newDoc();
    createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], color: 'black', thickness: 'thin' }, 'g');
    const pts = scaledPoints(strokesOf(doc)[0]);
    const tol = Math.max(PEN_THICKNESS_WORLD.thin / 2, STROKE_HIT_TOLERANCE_PX / 1);
    expect(distanceToPolyline(pts, { x: 100, y: 0 })).toBeLessThanOrEqual(tol);
    expect(distanceToPolyline(pts, { x: 100, y: 5.9 })).toBeLessThanOrEqual(tol);
    expect(distanceToPolyline(pts, { x: 100, y: 6.1 })).toBeGreaterThan(tol);
  });
});

describe('stroke.model smoothPath', () => {
  it('TC-08 three points: starts with M, uses Q segments, deterministic', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const d = smoothPath(pts);
    expect(d).toMatch(/^M /);
    expect(d).toContain('Q ');
    expect(d).toBe(smoothPath(pts));
    expect(d).toBe('M 0 0 Q 10 10 20 0');
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }])).toBe(
      'M 0 0 Q 10 10 15 5 Q 20 0 30 10',
    );
  });

  it('one point is a zero-length path (round dot); no points is empty', () => {
    expect(smoothPath([{ x: 3, y: 4 }])).toBe('M 3 4 L 3 4');
    expect(smoothPath([])).toBe('');
  });
});
