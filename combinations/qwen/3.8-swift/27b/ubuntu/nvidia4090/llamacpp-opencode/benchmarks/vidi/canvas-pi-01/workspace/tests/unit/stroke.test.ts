// stroke.model (story 11, TC-01 to TC-08): simplification fidelity, long
// stroke splitting, stroke creation/validation, proportional rescaling and
// line-distance hit tolerance. Pure model on a real Y.Doc.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import {
  createStroke,
  scaledPoints,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import { initDoc, resizeObjects, snapshot } from '../../src/shared/board-model';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { HANDWRITTEN_LOOP, LONG_SPIRAL } from '../fixtures/pen-paths';
import type { ObjectSnapshot } from '../../src/shared/board-model';

/** Assert the snapshot is a stroke (the id came from createStroke). */
function strokeAt(s: ObjectSnapshot): StrokeSnap {
  return s as StrokeSnap;
}

describe('stroke.model — simplify', () => {
  it('TC-01 loop fixture at tolerance 1: every raw point within 1 unit, fewer points', () => {
    const simplified = simplify(HANDWRITTEN_LOOP, 1);
    expect(simplified.length).toBeGreaterThanOrEqual(2);
    expect(simplified.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    for (const p of HANDWRITTEN_LOOP) {
      expect(distanceToPolyline(simplified, p)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('TC-02 loop fixture at tolerance 0.5 (200% zoom): every raw point within 0.5', () => {
    const simplified = simplify(HANDWRITTEN_LOOP, 0.5);
    expect(simplified.length).toBeGreaterThanOrEqual(2);
    for (const p of HANDWRITTEN_LOOP) {
      expect(distanceToPolyline(simplified, p)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});

describe('stroke.model — splitPoints (boundary)', () => {
  it('TC-03 at STROKE_MAX_POINTS − 1 / exactly / + 1 → 1 / 1 / 2 parts; shared join', () => {
    expect(splitPoints(LONG_SPIRAL.slice(0, STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(LONG_SPIRAL.slice(0, STROKE_MAX_POINTS))).toHaveLength(1);
    const parts = splitPoints(LONG_SPIRAL);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.length).toBe(STROKE_MAX_POINTS);
    // 5,010 − 5,000 new points plus the shared join point.
    expect(parts[1]!.length).toBe(LONG_SPIRAL.length - STROKE_MAX_POINTS + 1);
    // Part 2 starts with part 1's last point (seamless join).
    expect(parts[1]![0]).toEqual(parts[0]![parts[0]!.length - 1]);
  });
});

describe('stroke.model — createStroke', () => {
  it('TC-04 single point, thick → thickness square bbox, points length 2 (dot)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(doc, { points: [{ x: 10, y: 20 }], color: 'black', thickness: 'thick' }, 'test');
    expect(id).not.toBeNull();
    const s = strokeAt(snapshot(doc).find((o) => o.id === id)!);
    const t = PEN_THICKNESS_WORLD.thick;
    expect(s.x).toBe(10 - t / 2);
    expect(s.y).toBe(20 - t / 2);
    expect(s.width).toBe(t);
    expect(s.height).toBe(t);
    expect(s.points).toHaveLength(2);
    expect(s.color).toBe('black');
    expect(s.thickness).toBe('thick');
  });

  it('TC-05 empty points, NaN point, unknown colour/thickness → null, zero updates (negative)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    expect(
      createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'test'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }, { x: NaN, y: 1 }], color: 'black', thickness: 'medium' }, 'test'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as never, thickness: 'medium' }, 'test'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' as never }, 'test'),
    ).toBeNull();
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('stroke.model — scaledPoints', () => {
  it('TC-06 after doubling width and height: coordinates doubled, thickness unchanged', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const created = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' }, 'test');
    expect(created).not.toBeNull();
    const before = strokeAt(snapshot(doc).find((o) => o.id === created)!);
    // bbox: x = -2, y = -2, width = 104, height = 4; stored relative (2,2),(102,2).
    expect([before.x, before.y, before.width, before.height]).toEqual([-2, -2, 104, 4]);

    resizeObjects(
      doc,
      new Map([[created!, { x: before.x, y: before.y, width: before.width * 2, height: before.height * 2 }]]),
    );
    const after = strokeAt(snapshot(doc).find((o) => o.id === created)!);
    const scaled = scaledPoints(after);
    expect(scaled).toEqual([
      { x: after.x + before.points[0]! * 2, y: after.y + before.points[1]! * 2 },
      { x: after.x + before.points[2]! * 2, y: after.y + before.points[3]! * 2 },
    ]);
    expect(scaled).toEqual([
      { x: 2, y: 2 },
      { x: 202, y: 2 },
    ]);
    // Thickness is not scaled.
    expect(after.thickness).toBe('medium');
    expect(PEN_THICKNESS_WORLD[after.thickness]).toBe(PEN_THICKNESS_WORLD.medium);
  });
});

describe('stroke.model — hit tolerance', () => {
  it('TC-07 distanceToPolyline(scaledPoints) at 0 / 5.9 / 6.1 units → within / within / outside (zoom 1)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' }, 'test');
    expect(id).not.toBeNull();
    const s = strokeAt(snapshot(doc).find((o) => o.id === id)!);
    const tolerance = Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / 1);
    const pts = scaledPoints(s);
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(pts, { x: 50, y: 5.9 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(pts, { x: 50, y: 6.1 })).toBeGreaterThan(tolerance);
  });
});

describe('stroke.model — smoothPath', () => {
  it('TC-08 3 points → deterministic string starting with M and using Q segments', () => {
    const a = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    const b = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    expect(a).toBe(b);
    expect(a.startsWith('M')).toBe(true);
    expect(a).toContain(' Q');
  });
});
