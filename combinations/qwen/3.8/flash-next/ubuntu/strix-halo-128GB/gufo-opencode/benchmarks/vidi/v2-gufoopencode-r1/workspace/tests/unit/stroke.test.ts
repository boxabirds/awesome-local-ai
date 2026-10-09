import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { initDoc, resizeObjects, snapshotAll, isStrokeObject } from '../../src/shared/board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX
} from '../../src/shared/config';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints } from '../../src/shared/objects/stroke';
import {
  handwrittenLoop,
  straightLine,
  syntheticSpiral,
  underlinePath,
  type FixturePoint
} from '../fixtures/pen-paths';

function countUpdates(doc: Y.Doc): () => number {
  let n = 0;
  const handler = (): void => {
    n += 1;
  };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return n;
  };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function entry(doc: Y.Doc, id: string): Y.Map<unknown> {
  return doc.getMap('objects').get(id) as Y.Map<unknown>;
}

// Worst deviation of every raw point from the simplified polyline.
function maxDeviation(raw: readonly FixturePoint[], simplified: readonly FixturePoint[]): number {
  let max = 0;
  for (const p of raw) {
    const d = distanceToPolyline(simplified, p);
    if (d > max) max = d;
  }
  return max;
}

describe('pen.simplify', () => {
  test('TC-01 RDP shortens the loop fixture, keeps endpoints and keeps every point within tolerance', () => {
    const raw = handwrittenLoop();
    const out = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(raw.length).toBe(401);
    expect(out.length).toBeLessThan(raw.length);
    expect(out.length).toBeGreaterThan(2);
    expect(out[0]).toEqual({ x: raw[0].x, y: raw[0].y });
    expect(out[out.length - 1]).toEqual({ x: raw[raw.length - 1].x, y: raw[raw.length - 1].y });
    expect(maxDeviation(raw, out)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);
  });

  test('TC-02 a tighter tolerance keeps at least as many points and stays within it', () => {
    const raw = underlinePath();
    const loose = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);
    const tight = simplify(raw, 0.5);
    expect(loose.length).toBeLessThan(raw.length);
    expect(tight.length).toBeGreaterThanOrEqual(loose.length);
    expect(tight.length).toBeLessThan(raw.length);
    expect(maxDeviation(raw, tight)).toBeLessThanOrEqual(0.5);
  });

  test('simplify passes short inputs through and is deterministic', () => {
    expect(simplify([], 1)).toEqual([]);
    const one = [{ x: 1, y: 2 }];
    expect(simplify(one, 1)).toEqual(one);
    const two = [
      { x: 0, y: 0 },
      { x: 3, y: 4 }
    ];
    expect(simplify(two, 1)).toEqual(two);
    const raw = handwrittenLoop();
    expect(simplify(raw, 1)).toEqual(simplify(raw, 1));
  });

  test('TC-03 splitPoints keeps parts within the cap and chains them through the shared point', () => {
    const atMinusOne = syntheticSpiral(STROKE_MAX_POINTS - 1);
    expect(splitPoints(atMinusOne)).toHaveLength(1);
    expect(splitPoints(atMinusOne)[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const atCap = syntheticSpiral(STROKE_MAX_POINTS);
    expect(splitPoints(atCap)).toHaveLength(1);
    expect(splitPoints(atCap)[0]).toHaveLength(STROKE_MAX_POINTS);

    const overCap = syntheticSpiral(STROKE_MAX_POINTS + 1);
    const parts = splitPoints(overCap);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1][0]).toEqual(overCap[STROKE_MAX_POINTS - 1]);
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
    expect(parts[1][1]).toEqual(overCap[STROKE_MAX_POINTS]);

    const far = syntheticSpiral(2 * STROKE_MAX_POINTS + 37);
    const many = splitPoints(far);
    for (const part of many) {
      expect(part.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
      expect(part.length).toBeGreaterThanOrEqual(2);
    }
    for (let i = 1; i < many.length; i += 1) {
      expect(many[i][0]).toEqual(many[i - 1][many[i - 1].length - 1]);
    }
  });

  test('TC-08 smoothPath starts at the first point, uses Q segments and ends at the last point', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 5 }
    ];
    const d = smoothPath(points);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain('Q');
    expect(d.endsWith('30 5')).toBe(true);
    expect(d).toBe(smoothPath(points));
    expect(smoothPath(handwrittenLoop())).toBe(smoothPath(handwrittenLoop()));
  });

  test('smoothPath renders a single point as a zero-length segment and handles two points and empty input', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 7, y: 9 }])).toBe('M 7 9 L 7 9');
    const line = smoothPath([
      { x: 1, y: 2 },
      { x: 3, y: 4 }
    ]);
    expect(line).toBe('M 1 2 L 3 4');
  });
});

describe('pen.model', () => {
  test('TC-04 createStroke writes bbox, relative points, style, z and author in one transaction', () => {
    const doc = makeDoc();
    const stop = countUpdates(doc);
    const points = [
      { x: 100, y: 50 },
      { x: 140, y: 70 },
      { x: 180, y: 55 }
    ];
    const id = createStroke(doc, { points, color: 'red', thickness: 'thick' }, 'g_test');
    expect(stop()).toBe(1);
    expect(typeof id).toBe('string');
    const created = entry(doc, id as string);
    const pad = PEN_THICKNESS_WORLD.thick / 2;
    expect(created.get('type')).toBe('stroke');
    expect(created.get('x')).toBe(100 - pad);
    expect(created.get('y')).toBe(50 - pad);
    expect(created.get('width')).toBe(80 + 2 * pad);
    expect(created.get('height')).toBe(20 + 2 * pad);
    expect(created.get('baseWidth')).toBe(80 + 2 * pad);
    expect(created.get('baseHeight')).toBe(20 + 2 * pad);
    expect(created.get('points')).toEqual([pad, pad, 40 + pad, 20 + pad, 80 + pad, 5 + pad]);
    expect(created.get('color')).toBe('red');
    expect(created.get('thickness')).toBe('thick');
    expect(created.get('z')).toBe(1);
    expect(created.get('createdBy')).toBe('g_test');
  });

  test('TC-04b a single-point stroke is a thickness-sized dot centred on the point', () => {
    const doc = makeDoc();
    const id = createStroke(doc, { points: [{ x: 100, y: 50 }], color: 'black', thickness: 'thin' }, 'g_test');
    expect(id).not.toBeNull();
    const created = entry(doc, id as string);
    const size = PEN_THICKNESS_WORLD.thin;
    expect(created.get('x')).toBe(100 - size / 2);
    expect(created.get('y')).toBe(50 - size / 2);
    expect(created.get('width')).toBe(size);
    expect(created.get('height')).toBe(size);
    expect(created.get('points')).toEqual([size / 2, size / 2]);
    expect(created.get('color')).toBe(DEFAULT_PEN_COLOR);
    expect(created.get('thickness')).toBe('thin');
  });

  test('TC-05 invalid input returns null and writes no transaction', () => {
    const doc = makeDoc();
    const cases: { points: { x: number; y: number }[]; color: string; thickness: string }[] = [
      { points: [], color: 'black', thickness: 'medium' },
      { points: [{ x: NaN, y: 1 }], color: 'black', thickness: 'medium' },
      { points: [{ x: 1, y: Infinity }], color: 'black', thickness: 'medium' },
      { points: [{ x: 1, y: 2 }], color: 'pink', thickness: 'medium' },
      { points: [{ x: 1, y: 2 }], color: 'black', thickness: 'huge' }
    ];
    for (const args of cases) {
      const stop = countUpdates(doc);
      expect(createStroke(doc, args, 'g_test')).toBeNull();
      expect(stop()).toBe(0);
    }
    expect(doc.getMap('objects').size).toBe(0);
  });

  function strokeSnap(doc: Y.Doc, id: string) {
    const snap = snapshotAll(doc).find((obj) => obj.id === id);
    if (snap === undefined || !isStrokeObject(snap)) throw new Error(`stroke ${id} not readable`);
    return snap;
  }

  test('TC-06 scaledPoints round-trips at creation size and doubles offsets after a 2x resize', () => {
    const doc = makeDoc();
    const points = [
      { x: 20, y: 10 },
      { x: 60, y: 30 },
      { x: 100, y: 12 }
    ];
    const id = createStroke(doc, { points, color: 'blue', thickness: 'medium' }, 'g_test');
    const base = strokeSnap(doc, id as string);
    const before = scaledPoints(base);
    before.forEach((p, i) => {
      expect(p.x).toBeCloseTo(points[i].x, 9);
      expect(p.y).toBeCloseTo(points[i].y, 9);
    });

    resizeObjects(
      doc,
      new Map([[id as string, { x: base.x, y: base.y, width: base.width * 2, height: base.height * 2 }]])
    );
    const resized = strokeSnap(doc, id as string);
    const after = scaledPoints(resized);
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i += 1) {
      expect(after[i].x - resized.x).toBeCloseTo((before[i].x - base.x) * 2, 9);
      expect(after[i].y - resized.y).toBeCloseTo((before[i].y - base.y) * 2, 9);
    }
    // Thickness is stored as a key, not scaled by the bbox.
    expect(resized).toMatchObject({ thickness: 'medium' });
  });

  test('TC-07 hit distance uses the stroke line, not the bbox', () => {
    const doc = makeDoc();
    const id = createStroke(doc, { points: straightLine(), color: 'black', thickness: 'thin' }, 'g_test');
    const line = scaledPoints(strokeSnap(doc, id as string));
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.9 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(distanceToPolyline(line, { x: 50, y: 6.1 })).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });

  test('stroke snapshots read back through snapshotAll and default options are typed', () => {
    const doc = makeDoc();
    const id = createStroke(doc, { points: straightLine(3), color: 'purple', thickness: 'thick' }, 'g_one');
    const objects = snapshotAll(doc);
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({ type: 'stroke', color: 'purple', thickness: 'thick' });
    const created = entry(doc, id as string);
    expect(created.get('createdBy')).toBe('g_one');
    expect(DEFAULT_PEN_COLOR).toBe('black');
    expect(DEFAULT_PEN_THICKNESS).toBe('medium');
  });
});
