/**
 * stroke.model (story 11): simplification, splitting, smoothing, createStroke and scaled points
 * against a real Y.Doc. TC-01 to TC-08.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc, maxZ, objectSnapshot, resizeObjects } from '../../src/shared/board-model';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import {
  createStroke,
  isStroke,
  scaledPoints,
  type PenColor,
  type PenThickness,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import { HANDWRITTEN_LOOP, SPIRAL, UNDERLINE } from '../fixtures/pen-paths';

const AUTHOR = 'g_test';
const ZOOM_200 = 2;
/** Floating-point slack for "within tolerance" comparisons. */
const EPS = 1e-9;

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return { doc, updates: () => updates };
}

function strokes(doc: Y.Doc): StrokeSnap[] {
  return objectSnapshot(doc).filter(isStroke);
}

function line(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: (i % 7) * 0.1 }));
}

function maxDeviation(raw: readonly Point[], result: readonly Point[]): number {
  return Math.max(...raw.map((p) => distanceToPolyline(result, p)));
}

describe('stroke.model simplify', () => {
  it('TC-01 simplify a handwritten loop at tolerance 1: every raw point within 1 unit, fewer points', () => {
    const tol = STROKE_SIMPLIFY_TOLERANCE_PX / 1;
    const out = simplify(HANDWRITTEN_LOOP, tol);
    expect(out.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    expect(out[0]).toEqual(HANDWRITTEN_LOOP[0]);
    expect(out[out.length - 1]).toEqual(HANDWRITTEN_LOOP[HANDWRITTEN_LOOP.length - 1]);
    expect(maxDeviation(HANDWRITTEN_LOOP, out)).toBeLessThanOrEqual(tol + EPS);
    // Also for the underline: far fewer points, still faithful.
    const under = simplify(UNDERLINE, tol);
    expect(under.length).toBeLessThan(UNDERLINE.length);
    expect(maxDeviation(UNDERLINE, under)).toBeLessThanOrEqual(tol + EPS);
  });

  it('TC-02 at 200% zoom the tolerance is 0.5 units: every raw point within 0.5', () => {
    const tol = STROKE_SIMPLIFY_TOLERANCE_PX / ZOOM_200;
    const out = simplify(HANDWRITTEN_LOOP, tol);
    expect(maxDeviation(HANDWRITTEN_LOOP, out)).toBeLessThanOrEqual(tol + EPS);
    // A tighter tolerance keeps at least as many points.
    expect(out.length).toBeGreaterThanOrEqual(simplify(HANDWRITTEN_LOOP, 1).length);
  });

  it('simplify keeps a back-tracking stroke (distance to segments, not to the infinite line)', () => {
    const raw = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 0 },
    ];
    const out = simplify(raw, 1);
    expect(maxDeviation(raw, out)).toBeLessThanOrEqual(1);
    expect(out).toHaveLength(3);
  });

  it('simplify handles a STROKE_MAX_POINTS-long spiral without recursion problems', () => {
    const out = simplify(SPIRAL.slice(0, STROKE_MAX_POINTS), 1);
    expect(maxDeviation(SPIRAL.slice(0, STROKE_MAX_POINTS), out)).toBeLessThanOrEqual(1 + EPS);
  });
});

describe('stroke.model splitPoints', () => {
  it('TC-03 at STROKE_MAX_POINTS - 1, exactly and + 1: 1, 1 and 2 parts; part 2 starts with part 1’s last point', () => {
    expect(splitPoints(line(STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(line(STROKE_MAX_POINTS))).toHaveLength(1);
    const over = line(STROKE_MAX_POINTS + 1);
    const parts = splitPoints(over);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1]![0]).toEqual(parts[0]![parts[0]!.length - 1]);
    expect(parts[1]![parts[1]!.length - 1]).toEqual(over[over.length - 1]);
    // The spiral fixture (5,010 points) splits the same way.
    const spiral = splitPoints(SPIRAL);
    expect(spiral).toHaveLength(2);
    expect(spiral[1]![0]).toEqual(spiral[0]![STROKE_MAX_POINTS - 1]);
    expect(spiral[0]!.length + spiral[1]!.length - 1).toBe(SPIRAL.length);
  });
});

describe('stroke.model createStroke', () => {
  it('TC-04 one point, thick: a dot whose box is the thickness square, points length 2', () => {
    const { doc, updates } = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = maxZ(doc);
    const before = updates();
    const id = createStroke(doc, { points: [{ x: 50, y: 60 }], color: 'red', thickness: 'thick' }, AUTHOR);
    expect(id).toBeTruthy();
    expect(updates() - before).toBe(1);
    const t = PEN_THICKNESS_WORLD.thick;
    const [s] = strokes(doc);
    expect(s).toMatchObject({
      id,
      type: 'stroke',
      x: 50 - t / 2,
      y: 60 - t / 2,
      width: t,
      height: t,
      baseWidth: t,
      baseHeight: t,
      color: 'red',
      thickness: 'thick',
      createdBy: AUTHOR,
    });
    expect(s!.points).toHaveLength(2);
    expect(s!.z).toBe(top + 1);
    expect(scaledPoints(s!)).toEqual([{ x: 50, y: 60 }]);
  });

  it('createStroke stores points relative to the box padded by half the thickness', () => {
    const { doc } = newDoc();
    const pts = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
    ];
    createStroke(doc, { points: pts, color: 'black', thickness: 'medium' }, AUTHOR);
    const [s] = strokes(doc);
    const pad = PEN_THICKNESS_WORLD.medium / 2;
    expect(s).toMatchObject({ x: 10 - pad, y: 20 - pad, width: 100 + pad * 2, height: 50 + pad * 2 });
    expect(scaledPoints(s!)).toEqual(pts);
  });

  it.each([
    ['empty points', { points: [], color: 'black', thickness: 'medium' }],
    ['a NaN point', { points: [{ x: 0, y: 0 }, { x: NaN, y: 1 }], color: 'black', thickness: 'medium' }],
    ['an infinite point', { points: [{ x: Infinity, y: 0 }], color: 'black', thickness: 'medium' }],
    ["colour 'pink'", { points: [{ x: 0, y: 0 }], color: 'pink', thickness: 'medium' }],
    ["thickness 'huge'", { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' }],
  ])('TC-05 %s: null and zero updates', (_name, input) => {
    const { doc, updates } = newDoc();
    const before = updates();
    const id = createStroke(
      doc,
      input as { points: Point[]; color: PenColor; thickness: PenThickness },
      AUTHOR,
    );
    expect(id).toBeNull();
    expect(updates()).toBe(before);
    expect(strokes(doc)).toHaveLength(0);
  });

  it('TC-06 scaledPoints after width and height doubled: coordinates doubled, thickness unchanged', () => {
    const { doc } = newDoc();
    const id = createStroke(doc, { points: UNDERLINE, color: 'blue', thickness: 'thin' }, AUTHOR)!;
    const [s] = strokes(doc);
    const before = scaledPoints(s!).map((p) => ({ x: p.x - s!.x, y: p.y - s!.y }));
    resizeObjects(doc, new Map([[id, { x: s!.x, y: s!.y, width: s!.width * 2, height: s!.height * 2 }]]));
    const [r] = strokes(doc);
    const after = scaledPoints(r!).map((p) => ({ x: p.x - r!.x, y: p.y - r!.y }));
    after.forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i]!.x * 2, 9);
      expect(p.y).toBeCloseTo(before[i]!.y * 2, 9);
    });
    expect(r!.thickness).toBe('thin');
    expect(r!.baseWidth).toBe(s!.baseWidth);
    expect(r!.points).toEqual(s!.points);
  });

  it('TC-07 distanceToPolyline on scaledPoints at 0, 5.9 and 6.1 units: within, within, outside at zoom 1', () => {
    const { doc } = newDoc();
    createStroke(
      doc,
      {
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ],
        color: 'black',
        thickness: 'thin',
      },
      AUTHOR,
    );
    const [s] = strokes(doc);
    const tol = Math.max(PEN_THICKNESS_WORLD.thin / 2, STROKE_HIT_TOLERANCE_PX / 1);
    const pts = scaledPoints(s!);
    expect(distanceToPolyline(pts, { x: 100, y: 0 })).toBeLessThanOrEqual(tol);
    expect(distanceToPolyline(pts, { x: 100, y: 5.9 })).toBeLessThanOrEqual(tol);
    expect(distanceToPolyline(pts, { x: 100, y: 6.1 })).toBeGreaterThan(tol);
  });

  it('snapshot skips malformed strokes (bad points, colour or base size)', () => {
    const { doc } = newDoc();
    createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'thin' }, AUTHOR);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const bad = (patch: Record<string, unknown>) => {
      const m = new Y.Map<unknown>();
      objects.set(crypto.randomUUID(), m);
      const base = { type: 'stroke', x: 0, y: 0, width: 4, height: 4, baseWidth: 4, baseHeight: 4, points: [1, 1], color: 'black', thickness: 'thin', z: 1 };
      for (const [k, v] of Object.entries({ ...base, ...patch })) m.set(k, v);
    };
    bad({ points: [1] });
    bad({ points: [1, 'x'] });
    bad({ color: 'pink' });
    bad({ baseWidth: 0 });
    expect(strokes(doc)).toHaveLength(1);
  });
});

describe('stroke.model smoothPath', () => {
  it('TC-08 smoothPath of 3 points: starts with M, uses Q segments, deterministic', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 20 },
    ];
    const d = smoothPath(pts);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain('Q 10 20 20 20');
    expect(d).toBe('M 0 0 Q 10 20 20 20 L 30 20');
    expect(smoothPath(pts)).toBe(d);
    // One point: a zero-length path (drawn as a round dot).
    expect(smoothPath([{ x: 5, y: 5 }])).toBe('M 5 5 L 5 5');
    expect(smoothPath([])).toBe('');
  });
});
