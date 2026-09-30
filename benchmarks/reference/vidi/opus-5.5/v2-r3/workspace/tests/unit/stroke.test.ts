import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, createSticky, initDoc, maxZ, objectsSnapshot, resizeObjects } from '../../src/shared/board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { handwrittenLoop, spiral, underline } from '../fixtures/pen-paths';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number; origins: unknown[] } {
  const origins: unknown[] = [];
  const handler = (_u: Uint8Array, origin: unknown) => origins.push(origin);
  doc.on('update', handler);
  try {
    return { result: fn(), updates: origins.length, origins };
  } finally {
    doc.off('update', handler);
  }
}

function strokeSnap(doc: Y.Doc, id: string): StrokeSnap {
  const found = objectsSnapshot(doc).find((o) => o.id === id);
  if (!found || found.type !== 'stroke') throw new Error(`stroke ${id} missing`);
  return found as StrokeSnap;
}

function maxDeviation(raw: readonly Point[], result: readonly Point[]): number {
  return Math.max(...raw.map((p) => distanceToPolyline(result, p)));
}

describe('stroke.model', () => {
  it('named settings', () => {
    expect(PEN_COLORS).toEqual({
      black: '#212121', blue: '#1E88E5', red: '#E53935', green: '#43A047', orange: '#FB8C00', purple: '#8E24AA',
    });
    expect(PEN_THICKNESS_WORLD).toEqual({ thin: 2, medium: 4, thick: 8 });
    expect(STROKE_MAX_POINTS).toBe(5000);
    expect(STROKE_HIT_TOLERANCE_PX).toBe(6);
  });

  it('TC-01 simplify the handwritten loop at tolerance 1: every raw point within 1 unit, fewer points', () => {
    const raw = handwrittenLoop();
    expect(raw.length).toBeGreaterThanOrEqual(400);
    const out = simplify(raw, 1);
    expect(out.length).toBeLessThan(raw.length);
    expect(maxDeviation(raw, out)).toBeLessThanOrEqual(1);
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it('TC-02 at 200% zoom (tolerance 0.5) every raw point stays within 0.5 units', () => {
    for (const raw of [handwrittenLoop(), underline()]) {
      const out = simplify(raw, 1 / 2);
      expect(maxDeviation(raw, out)).toBeLessThanOrEqual(0.5);
      expect(out.length).toBeLessThan(raw.length);
    }
  });

  it('simplify handles the 5,010-point spiral without recursion limits', () => {
    const raw = spiral();
    const out = simplify(raw, 1);
    expect(maxDeviation(raw, out)).toBeLessThanOrEqual(1);
  });

  it('TC-03 splitPoints at STROKE_MAX_POINTS − 1, exactly and + 1 → 1, 1, 2 parts sharing the join point', () => {
    const raw = spiral();
    expect(splitPoints(raw.slice(0, STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(raw.slice(0, STROKE_MAX_POINTS))).toHaveLength(1);
    const parts = splitPoints(raw.slice(0, STROKE_MAX_POINTS + 1));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
    expect(parts[1]).toHaveLength(2);
    // Nothing lost: parts minus shared joins give back the input.
    const whole = spiral();
    const split = splitPoints(whole);
    expect(split.every((p) => p.length <= STROKE_MAX_POINTS)).toBe(true);
    expect(split.flatMap((p, i) => (i === 0 ? p : p.slice(1)))).toEqual(whole);
  });

  it('TC-04 a single point with thickness thick is a dot: thickness-square box, one stored point', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const { result: id, updates, origins } = countUpdates(doc, () =>
      createStroke(doc, { points: [{ x: 10, y: 20 }], color: 'black', thickness: 'thick' }, 'c_1'),
    );
    expect(id).not.toBeNull();
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    const s = strokeSnap(doc, id!);
    const t = PEN_THICKNESS_WORLD.thick;
    expect(s).toMatchObject({ x: 10 - t / 2, y: 20 - t / 2, width: t, height: t, color: 'black', thickness: 'thick' });
    expect(s.points).toHaveLength(2);
    expect(scaledPoints(s)).toEqual([{ x: 10, y: 20 }]);
    expect(s.z).toBe(maxZ(doc));
    expect(s.createdBy).toBe('c_1');
  });

  it('TC-05 empty points, a NaN point, colour "pink" or thickness "huge" → null and zero updates', () => {
    const doc = newDoc();
    const ok = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    const bad: { points: Point[]; color: PenColor; thickness: PenThickness }[] = [
      { points: [], color: 'black', thickness: 'medium' },
      { points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }], color: 'black', thickness: 'medium' },
      { points: [{ x: 0, y: Infinity }], color: 'black', thickness: 'medium' },
      { points: ok, color: 'pink' as PenColor, thickness: 'medium' },
      { points: ok, color: 'black', thickness: 'huge' as PenThickness },
    ];
    for (const a of bad) {
      const { result, updates } = countUpdates(doc, () => createStroke(doc, a, 'c_1'));
      expect(result).toBeNull();
      expect(updates).toBe(0);
    }
    expect(objectsSnapshot(doc)).toHaveLength(0);
  });

  it('TC-06 scaledPoints after width and height double: coordinates doubled, thickness unchanged', () => {
    const doc = newDoc();
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 0 }];
    const id = createStroke(doc, { points: pts, color: 'red', thickness: 'medium' }, 'c_1')!;
    const before = strokeSnap(doc, id);
    const rel0 = scaledPoints(before).map((p) => ({ x: p.x - before.x, y: p.y - before.y }));
    resizeObjects(doc, new Map([[id, { x: before.x, y: before.y, width: before.width * 2, height: before.height * 2 }]]));
    const after = strokeSnap(doc, id);
    const rel1 = scaledPoints(after).map((p) => ({ x: p.x - after.x, y: p.y - after.y }));
    rel1.forEach((p, i) => {
      expect(p.x).toBeCloseTo(rel0[i].x * 2, 9);
      expect(p.y).toBeCloseTo(rel0[i].y * 2, 9);
    });
    expect(after.thickness).toBe('medium');
    expect(after.points).toEqual(before.points);
    // Before any resize the scaled points are the drawn points.
    scaledPoints(before).forEach((p, i) => {
      expect(p.x).toBeCloseTo(pts[i].x, 9);
      expect(p.y).toBeCloseTo(pts[i].y, 9);
    });
  });

  it('TC-07 distance to the scaled line at 0 / 5.9 / 6.1 units → within / within / outside at zoom 1', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], color: 'black', thickness: 'medium' }, 'c_1')!;
    const s = strokeSnap(doc, id);
    const tol = Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / 1);
    const line = scaledPoints(s);
    expect(distanceToPolyline(line, { x: 100, y: 0 })).toBeLessThanOrEqual(tol);
    expect(distanceToPolyline(line, { x: 100, y: 5.9 })).toBeLessThanOrEqual(tol);
    expect(distanceToPolyline(line, { x: 100, y: 6.1 })).toBeGreaterThan(tol);
    // Inside the box but far from the line (the box is only thickness tall here, so use a V).
    const v = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' }, 'c_1')!;
    expect(distanceToPolyline(scaledPoints(strokeSnap(doc, v)), { x: 50, y: 10 })).toBeGreaterThan(tol);
  });

  it('TC-08 smoothPath of 3 points starts with M, uses Q segments and is deterministic', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const d = smoothPath(pts);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    expect(d).toBe('M 0 0 L 5 5 Q 10 10 15 5 L 20 0');
    // A capped cut keeps a sharp corner close to the drawn line.
    const corner = [{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 300, y: 200 }];
    expect(smoothPath(corner, 4)).toBe('M 0 0 L 0 196 Q 0 200 4 200 L 300 200');
    expect(smoothPath(pts)).toBe(d);
    expect(smoothPath([{ x: 3, y: 4 }])).toBe('M 3 4 L 3 4');
    expect(smoothPath([])).toBe('');
  });
});
