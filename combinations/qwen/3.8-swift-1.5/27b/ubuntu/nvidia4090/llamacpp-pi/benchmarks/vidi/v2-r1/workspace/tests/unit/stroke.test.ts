/**
 * Story 11: stroke.model unit tests (TC-01 to TC-08).
 *
 * Pure geometry (simplify, splitPoints, smoothPath) plus the stroke model
 * (createStroke, scaledPoints) on a real Y.Doc, and story 10's
 * distanceToPolyline applied to scaled points for the hit tolerance.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '@shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '@shared/objects/stroke';
import { distanceToPolyline } from '@shared/geometry/polyline';
import { snapshot } from '@shared/board-model';
import {
  PEN_THICKNESS_WORLD, STROKE_MAX_POINTS, STROKE_HIT_TOLERANCE_PX,
} from '@shared/config';
import { handwrittenLoop, underline, longSpiral } from '../fixtures/pen-paths';

function snapStroke(doc: Y.Doc, id: string): StrokeSnap {
  const snap = snapshot(doc).find((s) => s.id === id);
  expect(snap).toBeDefined();
  return snap as StrokeSnap;
}

describe('stroke.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  // TC-01: simplify a recorded handwritten loop at tolerance 1 (zoom 100%).
  it('TC-01: simplify(loop, 1) keeps every raw point within 1 unit and drops points', () => {
    const result = simplify(handwrittenLoop, 1);
    expect(result.length).toBeLessThan(handwrittenLoop.length);
    // First and last are kept (RDP contract).
    expect(result[0]).toEqual(handwrittenLoop[0]);
    expect(result[result.length - 1]).toEqual(handwrittenLoop[handwrittenLoop.length - 1]);
    // Smoothing stays faithful: every raw point lies within the tolerance
    // of the simplified polyline.
    for (const p of handwrittenLoop) {
      expect(distanceToPolyline(result, p)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  // TC-02: the same loop at zoom 200% → tolerance 1/zoom = 0.5.
  it('TC-02: simplify(loop, 0.5) keeps every raw point within 0.5 units', () => {
    const result = simplify(handwrittenLoop, 0.5);
    expect(result.length).toBeLessThan(handwrittenLoop.length);
    for (const p of handwrittenLoop) {
      expect(distanceToPolyline(result, p)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  // TC-03: splitPoints at STROKE_MAX_POINTS - 1 / exactly / + 1 (boundary).
  it('TC-03: splitPoints at the point limit splits 1 / 1 / 2 parts sharing the join', () => {
    const under = splitPoints(longSpiral.slice(0, STROKE_MAX_POINTS - 1));
    expect(under).toHaveLength(1);
    expect(under[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const exact = splitPoints(longSpiral.slice(0, STROKE_MAX_POINTS));
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(STROKE_MAX_POINTS);

    const over = splitPoints(longSpiral.slice(0, STROKE_MAX_POINTS + 1));
    expect(over).toHaveLength(2);
    expect(over[0]).toHaveLength(STROKE_MAX_POINTS);
    // Part 2 starts with part 1's last point (no visible gap).
    expect(over[1][0]).toEqual(over[0][over[0].length - 1]);
    // No point lost: total = n + (parts - 1) shared joins.
    expect(over[0].length + over[1].length).toBe(STROKE_MAX_POINTS + 1 + 1);
  });

  // TC-04: a single point with thickness thick → dot.
  it('TC-04: createStroke with one point makes a dot with a thickness-square bbox', () => {
    const t = PEN_THICKNESS_WORLD.thick;
    const id = createStroke(doc, { points: [{ x: 10, y: 20 }], color: 'black', thickness: 'thick' }, 'u1');
    expect(id).not.toBeNull();
    const s = snapStroke(doc, id!);
    expect(s.type).toBe('stroke');
    expect(s.width).toBe(t);
    expect(s.height).toBe(t);
    expect(s.x).toBe(10 - t / 2);
    expect(s.y).toBe(20 - t / 2);
    expect(s.points).toHaveLength(2);
    // The stored point is the centre of the bbox.
    expect(scaledPoints(s)).toEqual([{ x: 10, y: 20 }]);
  });

  // TC-05 (negative, error paths): invalid input → null, no transaction.
  it('TC-05: empty, non-finite, unknown colour/thickness → null with zero updates', () => {
    let updates = 0;
    doc.on('update', () => { updates += 1; });

    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'u1')).toBeNull();
    expect(createStroke(doc, { points: [{ x: Number.NaN, y: 0 }], color: 'black', thickness: 'medium' }, 'u1')).toBeNull();
    expect(createStroke(doc, { points: [{ x: 0, y: Number.POSITIVE_INFINITY }], color: 'black', thickness: 'medium' }, 'u1')).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as any, thickness: 'medium' }, 'u1')).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' as any }, 'u1')).toBeNull();

    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-06: proportional resize — scaledPoints follows width/height.
  it('TC-06: scaledPoints after doubling width and height doubles the offsets, thickness unchanged', () => {
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }],
      color: 'black', thickness: 'medium',
    }, 'u1');
    expect(id).not.toBeNull();
    const before = snapStroke(doc, id!);
    const beforePts = scaledPoints(before);
    expect(beforePts).toHaveLength(3);

    doc.transact(() => {
      const obj = doc.getMap('objects').get(id!) as Y.Map<unknown>;
      obj.set('width', before.width * 2);
      obj.set('height', before.height * 2);
    });

    const after = snapStroke(doc, id!);
    const afterPts = scaledPoints(after);
    for (let i = 0; i < beforePts.length; i++) {
      expect(afterPts[i].x - after.x).toBeCloseTo((beforePts[i].x - before.x) * 2);
      expect(afterPts[i].y - after.y).toBeCloseTo((beforePts[i].y - before.y) * 2);
    }
    // Thickness is a stored property: resize never changes it.
    expect(after.thickness).toBe(before.thickness);
    expect(after.baseWidth).toBe(before.baseWidth);
    expect(after.baseHeight).toBe(before.baseHeight);
  });

  // TC-07: hit tolerance — distanceToPolyline on scaled points at 0 / 5.9 / 6.1.
  it('TC-07: line distance 0 / 5.9 / 6.1 → within / within / outside STROKE_HIT_TOLERANCE_PX at zoom 1', () => {
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      color: 'black', thickness: 'medium',
    }, 'u1');
    expect(id).not.toBeNull();
    const s = snapStroke(doc, id!);
    const pts = scaledPoints(s);
    // The line runs along world y = 0 (the bbox is padded by thickness/2).
    expect(pts[0].y).toBeCloseTo(0);
    expect(pts[1].y).toBeCloseTo(0);

    const onLine = distanceToPolyline(pts, { x: 50, y: 0 });
    const near = distanceToPolyline(pts, { x: 50, y: 5.9 });
    const far = distanceToPolyline(pts, { x: 50, y: 6.1 });
    const tolerance = Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX);
    expect(onLine).toBeLessThanOrEqual(tolerance);
    expect(near).toBeLessThanOrEqual(tolerance);
    expect(far).toBeGreaterThan(tolerance);
  });

  // TC-08: smoothPath of 3 points → deterministic M ... Q ... string.
  it('TC-08: smoothPath of 3 points starts with M, uses Q segments, is deterministic', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const d = smoothPath(pts);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(' Q ');
    // Deterministic: same input → same string.
    expect(smoothPath(pts)).toBe(d);
    // A single point produces a zero-length path (round dot).
    const dot = smoothPath([{ x: 5, y: 5 }]);
    expect(dot).toBe('M 5 5 L 5 5');
  });

  // The underline fixture also simplifies faithfully (second recorded path).
  it('simplify(underline, 1) stays within 1 unit of every raw point', () => {
    const result = simplify(underline, 1);
    expect(result.length).toBeLessThan(underline.length);
    for (const p of underline) {
      expect(distanceToPolyline(result, p)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
