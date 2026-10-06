/**
 * Story 11 unit tests for the stroke model and its geometry (`stroke.model`): TC-01 to TC-08.
 *
 * Two halves, and the split is deliberate.
 *
 *  - `simplify`, `splitPoints` and `smoothPath` are pure maths on recorded points, run here on
 *    the paths in `tests/fixtures/pen-paths.ts`. TC-01 and TC-02 are the whole promise of the
 *    story's smoothing — *every* point the hand drew ends up within the tolerance of the line
 *    that is stored — so they are asserted point by point over a fixture of hundreds of points,
 *    not on a triangle that would pass for any algorithm.
 *  - `createStroke` and `scaledPoints` run against a real `Y.Doc`, because what is under test is
 *    the schema: one transaction per stroke, a rejection that costs no update at all, and points
 *    stored relative to a creation size so that a later resize can scale the drawing without
 *    touching it.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { boardObjects, resizeObjects, type ObjectSnapshot } from '../../src/shared/board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { handwrittenLoop, longSpiral, underline } from '../fixtures/pen-paths';

/** The one thing every rejection has in common: the document was never touched. */
function updatesDuring(doc: Y.Doc, run: () => void): number {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  run();
  doc.off('update', listener);
  return updates;
}

function strokeOf(doc: Y.Doc, id: string): StrokeSnap {
  const found = boardObjects(doc).find((object: ObjectSnapshot) => object.id === id);
  if (!found) throw new Error(`object ${id} is not in the snapshot`);
  return found as StrokeSnap;
}

/** How far the raw path strays from the simplified one, in the worst case. */
function worstDeviation(raw: readonly Point[], simplified: readonly Point[]): number {
  let worst = 0;
  for (const point of raw) worst = Math.max(worst, distanceToPolyline(simplified, point));
  return worst;
}

describe('simplify (Ramer-Douglas-Peucker)', () => {
  it('TC-01: keeps every point of a handwritten loop within 1 unit at tolerance 1', () => {
    const raw = handwrittenLoop();
    const simplified = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);

    // The promise of `pen.smooth`: nothing the hand drew is farther from the result than the
    // tolerance, which at the zoom it was drawn at is one screen pixel.
    expect(worstDeviation(raw, simplified)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);
    // And it did simplify: the whole point is a shorter stroke.
    expect(simplified.length).toBeLessThan(raw.length);
    expect(simplified.length).toBeGreaterThanOrEqual(2);
    // The ends are the ends: a stroke starts and finishes where it was started and finished.
    expect(simplified[0]).toEqual(raw[0]);
    expect(simplified[simplified.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it('TC-02: keeps every point within 0.5 units at tolerance 0.5 (drawing at 200%)', () => {
    const raw = handwrittenLoop();
    // The tool divides the screen tolerance by the zoom, so drawing at 200% halves it.
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / 2;
    const simplified = simplify(raw, tolerance);

    expect(worstDeviation(raw, simplified)).toBeLessThanOrEqual(tolerance);
    expect(simplified.length).toBeLessThanOrEqual(raw.length);
    // A tighter tolerance keeps at least as much of what was drawn.
    expect(simplified.length).toBeGreaterThanOrEqual(simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX).length);
  });

  it('leaves a two-point line and an empty path alone, and copes with a 5,000-point one', () => {
    expect(simplify([], 1)).toEqual([]);
    const one: Point[] = [{ x: 3, y: 4 }];
    expect(simplify(one, 1)).toEqual(one);
    const two: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 5 }
    ];
    expect(simplify(two, 1)).toEqual(two);
    // No recursion depth limit to fall over at, however long the stroke.
    const long = longSpiral();
    const simplified = simplify(long, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(worstDeviation(long, simplified)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(simplified[0]).toEqual(long[0]);
    expect(simplified[simplified.length - 1]).toEqual(long[long.length - 1]);
  });
});

describe('splitPoints', () => {
  const path = (count: number): Point[] => longSpiral({ count });

  it('TC-03: splits at the limit, with the join point shared (limit - 1, exactly, + 1)', () => {
    const before = splitPoints(path(STROKE_MAX_POINTS - 1));
    expect(before).toHaveLength(1);
    expect(before[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const exactly = splitPoints(path(STROKE_MAX_POINTS));
    expect(exactly).toHaveLength(1);
    expect(exactly[0]).toHaveLength(STROKE_MAX_POINTS);

    const over = splitPoints(path(STROKE_MAX_POINTS + 1));
    expect(over).toHaveLength(2);
    expect(over[0]).toHaveLength(STROKE_MAX_POINTS);
    // The second part starts where the first finished, so the two join with no gap.
    expect(over[1][0]).toEqual(over[0][over[0].length - 1]);
    expect(over[1]).toHaveLength(2);
    // Nothing is lost bar the shared point itself.
    expect(over[0].length + over[1].length - 1).toBe(STROKE_MAX_POINTS + 1);
  });

  it('splits a long path into parts that all fit, each starting on the last point of the one before', () => {
    const parts = splitPoints(path(STROKE_MAX_POINTS * 2 + 5), STROKE_MAX_POINTS);
    expect(parts.length).toBe(3);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    for (let index = 1; index < parts.length; index += 1) {
      const previous = parts[index - 1];
      expect(parts[index][0]).toEqual(previous[previous.length - 1]);
    }
    expect(splitPoints([], STROKE_MAX_POINTS)).toEqual([]);
  });
});

describe('smoothPath', () => {
  it('TC-08: draws three points as one path through a quadratic segment, the same way every time', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 5 }
    ];
    const path = smoothPath(points);
    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('Q');
    // Deterministic: the same points make the same path, so two screens draw one stroke alike.
    expect(smoothPath(points)).toBe(path);
    expect(smoothPath(points.slice(0, 1))).toMatch(/^M/);
    expect(smoothPath([])).toBe('');
  });

  it('TC-02: keeps a straight leg straight, however long the straight leg is', () => {
    // The failure this guards against is not visible on a densely-sampled squiggle and glaring on
    // one the simplifier has thinned: a chain of quadratics that starts at the first point rather
    // than at the first midpoint bows away from a long straight run by a sizeable part of its own
    // length, so a hand-drawn underline arrives as a smile.
    const leg = smoothPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 }
    ]);
    const numbers = (leg.match(/-?[\d.]+/g) ?? []).map(Number);
    expect(numbers.length).toBeGreaterThan(2);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    expect(ys.every((y) => y === 0)).toBe(true);
    // The runs in and out of the curve reach the endpoints the pen actually started and stopped at.
    expect(leg.startsWith('M 0 0 L 50 0')).toBe(true);
    expect(leg.endsWith('L 300 0')).toBe(true);
  });
});

describe('createStroke', () => {
  it('TC-04: a single point becomes a round dot the size of the thickness', () => {
    const doc = new Y.Doc();
    const thickness = PEN_THICKNESS_WORLD.thick;
    const id = createStroke(doc, { points: [{ x: 40, y: -20 }], color: 'red', thickness: 'thick' }, 'me');
    expect(id).not.toBeNull();

    const stroke = strokeOf(doc, id!);
    // The box is a square of the thickness, centred on the point: the dot's own diameter.
    expect(stroke.width).toBe(thickness);
    expect(stroke.height).toBe(thickness);
    expect(stroke.x).toBe(40 - thickness / 2);
    expect(stroke.y).toBe(-20 - thickness / 2);
    // One point, flattened: the centre of that square.
    expect(stroke.points).toHaveLength(2);
    expect(Array.from(stroke.points)).toEqual([thickness / 2, thickness / 2]);
    expect(stroke.baseWidth).toBe(thickness);
    expect(stroke.baseHeight).toBe(thickness);
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');
    expect(stroke.type).toBe('stroke');
  });

  it('stores a stroke as its bounding box plus the line inside it, on top of everything else', () => {
    const doc = new Y.Doc();
    const path = underline();
    const id = createStroke(doc, { points: path, color: 'blue', thickness: 'thin' }, 'me');
    expect(id).not.toBeNull();
    const stroke = strokeOf(doc, id!);

    const xs = path.map((point) => point.x);
    const ys = path.map((point) => point.y);
    const pad = PEN_THICKNESS_WORLD.thin / 2;
    expect(stroke.x).toBeCloseTo(Math.min(...xs) - pad, 6);
    expect(stroke.y).toBeCloseTo(Math.min(...ys) - pad, 6);
    expect(stroke.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs) + pad * 2, 6);
    expect(stroke.height).toBeCloseTo(Math.max(...ys) - Math.min(...ys) + pad * 2, 6);
    // Points are relative to the box origin, flattened, and stay inside it.
    expect(stroke.points).toHaveLength(path.length * 2);
    for (let index = 0; index < path.length; index += 1) {
      const px = stroke.points[index * 2] as number;
      const py = stroke.points[index * 2 + 1] as number;
      expect(px).toBeGreaterThanOrEqual(0);
      expect(py).toBeGreaterThanOrEqual(0);
      expect(px).toBeLessThanOrEqual(stroke.width);
      expect(py).toBeLessThanOrEqual(stroke.height);
    }
    expect(stroke.baseWidth).toBeCloseTo(stroke.width, 6);
    expect(stroke.baseHeight).toBeCloseTo(stroke.height, 6);

    // A stroke is drawn on top of what is already there.
    const note = doc;
    const above = createStroke(note, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'thin' }, 'me');
    expect(strokeOf(note, above!).z).toBeGreaterThan(stroke.z);
  });

  it('TC-05: refuses an empty path, a NaN, an unknown colour and an unknown thickness, writing nothing', () => {
    const doc = new Y.Doc();
    const good = { points: [{ x: 0, y: 0 }], color: 'black' as const, thickness: 'thin' as const };

    const rejections: Array<{ what: string; request: unknown }> = [
      { what: 'no points', request: { ...good, points: [] } },
      { what: 'a NaN coordinate', request: { ...good, points: [{ x: Number.NaN, y: 0 }] } },
      { what: 'an infinite coordinate', request: { ...good, points: [{ x: 0, y: Number.POSITIVE_INFINITY }] } },
      { what: 'a colour that does not exist', request: { ...good, color: 'pink' } },
      { what: 'a thickness that does not exist', request: { ...good, thickness: 'huge' } },
      { what: 'no path at all', request: { ...good, points: null } }
    ];

    for (const rejection of rejections) {
      const updates = updatesDuring(doc, () => {
        expect(createStroke(doc, rejection.request as never, 'me')).toBeNull();
      });
      expect(updates, rejection.what).toBe(0);
    }
    expect(boardObjects(doc)).toHaveLength(0);
  });

  it('TC-06: scales the drawn line in proportion when the box doubles, and leaves the thickness alone', () => {
    const doc = new Y.Doc();
    const path = underline();
    const id = createStroke(doc, { points: path, color: 'green', thickness: 'medium' }, 'me');
    const before = strokeOf(doc, id!);
    const world = scaledPoints(before);
    expect(world).toHaveLength(path.length);

    // The generic resize of story 7 writes a new box; nothing here is re-recorded.
    const applied = resizeObjects(doc, new Map([[id!, { x: before.x, y: before.y, width: before.width * 2, height: before.height * 2 }]]));
    expect(applied).toBe(1);
    const after = strokeOf(doc, id!);
    const scaled = scaledPoints(after);

    expect(after.thickness).toBe('medium');
    expect(after.points).toEqual(before.points);
    expect(after.baseWidth).toBe(before.baseWidth);
    // Twice the box is twice the drawing, measured from the same origin: the proportions hold.
    for (let index = 0; index < world.length; index += 1) {
      expect(scaled[index].x - after.x).toBeCloseTo((world[index].x - before.x) * 2, 6);
      expect(scaled[index].y - after.y).toBeCloseTo((world[index].y - before.y) * 2, 6);
    }
    // A stroke whose size nobody has changed scales by exactly one.
    expect(scaledPoints(before)).toEqual(world);
  });

  it('TC-07: measures a click against the line, not the box: 0 and 5.9 units hit, 6.1 misses', () => {
    const doc = new Y.Doc();
    // A shallow V: the line passes through the origin, and its box has plenty of room in it that
    // the line never goes near.
    const path: Point[] = [];
    for (let x = -100; x <= 100; x += 5) path.push({ x, y: -0.3 * Math.abs(x) });
    const id = createStroke(doc, { points: path, color: 'black', thickness: 'thin' }, 'me');
    const stroke = strokeOf(doc, id!);
    const line = scaledPoints(stroke);

    // At 100% zoom, 6 screen pixels is 6 board units; half a thin line's thickness is less.
    const zoom = 1;
    const tolerance = Math.max(PEN_THICKNESS_WORLD[stroke.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
    expect(tolerance).toBe(STROKE_HIT_TOLERANCE_PX);

    expect(distanceToPolyline(line, { x: 0, y: 0 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(line, { x: 0, y: 5.9 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(line, { x: 0, y: 6.1 })).toBeGreaterThan(tolerance);
    // Inside the box, and well outside the stroke: the box is mostly nothing.
    expect(stroke.width).toBeGreaterThan(200);
    expect(stroke.height).toBeGreaterThan(2 * tolerance);
    expect(stroke.x).toBeLessThan(-100);
    expect(stroke.y + stroke.height).toBeGreaterThan(0);
    expect(distanceToPolyline(line, { x: -100, y: 0 })).toBeGreaterThan(tolerance);
    expect(PEN_COLORS[stroke.color]).toBe('#212121');
  });
});
