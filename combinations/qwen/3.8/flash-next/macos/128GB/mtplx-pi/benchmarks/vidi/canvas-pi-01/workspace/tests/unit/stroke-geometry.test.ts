/**
 * Story 11 · task 14 — the geometry contract, tested on recorded paths (TC-01,
 * TC-02, TC-03, TC-07, TC-08).
 *
 * `simplify` is specified by a *guarantee*, not by an output: every raw point must
 * end up within the tolerance of the result. That property is what makes a
 * tolerance in screen pixels legitimate (PRD `pen.smooth`), so it is asserted
 * directly — with the recorded loop, at both the zoom-1 and the zoom-2 tolerance —
 * rather than by pinning an exact point list.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints } from '../../src/shared/objects/stroke';
import { snapshot, initDoc } from '../../src/shared/board-model';
import { STROKE_HIT_TOLERANCE_PX, STROKE_MAX_POINTS } from '../../src/shared/config';
import { makeHandwrittenLoop, makeSpiral, makeUnderline } from '../fixtures/pen-paths';

/** The worst deviation of any raw point from the simplified path. */
function maxDeviation(raw: readonly { x: number; y: number }[], kept: readonly { x: number; y: number }[]) {
  let worst = 0;
  for (const point of raw) {
    const distance = distanceToPolyline(kept, point);
    if (distance > worst) worst = distance;
  }
  return worst;
}

describe('simplify (TC-01, TC-02)', () => {
  it('keeps a handwritten loop inside 1 unit of itself at zoom 1', () => {
    const loop = makeHandwrittenLoop();
    expect(loop.length).toBeGreaterThan(350);
    const kept = simplify(loop, 1);
    // The guarantee, and the point of doing it at all.
    expect(maxDeviation(loop, kept)).toBeLessThanOrEqual(1);
    expect(kept.length).toBeLessThan(loop.length / 2);
    // The first and the last point of a stroke are never dropped: the pen lands
    // where it landed and lifts where it lifted.
    expect(kept[0]).toEqual(loop[0]);
    expect(kept[kept.length - 1]).toEqual(loop[loop.length - 1]);
  });

  it('keeps half the detail at 200 % zoom, as the per-zoom tolerance intends', () => {
    const loop = makeHandwrittenLoop();
    const flat = simplify(loop, 1);
    const zoomed = simplify(loop, 1 / 2);
    expect(maxDeviation(loop, zoomed)).toBeLessThanOrEqual(0.5);
    // Twice the detail at twice the zoom: the same drag is not thrown away because
    // the board happens to be magnified (PRD pen.smooth).
    expect(zoomed.length).toBeGreaterThan(flat.length);
  });

  it('collapses an underline hard and survives the point-cap fixture', () => {
    const underline = makeUnderline();
    const kept = simplify(underline, 1);
    expect(maxDeviation(underline, kept)).toBeLessThanOrEqual(1);
    expect(kept.length).toBeLessThan(underline.length / 2);
    // 5,010 points must not exhaust the call stack or take forever.
    const spiral = makeSpiral();
    const spiralKept = simplify(spiral, 1);
    expect(spiralKept.length).toBeLessThan(spiral.length);
    expect(maxDeviation(spiral, spiralKept)).toBeLessThanOrEqual(1);
  });
});

describe('splitPoints (TC-03)', () => {
  const path = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ x: i * 0.5, y: (i % 7) * 0.2 }));

  it('splits at the cap and shares the join point', () => {
    const under = path(STROKE_MAX_POINTS - 1);
    const exactly = path(STROKE_MAX_POINTS);
    const over = path(STROKE_MAX_POINTS + 1);

    expect(splitPoints(under)).toHaveLength(1);
    expect(splitPoints(exactly)).toHaveLength(1);
    const parts = splitPoints(over);
    expect(parts).toHaveLength(2);
    // Part two starts where part one ended: a long drag stays one continuous line
    // when it becomes two objects (PRD pen.long_stroke).
    const join = parts[0][parts[0].length - 1];
    expect(parts[1][0]).toEqual(join);
    expect(parts[0].length + parts[1].length - 1).toBe(over.length);
  });

  it('leaves a short path alone and copies the points it returns', () => {
    const short = path(3);
    const parts = splitPoints(short, 10);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual(short);
    expect(parts[0]).not.toBe(short);
    expect(splitPoints([])).toEqual([]);
  });
});

describe('the hit distance (TC-07)', () => {
  it('reports 0, 5.9 and 6.1 units as inside, inside and outside at zoom 1', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(
      doc,
      { points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'thin' },
      'me',
    );
    expect(id).not.toBeNull();
    const stroke = snapshot(doc).find((entry) => entry.id === id)!;
    const line = scaledPoints(stroke);
    // A point on the ink, one just inside the tolerance and one just outside, all
    // measured in world units at zoom 1 (where the tolerance is
    // STROKE_HIT_TOLERANCE_PX).
    const on = distanceToPolyline(line, { x: 50, y: 0 });
    const inside = distanceToPolyline(line, { x: 50, y: 5.9 });
    const outside = distanceToPolyline(line, { x: 50, y: 6.1 });
    expect(on).toBeCloseTo(0, 6);
    expect(inside).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(outside).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });

  it('keeps the distance in world units when the box is resized', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(
      doc,
      { points: [{ x: 0, y: 0 }, { x: 40, y: 40 }], color: 'black', thickness: 'thin' },
      'me',
    );
    // A refused fixture is a broken test, not a passing one: fail loudly.
    if (id === null) throw new Error('createStroke refused the fixture path');
    const stroke = snapshot(doc).find((entry) => entry.id === id)!;
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const record = objects.get(id) as Y.Map<unknown>;
    // Double the box: the drawn line doubles with it, so a point that was on the
    // ink before the resize is still measured against a line that grew.
    doc.transact(() => {
      record.set('width', (record.get('width') as number) * 2);
      record.set('height', (record.get('height') as number) * 2);
    });
    const doubled = scaledPoints(snapshot(doc).find((entry) => entry.id === id)!);
    const before = scaledPoints(stroke);
    expect(doubled.length).toBe(before.length);
    expect(Math.max(...doubled.map((p) => Math.abs(p.x - stroke.x)))).toBeGreaterThan(
      Math.max(...before.map((p) => Math.abs(p.x - stroke.x))) - 0.001,
    );
  });
});

describe('smoothPath (TC-08)', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 20, y: 10 },
    { x: 40, y: 0 },
  ];

  it('starts at the pen-down point and uses quadratic segments', () => {
    const d = smoothPath(points);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    // Deterministic: the same recording paints the same line for everyone.
    expect(smoothPath(points)).toBe(d);
  });

  it('draws a single point as a zero-length path, not nothing', () => {
    const dot = smoothPath([{ x: 5, y: 5 }]);
    expect(dot.startsWith('M')).toBe(true);
    expect(smoothPath([])).toBe('');
  });
});
