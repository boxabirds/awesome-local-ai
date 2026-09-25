import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, objectSnapshot, registerModelObjectType, resizeObjects } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type PenColor, type PenThickness, type StrokeSnap } from '../../src/shared/objects/stroke';
import { HANDWRITTEN_LOOP, LONG_SPIRAL, UNDERLINE } from '../fixtures/pen-paths';

// The client registry makes 'stroke' a known type; the model tests do the same without React.
registerModelObjectType('stroke');

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const on = () => n++;
  doc.on('update', on);
  try {
    fn();
  } finally {
    doc.off('update', on);
  }
  return n;
}

const stroke = (doc: Y.Doc, id: string) => objectSnapshot(doc).find((o) => o.id === id) as StrokeSnap;

function maxDeviation(raw: readonly Point[], result: readonly Point[]): number {
  return Math.max(...raw.map((p) => distanceToPolyline(result, p)));
}

/** A drawn line's hit test at `zoom`, as the registry does it. */
function hits(s: StrokeSnap, p: Point, zoom: number): boolean {
  return distanceToPolyline(scaledPoints(s), p) <= Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
}

describe('stroke model and geometry (stroke.model)', () => {
  it('TC-01 simplifying a handwritten loop at tolerance 1 keeps every raw point within 1 unit, with fewer points', () => {
    const out = simplify(HANDWRITTEN_LOOP, 1);
    expect(maxDeviation(HANDWRITTEN_LOOP, out)).toBeLessThanOrEqual(1);
    expect(out.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    expect(out[0]).toEqual(HANDWRITTEN_LOOP[0]);
    expect(out.at(-1)).toEqual(HANDWRITTEN_LOOP.at(-1));
    const line = simplify(UNDERLINE, 1);
    expect(maxDeviation(UNDERLINE, line)).toBeLessThanOrEqual(1);
    expect(line.length).toBeLessThan(UNDERLINE.length);
  });

  it('TC-02 at 200% zoom (tolerance 0.5) every raw point is within 0.5 units', () => {
    const out = simplify(HANDWRITTEN_LOOP, 1 / 2);
    expect(maxDeviation(HANDWRITTEN_LOOP, out)).toBeLessThanOrEqual(0.5);
    expect(out.length).toBeGreaterThan(simplify(HANDWRITTEN_LOOP, 1).length);
    // Long input needs no recursion.
    expect(maxDeviation(LONG_SPIRAL, simplify(LONG_SPIRAL, 0.5))).toBeLessThanOrEqual(0.5);
  });

  it('TC-03 splitPoints at STROKE_MAX_POINTS - 1, exactly and + 1 gives 1, 1 and 2 parts sharing the join point', () => {
    const pts = (n: number) => LONG_SPIRAL.slice(0, n);
    expect(splitPoints(pts(STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(pts(STROKE_MAX_POINTS))).toHaveLength(1);
    const parts = splitPoints(pts(STROKE_MAX_POINTS + 1));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1][0]).toEqual(parts[0].at(-1));
    expect(parts[1].at(-1)).toEqual(LONG_SPIRAL[STROKE_MAX_POINTS]);
  });

  it('TC-04 a single point makes a dot: the box is a thickness-sided square and one point is stored', () => {
    const doc = freshDoc();
    const id = createStroke(doc, { points: [{ x: 100, y: 50 }], color: 'black', thickness: 'thick' }, 'g')!;
    const s = stroke(doc, id);
    const t = PEN_THICKNESS_WORLD.thick;
    expect(s).toMatchObject({ x: 100 - t / 2, y: 50 - t / 2, width: t, height: t, color: 'black', thickness: 'thick' });
    expect(s.points).toHaveLength(2);
    expect(scaledPoints(s)).toEqual([{ x: 100, y: 50 }]);
  });

  it('TC-05 empty points, a NaN point, colour pink or thickness huge create nothing and emit no update', () => {
    const doc = freshDoc();
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    const n = countUpdates(doc, () => {
      expect(createStroke(doc, { points: [], color: 'black', thickness: 'thin' }, 'g')).toBeNull();
      expect(createStroke(doc, { points: [{ x: 0, y: 0 }, { x: NaN, y: 1 }], color: 'black', thickness: 'thin' }, 'g')).toBeNull();
      expect(createStroke(doc, { points: pts, color: 'pink' as PenColor, thickness: 'thin' }, 'g')).toBeNull();
      expect(createStroke(doc, { points: pts, color: 'black', thickness: 'huge' as PenThickness }, 'g')).toBeNull();
    });
    expect(n).toBe(0);
    expect(objectSnapshot(doc)).toHaveLength(0);
  });

  it('a stroke is one update; the box is the points padded by half the thickness', () => {
    const doc = freshDoc();
    let id: string | null = null;
    expect(countUpdates(doc, () => (id = createStroke(doc, { points: [{ x: 10, y: 20 }, { x: 110, y: 70 }], color: 'red', thickness: 'medium' }, 'g')))).toBe(1);
    const s = stroke(doc, id!);
    expect(s).toMatchObject({ x: 8, y: 18, width: 104, height: 54, baseWidth: 104, baseHeight: 54, color: 'red' });
    expect(scaledPoints(s)).toEqual([{ x: 10, y: 20 }, { x: 110, y: 70 }]);
  });

  it('TC-06 after width and height are doubled the drawn coordinates double; thickness is unchanged', () => {
    const doc = freshDoc();
    const id = createStroke(doc, { points: [{ x: 2, y: 2 }, { x: 42, y: 22 }], color: 'blue', thickness: 'medium' }, 'g')!;
    const before = stroke(doc, id);
    expect(before).toMatchObject({ x: 0, y: 0, width: 44, height: 24 });
    resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 88, height: 48 }]]));
    const after = stroke(doc, id);
    expect(scaledPoints(after)).toEqual(scaledPoints(before).map((p) => ({ x: p.x * 2, y: p.y * 2 })));
    expect(after.thickness).toBe('medium');
    expect(after.points).toEqual(before.points);
  });

  it('TC-07 at zoom 1 points 0 and 5.9 units from the line are within the tolerance, 6.1 is outside', () => {
    const doc = freshDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], color: 'black', thickness: 'thin' }, 'g')!;
    const s = stroke(doc, id);
    expect(distanceToPolyline(scaledPoints(s), { x: 100, y: 0 })).toBe(0);
    expect(hits(s, { x: 100, y: 0 }, 1)).toBe(true);
    expect(hits(s, { x: 100, y: 5.9 }, 1)).toBe(true);
    expect(hits(s, { x: 100, y: 6.1 }, 1)).toBe(false);
  });

  it('TC-08 smoothPath of 3 points starts with M, uses Q segments and is deterministic', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 0 }];
    const d = smoothPath(pts);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain('Q 10 20 20 10');
    expect(d).toBe(smoothPath(pts));
    expect(d).toBe('M 0 0 Q 10 20 20 10 L 30 0');
    expect(smoothPath([{ x: 5, y: 5 }])).toBe('M 5 5 L 5 5');
  });
});
