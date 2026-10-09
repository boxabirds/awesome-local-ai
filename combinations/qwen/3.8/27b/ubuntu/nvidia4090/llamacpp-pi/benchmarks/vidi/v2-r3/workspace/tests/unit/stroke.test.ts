/**
 * Story 11 unit tests (TC-01 to TC-08): the stroke model (stroke.model) and
 * the stroke geometry (simplify / splitPoints / smoothPath) against a real
 * Y.Doc.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  initDoc,
  registerKnownObjectType,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import {
  createStroke,
  scaledPoints,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import { handwrittenLoop, longSpiral } from '../fixtures/pen-paths';

registerKnownObjectType('stroke'); // as the client registry does at load

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function item(doc: Y.Doc, id: string): Y.Map<any> {
  return doc.getMap('objects').get(id) as Y.Map<any>;
}

function strokeOf(doc: Y.Doc, id: string): StrokeSnap {
  const o = snapshot(doc).find((s) => s.id === id);
  if (!o) throw new Error(`missing stroke ${id}`);
  return o as StrokeSnap;
}

describe('stroke.model', () => {
  it('TC-01: simplify of the recorded handwritten loop at tolerance 1 keeps every raw point within 1 unit, with fewer points', () => {
    const out = simplify(handwrittenLoop, 1);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.length).toBeLessThan(handwrittenLoop.length);
    // first and last points are always kept
    expect(out[0]).toEqual(handwrittenLoop[0]);
    expect(out[out.length - 1]).toEqual(handwrittenLoop[handwrittenLoop.length - 1]);
    for (const p of handwrittenLoop) {
      expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(1);
    }
  });

  it('TC-02: simplify at tolerance 0.5 keeps every raw point within 0.5 units, with fewer points', () => {
    const out = simplify(handwrittenLoop, 0.5);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.length).toBeLessThan(handwrittenLoop.length);
    for (const p of handwrittenLoop) {
      expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(0.5);
    }
  });

  it('TC-03: splitPoints at STROKE_MAX_POINTS − 1 / exactly / + 1 → 1 / 1 / 2 parts; part 2 starts with part 1 last', () => {
    expect(splitPoints(longSpiral.slice(0, STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(longSpiral.slice(0, STROKE_MAX_POINTS))).toHaveLength(1);
    const parts = splitPoints(longSpiral.slice(0, STROKE_MAX_POINTS + 1));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
  });

  it('TC-04: createStroke with a single point and thick → dot with a thickness-square bbox and points of length 2', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 10, y: 20 }], color: 'black', thickness: 'thick' }, 'priya');
    expect(id).toBeTruthy();
    const t = PEN_THICKNESS_WORLD.thick;
    const o = item(doc, id!);
    expect(o.get('width')).toBe(t);
    expect(o.get('height')).toBe(t);
    expect(o.get('x')).toBe(10 - t / 2);
    expect(o.get('y')).toBe(20 - t / 2);
    const pts = o.get('points') as number[];
    expect(pts).toHaveLength(2);
    // the relative points describe the dot at its centre
    const snap = strokeOf(doc, id!);
    expect(scaledPoints(snap)).toEqual([{ x: 10, y: 20 }]);
  });

  it('TC-05: empty points / NaN point / unknown colour / unknown thickness → null with zero updates', () => {
    const doc = newDoc();
    let updates = 0;
    doc.on('update', () => updates++);
    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'p')).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 1, y: Number.NaN }], color: 'black', thickness: 'medium' }, 'p'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: 'pink' as never, thickness: 'medium' }, 'p'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: 'black', thickness: 'huge' as never }, 'p'),
    ).toBeNull();
    expect(updates).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('TC-06: a stroke created at the origin and doubled by a resize → scaledPoints coordinates doubled, thickness unchanged', () => {
    const doc = newDoc();
    const id = createStroke(
      doc,
      { points: [{ x: 2, y: 2 }, { x: 12, y: 12 }], color: 'black', thickness: 'medium' },
      'priya',
    );
    const before = strokeOf(doc, id!);
    // bbox: points (2,2)-(12,12) expanded by half the medium thickness (2)
    expect(before.x).toBe(0);
    expect(before.y).toBe(0);
    expect(before.width).toBe(14);
    expect(before.height).toBe(14);

    const n = resizeObjects(doc, new Map([[id!, { x: 0, y: 0, width: 28, height: 28 }]]));
    expect(n).toBe(1);

    const after = strokeOf(doc, id!);
    expect(after.width).toBe(28);
    expect(after.height).toBe(28);
    expect(after.thickness).toBe('medium');
    expect(PEN_THICKNESS_WORLD[after.thickness as keyof typeof PEN_THICKNESS_WORLD]).toBe(PEN_THICKNESS_WORLD.medium);
    expect(scaledPoints(after)).toEqual([{ x: 4, y: 4 }, { x: 24, y: 24 }]);
  });

  it('TC-07: line-distance hit rule: on the line and 5.9 units away hit at zoom 1, 6.1 away misses', () => {
    const doc = newDoc();
    const id = createStroke(
      doc,
      { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' },
      'priya',
    );
    const snap = strokeOf(doc, id!);
    const pts = scaledPoints(snap);
    const tol = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX); // zoom 1
    expect(distanceToPolyline(pts, { x: 50, y: 0 }) <= tol).toBe(true); // on the line
    expect(distanceToPolyline(pts, { x: 50, y: 5.9 }) <= tol).toBe(true);
    expect(distanceToPolyline(pts, { x: 50, y: 6.1 }) <= tol).toBe(false);
  });

  it('TC-08: smoothPath of 3 points → deterministic string starting with M and using Q segments', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ];
    const d = smoothPath(pts);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    expect(smoothPath(pts)).toBe(d);
    // a single point is a (zero-length) path too
    const dot = smoothPath([{ x: 3, y: 4 }]);
    expect(dot.startsWith('M')).toBe(true);
  });
});
