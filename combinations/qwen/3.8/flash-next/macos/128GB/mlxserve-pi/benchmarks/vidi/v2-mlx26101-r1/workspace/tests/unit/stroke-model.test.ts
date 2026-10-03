// stroke.model unit tests (story 11, TC-01 to TC-08).
//
// Everything in this file is arithmetic — a recorded path in, a path out, a box, a distance —
// run against a real Y.Doc where a document is needed. That is deliberate: the two promises
// this story rests on are both statements about numbers rather than about pixels.
//
//   * Smoothing is *faithful*, not merely tidy (pen.smooth). "The line looks smoother" is
//     unfalsifiable; "every point the hand drew lies within 1 screen pixel of the line that is
//     stored" is a number, and it is the number Ramer-Douglas-Peucker actually guarantees. The
//     tolerance is divided by the zoom, so the guarantee is in screen pixels at whatever zoom
//     the person was drawing at (TC-01, TC-02).
//   * A stroke is an ordinary object, so it is stored in the box it will be drawn in, and the
//     points are stored relative to that box at the size they were drawn at. That is what makes
//     a proportional resize a *resize of the drawing* and not a resize of an empty frame
//     (TC-06), and it is why the line is measured in the same scaled coordinates a person
//     clicks in (TC-07).
//
// The fixtures are recorded-style paths with real jitter in them (tests/fixtures/pen-paths.ts):
// a test of smoothing that feeds it a straight line proves nothing about a hand.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  distanceToPolyline,
  type Point,
} from '../../src/shared/geometry';
import {
  simplify,
  smoothPath,
  splitPoints,
} from '../../src/shared/geometry/simplify';
import {
  createStroke,
  scaledPoints,
  strokePolyline,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import { objectSnapshots, resizeObjects } from '../../src/shared/board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';
import {
  HANDWRITTEN_LOOP,
  LONG_SPIRAL,
  SPIRAL_LONG_COUNT,
  UNDERLINE,
  handwrittenLoop,
  spiral,
} from '../fixtures/pen-paths';

function doc(): Y.Doc {
  return new Y.Doc();
}

/** How many times this document emitted an update while `fn` ran. */
function updatesWhile(d: Y.Doc, fn: () => void): number {
  let count = 0;
  const observer = () => {
    count += 1;
  };
  d.on('update', observer);
  try {
    fn();
  } finally {
    d.off('update', observer);
  }
  return count;
}

/**
 * The worst distance between the points a hand drew and the line that was kept: over every
 * dropped point, its distance to the kept polyline. This is the quantity `pen.smooth` puts a
 * bound on, and the one Ramer-Douglas-Peucker actually guarantees — distance to the line that
 * replaces the point, which is the line the board then draws.
 */
function maxDeviation(raw: readonly Point[], kept: readonly Point[]): number {
  if (kept.length === 0) return Infinity;
  let worst = 0;
  for (const p of raw) worst = Math.max(worst, distanceToPolyline(kept, p));
  return worst;
}

/** The stroke this board has, or fail: there is one at a time in these tests. */
function onlyStroke(d: Y.Doc): StrokeSnap {
  const strokes = strokesOf(d);
  if (strokes.length !== 1) throw new Error(`expected one stroke, found ${strokes.length}`);
  return strokes[0]!;
}

/** Every stroke on the board, as the render model sees it. */
function strokesOf(d: Y.Doc): StrokeSnap[] {
  return objectSnapshots(d).filter((o): o is StrokeSnap => o.type === 'stroke');
}

/** One stroke by id. */
function strokeById(d: Y.Doc, id: string): StrokeSnap {
  const found = strokesOf(d).find((s) => s.id === id);
  if (!found) throw new Error(`no stroke ${id} on the board`);
  return found;
}

function stroke(
  d: Y.Doc,
  points: readonly Point[],
  color: PenColor = 'black',
  thickness: PenThickness = 'medium',
): string | null {
  return createStroke(d, { points, color, thickness }, 'tester');
}

/**
 * A straight two-point stroke, deliberately axis-aligned: its box is easy to reason about, so
 * a doubled width is visibly a doubled x and nothing else (TC-06) and a distance from the line
 * is a plain y difference (TC-07).
 */
function lineStroke(d: Y.Doc, thickness: PenThickness = 'thin'): StrokeSnap {
  const id = stroke(d, [{ x: 100, y: 100 }, { x: 300, y: 100 }], 'blue', thickness);
  if (id === null) throw new Error('the model refused a stroke it should keep');
  return onlyStroke(d);
}

describe('stroke.model', () => {
  // TC-01 (pen.smooth): the recorded loop, smoothed at the tolerance the board uses at 100%
  // zoom. What is asserted is faithfulness first and brevity second: the simplification is only
  // allowed because every drawn point is still within one pixel of it.
  it('TC-01 simplifies a handwritten loop to fewer points, every one of them within the tolerance', () => {
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / 1; // 100% zoom
    const kept = simplify(HANDWRITTEN_LOOP, tolerance);

    expect(HANDWRITTEN_LOOP.length).toBeGreaterThanOrEqual(400);
    // A hundred-to-one reduction would be a different line, not a smoother one; a quarter of
    // the points is a real hand's redundancy.
    expect(kept.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    expect(kept.length).toBeGreaterThan(1);
    expect(maxDeviation(HANDWRITTEN_LOOP, kept)).toBeLessThanOrEqual(tolerance);

    // The ends are kept: a stroke that stops short of where the pen went down and up is a
    // stroke in the wrong place.
    expect(kept[0]).toEqual(HANDWRITTEN_LOOP[0]);
    expect(kept[kept.length - 1]).toEqual(HANDWRITTEN_LOOP[HANDWRITTEN_LOOP.length - 1]);

    // And it is safe to run again: a second pass can only ever stay inside the same
    // tolerance, so smoothing a stroke twice is a tidier stroke, not a different one.
    const twice = simplify(kept, tolerance);
    expect(twice.length).toBeLessThanOrEqual(kept.length);
    expect(maxDeviation(kept, twice)).toBeLessThanOrEqual(tolerance);

    // The same guarantee on the underline: a short, nearly-straight path is where a simplifier
    // is most tempted to throw away the sag that made it an underline.
    const sag = simplify(UNDERLINE, tolerance);
    expect(maxDeviation(UNDERLINE, sag)).toBeLessThanOrEqual(tolerance);
    expect(sag.length).toBeLessThan(UNDERLINE.length);
    expect(sag.length).toBeGreaterThan(2);
  });

  // TC-02 (pen.smooth at another zoom): the tolerance is a *screen* allowance, so at 200% the
  // board asks for half as much in board units and still keeps every drawn point inside it.
  it('TC-02 keeps every drawn point within one screen pixel at 200% zoom as well', () => {
    const zoom = 2;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / zoom; // 0.5 board units
    const kept = simplify(HANDWRITTEN_LOOP, tolerance);

    expect(maxDeviation(HANDWRITTEN_LOOP, kept)).toBeLessThanOrEqual(tolerance);
    // Zoomed in, the hand's tremor is bigger on the screen, so more of it has to be kept: the
    // tolerance is not a fixed amount of the board.
    expect(kept.length).toBeGreaterThan(simplify(HANDWRITTEN_LOOP, 1).length);
    expect(kept.length).toBeLessThan(HANDWRITTEN_LOOP.length);
  });

  // A tolerance of 0 must not invent a point or lose one: whatever is kept has to be the whole
  // path, which is the one thing that makes the guarantee above meaningful rather than a
  // property of one particular number.
  it('simplify with no tolerance keeps the path as it was', () => {
    const path = handwrittenLoop(40, 7);
    expect(simplify(path, 0)).toEqual(path);
  });

  // TC-03 (pen.long_stroke): the boundary of the point limit. One part below and at the limit,
  // two parts above it, and the second part has to begin where the first one ended or the
  // circle the person drew has a hole in it.
  it('TC-03 splits a point list at the limit and shares the join point', () => {
    const last = (parts: Point[][]): Point => parts[parts.length - 1]![parts[parts.length - 1]!.length - 1]!;

    const justUnder = spiral(STROKE_MAX_POINTS - 1);
    const exactly = spiral(STROKE_MAX_POINTS);
    const justOver = spiral(STROKE_MAX_POINTS + 1);

    const under = splitPoints(justUnder);
    expect(under).toHaveLength(1);
    expect(under[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const exact = splitPoints(exactly);
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(STROKE_MAX_POINTS);

    const over = splitPoints(justOver);
    expect(over).toHaveLength(2);
    expect(over[0]![0]).toEqual(justOver[0]);
    expect(over[1]![0], 'the second part starts at the point the first one ended on').toEqual(
      last(over.slice(0, 1)),
    );
    // Nothing is lost and nothing is invented except that shared join.
    expect(over[0]!.length + over[1]!.length).toBe(STROKE_MAX_POINTS + 2);

    // Many parts: the same rule further along the path, and the max is a parameter so a test
    // can ask for a small one instead of building ten thousand points.
    const small = splitPoints(spiral(10), 4);
    expect(small.map((p) => p.length)).toEqual([4, 4, 4]);
    expect(small[1]![0]).toEqual(small[0]![3]);
    expect(small[2]![0]).toEqual(small[1]![3]);

    // The edges of the edge cases.
    expect(splitPoints([])).toEqual([]);
    expect(splitPoints(spiral(1))).toHaveLength(1);
  });

  // TC-04 (pen.dot): a press that never moved is still a mark. Its box is the dot — a square
  // the size of the thickness, so a round-capped line drawn through its centre fills it — and
  // the one point it stores is at the centre of that box.
  it('TC-04 stores a single point as a dot whose box is the thickness square', () => {
    const d = doc();
    const thickness = PEN_THICKNESS_WORLD.thick;
    const id = stroke(d, [{ x: 500, y: -250 }], 'green', 'thick');
    expect(id).not.toBeNull();

    const s = onlyStroke(d);
    expect(s.width).toBeCloseTo(thickness, 9);
    expect(s.height).toBeCloseTo(thickness, 9);
    // The box is padded by half a thickness on every side, so the point sits in the middle.
    expect(s.x).toBeCloseTo(500 - thickness / 2, 9);
    expect(s.y).toBeCloseTo(-250 - thickness / 2, 9);
    expect(s.points).toHaveLength(2);
    expect(scaledPoints(s)).toEqual([{ x: thickness / 2, y: thickness / 2 }]);
    expect(s.color).toBe('green');
    expect(s.thickness).toBe('thick');
    expect(s.createdBy).toBe('tester');
    // A dot is a whole stroke: it lands on top of everything else, like any other object.
    expect(s.z).toBeGreaterThan(0);
  });

  // TC-05 (errors): a stroke that cannot be a stroke is refused before the document is opened,
  // so nothing goes on the wire and nobody's board changes. Four ways to get it wrong, and each
  // of them has to leave the document exactly as it was.
  it('TC-05 refuses empty, non-finite, unknown-colour and unknown-thickness strokes without a write', () => {
    const d = doc();
    const cases: [string, () => string | null][] = [
      ['no points at all', () => stroke(d, [])],
      ['one NaN coordinate', () => stroke(d, [{ x: 10, y: Number.NaN }, { x: 40, y: 40 }])],
      ['an infinite coordinate', () => stroke(d, [{ x: Number.POSITIVE_INFINITY, y: 4 }])],
      ['a colour that does not exist', () => stroke(d, [{ x: 1, y: 1 }], 'pink' as PenColor, 'medium')],
      ['a thickness that does not exist', () => stroke(d, [{ x: 1, y: 1 }], 'red', 'huge' as PenThickness)],
    ];

    for (const [what, attempt] of cases) {
      expect(attempt(), `${what} must be refused`).toBeNull();
      expect(objectSnapshots(d), `${what} wrote an object anyway`).toHaveLength(0);
      expect(updatesWhile(d, attempt), `${what} put something on the wire`).toBe(0);
    }

    // A stroke that is refused must not be the reason the next one is too.
    expect(updatesWhile(d, () => stroke(d, [{ x: 5, y: 5 }], 'red', 'medium'))).toBe(1);
    expect(objectSnapshots(d)).toHaveLength(1);
  });

  // TC-06 (pen.resize): a stroke stores its points relative to its own box, at the size it was
  // drawn. Double the box and every coordinate doubles — which is the whole reason resizing a
  // scribble scales the scribble rather than the empty frame around it. The thickness does not
  // double with it, because line thickness is a property of the pen, not of the paper.
  it('TC-06 scales the stored points with the box and leaves the thickness alone', () => {
    const d = doc();
    const id = createStroke(
      d,
      {
        points: [
          { x: 100, y: 100 },
          { x: 140, y: 160 },
          { x: 220, y: 120 },
          { x: 300, y: 200 },
        ],
        color: 'purple',
        thickness: 'medium',
      },
      'tester',
    );
    if (id === null) throw new Error('the model refused a stroke it should keep');
    const before = onlyStroke(d);
    const beforeScaled = scaledPoints(before);
    const thicknessPx = PEN_THICKNESS_WORLD[before.thickness];

    // The points are stored in the box, so they start at half a thickness in and end at the
    // far side less half a thickness: the padding is the round cap's room.
    expect(Math.min(...beforeScaled.map((p) => p.x))).toBeCloseTo(thicknessPx / 2, 9);
    expect(before.baseWidth).toBeCloseTo(before.width, 9);
    expect(before.baseHeight).toBeCloseTo(before.height, 9);

    expect(resizeObjects(d, new Map([[id, { x: before.x, y: before.y, width: before.width * 2, height: before.height * 2 }]]))).toBe(1);
    const after = onlyStroke(d);
    const afterScaled = scaledPoints(after);

    expect(after.width).toBeCloseTo(before.width * 2, 6);
    expect(afterScaled).toHaveLength(beforeScaled.length);
    for (let i = 0; i < afterScaled.length; i += 1) {
      expect(afterScaled[i]!.x).toBeCloseTo(beforeScaled[i]!.x * 2, 6);
      expect(afterScaled[i]!.y).toBeCloseTo(beforeScaled[i]!.y * 2, 6);
    }
    // Nothing about the stroke itself changed: only its box.
    expect(after.thickness).toBe('medium');
    expect(after.color).toBe('purple');
    expect(after.points).toEqual(before.points);
    expect(after.baseWidth).toBeCloseTo(before.baseWidth, 9);

    // And the *world* polyline the renderer and the hit test use follows the box: the same
    // scaled points, moved to where the box now is.
    const world = strokePolyline(after);
    expect(world[0]!.x).toBeCloseTo(after.x + afterScaled[0]!.x, 6);

    // A resize that is not proportional keeps the ratio it was given, because scaling is by
    // each axis: which is how a stroke drawn flat and wide stays flat and wide.
    resizeObjects(d, new Map([[id, { x: after.x, y: after.y, width: after.baseWidth, height: after.baseHeight }]]));
    expect(scaledPoints(onlyStroke(d))).toEqual(beforeScaled);
  });

  // TC-07 (pen.select): the thing a person has to hit is the line, plus a screen allowance
  // either side — the same rule story 10 established for arrows, on a polyline that has many
  // more points in it. 5.9 units is inside the six-pixel allowance at 100%, 6.1 is outside it.
  it('TC-07 measures the hit distance against the scaled line, not the box', () => {
    const d = doc();
    const s = lineStroke(d);
    // Where the board draws it: the scaled path, moved to the box. A translation changes no
    // distance, so the same line is measured in either space; this one is in world units, which
    // is where a click arrives from.
    const line = strokePolyline(s);
    const zoom = 1;
    const tolerance = STROKE_HIT_TOLERANCE_PX / zoom;

    // The box is the drawn path's own: 202 long (200 of path plus a line width of padding), and
    // 4 tall, grown from the 2 a thin horizontal line needs to the smallest box a stroke may
    // have — grown equally on both sides, so the line still runs through the middle of it.
    expect(s.width).toBeCloseTo(202, 9);
    expect(s.height).toBeCloseTo(STROKE_MIN_SIZE_WORLD, 9);
    expect(line[0]!.y - s.y).toBeCloseTo(STROKE_MIN_SIZE_WORLD / 2, 9);

    // A point halfway along the line, then the same point lifted off it by just under and just
    // over the allowance. The stroke is horizontal, so "off the line" is a y difference.
    const onTheLine = { x: line[1]!.x - 50, y: line[0]!.y };
    expect(distanceToPolyline(line, onTheLine)).toBeCloseTo(0, 9);
    expect(distanceToPolyline(line, { x: onTheLine.x, y: onTheLine.y + 5.9 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(line, { x: onTheLine.x, y: onTheLine.y + 6.1 })).toBeGreaterThan(tolerance);

    // The allowance is a screen allowance: twice the zoom, half the room in board units.
    expect(STROKE_HIT_TOLERANCE_PX / 2).toBeLessThan(tolerance);

    // Along the line but outside its ends is not a hit either: a click in the empty board past
    // the end of a stroke is a click on the board.
    expect(distanceToPolyline(line, { x: line[1]!.x + 20, y: line[1]!.y })).toBeGreaterThan(tolerance);

    // And the rule that matters most for a scribble: the middle of a circle is inside its box
    // and nowhere near its line, and clicking there must not grab the circle. This is the case a
    // box hit test gets wrong and a line hit test gets right.
    const loop = simplify(handwrittenLoop(60, 5), 1);
    const loopId = stroke(d, loop);
    if (loopId === null) throw new Error('the model refused a stroke it should keep');
    const drawn = strokePolyline(strokeById(d, loopId));
    const xs = drawn.map((p) => p.x);
    const ys = drawn.map((p) => p.y);
    const centre = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    expect(distanceToPolyline(drawn, centre)).toBeGreaterThan(tolerance);
  });

  // TC-08: the drawn path is built from midpoint quadratics through the kept points, so the
  // stroke has round corners and no visible joins, and the same stroke always draws the same
  // way (a path that changed between renders would make a stroke shimmer).
  it('TC-08 builds a deterministic quadratic path through the points', () => {
    const three = [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 5 }];
    const path = smoothPath(three);

    expect(path.startsWith('M 0 0')).toBe(true);
    expect(path).toContain('Q');
    expect(smoothPath(three)).toBe(path);

    // The curve is handed each interior point as a control point and finishes on the last
    // point, so the drawing starts and stops where the pen did.
    const parts = path.split(/[MLQ] /).filter(Boolean);
    expect(parts).toHaveLength(3); // M p0, Q control end, L last point
    expect(path.endsWith('30 5')).toBe(true);

    // Two points is a straight run: no curve can be built from two points, and inventing one
    // would move the line off where it was drawn.
    expect(smoothPath([{ x: 1, y: 2 }, { x: 5, y: 6 }])).toBe('M 1 2 L 5 6');

    // One point is a zero-length subpath: with a round cap that is a dot, which is what a press
    // that never moved means (pen.dot).
    expect(smoothPath([{ x: 7, y: 9 }])).toBe('M 7 9 L 7 9');

    // Nothing to draw at all, rather than a path that is a lie.
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 0, y: 0 }, { x: Number.NaN, y: 3 }, { x: 4, y: 4 }])).toBe('M 0 0 L 4 4');

    // A path made of quadratics stays inside the points it was given, which is what keeps the
    // rendered stroke within the tolerance the simplifier promised: no Q may reach outside the
    // box the points occupy.
    const loop = simplify(HANDWRITTEN_LOOP, 1);
    const d = smoothPath(loop);
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = loop.map((p) => p.x);
    const ys = loop.map((p) => p.y);
    for (let i = 0; i < numbers.length; i += 2) {
      const x = numbers[i]!;
      const y = numbers[i + 1]!;
      // Half a hundredth of a pixel is the path string's rounding, not a curve escaping.
      expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - 0.01);
      expect(x).toBeLessThanOrEqual(Math.max(...xs) + 0.01);
      expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - 0.01);
      expect(y).toBeLessThanOrEqual(Math.max(...ys) + 0.01);
    }
  });

  // The rest of what the model owes the board: a stroke is a known object type, it is stored on
  // top of what is already there, and a long path survives the round trip through the document.
  it('stores a stroke as an ordinary object, on top of what was already there', () => {
    const d = doc();
    const first = stroke(d, handwrittenLoop(30, 3), 'red', 'thin');
    const second = createStroke(d, { points: spiral(600), color: 'blue', thickness: 'thick' }, 'other');
    if (first === null || second === null) throw new Error('both strokes should be kept');

    const all = objectSnapshots(d).filter((o): o is StrokeSnap => o.type === 'stroke');
    expect(all).toHaveLength(2);
    expect(all[1]!.z).toBeGreaterThan(all[0]!.z);
    expect(all.map((s) => s.id)).toEqual([first, second]);

    // 600 points, flattened: nothing was quietly dropped on the way in, and the colour and
    // thickness a person chose are what the object carries.
    expect(all[1]!.points).toHaveLength(1200);
    expect(all[1]!.color).toBe('blue');
    expect(all[1]!.thickness).toBe('thick');
    expect(all[1]!.createdBy).toBe('other');

    // The box is the drawing's own, so a path that spans a wide area gets a wide box, padded by
    // half a thickness so the round caps are inside it.
    expect(all[1]!.width).toBeGreaterThan(100);
    const t = PEN_THICKNESS_WORLD.thick;
    const left = Math.min(...scaledPoints(all[1]!).map((p) => p.x));
    const right = Math.max(...scaledPoints(all[1]!).map((p) => p.x));
    expect(left).toBeCloseTo(t / 2, 6);
    expect(right).toBeCloseTo(all[1]!.width - t / 2, 6);

    // Every colour and thickness in the settings is a stroke the model will accept, which is
    // what makes the toolbar's buttons a list rather than a promise.
    const many = new Y.Doc();
    for (const color of Object.keys(PEN_COLORS) as PenColor[]) {
      for (const thickness of Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]) {
        expect(
          createStroke(many, { points: [{ x: 1, y: 1 }], color, thickness }, 'tester'),
          `${color}/${thickness} should be a stroke`,
        ).not.toBeNull();
      }
    }
    expect(objectSnapshots(many)).toHaveLength(
      Object.keys(PEN_COLORS).length * Object.keys(PEN_THICKNESS_WORLD).length,
    );

    // The long spiral: the count the point limit is set below, kept whole by one call.
    const longDoc = doc();
    expect(updatesWhile(longDoc, () => stroke(longDoc, LONG_SPIRAL))).toBe(1);
    expect(objectSnapshots(longDoc)[0]!.type).toBe('stroke');
    expect((objectSnapshots(longDoc)[0] as StrokeSnap).points).toHaveLength(
      SPIRAL_LONG_COUNT * 2,
    );
  });
});
