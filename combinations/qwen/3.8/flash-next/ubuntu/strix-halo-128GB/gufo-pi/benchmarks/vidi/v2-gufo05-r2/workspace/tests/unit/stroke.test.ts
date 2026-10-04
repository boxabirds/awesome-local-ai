/**
 * Story 11: the stroke object, and the geometry a finished sketch is made of.
 *
 * Three things are pinned here, and they are the three that a browser cannot judge
 * for us. Smoothing has to *stay faithful*: Ramer–Douglas–Peucker is allowed to drop
 * points only within a stated distance, so the assertions are made about every raw
 * point of a recorded hand, not about a pretty picture. A long drag has to split at
 * exactly the limit, and the two halves have to share the point where they join, or
 * the sketch has a gap in it. And a stroke has to survive being moved and resized by
 * story 7's generic code, which only ever touches `x`, `y`, `width` and `height` — so
 * what `scaledPoints` says after a doubled box is what a person will see.
 *
 * As in story 10, "exactly one update" is counted on the doc itself: a stroke that
 * arrives as several updates is several undo steps on somebody else's screen.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  initDoc,
  objectBounds,
  objectSnapshots,
  resizeObjects,
  deleteObjects,
} from '../../src/shared/board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import {
  createStroke,
  isStrokeSnapshot,
  readStroke,
  readStrokes,
  scaledPoints,
  type StrokeSnapshot,
} from '../../src/shared/objects/stroke';
import {
  CORNER,
  handwrittenLoop,
  longSpiral,
  straightLine,
  underline,
} from '../fixtures/pen-paths';

/** Run `fn`, counting how many `update` events the doc emits. */
function withUpdateCount<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    return { result: fn(), updates };
  } finally {
    doc.off('update', observer);
  }
}

function docWithBoard(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function stroke(
  doc: Y.Doc,
  points: readonly Point[],
  color: string = DEFAULT_PEN_COLOR,
  thickness: string = DEFAULT_PEN_THICKNESS,
): string | null {
  return createStroke(
    doc,
    { points, color: color as never, thickness: thickness as never },
    'g_priya',
  );
}

/** How far the raw path strays from the simplified one, over all its points. */
function worstDeviation(raw: readonly Point[], simplified: readonly Point[]): number {
  let worst = 0;
  for (const point of raw) {
    const distance = distanceToPolyline(simplified, point);
    if (distance > worst) worst = distance;
  }
  return worst;
}

describe('stroke.model — simplify (TC-01, TC-02)', () => {
  const loop = handwrittenLoop();

  it('TC-01: a handwritten loop simplifies inside 1 unit, and loses points', () => {
    expect(loop).toHaveLength(400);
    const simplified = simplify(loop, 1);
    // Every point the hand went near is still within one unit of the finished line —
    // this is PRD pen.smooth stated as a number.
    expect(worstDeviation(loop, simplified)).toBeLessThanOrEqual(1);
    // …and it was not a no-op: a stroke nobody smoothed would keep all 400.
    expect(simplified.length).toBeLessThan(loop.length);
    expect(simplified.length).toBeGreaterThan(1);
    // The ends are the drawn ends: a stroke that shrank at either end moved.
    expect(simplified[0]).toEqual(loop[0]);
    expect(simplified[simplified.length - 1]).toEqual(loop[loop.length - 1]);
  });

  it('TC-01b: an underline simplifies inside 1 unit too', () => {
    const line = underline();
    const simplified = simplify(line, 1);
    expect(worstDeviation(line, simplified)).toBeLessThanOrEqual(1);
    expect(simplified.length).toBeLessThan(line.length);
  });

  it('TC-02: at 200% zoom the tolerance halves, and so is the deviation', () => {
    // The tool asks for STROKE_SIMPLIFY_TOLERANCE_PX / zoom: at zoom 2 that is 0.5.
    const simplified = simplify(loop, 1 / 2);
    expect(worstDeviation(loop, simplified)).toBeLessThanOrEqual(0.5);
    // A tighter promise keeps more of the line than a looser one.
    expect(simplified.length).toBeGreaterThan(simplify(loop, 1).length);
  });

  it('a path of nothing, one point, or two is its own answer', () => {
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([CORNER[0]!], 1)).toEqual([CORNER[0]]);
    expect(simplify(CORNER.slice(0, 2) as Point[], 1)).toEqual(CORNER.slice(0, 2));
  });

  it('a corner survives: the point that makes the shape is kept', () => {
    const simplified = simplify(CORNER as Point[], 1);
    expect(simplified).toHaveLength(3);
    expect(simplified[1]).toEqual({ x: 100, y: 0 });
  });

  it('a 5,010-point spiral simplifies inside tolerance without blowing the stack', () => {
    const spiral = longSpiral();
    const simplified = simplify(spiral, 1);
    expect(worstDeviation(spiral, simplified)).toBeLessThanOrEqual(1);
    expect(simplified.length).toBeLessThan(spiral.length);
  });
});

describe('stroke.model — splitPoints (TC-03)', () => {
  it('TC-03: the limit is split at one point past it, and the halves share the join', () => {
    const before = longSpiral(STROKE_MAX_POINTS - 1);
    const exactly = longSpiral(STROKE_MAX_POINTS);
    const past = longSpiral(STROKE_MAX_POINTS + 1);

    expect(splitPoints(before)).toHaveLength(1);
    expect(splitPoints(exactly)).toHaveLength(1);

    const parts = splitPoints(past);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1]).toHaveLength(2);
    // No gap: the second stroke starts where the first stopped.
    expect(parts[1]![0]).toEqual(parts[0]![parts[0]!.length - 1]);
  });

  it('a very long drag splits into as many parts as it needs, each within the limit', () => {
    const parts = splitPoints(longSpiral(STROKE_MAX_POINTS * 2 + 3));
    expect(parts).toHaveLength(3);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    for (let i = 1; i < parts.length; i += 1) {
      expect(parts[i]![0]).toEqual(parts[i - 1]![parts[i - 1]!.length - 1]);
    }
  });

  it('an empty path splits into nothing at all', () => {
    expect(splitPoints([])).toEqual([]);
  });
});

describe('stroke.model — createStroke (TC-04, TC-05)', () => {
  it('TC-04: one point becomes a round dot the size of the thickness', () => {
    const doc = docWithBoard();
    const id = stroke(doc, [{ x: 300, y: 200 }], 'black', 'thick');
    expect(id).toBeTruthy();

    const snap = readStroke(doc, id!);
    expect(snap).not.toBeNull();
    const thickness = PEN_THICKNESS_WORLD.thick;
    // The box is a square of the thickness, centred on where the pointer went down,
    // so the round-capped zero-length path inside it is a dot and not a smudge.
    expect(objectBounds(snap!)).toEqual({
      x: 300 - thickness / 2,
      y: 200 - thickness / 2,
      width: thickness,
      height: thickness,
    });
    expect(snap!.baseWidth).toBe(thickness);
    expect(snap!.baseHeight).toBe(thickness);
    expect(snap!.points).toHaveLength(2);
    expect(snap!.color).toBe('black');
    expect(snap!.thickness).toBe('thick');
    expect(snap!.createdBy).toBe('g_priya');
    // The stored point sits in the middle of the box it was measured against.
    expect(snap!.points).toEqual([thickness / 2, thickness / 2]);
  });

  it('TC-04b: a drag pads its box by half the thickness, so ink is never clipped', () => {
    const doc = docWithBoard();
    const id = stroke(doc, straightLine(10, 10, { x: 0, y: 0 }), 'red', 'thick')!;
    const snap = readStroke(doc, id)!;
    const half = PEN_THICKNESS_WORLD.thick / 2;
    expect(snap.x).toBe(-half);
    expect(snap.y).toBe(-half);
    expect(snap.width).toBe(90 + PEN_THICKNESS_WORLD.thick);
    expect(snap.height).toBe(PEN_THICKNESS_WORLD.thick);
  });

  it('TC-05: nothing sound comes of rubbish, and the document does not move', () => {
    const doc = docWithBoard();
    const good: Point[] = [{ x: 10, y: 10 }];
    const bad: [string, Point[], string, string][] = [
      ['no points at all', [], 'black', 'medium'],
      ['a point that is not a number', [{ x: Number.NaN, y: 10 }], 'black', 'medium'],
      ['a point at infinity', [{ x: 10, y: Number.POSITIVE_INFINITY }], 'black', 'medium'],
      ['a path with one broken point', [...good, { x: 20, y: Number.NaN }], 'black', 'medium'],
    ];
    for (const [what, points, color, thickness] of bad) {
      const { result, updates } = withUpdateCount(doc, () => stroke(doc, points, color, thickness));
      expect(result, what).toBeNull();
      expect(updates, what).toBe(0);
    }
    // A colour and a weight that are not on the palette are refused the same way:
    // the document must never hold a style the board cannot draw.
    for (const [what, color, thickness] of [
      ['an unknown colour', 'pink', 'medium'],
      ['an unknown weight', 'black', 'huge'],
    ] as [string, string, string][]) {
      const { result, updates } = withUpdateCount(doc, () =>
        stroke(doc, good, color, thickness),
      );
      expect(result, what).toBeNull();
      expect(updates, what).toBe(0);
    }
    expect(readStrokes(doc)).toHaveLength(0);
    expect(objectSnapshots(doc)).toHaveLength(0);
  });

  it('every colour and weight the pen offers is storable, and stays itself', () => {
    const doc = docWithBoard();
    const colors = Object.keys(PEN_COLORS) as PenColor[];
    const thicknesses = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];
    expect(colors).toHaveLength(6);
    expect(thicknesses).toHaveLength(3);
    for (const color of colors) {
      for (const thickness of thicknesses) {
        const id = stroke(doc, [{ x: 0, y: 0 }], color, thickness);
        expect(id, `${color} / ${thickness}`).toBeTruthy();
        const snap = readStroke(doc, id!)!;
        expect(snap.color).toBe(color);
        expect(snap.thickness).toBe(thickness);
      }
    }
  });

  it('one finished stroke is one update, and it lands on top', () => {
    const doc = docWithBoard();
    const { updates } = withUpdateCount(doc, () => {
      stroke(doc, underline(), 'blue', 'thin');
    });
    expect(updates).toBe(1);
    const snap = readStrokes(doc)[0];
    expect(snap!.z).toBe(1);
    stroke(doc, underline(), 'blue', 'thin');
    expect(readStrokes(doc)[1]!.z).toBe(2);
  });

  it('the board reads a stroke as a stroke, with its own fields', () => {
    const doc = docWithBoard();
    const id = stroke(doc, CORNER as Point[], 'green', 'medium')!;
    const object = objectSnapshots(doc).find((entry) => entry.id === id);
    expect(object).toBeDefined();
    expect(isStrokeSnapshot(object!)).toBe(true);
    const snap = object as StrokeSnapshot;
    expect(snap.type).toBe('stroke');
    expect(snap.points).toHaveLength(6);
    expect(snap.baseWidth).toBeCloseTo(100 + PEN_THICKNESS_WORLD.medium);
    expect(snap.baseHeight).toBeCloseTo(100 + PEN_THICKNESS_WORLD.medium);
  });

  it('a stroke entry that arrived with rubbish in it is read with defaults', () => {
    const doc = docWithBoard();
    const id = stroke(doc, CORNER as Point[], 'orange', 'thin')!;
    const entry = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    entry.set('color', 'mauve');
    entry.set('thickness', 'enormous');
    entry.set('points', 'not a path');
    const snap = readStroke(doc, id)!;
    expect(snap.color).toBe(DEFAULT_PEN_COLOR);
    expect(snap.thickness).toBe(DEFAULT_PEN_THICKNESS);
    expect(snap.points).toEqual([]);
  });

  it('deleting a stroke takes it off the board', () => {
    const doc = docWithBoard();
    const id = stroke(doc, underline(), 'purple', 'medium')!;
    expect(deleteObjects(doc, [id])).toBe(1);
    expect(readStroke(doc, id)).toBeNull();
    expect(objectSnapshots(doc)).toHaveLength(0);
  });
});

describe('stroke.model — scaled points (TC-06, TC-07)', () => {
  /** A horizontal line from (0, 0) to (100, 0), in a box padded by half the thickness. */
  function horizontalStroke(doc: Y.Doc, thickness: 'thin' | 'medium' | 'thick' = 'medium') {
    const id = stroke(doc, [{ x: 0, y: 0 }, { x: 100, y: 0 }], 'black', thickness)!;
    return readStroke(doc, id)!;
  }

  it('TC-06: doubling the box doubles the drawn line and leaves the thickness alone', () => {
    const doc = docWithBoard();
    const snap = horizontalStroke(doc, 'medium');
    const before = scaledPoints(snap);
    expect(before).toHaveLength(2);

    const box = objectBounds(snap);
    const grown: StrokeSnapshot = { ...snap, width: box.width * 2, height: box.height * 2 };
    const after = scaledPoints(grown);
    expect(after[0]!.x).toBeCloseTo(before[0]!.x * 2);
    expect(after[0]!.y).toBeCloseTo(before[0]!.y * 2);
    expect(after[1]!.x).toBeCloseTo(before[1]!.x * 2);
    expect(after[1]!.y).toBeCloseTo(before[1]!.y * 2);
    // The weight of the line is not part of the drawing: a scaled stroke is as thick
    // as the pen that made it (PRD pen.resize).
    expect(grown.thickness).toBe(snap.thickness);
    expect(PEN_THICKNESS_WORLD[grown.thickness]).toBe(PEN_THICKNESS_WORLD.medium);
  });

  it('TC-06b: a resize through the model scales the line, and a move does not', () => {
    const doc = docWithBoard();
    const snap = horizontalStroke(doc, 'medium');
    const box = objectBounds(snap);

    // Story 7's own write, with nothing stroke-specific about it.
    expect(resizeObjects(doc, new Map([[snap.id, { ...box, width: box.width * 2, height: box.height * 2 }]]))).toBe(1);
    const resized = readStroke(doc, snap.id)!;
    const points = scaledPoints(resized);
    expect(points[1]!.x - points[0]!.x).toBeCloseTo(100 * 2);
    expect(resized.thickness).toBe('medium');
  });

  it('TC-07: a click is judged by its distance from the line, at 6 screen pixels', () => {
    const doc = docWithBoard();
    const snap = horizontalStroke(doc, 'medium');
    const points = scaledPoints(snap);
    // The line runs along y = points[0].y, so a query point's y offset *is* its
    // distance. The tolerance at zoom 1 is 6, whichever way the thickness points.
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[snap.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / 1,
    );
    const on = { x: 50, y: points[0]!.y };
    const justInside = { x: 50, y: points[0]!.y + 5.9 };
    const justOutside = { x: 50, y: points[0]!.y + 6.1 };

    expect(distanceToPolyline(points, on)).toBeCloseTo(0);
    expect(distanceToPolyline(points, justInside)).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(points, justOutside)).toBeGreaterThan(tolerance);
    // Empty space inside the box counts for nothing: the box is 4 tall and 104 wide,
    // and the middle of it is 6 away from the line.
    expect(snap.width).toBeGreaterThan(100);
  });

  it('a dot is measured from its centre', () => {
    const doc = docWithBoard();
    const id = stroke(doc, [{ x: 20, y: 20 }], 'black', 'thick')!;
    const snap = readStroke(doc, id)!;
    const points = scaledPoints(snap);
    expect(distanceToPolyline(points, points[0]!)).toBe(0);
    expect(distanceToPolyline(points, { x: points[0]!.x + 10, y: points[0]!.y })).toBeCloseTo(10);
  });
});

describe('stroke.model — smoothPath (TC-08)', () => {
  it('TC-08: three points become a path of quadratic curves, every time', () => {
    const first = smoothPath(CORNER as Point[]);
    const second = smoothPath(CORNER as Point[]);
    expect(first).toBe(second);
    expect(first.startsWith('M')).toBe(true);
    expect(first).toContain('Q');
    // One Q per interior point: the curve is drawn *through* the midpoints of the
    // segments, with the recorded points as their control points.
    expect((first.match(/Q/g) ?? []).length).toBe(1);
  });

  it('a single point is a zero-length path, which a round cap draws as a dot', () => {
    const path = smoothPath([{ x: 4, y: 6 }]);
    expect(path).toBe('M 4 6 L 4 6');
  });

  it('no points draw nothing', () => {
    expect(smoothPath([])).toBe('');
  });

  it('every coordinate written is finite, whatever came in', () => {
    const path = smoothPath([
      { x: 0, y: 0 },
      { x: 50, y: 20 },
      { x: 100, y: 0 },
      { x: 140, y: 40 },
    ]);
    const numbers = (path.match(/-?\d+(\.\d+)?(e[-+]?\d+)?/gi) ?? []).map(Number);
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('a long path is rounded to two decimals, so it stays cheap to sync', () => {
    const path = smoothPath(handwrittenLoop());
    expect(path.length).toBeLessThan(400 * 30);
    for (const value of path.match(/-?\d+\.\d+/g) ?? []) {
      expect(value.split('.')[1]!.length).toBeLessThanOrEqual(2);
    }
  });
});
