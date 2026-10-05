import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import {
  createStroke,
  scaledPoints,
  isPenColor,
  isPenThickness,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_HIT_TOLERANCE_PX,
} from '../../src/shared/config';
import { snapshotObjects } from '../../src/shared/board-model';
import { handwrittenLoop, underline, longSpiral } from '../fixtures/pen-paths';
import type { Point } from '../../src/shared/geometry';

/** The stroke snap from the doc, or null when absent. */
function strokeSnap(doc: Y.Doc, id: string): StrokeSnap | null {
  const o = snapshotObjects(doc).find((s) => s.id === id);
  if (!o || o.type !== 'stroke') return null;
  return o as StrokeSnap;
}

/** The minimum distance from `p` to the polyline `pts`. */
function distTo(pts: readonly Point[], p: Point): number {
  return distanceToPolyline(pts, p);
}

describe('stroke.model: simplify (TC-01, TC-02)', () => {
  it('TC-01: simplify the handwritten loop at tolerance 1 → every raw point within 1 unit, fewer points', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 1);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThan(raw.length);
    // First and last are kept.
    expect(result[0]).toEqual(raw[0]);
    expect(result[result.length - 1]).toEqual(raw[raw.length - 1]);
    // Smoothing stays faithful: every raw point lies within 1 unit of the result.
    for (const p of raw) {
      expect(distTo(result, p)).toBeLessThanOrEqual(1);
    }
  });

  it('TC-02: simplify at tolerance 0.5 (zoom 200%) → every raw point within 0.5', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 0.5);
    expect(result.length).toBeLessThan(raw.length);
    for (const p of raw) {
      expect(distTo(result, p)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('stroke.model: splitPoints (TC-03)', () => {
  const spiral = longSpiral(); // 5010 points

  it('TC-03: at STROKE_MAX_POINTS − 1 / exactly / + 1 → 1 / 1 / 2 parts; parts share the join point', () => {
    // − 1: a single part.
    const under = splitPoints(spiral.slice(0, STROKE_MAX_POINTS - 1));
    expect(under).toHaveLength(1);
    expect(under[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    // exactly: a single part.
    const exact = splitPoints(spiral.slice(0, STROKE_MAX_POINTS));
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(STROKE_MAX_POINTS);

    // + 1: two parts; part 2 starts with part 1's last point.
    const over = splitPoints(spiral); // 5010
    expect(over).toHaveLength(2);
    expect(over[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(over[1][0]).toEqual(over[0][over[0].length - 1]);
    // No point is lost (the join point is shared, not duplicated).
    expect(over[0].length + over[1].length).toBe(spiral.length + 1);
  });
});

describe('stroke.model: createStroke (TC-04, TC-05)', () => {
  it('TC-04: a single point with thickness thick → bbox = thickness square, points length 2 (dot)', () => {
    const doc = new Y.Doc();
    const t = PEN_THICKNESS_WORLD.thick;
    const id = createStroke(doc, { points: [{ x: 100, y: 100 }], color: 'black', thickness: 'thick' }, 'u1');
    expect(id).not.toBeNull();
    const s = strokeSnap(doc, id!);
    expect(s).not.toBeNull();
    expect(s!.width).toBe(t);
    expect(s!.height).toBe(t);
    expect(s!.x).toBe(100 - t / 2);
    expect(s!.y).toBe(100 - t / 2);
    expect(s!.points).toHaveLength(2);
    // The dot sits at the centre of the bbox.
    expect(scaledPoints(s!)).toEqual([{ x: 100, y: 100 }]);
  });

  it('TC-05: empty points, NaN point, colour pink, thickness huge → null each, zero update events', () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => updates++);

    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'u1')).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'medium' }, 'u1'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: 'pink' as never, thickness: 'medium' }, 'u1'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: 'black', thickness: 'huge' as never }, 'u1'),
    ).toBeNull();

    expect(updates).toBe(0);
    expect(snapshotObjects(doc)).toHaveLength(0);

    // The guards agree.
    expect(isPenColor('pink')).toBe(false);
    expect(isPenThickness('huge')).toBe(false);
  });
});

describe('stroke.model: scaledPoints (TC-06)', () => {
  it('TC-06: after width and height doubled → coordinates doubled, thickness unchanged', () => {
    const doc = new Y.Doc();
    const id = createStroke(
      doc,
      { points: [{ x: 100, y: 100 }, { x: 200, y: 140 }], color: 'blue', thickness: 'thin' },
      'u1',
    );
    const before = strokeSnap(doc, id!);
    const original = scaledPoints(before!);
    expect(original).toHaveLength(2);

    // Resize the bbox 2x (what story 7's proportional resize writes).
    const obj = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    obj.set('width', before!.width! * 2);
    obj.set('height', before!.height! * 2);

    const after = strokeSnap(doc, id!);
    const scaled = scaledPoints(after!);
    const bx = before!.x;
    const by = before!.y;
    for (let i = 0; i < original.length; i++) {
      expect(scaled[i].x).toBeCloseTo(bx + (original[i].x - bx) * 2, 6);
      expect(scaled[i].y).toBeCloseTo(by + (original[i].y - by) * 2, 6);
    }
    // Thickness is never scaled.
    expect(after!.thickness).toBe('thin');
    expect(PEN_THICKNESS_WORLD[after!.thickness]).toBe(PEN_THICKNESS_WORLD.thin);
  });
});

describe('stroke.model: select by line (TC-07)', () => {
  it('TC-07: distanceToPolyline(scaledPoints) at 0 / 5.9 / 6.1 units → within / within / outside at zoom 1', () => {
    const doc = new Y.Doc();
    const id = createStroke(
      doc,
      { points: [{ x: 100, y: 100 }, { x: 200, y: 100 }], color: 'black', thickness: 'thin' },
      'u1',
    );
    const s = strokeSnap(doc, id!);
    const pts = scaledPoints(s!);

    // At zoom 1 the tolerance is max(thickness/2, 6) = 6 world units.
    const zoom = 1;
    const tolerance = Math.max(PEN_THICKNESS_WORLD.thin / 2, STROKE_HIT_TOLERANCE_PX / zoom);
    expect(tolerance).toBe(STROKE_HIT_TOLERANCE_PX);

    const at = (d: number): Point => ({ x: 150, y: 100 + d });
    expect(distTo(pts, at(0))).toBeLessThanOrEqual(tolerance);
    expect(distTo(pts, at(5.9))).toBeLessThanOrEqual(tolerance);
    expect(distTo(pts, at(6.1))).toBeGreaterThan(tolerance);
  });
});

describe('stroke.model: smoothPath (TC-08)', () => {
  it('TC-08: smoothPath of 3 points → deterministic string starting with M and using Q segments', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 0 },
    ];
    const d1 = smoothPath(pts);
    const d2 = smoothPath(pts);
    expect(d1).toBe(d2); // deterministic
    expect(d1.startsWith('M ')).toBe(true);
    expect(d1).toContain(' Q ');
    // Ends at the last point.
    expect(d1.endsWith('L 20 0')).toBe(true);
  });

  it('a single point renders a zero-length path (round dot)', () => {
    const d = smoothPath([{ x: 5, y: 5 }]);
    expect(d).toBe('M 5 5 L 5 5');
  });
});

describe('stroke.model: underline fixture sanity', () => {
  it('the underline simplifies and stays faithful at tolerance 1', () => {
    const raw = underline();
    const result = simplify(raw, 1);
    expect(result.length).toBeLessThan(raw.length);
    for (const p of raw) {
      expect(distTo(result, p)).toBeLessThanOrEqual(1);
    }
  });
});
