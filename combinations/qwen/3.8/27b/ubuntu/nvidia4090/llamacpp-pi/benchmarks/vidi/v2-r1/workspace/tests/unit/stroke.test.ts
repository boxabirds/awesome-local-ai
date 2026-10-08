// Story 11 unit tests (task 1, TC-01 to TC-08): the stroke.model contract —
// simplify / splitPoints / smoothPath / createStroke / scaledPoints on a
// real Y.Doc, plus story 10's distanceToPolyline applied to scaled points.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import {
  simplify,
  smoothPath,
  splitPoints,
} from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  createStroke,
  scaledPoints,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import {
  objectsSnapshot,
  resizeObjects,
} from '../../src/shared/board-model';
// Importing the client registry registers 'stroke' as a known object type
// (and proves the spec exists; the registry unit tests cover it separately).
import '../../src/client/objects/registry';
import { HANDWRITTEN_LOOP, SPIRAL_5010, UNDERLINE } from '../fixtures/pen-paths';

/** The largest distance of any raw point to the simplified polyline. */
function maxDeviation(raw: readonly Point[], simplified: readonly Point[]): number {
  let d = 0;
  for (const p of raw) d = Math.max(d, distanceToPolyline(simplified, p));
  return d;
}

function strokeSnap(doc: Y.Doc): StrokeSnap {
  const snaps = objectsSnapshot(doc);
  const strokes = snaps.filter((o) => o.type === 'stroke');
  expect(strokes).toHaveLength(1);
  return strokes[0]! as StrokeSnap;
}

describe('stroke.model: smoothing (pen.smooth)', () => {
  it('TC-01: simplifying the handwritten loop at tolerance 1 stays within 1 unit and is shorter', () => {
    const result = simplify(HANDWRITTEN_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX);
    // Smoothing is faithful: no finished point farther than the tolerance.
    expect(maxDeviation(HANDWRITTEN_LOOP, result)).toBeLessThanOrEqual(
      STROKE_SIMPLIFY_TOLERANCE_PX + 1e-9,
    );
    // ...and it actually simplified the shaky input.
    expect(result.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    // First and last are always kept.
    expect(result[0]).toEqual(HANDWRITTEN_LOOP[0]);
    expect(result[result.length - 1]).toEqual(
      HANDWRITTEN_LOOP[HANDWRITTEN_LOOP.length - 1],
    );
  });

  it('TC-02: at 200% zoom (tolerance 1/2 = 0.5) the result stays within 0.5 units', () => {
    const result = simplify(HANDWRITTEN_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX / 2);
    expect(maxDeviation(HANDWRITTEN_LOOP, result)).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(result.length).toBeLessThan(HANDWRITTEN_LOOP.length);
  });
});

describe('stroke.model: long-stroke splitting (pen.long_stroke)', () => {
  it('TC-03: splitPoints at STROKE_MAX_POINTS - 1 / exactly / + 1 gives 1 / 1 / 2 parts (boundary)', () => {
    const under = splitPoints(SPIRAL_5010.slice(0, STROKE_MAX_POINTS - 1));
    expect(under).toHaveLength(1);
    expect(under[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const exact = splitPoints(SPIRAL_5010.slice(0, STROKE_MAX_POINTS));
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(STROKE_MAX_POINTS);

    // The full fixture is STROKE_MAX_POINTS + 10 points.
    expect(SPIRAL_5010).toHaveLength(STROKE_MAX_POINTS + 10);
    const over = splitPoints(SPIRAL_5010);
    expect(over).toHaveLength(2);
    expect(over[0]).toHaveLength(STROKE_MAX_POINTS);
    // Part 2 starts with part 1's last point (shared join, no gap).
    expect(over[1]![0]).toEqual(over[0]![over[0]!.length - 1]);
    // ...and continues with the remaining points.
    expect(over[1]).toHaveLength(11);
    expect(over[1]![1]).toEqual(SPIRAL_5010[STROKE_MAX_POINTS]);
  });
});

describe('stroke.model: createStroke', () => {
  it('TC-04: a single point with thickness thick is a dot with a thickness-square bbox and 2 stored coordinates', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: [{ x: 100, y: 50 }], color: 'black', thickness: 'thick' }, 'me');
    expect(id).not.toBeNull();
    const snap = strokeSnap(doc);
    expect(snap.thickness).toBe('thick');
    expect(snap.color).toBe('black');
    // bbox = the thickness square centred on the point.
    expect(snap.width).toBe(8);
    expect(snap.height).toBe(8);
    expect(snap.x).toBe(100 - 4);
    expect(snap.y).toBe(50 - 4);
    // One point, flattened.
    expect(snap.points).toHaveLength(2);
    // The dot sits at the bbox centre (4, 4 relative).
    expect(scaledPoints(snap)).toEqual([{ x: 100, y: 50 }]);
    // New object goes on top with the creator recorded.
    const raw = doc.getMap('objects').get(id!) as Y.Map<unknown> | undefined;
    expect(raw?.get('createdBy')).toBe('me');
  });

  it('TC-05: empty points, a NaN point, an unknown colour or thickness are all rejected with zero updates (negative)', () => {
    const cases: Array<{ points: Point[]; color: string; thickness: string }> = [
      { points: [], color: 'black', thickness: 'medium' },
      { points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }], color: 'black', thickness: 'medium' },
      { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: 'pink', thickness: 'medium' },
      { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: 'black', thickness: 'huge' },
    ];
    for (const a of cases) {
      const doc = new Y.Doc();
      let updates = 0;
      doc.on('update', () => {
        updates += 1;
      });
      expect(
        createStroke(doc, { points: a.points, color: a.color as never, thickness: a.thickness as never }, 'me'),
      ).toBeNull();
      expect(updates).toBe(0);
    }
  });
});

describe('stroke.model: proportional resize (pen.resize)', () => {
  it('TC-06: doubling width and height doubles the scaled coordinates; thickness is unchanged', () => {
    const doc = new Y.Doc();
    // Points chosen so the (thickness-padded) bbox origin is exactly (0, 0):
    // with a medium pen (thickness 4) the padding is 2 on every side.
    const id = createStroke(
      doc,
      { points: [{ x: 2, y: 2 }, { x: 102, y: 52 }, { x: 202, y: 2 }], color: 'blue', thickness: 'medium' },
      'me',
    );
    expect(id).not.toBeNull();
    const before = strokeSnap(doc);
    expect(before.x).toBe(0);
    expect(before.y).toBe(0);
    const beforePts = scaledPoints(before);

    // Resize the bbox 2x in both directions (anchored at the origin).
    resizeObjects(doc, new Map([[id!, { x: 0, y: 0, width: before.width! * 2, height: before.height! * 2 }]]));
    const after = strokeSnap(doc);
    const afterPts = scaledPoints(after);

    expect(afterPts).toHaveLength(beforePts.length);
    for (let i = 0; i < beforePts.length; i += 1) {
      expect(afterPts[i]!.x).toBeCloseTo(beforePts[i]!.x * 2, 9);
      expect(afterPts[i]!.y).toBeCloseTo(beforePts[i]!.y * 2, 9);
    }
    // Thickness (and colour) survive the resize untouched.
    expect(after.thickness).toBe('medium');
    expect(after.color).toBe('blue');
  });
});

describe('stroke.model: line hit distance (pen.select)', () => {
  it('TC-07: distanceToPolyline(scaledPoints) at 0 / 5.9 / 6.1 units is within / within / outside the 6px tolerance at zoom 1', () => {
    const doc = new Y.Doc();
    createStroke(
      doc,
      { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' },
      'me',
    );
    const pts = scaledPoints(strokeSnap(doc));
    const mid = { x: 50, y: 0 };
    const at = (d: number): number => distanceToPolyline(pts, { x: mid.x, y: mid.y + d });

    expect(at(0)).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(at(5.9)).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(at(6.1)).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });
});

describe('stroke.model: smooth path (stroke.object)', () => {
  it('TC-08: smoothPath of 3 points is a deterministic string starting with M and using Q segments', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const d1 = smoothPath(pts);
    const d2 = smoothPath(pts);
    expect(d1).toBe(d2); // deterministic
    expect(d1.startsWith('M ')).toBe(true);
    expect(d1).toContain(' Q ');
    // It ends at the last point.
    expect(d1.endsWith('L 20 0')).toBe(true);
  });
});
