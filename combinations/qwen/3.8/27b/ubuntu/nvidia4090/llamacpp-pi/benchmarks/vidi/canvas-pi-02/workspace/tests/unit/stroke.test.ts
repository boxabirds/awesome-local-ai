import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createStroke, scaledPoints } from '../../src/shared/objects/stroke';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { resizeObjects, snapshot } from '../../src/shared/board-model';
import type { PenColor, PenThickness } from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';
import { HANDWRITTEN_LOOP, LONG_SPIRAL } from '../fixtures/pen-paths';

/**
 * Story 11 stroke.model unit tests (task 1, TC-01 to TC-08): the pure
 * geometry (RDP simplify, split, smooth path) and the stroke object model
 * on a real Y.Doc (createStroke, scaledPoints, hit distance).
 */

const BY = 'drawer-1';

function theStroke(doc: Y.Doc, id: string): StrokeSnap {
  const snap = snapshot(doc).find((o) => o.id === id);
  expect(snap, `stroke ${id} should be in the snapshot`).toBeDefined();
  return snap as StrokeSnap;
}

describe('simplify (RDP) — TC-01, TC-02', () => {
  it('TC-01 handwritten loop at tolerance 1: every raw point within 1 unit of the result; fewer points', () => {
    const result = simplify(HANDWRITTEN_LOOP, 1);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    // pen.smooth: no point of the finished stroke lies farther than the
    // tolerance from the path that was drawn.
    for (const raw of HANDWRITTEN_LOOP) {
      expect(distanceToPolyline(result, raw)).toBeLessThanOrEqual(1 + 1e-9);
    }
    // First and last points are kept (the path starts and ends where drawn).
    expect(result[0]).toEqual(HANDWRITTEN_LOOP[0]);
    expect(result[result.length - 1]).toEqual(HANDWRITTEN_LOOP[HANDWRITTEN_LOOP.length - 1]);
  });

  it('TC-02 the same loop at tolerance 0.5 (zoom 200%): every raw point within 0.5 units', () => {
    const result = simplify(HANDWRITTEN_LOOP, 0.5);
    expect(result.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    for (const raw of HANDWRITTEN_LOOP) {
      expect(distanceToPolyline(result, raw)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});

describe('splitPoints — TC-03 (boundary)', () => {
  it('TC-03 at STROKE_MAX_POINTS - 1 / exactly / + 1 → 1 / 1 / 2 parts; part 2 starts with part 1 last point', () => {
    const base = LONG_SPIRAL.slice(0, STROKE_MAX_POINTS + 1);
    expect(base).toHaveLength(STROKE_MAX_POINTS + 1);

    expect(splitPoints(base.slice(0, STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(base.slice(0, STROKE_MAX_POINTS))).toHaveLength(1);

    const parts = splitPoints(base);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1]![0]).toEqual(parts[0]![parts[0]!.length - 1]);
    // No point is lost: the concatenation (minus the shared join point) is the input.
    const merged = [...parts[0]!, ...parts[1]!.slice(1)];
    expect(merged).toHaveLength(base.length);
  });
});

describe('createStroke — TC-04, TC-05', () => {
  it('TC-04 single point, thickness thick: a dot — bbox is the thickness square, points length 2', () => {
    const doc = new Y.Doc();
    const t = PEN_THICKNESS_WORLD.thick;
    const id = createStroke(doc, { points: [{ x: 10, y: 20 }], color: 'red', thickness: 'thick' }, BY);
    expect(id).not.toBeNull();
    const snap = theStroke(doc, id!);
    expect(snap.type).toBe('stroke');
    expect(snap.x).toBeCloseTo(10 - t / 2);
    expect(snap.y).toBeCloseTo(20 - t / 2);
    expect(snap.width).toBeCloseTo(t);
    expect(snap.height).toBeCloseTo(t);
    expect(snap.points).toHaveLength(2);
    expect(snap.color).toBe('red');
    expect(snap.thickness).toBe('thick');
    expect(snap.baseWidth).toBeCloseTo(t);
    expect(snap.baseHeight).toBeCloseTo(t);
  });

  it('TC-05 empty points / NaN point / unknown colour / unknown thickness → null, zero updates (error path)', () => {
    const doc = new Y.Doc();
    const before = Y.encodeStateAsUpdate(doc);
    // The last two rows deliberately pass names that are NOT in the named
    // settings (unknown colour / thickness) — cast past the type system to
    // exercise the runtime validation.
    const invalid: Array<{ points: readonly { x: number; y: number }[]; color: string; thickness: string }> = [
      { points: [], color: 'red', thickness: 'medium' },
      { points: [{ x: Number.NaN, y: 0 }], color: 'red', thickness: 'medium' },
      { points: [{ x: 0, y: Number.NaN }], color: 'red', thickness: 'medium' },
      { points: [{ x: 0, y: 0 }], color: 'pink', thickness: 'medium' },
      { points: [{ x: 0, y: 0 }], color: 'red', thickness: 'huge' },
    ];
    for (const a of invalid) {
      expect(createStroke(doc, a as { points: readonly Point[]; color: PenColor; thickness: PenThickness }, BY)).toBeNull();
    }
    // Nothing reached the doc: no transaction, no update bytes.
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('scaledPoints — TC-06 (proportional resize)', () => {
  it('TC-06 after width and height doubled, coordinates double relative to the origin; thickness unchanged', () => {
    const doc = new Y.Doc();
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 10 },
      { x: 50, y: 40 },
    ];
    const id = createStroke(doc, { points: pts, color: 'blue', thickness: 'medium' }, BY);
    const snap0 = theStroke(doc, id!);
    const p0 = scaledPoints(snap0);
    const ox = snap0.x;
    const oy = snap0.y;

    // Double the stored rect (a story 7 aspect-locked resize does exactly this).
    resizeObjects(doc, new Map([[id!, { x: ox, y: oy, width: snap0.width! * 2, height: snap0.height! * 2 }]]));
    const snap1 = theStroke(doc, id!);
    const p1 = scaledPoints(snap1);

    expect(p1).toHaveLength(p0.length);
    for (let i = 0; i < p0.length; i += 1) {
      expect(p1[i]!.x - ox).toBeCloseTo(2 * (p0[i]!.x - ox), 9);
      expect(p1[i]!.y - oy).toBeCloseTo(2 * (p0[i]!.y - oy), 9);
    }
    // The stroke keeps its thickness (pen.resize).
    expect(snap1.thickness).toBe('medium');
    expect(snap1.baseWidth).toBe(snap0.baseWidth);
    expect(snap1.baseHeight).toBe(snap0.baseHeight);
  });
});

describe('hit distance — TC-07 (boundary)', () => {
  it('TC-07 distanceToPolyline(scaledPoints) at 0 / 5.9 / 6.1 units → within / within / outside the hit tolerance at zoom 1', () => {
    const doc = new Y.Doc();
    const id = createStroke(
      doc,
      {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        color: 'black',
        thickness: 'medium',
      },
      BY,
    );
    const snap = theStroke(doc, id!);
    const pts = scaledPoints(snap);
    // A point on the line at world x = 50 (the line runs along y = 0).
    const d = (dy: number) => distanceToPolyline(pts, { x: 50, y: dy });
    // Zoom 1: tolerance = max(thickness/2 = 2, STROKE_HIT_TOLERANCE_PX = 6) = 6.
    expect(d(0)).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(d(5.9)).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(d(6.1)).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
    // On the far side too.
    expect(d(-6.1)).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });
});

describe('smoothPath — TC-08', () => {
  it('TC-08 three points → deterministic string starting with M and using Q segments', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 0 },
    ];
    const d = smoothPath(pts);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    expect(smoothPath(pts)).toBe(d); // deterministic
  });
});
