/** Story 11 stroke.model unit tests (TC-01 to TC-08) on a real Y.Doc. */
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, resizeObjects, snapshotObjects } from '../../src/shared/board-model';
import { createStroke, isStrokeSnap, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { HANDWRITTEN_LOOP, LONG_SPIRAL, UNDERLINE } from '../fixtures/pen-paths';

function countUpdates(doc: Y.Doc): { readonly count: number; origins: unknown[] } {
  const state = { count: 0, origins: [] as unknown[] };
  doc.on('update', (_u: Uint8Array, origin: unknown) => {
    state.count += 1;
    state.origins.push(origin);
  });
  return state;
}

function strokes(doc: Y.Doc): StrokeSnap[] {
  return snapshotObjects(doc).filter(isStrokeSnap);
}

/** Largest distance from any raw point to the simplified polyline. */
function maxDeviation(raw: readonly Point[], simplified: readonly Point[]): number {
  return Math.max(...raw.map((p) => distanceToPolyline(simplified, p)));
}

const pts = (n: number): Point[] => Array.from({ length: n }, (_, i) => ({ x: i, y: (i * 7) % 13 }));

describe('stroke.model', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('named settings', () => {
    expect(PEN_COLORS).toEqual({ black: '#212121', blue: '#1E88E5', red: '#E53935', green: '#43A047', orange: '#FB8C00', purple: '#8E24AA' });
    expect(PEN_THICKNESS_WORLD).toEqual({ thin: 2, medium: 4, thick: 8 });
    expect(DEFAULT_PEN_COLOR).toBe('black');
    expect(DEFAULT_PEN_THICKNESS).toBe('medium');
    expect(STROKE_SIMPLIFY_TOLERANCE_PX).toBe(1);
    expect(STROKE_MAX_POINTS).toBe(5000);
    expect(STROKE_HIT_TOLERANCE_PX).toBe(6);
    expect(STROKE_MIN_SIZE_WORLD).toBe(4);
  });

  it('TC-01 simplify the handwritten loop at tolerance 1: every raw point within 1 unit, fewer points', () => {
    expect(HANDWRITTEN_LOOP.length).toBeGreaterThanOrEqual(380);
    const out = simplify(HANDWRITTEN_LOOP, 1);
    expect(out.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    expect(maxDeviation(HANDWRITTEN_LOOP, out)).toBeLessThanOrEqual(1);
    expect(out[0]).toEqual(HANDWRITTEN_LOOP[0]);
    expect(out[out.length - 1]).toEqual(HANDWRITTEN_LOOP[HANDWRITTEN_LOOP.length - 1]);

    const underline = simplify(UNDERLINE, 1);
    expect(underline.length).toBeLessThan(UNDERLINE.length);
    expect(maxDeviation(UNDERLINE, underline)).toBeLessThanOrEqual(1);
  });

  it('TC-02 simplify at zoom 200% (tolerance 0.5): every raw point within 0.5 units', () => {
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / 2;
    const out = simplify(HANDWRITTEN_LOOP, tolerance);
    expect(maxDeviation(HANDWRITTEN_LOOP, out)).toBeLessThanOrEqual(0.5);
    expect(out.length).toBeGreaterThan(simplify(HANDWRITTEN_LOOP, 1).length);
    // 5,000 points are handled without recursion.
    const spiral = simplify(LONG_SPIRAL, tolerance);
    expect(maxDeviation(LONG_SPIRAL, spiral)).toBeLessThanOrEqual(0.5);
  });

  it('TC-03 splitPoints at STROKE_MAX_POINTS - 1, exactly, + 1 → 1, 1, 2 parts sharing the join point', () => {
    expect(splitPoints(pts(STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(pts(STROKE_MAX_POINTS))).toHaveLength(1);
    const parts = splitPoints(pts(STROKE_MAX_POINTS + 1));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1]![0]).toEqual(parts[0]![parts[0]!.length - 1]);
    expect(parts[1]![1]).toEqual(pts(STROKE_MAX_POINTS + 1)[STROKE_MAX_POINTS]);
    // Every point is kept once, plus the shared join point.
    const spiralParts = splitPoints(LONG_SPIRAL);
    expect(spiralParts.reduce((n, p) => n + p.length, 0)).toBe(LONG_SPIRAL.length + spiralParts.length - 1);
  });

  it('TC-04 createStroke with one point, thick: a thickness square dot with one stored point', () => {
    const updates = countUpdates(doc);
    const id = createStroke(doc, { points: [{ x: 100, y: 50 }], color: 'blue', thickness: 'thick' }, 'g_priya');
    expect(id).not.toBeNull();
    expect(updates.count).toBe(1);
    expect(updates.origins).toEqual([LOCAL_ORIGIN]);
    const s = strokes(doc)[0]!;
    const t = PEN_THICKNESS_WORLD.thick;
    expect(s).toMatchObject({ id, type: 'stroke', x: 100 - t / 2, y: 50 - t / 2, width: t, height: t, color: 'blue', thickness: 'thick' });
    expect(s.points).toHaveLength(2);
    expect(scaledPoints(s)).toEqual([{ x: 100, y: 50 }]);
    expect(doc.getMap<Y.Map<unknown>>('objects').get(id!)!.get('createdBy')).toBe('g_priya');
  });

  it('TC-05 invalid input → null and zero updates', () => {
    const updates = countUpdates(doc);
    expect(createStroke(doc, { points: [], color: 'black', thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }], color: 'black', thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 1 }], color: 'black', thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as never, thickness: 'thin' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' as never }, 'g')).toBeNull();
    expect(updates.count).toBe(0);
    expect(snapshotObjects(doc)).toHaveLength(0);
  });

  it('TC-06 scaledPoints after width and height doubled: coordinates doubled, thickness unchanged', () => {
    const input = [{ x: 10, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 120 }];
    const id = createStroke(doc, { points: input, color: 'red', thickness: 'medium' }, 'g')!;
    const before = strokes(doc)[0]!;
    const pad = PEN_THICKNESS_WORLD.medium / 2;
    expect(before).toMatchObject({ x: 10 - pad, y: 20 - pad, width: 50 + 2 * pad, height: 100 + 2 * pad });
    expect(before.baseWidth).toBe(before.width);
    expect(before.baseHeight).toBe(before.height);
    expect(scaledPoints(before)).toEqual(input);

    resizeObjects(doc, new Map([[id, { x: before.x, y: before.y, width: before.width * 2, height: before.height * 2 }]]));
    const after = strokes(doc)[0]!;
    const scaled = scaledPoints(after);
    scaled.forEach((p, i) => {
      expect(p.x - after.x).toBeCloseTo((input[i]!.x - before.x) * 2);
      expect(p.y - after.y).toBeCloseTo((input[i]!.y - before.y) * 2);
    });
    expect(after.thickness).toBe('medium');
    expect(after.points).toEqual(before.points);
  });

  it('TC-07 distanceToPolyline on scaledPoints at 0, 5.9, 6.1 units: within, within, outside at zoom 1', () => {
    createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], color: 'black', thickness: 'thin' }, 'g');
    const line = scaledPoints(strokes(doc)[0]!);
    const tolerance = Math.max(PEN_THICKNESS_WORLD.thin / 2, STROKE_HIT_TOLERANCE_PX / 1);
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(line, { x: 50, y: 5.9 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(line, { x: 50, y: 6.1 })).toBeGreaterThan(tolerance);
  });

  it('TC-08 smoothPath of 3 points starts with M, uses Q segments and is deterministic', () => {
    const three = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const d = smoothPath(three);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain('Q 10 10 15 5');
    expect(d.endsWith('L 20 0')).toBe(true);
    expect(smoothPath(three)).toBe(d);
    expect(smoothPath([{ x: 5, y: 5 }])).toBe('M 5 5 L 5 5');
    expect(smoothPath([])).toBe('');
  });
});
