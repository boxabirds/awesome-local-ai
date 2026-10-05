import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  resizeObjects,
} from '../../src/shared/board-model';
import {
  STROKE_MAX_POINTS,
  STROKE_HIT_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
} from '../../src/shared/config';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import type { PenColor, PenThickness } from '../../src/shared/config';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Point } from '../../src/shared/geometry';
import { penPaths } from '../fixtures/pen-paths';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Find the stroke snapshot with the given id. */
function strokeSnap(doc: Y.Doc, id: string): StrokeSnap {
  const entry = snapshot(doc).find((o) => o.id === id) as StrokeSnap | undefined;
  expect(entry, `stroke ${id} not in snapshot`).toBeDefined();
  return entry!;
}

/** A straight horizontal line of points (world units) at y = 0. */
function straightLine(n: number, from = 0, to = 100): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    pts.push({ x: from + t * (to - from), y: 0 });
  }
  return pts;
}

// ─── TC-01: simplify loop at tolerance 1 ─────────────────────────────────────
describe('TC-01: simplify handwritten loop at tolerance 1', () => {
  it('every raw point within 1 unit of result; result has fewer points', () => {
    const raw = penPaths.handwrittenLoop;
    const result = simplify(raw, 1);

    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(raw.length);

    // First and last kept
    expect(result[0]).toEqual(raw[0]);
    expect(result[result.length - 1]).toEqual(raw[raw.length - 1]);

    // Every raw point lies within 1 unit of the simplified polyline
    for (const p of raw) {
      const d = distanceToPolyline(result, p);
      expect(d).toBeLessThanOrEqual(1);
    }
  });
});

// ─── TC-02: simplify at tolerance 0.5 (zoom 200%) ────────────────────────────
describe('TC-02: simplify at tolerance 0.5', () => {
  it('every raw point within 0.5 units', () => {
    const raw = penPaths.handwrittenLoop;
    const result = simplify(raw, 0.5);

    expect(result.length).toBeGreaterThan(0);
    for (const p of raw) {
      const d = distanceToPolyline(result, p);
      expect(d).toBeLessThanOrEqual(0.5);
    }
  });
});

// ─── TC-03: splitPoints at the point-limit boundary ──────────────────────────
describe('TC-03: splitPoints at STROKE_MAX_POINTS - 1 / exactly / + 1', () => {
  const base = penPaths.longSpiral; // 5,010 points

  it('STROKE_MAX_POINTS - 1 points → 1 part', () => {
    const pts = base.slice(0, STROKE_MAX_POINTS - 1);
    const parts = splitPoints(pts);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS - 1);
  });

  it('exactly STROKE_MAX_POINTS points → 1 part', () => {
    const pts = base.slice(0, STROKE_MAX_POINTS);
    const parts = splitPoints(pts);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
  });

  it('STROKE_MAX_POINTS + 1 points → 2 parts; part 2 starts with part 1 last point', () => {
    const pts = base.slice(0, STROKE_MAX_POINTS + 1);
    const parts = splitPoints(pts);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
  });
});

// ─── TC-04: createStroke single point (dot) ──────────────────────────────────
describe('TC-04: createStroke with one point, thickness thick', () => {
  it('bbox is a thickness square; points length 2', () => {
    const doc = newDoc();
    const t = PEN_THICKNESS_WORLD.thick;
    const at = { x: 100, y: 200 };
    const id = createStroke(doc, { points: [at], color: 'black', thickness: 'thick' }, 'local');
    expect(id).toBeTypeOf('string');

    const s = strokeSnap(doc, id!);
    expect(s.width).toBe(t);
    expect(s.height).toBe(t);
    expect(s.x).toBe(at.x - t / 2);
    expect(s.y).toBe(at.y - t / 2);
    expect(s.baseWidth).toBe(t);
    expect(s.baseHeight).toBe(t);
    expect(s.points).toHaveLength(2);
    // The single stored point sits at the centre of the bbox
    const p = scaledPoints(s);
    expect(p).toHaveLength(1);
    expect(p[0].x).toBeCloseTo(at.x, 5);
    expect(p[0].y).toBeCloseTo(at.y, 5);
  });
});

// ─── TC-05: invalid input → null, zero updates ───────────────────────────────
describe('TC-05: invalid input is rejected with no transaction', () => {
  const cases: Array<[string, { points: readonly Point[]; color: string; thickness: string }]> = [
    ['empty points', { points: [], color: 'black', thickness: 'medium' }],
    ['NaN point', { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'medium' }],
    ['colour pink', { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], color: 'pink', thickness: 'medium' }],
    ['thickness huge', { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], color: 'black', thickness: 'huge' }],
  ];

  for (const [name, args] of cases) {
    it(`${name} → null and zero update events`, () => {
      const doc = newDoc();
      let updates = 0;
      doc.on('update', () => {
        updates++;
      });

      const id = createStroke(doc, args as { points: readonly Point[]; color: PenColor; thickness: PenThickness }, 'local');
      expect(id).toBeNull();
      expect(updates).toBe(0);
      expect(snapshot(doc)).toHaveLength(0);
    });
  }
});

// ─── TC-06: scaledPoints after proportional resize ───────────────────────────
describe('TC-06: scaledPoints after width and height doubled', () => {
  it('coordinates doubled; thickness unchanged', () => {
    const doc = newDoc();
    const pts = straightLine(20, 0, 100);
    const id = createStroke(doc, { points: pts, color: 'black', thickness: 'medium' }, 'local');

    const before = strokeSnap(doc, id!);
    const worldBefore = scaledPoints(before);

    // Double the size (generic story 7 resize)
    resizeObjects(doc, new Map([[id!, { x: before.x, y: before.y, width: (before.width ?? 0) * 2, height: (before.height ?? 0) * 2 }]]));

    const after = strokeSnap(doc, id!);
    const worldAfter = scaledPoints(after);

    expect(after.width).toBeCloseTo((before.width ?? 0) * 2, 5);
    expect(after.height).toBeCloseTo((before.height ?? 0) * 2, 5);
    expect(after.thickness).toBe(before.thickness);
    expect(worldAfter).toHaveLength(worldBefore.length);
    for (let i = 0; i < worldBefore.length; i++) {
      expect(worldAfter[i].x).toBeCloseTo(before.x + (worldBefore[i].x - before.x) * 2, 5);
      expect(worldAfter[i].y).toBeCloseTo(before.y + (worldBefore[i].y - before.y) * 2, 5);
    }
  });
});

// ─── TC-07: hit distance at 0 / 5.9 / 6.1 units ──────────────────────────────
describe('TC-07: distanceToPolyline on scaledPoints (hit tolerance boundary)', () => {
  it('0 / 5.9 / 6.1 units → within / within / outside STROKE_HIT_TOLERANCE_PX at zoom 1', () => {
    const doc = newDoc();
    const pts = straightLine(50, 0, 100);
    const id = createStroke(doc, { points: pts, color: 'black', thickness: 'medium' }, 'local');
    const s = strokeSnap(doc, id!);
    const world = scaledPoints(s);

    const zoom = 1;
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[s.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / zoom,
    );
    expect(tolerance).toBe(STROKE_HIT_TOLERANCE_PX);

    const onLine = { x: 50, y: 0 };
    const near = { x: 50, y: 5.9 };
    const far = { x: 50, y: 6.1 };

    expect(distanceToPolyline(world, onLine)).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(world, near)).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(world, far)).toBeGreaterThan(tolerance);
  });
});

// ─── TC-08: smoothPath of 3 points ───────────────────────────────────────────
describe('TC-08: smoothPath of 3 points', () => {
  it('deterministic string starting with M and using Q segments', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ];
    const d1 = smoothPath(pts);
    const d2 = smoothPath(pts);

    expect(d1).toBe(d2);
    expect(d1.startsWith('M ')).toBe(true);
    expect(d1).toContain('Q ');
    // Ends at the last point
    expect(d1.endsWith('20 0')).toBe(true);
  });

  it('single point → zero-length path (round dot)', () => {
    const d = smoothPath([{ x: 3, y: 4 }]);
    expect(d.startsWith('M 3 4')).toBe(true);
  });
});
