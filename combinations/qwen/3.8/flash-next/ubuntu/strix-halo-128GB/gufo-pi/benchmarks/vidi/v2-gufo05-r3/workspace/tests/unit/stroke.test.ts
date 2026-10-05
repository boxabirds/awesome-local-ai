/**
 * Stroke model and geometry unit tests (story 11, task 1): TC-01 to TC-08.
 *
 * Pure maths on a real Y.Doc: simplification faithfulness, the split boundary
 * at `STROKE_MAX_POINTS`, the dot case, rejection of invalid input (which must
 * not open a transaction — an empty one would still travel to every screen),
 * proportional scaling and the line-distance that backs selection.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { snapshot } from '../../src/shared/board-model';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop, spiral, underline } from '../fixtures/pen-paths';

/** Count the `update` events `fn` produces. */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const listener = () => {
    updates++;
  };
  doc.on('update', listener);
  try {
    fn();
  } finally {
    doc.off('update', listener);
  }
  return updates;
}

/** The snapshot of the single stroke on the board. */
function onlyStroke(doc: Y.Doc): StrokeSnap {
  const strokes = snapshot(doc).filter((s): s is StrokeSnap => s.type === 'stroke');
  if (strokes.length !== 1) throw new Error(`expected exactly one stroke, got ${strokes.length}`);
  return strokes[0];
}

/** Unflatten a stored points array back to world points. */
function worldPoints(s: StrokeSnap): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    out.push({ x: s.x + s.points[i], y: s.y + s.points[i + 1] });
  }
  return out;
}

describe('simplify (Ramer-Douglas-Peucker)', () => {
  // TC-01: a recorded handwritten loop simplified at tolerance 1 stays
  // faithful — every point the user drew lies within 1 unit of the result —
  // and the result is smaller than the recording.
  it('TC-01 keeps every raw point within the tolerance and drops the rest', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 1);
    expect(result.length).toBeLessThan(raw.length);
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const p of raw) {
      expect(distanceToPolyline(result, p)).toBeLessThanOrEqual(1);
    }
    // First and last are kept exactly.
    expect(result[0]).toEqual(raw[0]);
    expect(result[result.length - 1]).toEqual(raw[raw.length - 1]);
  });

  // TC-02: the tolerance is the caller's — at zoom 200% the caller passes
  // 1/zoom = 0.5 and faithfulness tightens with it.
  it('TC-02 a tolerance of 0.5 (zoom 200%) holds every point within 0.5', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 1 / 2);
    expect(result.length).toBeLessThan(raw.length);
    for (const p of raw) {
      expect(distanceToPolyline(result, p)).toBeLessThanOrEqual(0.5);
    }
  });

  it('a degenerate recording is returned as itself', () => {
    const two: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    expect(simplify(two, 1)).toEqual(two);
    const one: Point[] = [{ x: 3, y: 4 }];
    expect(simplify(one, 1)).toEqual(one);
    expect(simplify([], 1)).toEqual([]);
  });
});

describe('splitPoints', () => {
  const line = (n: number): Point[] =>
    Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));

  // TC-03: the boundary values — one below, exactly at, and one above the
  // recorded-point limit.
  it('TC-03 splits at the limit with a shared join point', () => {
    const below = splitPoints(line(STROKE_MAX_POINTS - 1));
    expect(below).toHaveLength(1);
    expect(below[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const exact = splitPoints(line(STROKE_MAX_POINTS));
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(STROKE_MAX_POINTS);

    const over = splitPoints(line(STROKE_MAX_POINTS + 1));
    expect(over).toHaveLength(2);
    expect(over[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(over[1][0]).toEqual(over[0][over[0].length - 1]);
    expect(over[1][1]).toEqual(line(STROKE_MAX_POINTS + 1)[STROKE_MAX_POINTS]);
  });

  it('a spiral far past the limit splits into parts that cover it in order', () => {
    const raw = spiral();
    const parts = splitPoints(raw);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
      expect(part.length).toBeGreaterThanOrEqual(2);
    }
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i][0]).toEqual(parts[i - 1][parts[i - 1].length - 1]);
    }
    const joined = parts.flatMap((part, i) => (i === 0 ? part : part.slice(1)));
    expect(joined).toEqual(raw);
  });
});

describe('createStroke', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  // TC-04: a click is a dot — the bbox is a thickness square, one point stays,
  // centred in it.
  it('TC-04 a single thick point becomes a thickness-sized dot', () => {
    const id = createStroke(
      doc,
      { points: [{ x: 100, y: 50 }], color: 'black', thickness: 'thick' },
      'priya',
    );
    expect(id).toBeTruthy();
    const s = onlyStroke(doc);
    const side = PEN_THICKNESS_WORLD.thick;
    expect(s.x).toBe(100 - side / 2);
    expect(s.y).toBe(50 - side / 2);
    expect(s.width).toBe(side);
    expect(s.height).toBe(side);
    expect(s.baseWidth).toBe(side);
    expect(s.baseHeight).toBe(side);
    expect(s.points).toHaveLength(2);
    expect(s.points).toEqual([side / 2, side / 2]);
    expect(s.createdBy).toBe('priya');
  });

  it('a drag is stored relative to its bbox, padded by half the thickness', () => {
    const raw = underline();
    const id = createStroke(doc, { points: raw, color: 'red', thickness: 'medium' }, 'sam');
    expect(id).toBeTruthy();
    const s = onlyStroke(doc);
    const pad = PEN_THICKNESS_WORLD.medium / 2;
    const minX = Math.min(...raw.map((p) => p.x));
    const minY = Math.min(...raw.map((p) => p.y));
    const maxX = Math.max(...raw.map((p) => p.x));
    const maxY = Math.max(...raw.map((p) => p.y));
    expect(s.x).toBeCloseTo(minX - pad, 6);
    expect(s.y).toBeCloseTo(minY - pad, 6);
    expect(s.width).toBeCloseTo(maxX - minX + pad * 2, 6);
    expect(s.height).toBeCloseTo(maxY - minY + pad * 2, 6);
    // Every stored point round-trips to its world position.
    const world = worldPoints(s);
    expect(world).toHaveLength(raw.length);
    for (let i = 0; i < raw.length; i++) {
      expect(world[i].x).toBeCloseTo(raw[i].x, 6);
      expect(world[i].y).toBeCloseTo(raw[i].y, 6);
    }
    expect(s.color).toBe('red');
    expect(s.thickness).toBe('medium');
  });

  it('one stroke is exactly one transaction', () => {
    const updates = countUpdates(doc, () => {
      createStroke(doc, { points: underline(), color: 'blue', thickness: 'thin' }, 'sam');
    });
    expect(updates).toBe(1);
  });

  // TC-05: invalid input is refused before a transaction opens — no stroke,
  // and no update on the wire (negative / error paths).
  it('TC-05 refuses empty, non-finite, unknown-colour and unknown-thickness input', () => {
    expect(
      createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'a'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'medium' }, 'a'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as never, thickness: 'medium' }, 'a'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' as never }, 'a'),
    ).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-05 a refused stroke produces zero update events', () => {
    const updates = countUpdates(doc, () => {
      createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'a');
      createStroke(doc, { points: [{ x: 1, y: Infinity }], color: 'black', thickness: 'medium' }, 'a');
      createStroke(doc, { points: [{ x: 1, y: 2 }], color: 'pink' as never, thickness: 'medium' }, 'a');
      createStroke(doc, { points: [{ x: 1, y: 2 }], color: 'black', thickness: 'huge' as never }, 'a');
    });
    expect(updates).toBe(0);
  });
});

describe('scaledPoints and selection distance', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  // TC-06: proportional resize — the drawn line scales with the box, the
  // thickness stays the stored one.
  it('TC-06 doubling the box doubles every drawn coordinate and keeps the thickness', () => {
    const raw = underline();
    const created = createStroke(doc, { points: raw, color: 'green', thickness: 'medium' }, 'a');
    if (created === null) throw new Error('createStroke refused a valid stroke');
    const before = onlyStroke(doc);
    const doubledWidth = (before.width ?? before.baseWidth) * 2;
    const doubledHeight = (before.height ?? before.baseHeight) * 2;
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    doc.transact(() => {
      objects.get(created)?.set('width', doubledWidth);
      objects.get(created)?.set('height', doubledHeight);
    });
    const after = onlyStroke(doc);
    const scaled = scaledPoints(after);
    const original = scaledPoints(before);
    expect(scaled).toHaveLength(original.length);
    for (let i = 0; i < scaled.length; i++) {
      expect(scaled[i].x).toBeCloseTo(before.x + (original[i].x - before.x) * 2, 6);
      expect(scaled[i].y).toBeCloseTo(before.y + (original[i].y - before.y) * 2, 6);
    }
    expect(after.thickness).toBe('medium');
  });

  // TC-07: the hit rule at zoom 1 — 6 screen pixels are 6 world units, so
  // 5.9 selects and 6.1 does not.
  it('TC-07 the selection distance crosses STROKE_HIT_TOLERANCE_PX at the boundary', () => {
    createStroke(
      doc,
      { points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }], color: 'black', thickness: 'medium' },
      'a',
    );
    const s = onlyStroke(doc);
    const pts = scaledPoints(s);
    const on = distanceToPolyline(pts, { x: 200, y: 100 });
    const justInside = distanceToPolyline(pts, { x: 200, y: 100 + STROKE_HIT_TOLERANCE_PX - 0.1 });
    const justOutside = distanceToPolyline(pts, { x: 200, y: 100 + STROKE_HIT_TOLERANCE_PX + 0.1 });
    expect(on).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(justInside).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(justOutside).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });
});

describe('smoothPath', () => {
  // TC-08: the renderer's path is an `M` move followed by quadratic segments,
  // and it is a pure function of its points.
  it('TC-08 builds a deterministic path of quadratic segments', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const d = smoothPath(pts);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    expect(d).toBe(smoothPath(pts));
    // The curve starts at the first point and ends at the last.
    expect(d).toContain('0 0');
    expect(d.trim().endsWith('20 0')).toBe(true);
  });

  it('a single point draws a zero-length stroke (a round cap makes the dot)', () => {
    const d = smoothPath([{ x: 5, y: 7 }]);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('5 7');
  });

  it('no points draw nothing', () => {
    expect(smoothPath([])).toBe('');
  });
});
