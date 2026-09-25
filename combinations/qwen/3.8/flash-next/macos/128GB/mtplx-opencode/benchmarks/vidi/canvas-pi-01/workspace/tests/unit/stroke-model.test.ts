/**
 * Story 11 · unit tests for the stroke model and its geometry (TC-23, TC-24,
 * TC-26). Everything here runs against a plain `Y.Doc` — no DOM, no provider —
 * because both the drawing maths and the document shape are defined in
 * `src/shared` precisely so they can be tested this way.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createStroke,
  scaledPoints,
  setStrokeStyle,
  strokeSnapshot,
  STROKE_TYPE,
} from '../../src/shared/objects/stroke';
import { simplify, smoothPath } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { snapshot } from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import { getObjectType } from '../../src/client/objects/registry';
import type { Point } from '../../src/shared/geometry';

/** A straight 45° path, `n` points long, starting at the origin. */
function diagonal(n: number, step = 10): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < n; i++) points.push({ x: i * step, y: i * step });
  return points;
}

describe('createStroke (design "Stroke model")', () => {
  it('stores the path relative to a box padded by half the ink', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: diagonal(5, 10), color: 'black', thickness: 'medium' }, 'me');
    expect(id).toBeTruthy();
    const record = doc.getMap<Y.Map<unknown>>('objects').get(id!);
    expect(record).toBeTruthy();
    // A 40 × 40 path with 4-unit ink becomes a 44 × 44 box, offset by −2.
    expect(record!.get('x')).toBeCloseTo(-2, 6);
    expect(record!.get('y')).toBeCloseTo(-2, 6);
    expect(record!.get('width')).toBeCloseTo(44, 6);
    expect(record!.get('height')).toBeCloseTo(44, 6);
    const points = record!.get('points') as number[];
    expect(points.length).toBe(10);
    // The first stored coordinate is relative to the padded origin.
    expect(points[0]).toBeCloseTo(2, 6);
    expect(points[1]).toBeCloseTo(2, 6);
  });

  it('gives a one-point dot a thickness-squared box (TC-23)', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: [{ x: 100, y: 50 }], color: 'blue', thickness: 'thick' }, 'me');
    const record = doc.getMap<Y.Map<unknown>>('objects').get(id!);
    expect(record!.get('width')).toBe(8);
    expect(record!.get('height')).toBe(8);
    // The dot itself sits in the middle of that box.
    expect((record!.get('points') as number[])[0]).toBeCloseTo(4, 6);
  });

  it('refuses empty, non-finite and unknown-token input without a transaction', () => {
    const doc = new Y.Doc();
    let transactions = 0;
    doc.on('afterTransaction', () => {
      transactions += 1;
    });
    expect(createStroke(doc, { points: [], color: 'black', thickness: 'thin' }, 'me')).toBeNull();
    expect(createStroke(doc, { points: [{ x: NaN, y: 1 }], color: 'black', thickness: 'thin' }, 'me')).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 1, y: 1 }], color: 'rainbow' as 'black', thickness: 'thin' }, 'me'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 1, y: 1 }], color: 'black', thickness: 'huge' as 'thin' }, 'me'),
    ).toBeNull();
    expect(doc.getMap('objects').size).toBe(0);
    // Nothing was written, so no document transaction happened either.
    expect(transactions).toBe(0);
  });

  it('writes the whole sketch in one transaction, so one Ctrl+Z removes it', () => {
    const doc = new Y.Doc();
    const steps: number[] = [];
    doc.on('afterTransaction', () => steps.push(1));
    const undo = createUndo(doc);
    // This is exactly how the Pen tool commits a gesture: one step, one stroke.
    undo.step(() => createStroke(doc, { points: diagonal(50), color: 'black', thickness: 'medium' }, 'me'));
    expect(steps.length).toBe(1);
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(1);
    undo.undo();
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(0);
    undo.destroy();
  });
});

describe('strokeSnapshot (rehydration)', () => {
  function recordFrom(stroke: { points: readonly number[]; baseWidth?: number; baseHeight?: number }) {
    const record = new Y.Map<unknown>();
    record.set('type', STROKE_TYPE);
    record.set('points', [...stroke.points]);
    if (stroke.baseWidth !== undefined) record.set('baseWidth', stroke.baseWidth);
    if (stroke.baseHeight !== undefined) record.set('baseHeight', stroke.baseHeight);
    return record;
  }
  const base = {
    id: 'x',
    x: 0,
    y: 0,
    z: 1,
    width: 10,
    height: 10,
    createdAt: 0,
  };

  it('rejects a damaged path instead of throwing (TC-24)', () => {
    expect(strokeSnapshot(recordFrom({ points: [] }), base)).toBeNull();
    expect(strokeSnapshot(recordFrom({ points: [1, 2, 3] }), base)).toBeNull();
    expect(strokeSnapshot(recordFrom({ points: [1, Number.NaN, 2, 2] }), base)).toBeNull();
    const huge = new Array<number>(20_000).fill(1);
    expect(strokeSnapshot(recordFrom({ points: huge }), base)).toBeNull();
  });

  it('drops a stroke with a damaged path from the render snapshot', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const record = new Y.Map<unknown>();
    record.set('type', STROKE_TYPE);
    record.set('x', 0);
    record.set('y', 0);
    record.set('width', 10);
    record.set('height', 10);
    record.set('z', 1);
    record.set('createdAt', 0);
    record.set('points', [1, 2, 3]);
    objects.set('broken', record);
    expect(snapshot(doc)).toEqual([]);
  });
});

describe('scaledPoints (proportional resize, TC-26)', () => {
  it('scales the stored path with the box and leaves the ink alone', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: diagonal(5, 10), color: 'black', thickness: 'medium' }, 'me');
    const record = doc.getMap<Y.Map<unknown>>('objects').get(id!);
    const original = scaledPoints({
      x: record!.get('x') as number,
      y: record!.get('y') as number,
      width: record!.get('width') as number,
      height: record!.get('height') as number,
      points: record!.get('points') as number[],
      baseWidth: record!.get('baseWidth') as number,
      baseHeight: record!.get('baseHeight') as number,
    });
    const doubled = scaledPoints({
      x: (record!.get('x') as number) - 44,
      y: (record!.get('y') as number) - 44,
      width: (record!.get('width') as number) * 2,
      height: (record!.get('height') as number) * 2,
      points: record!.get('points') as number[],
      baseWidth: record!.get('baseWidth') as number,
      baseHeight: record!.get('baseHeight') as number,
    });
    // Same shape, twice the size: every spacing doubles.
    const gap = (points: Point[]) => Math.abs(points[1].x - points[0].x);
    expect(gap(doubled)).toBeCloseTo(gap(original) * 2, 6);
    // And the path is exactly twice as long, in the same direction.
    expect(doubled.length).toBe(original.length);
  });
});

describe('simplify (Ramer–Douglas–Peucker, TC-24)', () => {
  it('collapses a straight run to its two ends', () => {
    const line = diagonal(100, 1);
    const result = simplify(line, 1);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 99, y: 99 });
  });

  it('keeps every raw point within the tolerance (TC-24)', () => {
    // A nearly-straight path whose wobble is smaller than the tolerance: all of
    // it is "explained" by the two ends, and the property the PRD asks for is
    // that no raw point is left further than the tolerance from the result.
    const wobble: Point[] = [];
    for (let i = 0; i < 60; i++) wobble.push({ x: i * 5, y: i % 2 === 0 ? 0 : 0.2 });
    const tolerance = 1;
    const collapsed = simplify(wobble, tolerance);
    expect(collapsed.length).toBeLessThan(wobble.length);
    for (const point of wobble) {
      expect(distanceToPolyline(collapsed, point)).toBeLessThanOrEqual(tolerance + 1e-9);
    }
    // A real corner (a 90° turn) is kept: the path is not flattened away.
    const corner: Point[] = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
    expect(simplify(corner, 1).length).toBe(3);
  });

  it('leaves a two-point path alone and survives a 5,000-point spiral', () => {
    expect(simplify([{ x: 0, y: 0 }, { x: 1, y: 1 }], 1).length).toBe(2);
    const spiral: Point[] = [];
    for (let i = 0; i < 5000; i++) {
      const angle = i / 20;
      spiral.push({ x: Math.cos(angle) * (i / 10), y: Math.sin(angle) * (i / 10) });
    }
    expect(() => simplify(spiral, 1)).not.toThrow();
    expect(simplify(spiral, 1).length).toBeLessThan(5000);
    expect(smoothPath(spiral).startsWith('M')).toBe(true);
  });
});

describe('the stroke registry (TC-23)', () => {
  it('tests the footprint against the path, not the bounding box', () => {
    const spec = getObjectType('stroke');
    expect(spec).toBeTruthy();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    // A horizontal line from (0,0) to (100,0) in a 100 × 4 box.
    const stroke = {
      id: 's1',
      type: STROKE_TYPE,
      x: 0,
      y: 0,
      z: 1,
      width: 100,
      height: 4,
      createdAt: 0,
      points: [0, 2, 20, 2, 40, 2, 60, 2, 80, 2, 100, 2],
      baseWidth: 100,
      baseHeight: 4,
      color: 'black',
      thickness: 'medium',
    } as never;
    // On the line: selected. Far inside the box: not.
    expect(spec!.hitTest(stroke, { x: 50, y: 2 })).toBe(true);
    expect(spec!.hitTest(stroke, { x: 50, y: 40 })).toBe(false);
    // The tolerance is at least 6 screen px, so at zoom 2 it is 3 world units.
    expect(spec!.hitTest(stroke, { x: 50, y: 4.5 }, 2)).toBe(true);
    expect(spec!.hitTest(stroke, { x: 50, y: 10 }, 2)).toBe(false);
  });
});

describe('setStrokeStyle (restyle without a new object)', () => {
  it('changes the tokens of the sketch that already exists', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: diagonal(6, 5), color: 'black', thickness: 'medium' }, 'me');
    expect(setStrokeStyle(doc, id!, { color: 'purple', thickness: 'thick' })).toBe(true);
    const record = doc.getMap<Y.Map<unknown>>('objects').get(id!);
    expect(record!.get('color')).toBe('purple');
    expect(record!.get('thickness')).toBe('thick');
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(1);
    // An unknown token writes nothing.
    expect(setStrokeStyle(doc, id!, { color: 'rainbow' })).toBe(false);
    expect(setStrokeStyle(doc, 'missing', { color: 'red' })).toBe(false);
  });
});
