import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { initDoc, resizeObjects } from '../../src/shared/board-model';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS
} from '../../src/shared/config';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import {
  createStroke,
  getStrokeSnap,
  scaledPoints
} from '../../src/shared/objects/stroke';
import { handwrittenLoop, underlinePath } from '../fixtures/pen-paths';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function trackUpdates(doc: Y.Doc): { count(): number } {
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return { count: () => updates };
}

describe('stroke.model', () => {
  test('TC-01 simplify at tolerance 1 stays faithful and shrinks a handwritten loop', () => {
    const raw = handwrittenLoop();
    const out = simplify(raw, 1);
    expect(out.length).toBeLessThan(raw.length);
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
    for (const p of raw) {
      expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  test('TC-02 simplify at tolerance 0.5 (zoom 2) stays within 0.5 units', () => {
    const raw = handwrittenLoop();
    const out = simplify(raw, 0.5);
    for (const p of raw) {
      expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  test('TC-03 splitPoints at the limit: n-1, exactly n, n+1 with a shared join point', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));
    const before = splitPoints(mk(STROKE_MAX_POINTS - 1));
    const exact = splitPoints(mk(STROKE_MAX_POINTS));
    const after = splitPoints(mk(STROKE_MAX_POINTS + 1));
    expect(before).toHaveLength(1);
    expect(exact).toHaveLength(1);
    expect(after).toHaveLength(2);
    const firstPart = after[0];
    const secondPart = after[1];
    expect(firstPart).toHaveLength(STROKE_MAX_POINTS);
    expect(secondPart[0]).toEqual(firstPart[firstPart.length - 1]);
  });

  test('TC-04 createStroke with one point stores a thickness square and a single point', () => {
    const doc = newDoc();
    const side = PEN_THICKNESS_WORLD.thick;
    const id = createStroke(
      doc,
      { points: [{ x: 100, y: 50 }], color: 'black', thickness: 'thick' },
      'g_test'
    );
    expect(id).not.toBeNull();
    const snap = getStrokeSnap(doc, id!);
    expect(snap).toBeDefined();
    expect(snap!.width).toBe(side);
    expect(snap!.height).toBe(side);
    expect(snap!.x).toBe(100 - side / 2);
    expect(snap!.y).toBe(50 - side / 2);
    expect(snap!.points).toHaveLength(2);
    expect(snap!.points).toEqual([side / 2, side / 2]);
    expect(snap!.color).toBe('black');
    expect(snap!.thickness).toBe('thick');
  });

  test('TC-05 invalid input returns null and writes nothing', () => {
    const doc = newDoc();
    const updates = trackUpdates(doc);
    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'g_test')).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: NaN, y: 1 }], color: 'black', thickness: 'medium' }, 'g_test')
    ).toBeNull();
    expect(
      createStroke(
        doc,
        { points: [{ x: 1, y: 2 }], color: 'pink' as never, thickness: 'medium' },
        'g_test'
      )
    ).toBeNull();
    expect(
      createStroke(
        doc,
        { points: [{ x: 1, y: 2 }], color: 'black', thickness: 'huge' as never },
        'g_test'
      )
    ).toBeNull();
    expect(updates.count()).toBe(0);
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(0);
  });

  test('TC-06 scaledPoints after doubling width and height doubles coordinates', () => {
    const doc = newDoc();
    const id = createStroke(
      doc,
      { points: [{ x: 10, y: 20 }, { x: 60, y: 40 }, { x: 90, y: 12 }], color: 'blue', thickness: 'medium' },
      'g_test'
    );
    const before = getStrokeSnap(doc, id!)!;
    resizeObjects(
      doc,
      new Map([[id!, { x: before.x, y: before.y, width: before.width * 2, height: before.height * 2 }]])
    );
    const after = getStrokeSnap(doc, id!)!;
    expect(after.width).toBeCloseTo(before.width * 2);
    const points = scaledPoints(after);
    expect(points).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(points[i].x).toBeCloseTo(after.x + 2 * before.points[i * 2]);
      expect(points[i].y).toBeCloseTo(after.y + 2 * before.points[i * 2 + 1]);
    }
    expect(after.thickness).toBe('medium');
  });

  test('TC-07 line distance 0 / 5.9 / 6.1 sits within, within, outside the hit tolerance at zoom 1', () => {
    const doc = newDoc();
    const id = createStroke(
      doc,
      { points: [{ x: 0, y: 100 }, { x: 200, y: 100 }], color: 'black', thickness: 'medium' },
      'g_test'
    );
    const snap = getStrokeSnap(doc, id!)!;
    const line = scaledPoints(snap);
    const tolerance = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX);
    expect(distanceToPolyline(line, { x: 100, y: 100 })).toBe(0);
    expect(distanceToPolyline(line, { x: 100, y: 105.9 })).toBeCloseTo(5.9);
    expect(distanceToPolyline(line, { x: 100, y: 106.1 })).toBeCloseTo(6.1);
    expect(distanceToPolyline(line, { x: 100, y: 100 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(line, { x: 100, y: 105.9 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(line, { x: 100, y: 106.1 })).toBeGreaterThan(tolerance);
  });

  test('TC-08 smoothPath emits an M-first, Q-based deterministic path', () => {
    const pts = simplify(underlinePath(), 1);
    expect(pts.length).toBeGreaterThanOrEqual(3);
    const d1 = smoothPath(pts);
    const d2 = smoothPath(pts);
    expect(d1).toBe(d2);
    expect(d1.startsWith('M ')).toBe(true);
    expect(d1).toContain('Q ');
    const three = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    expect(three.startsWith('M 0 0')).toBe(true);
    expect(three).toContain('Q ');
    expect(smoothPath([{ x: 3, y: 4 }])).toContain('M 3 4');
    expect(smoothPath([])).toBe('');
  });
});
