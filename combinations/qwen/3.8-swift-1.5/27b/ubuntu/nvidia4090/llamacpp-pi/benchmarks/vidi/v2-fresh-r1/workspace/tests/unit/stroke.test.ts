// Story 11: stroke model and geometry (stroke.model). TC-01 to TC-08.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, resizeObjects, snapshot } from '../../src/shared/board-model';
import {
  createStroke,
  scaledPoints,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  PEN_THICKNESS_WORLD,
} from '../../src/shared/config';
import { handwrittenLoop, longSpiral } from '../fixtures/pen-paths';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function strokeOf(doc: Y.Doc, index = 0): StrokeSnap {
  const strokes = snapshot(doc).filter((o) => o.type === 'stroke');
  expect(strokes.length).toBeGreaterThan(index);
  return strokes[index] as StrokeSnap;
}

describe('simplify (RDP)', () => {
  // TC-01: simplify the recorded handwritten loop at tolerance 1 → every raw
  // point within 1 unit of the result, and the result has fewer points.
  it('TC-01 loop at tolerance 1 stays within 1 unit and loses points', () => {
    const out = simplify(handwrittenLoop, 1);
    expect(out.length).toBeLessThan(handwrittenLoop.length);
    expect(out.length).toBeGreaterThanOrEqual(2);
    // First and last kept.
    expect(out[0]).toEqual(handwrittenLoop[0]);
    expect(out[out.length - 1]).toEqual(handwrittenLoop[handwrittenLoop.length - 1]);
    for (const p of handwrittenLoop) {
      expect(distanceToPolyline(out, p), `point ${p.x},${p.y}`).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  // TC-02: tolerance 0.5 (the 200% zoom case: 1 px / zoom) → within 0.5.
  it('TC-02 loop at tolerance 0.5 stays within 0.5 units', () => {
    const out = simplify(handwrittenLoop, 0.5);
    for (const p of handwrittenLoop) {
      expect(distanceToPolyline(out, p), `point ${p.x},${p.y}`).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});

describe('splitPoints', () => {
  // TC-03 (boundary): STROKE_MAX_POINTS - 1 / exactly / + 1 →
  // 1 / 1 / 2 parts; part 2 starts with part 1's last point.
  it('TC-03 splits at the point limit, sharing the join point', () => {
    const under = splitPoints(longSpiral.slice(0, STROKE_MAX_POINTS - 1));
    expect(under).toHaveLength(1);
    expect(under[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const exact = splitPoints(longSpiral.slice(0, STROKE_MAX_POINTS));
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(STROKE_MAX_POINTS);

    const over = splitPoints(longSpiral.slice(0, STROKE_MAX_POINTS + 1));
    expect(over).toHaveLength(2);
    expect(over[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(over[1].length).toBeGreaterThanOrEqual(2);
    // Part 2 starts with part 1's last point (no visible gap).
    expect(over[1][0]).toEqual(over[0][over[0].length - 1]);
  });
});

describe('createStroke', () => {
  // TC-04: single point, thickness thick → bbox is a thickness square;
  // stored points length 2 (one flattened point).
  it('TC-04 a single point becomes a dot with a thickness-square bbox', () => {
    const doc = makeDoc();
    const t = PEN_THICKNESS_WORLD.thick;
    const id = createStroke(doc, { points: [{ x: 10, y: 20 }], color: 'black', thickness: 'thick' }, 'local');
    expect(id).toBeTruthy();
    const s = strokeOf(doc);
    expect(s.x).toBe(10 - t / 2);
    expect(s.y).toBe(20 - t / 2);
    expect(s.width).toBe(t);
    expect(s.height).toBe(t);
    expect(s.baseWidth).toBe(t);
    expect(s.baseHeight).toBe(t);
    expect(s.points).toHaveLength(2);
    expect(s.thickness).toBe('thick');
  });

  // TC-05 (negative / error paths): empty points, NaN point, unknown colour,
  // unknown thickness → null and zero update events.
  it('TC-05 invalid input returns null and writes nothing', () => {
    const doc = makeDoc();
    let updates = 0;
    doc.on('update', () => updates++);

    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'local')).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: Number.NaN, y: 0 }], color: 'black', thickness: 'medium' }, 'local'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as never, thickness: 'medium' }, 'local'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' as never }, 'local'),
    ).toBeNull();

    expect(updates).toBe(0);
    expect(snapshot(doc).filter((o) => o.type === 'stroke')).toHaveLength(0);
  });
});

describe('scaledPoints', () => {
  // TC-06: after width and height are doubled, coordinates double;
  // thickness is unchanged.
  it('TC-06 scales with the bbox, keeps thickness', () => {
    const doc = makeDoc();
    // Points at (2,2)-(12,12) with medium (4) thickness → bbox origin (0,0).
    createStroke(doc, { points: [{ x: 2, y: 2 }, { x: 12, y: 12 }], color: 'red', thickness: 'medium' }, 'local');
    const s = strokeOf(doc);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    const before = scaledPoints(s);
    expect(before).toEqual([{ x: 2, y: 2 }, { x: 12, y: 12 }]);

    // Resize the bbox to 2x (same origin).
    resizeObjects(doc, new Map([[s.id, { x: s.x, y: s.y, width: s.width! * 2, height: s.height! * 2 }]]));

    const s2 = strokeOf(doc);
    const after = scaledPoints(s2);
    expect(after).toEqual([{ x: 4, y: 4 }, { x: 24, y: 24 }]);
    expect(s2.thickness).toBe('medium');
  });
});

describe('hit distance (select by line)', () => {
  // TC-07: distanceToPolyline on scaled points at 0 / 5.9 / 6.1 units →
  // within / within / outside STROKE_HIT_TOLERANCE_PX at zoom 1.
  it('TC-07 0, 5.9 and 6.1 units from the line at zoom 1', () => {
    const doc = makeDoc();
    createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' }, 'local');
    const s = strokeOf(doc);
    const pts = scaledPoints(s);

    const at = (d: number) => distanceToPolyline(pts, { x: 50, y: d });
    expect(at(0)).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(at(5.9)).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(at(6.1)).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });
});

describe('smoothPath', () => {
  // TC-08: 3 points → deterministic string starting with M and using Q
  // segments.
  it('TC-08 quadratic midpoint path, deterministic', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }];
    const d1 = smoothPath(pts);
    const d2 = smoothPath(pts);
    expect(d1).toBe(d2);
    expect(d1.startsWith('M ')).toBe(true);
    expect(d1).toContain(' Q ');
  });
});
