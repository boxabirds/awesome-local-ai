/**
 * Unit tests for the stroke model and the geometry under it (story 11, `stroke.model`, TC-01 to TC-08).
 *
 * A real `Y.Doc`, as the story 2, 9 and 10 model tests use one, for the two questions a document has to
 * answer: *what is stored*, and *how many transactions did that cost*. The second is not a detail — a write
 * that changes nothing puts a sync message on the wire and an empty step in five people's undo histories.
 *
 * What is checked here is the record and the maths, never the picture. That a stroke is drawn with round ends,
 * or that a quadratic Bézier looks smoother than the points it goes through, is a fact about a component and
 * belongs to the component suite. What belongs here is that the document holds the key `"purple"`, that it
 * holds five thousand points as fifty, and that a point read back out of it is a point that was drawn.
 *
 * Distances are said out loud in units, because "the shape came out the same" means nothing without a number:
 * a stroke is *thinned*, which means the points it stores are not the points that were drawn, and the whole of
 * the trick is that the line still is. Board units are used throughout, at 100% where a board unit and a
 * screen pixel are the same thing.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  LOCAL_ORIGIN,
  initDoc,
  isDerivedBoxObjectType,
  moveObjects,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_ORDER,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  isPenColor,
  isPenThickness,
  type PenColor,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import {
  STROKE_OBJECT_TYPE,
  createStroke,
  isStrokeSnapshot,
  readStroke,
  scaledPoints,
  strokeHit,
  strokePaint,
  strokePenWidth,
  strokeSnapshots,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import {
  count,
  extent,
  firstOf,
  handwrittenLoop,
  holds,
  lastOf,
  letterAStrokes,
  longSpiral,
  maxDeviation,
  noisySine,
  spiral,
  straightRun,
  underline,
  zigzag,
} from '../fixtures/pen-paths';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Starts counting `update` events; returns a reader of the count. */
function countUpdates(doc: Y.Doc): () => number {
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return () => updates;
}

/**
 * How far a point read back out of the document may sit from the point that went in, in board units.
 *
 * It is not zero, and it should not be: points are stored relative to the stroke's own origin and at a fixed
 * number of decimals, so a point a long way from the board's origin comes back carrying a rounding. What is
 * being ruled out is a point that came from somewhere else — a hundredth of a board unit is a four-hundredth
 * of the pen's width, and a hundred times the rounding is a stroke that drifted off the board.
 */
const ROUND_TRIP = 0.01;

/** Put a stroke on the board and insist it was accepted, so a test can read its id without a null check. */
function draw(
  doc: Y.Doc,
  path: readonly Point[],
  options: { color?: PenColor; thickness?: string; by?: string } = {},
): string {
  const id = createStroke(doc, { points: path, color: options.color, thickness: options.thickness }, options.by ?? 'tester');
  if (id === null) throw new Error('the model refused a stroke it should have made');
  return id;
}

/** A stroke as the document holds it, or a failure that says which assumption broke. */
function strokeOf(doc: Y.Doc, id: string): StrokeSnap {
  const stroke = readStroke(doc, id);
  if (stroke === null) throw new Error(`no stroke ${id} in the document`);
  return stroke;
}

/** The points a stroke holds, at the size it was drawn at: what `scaledPoints` answers when nothing resized it. */
function stored(doc: Y.Doc, id: string): Point[] {
  return scaledPoints(strokeOf(doc, id));
}

/** Rewrite stored fields behind the model's back: how a foreign or damaged record is simulated. */
function rewrite(doc: Y.Doc, id: string, values: Record<string, unknown>): void {
  const object = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (object === undefined) throw new Error(`no object ${id} to rewrite`);
  doc.transact(() => {
    for (const [key, value] of Object.entries(values)) object.set(key, value);
  }, LOCAL_ORIGIN);
}

/** Resize a stroke the way a corner handle does, and say how much of it the board wrote. */
function resize(doc: Y.Doc, id: string, width: number, height: number, x?: number, y?: number): number {
  const before = strokeOf(doc, id);
  return resizeObjects(doc, new Map([[id, { x: x ?? before.x, y: y ?? before.y, width, height }]]));
}

// --------------------------------------------------------------------------
// stroke.simplify — Ramer–Douglas–Peucker, and the curve that draws it
// --------------------------------------------------------------------------

describe('stroke.simplify', () => {
  it('TC-01: thins a handwritten loop to points every one of which is within the tolerance of the drawing', () => {
    // The design's own fixture: a loop wound by hand, four hundred points, jittered.
    const drawn = handwrittenLoop();
    const thin = simplify(drawn, STROKE_SIMPLIFY_TOLERANCE_PX);

    expect(count(drawn)).toBeGreaterThanOrEqual(400);
    expect(count(thin)).toBeLessThan(count(drawn));

    // The guarantee RDP makes, said as a number rather than as a hope: no point the pen passed through is
    // farther from the finished line than the tolerance. At 100% the tolerance is one screen pixel, which is
    // why a stroke can lose nine points in ten and still be the loop somebody drew.
    expect(maxDeviation(drawn, thin)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);

    // The two points a path cannot lose: the pen's first touch and its last lift. Drop either and the stroke
    // is shorter than the gesture that made it.
    expect(firstOf(thin)).toEqual(firstOf(drawn));
    expect(lastOf(thin)).toEqual(lastOf(drawn));
  });

  it('TC-01a: keeps a point the line cannot account for, and drops the ones it can', () => {
    // Four points along y = x and one five units off it in the middle, with a tolerance of one.
    const path: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 7 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ];
    const thin = simplify(path, 1);

    // The deviant survives, because it is what the drawing *is*; the point before it only repeats the line.
    expect(thin).toHaveLength(4);
    expect(holds(thin, path[2]!)).toBe(true);
    expect(holds(thin, path[1]!)).toBe(false);
    expect(holds(thin, path[0]!)).toBe(true);
    expect(holds(thin, path[4]!)).toBe(true);
  });

  it('TC-02: at 200% the tolerance is halved, so the thinner answer is held to twice the accuracy', () => {
    // The same path at two zooms, which is what the pen does with it: the tolerance is in screen pixels and
    // the board is in world units, so what a person drawing at 200% tolerates is half as much board.
    const drawn = handwrittenLoop({ radius: 80 });
    const zoom = 2;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / zoom;
    expect(tolerance).toBe(0.5);

    const thin = simplify(drawn, tolerance);
    expect(maxDeviation(drawn, thin)).toBeLessThanOrEqual(tolerance);

    // Halving the tolerance cannot throw away *more* of the drawing: accuracy is bought with points, and the
    // only currency is the points that are kept.
    expect(count(thin)).toBeGreaterThanOrEqual(count(simplify(drawn, STROKE_SIMPLIFY_TOLERANCE_PX)));

    // An underline shows the other half of the same rule: nearly all of a straight run is repetition, and a
    // tolerance of one pixel is enough to know it.
    const line = underline();
    expect(count(simplify(line, 1))).toBeLessThanOrEqual(Math.ceil(count(line) / 4));
    expect(maxDeviation(line, simplify(line, 1))).toBeLessThanOrEqual(1);
  });

  it('TC-03: splits a gesture that outgrew the record, the next part starting at the last point of the one before', () => {
    const long = longSpiral();
    expect(count(long)).toBe(STROKE_MAX_POINTS + 10);

    // The three cases the boundary has: one point short of the limit, exactly at it, and one point over.
    expect(splitPoints(long.slice(0, STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(long.slice(0, STROKE_MAX_POINTS))).toHaveLength(1);
    const parts = splitPoints(long);
    expect(parts).toHaveLength(2);
    expect(count(parts[0]!)).toBe(STROKE_MAX_POINTS);

    // The join is a shared point and not a jump. Two strokes that meet at a point read as one line; a gap
    // between them is a nick out of the drawing, and it shows at any zoom.
    expect(lastOf(parts[0]!)).toEqual(firstOf(parts[1]!));
    expect(count(parts[1]!)).toBe(11);
    expect(parts.flat()).toHaveLength(count(long) + 1);

    // And it keeps splitting: three parts, each joined to the last, none longer than the record. Asked at a
    // limit of forty rather than five thousand, because the arithmetic is the same and a test that split five
    // thousand points would be a test of the fixture.
    const winding = handwrittenLoop({ count: 100 });
    const three = splitPoints(winding, 40);
    expect(three).toHaveLength(3);
    for (const part of three) expect(count(part)).toBeLessThanOrEqual(40);
    expect(firstOf(three[1]!)).toEqual(lastOf(three[0]!));
    expect(firstOf(three[2]!)).toEqual(lastOf(three[1]!));
    expect(three.flat()).toHaveLength(count(winding) + 2);

    // Nothing to split, nothing to say.
    expect(splitPoints([])).toEqual([]);
    expect(splitPoints(straightRun(3, { x: 0, y: 0 }, { x: 3, y: 3 }), 0)).toHaveLength(1);
  });

  it('TC-04: a tap of the pen is stored as one point in a box the size of the pen', () => {
    const doc = newDoc();
    const id = draw(doc, [{ x: 300, y: 300 }], { thickness: 'thick' });
    const stroke = strokeOf(doc, id);

    // The bbox is the thickness square: a dot is painted around the point the pen came down on, so the box has
    // to reach half a pen beyond it on every side, or the box would crop the dot and the selection's handles
    // would be drawn on top of it.
    const pen = PEN_THICKNESS_WORLD.thick;
    expect(stroke.x).toBeCloseTo(300 - pen / 2, 6);
    expect(stroke.y).toBeCloseTo(300 - pen / 2, 6);
    expect(stroke.width).toBe(pen);
    expect(stroke.height).toBe(pen);
    expect(stroke.baseWidth).toBe(pen);
    expect(stroke.baseHeight).toBe(pen);

    // And the points are the two numbers of that one point, relative to the box: the record of a tap is a
    // number and a half the size of the record of a letter.
    expect(stroke.points).toHaveLength(2);
    expect(stroke.points[0]).toBeCloseTo(pen / 2, 3);
    expect(stroke.points[1]).toBeCloseTo(pen / 2, 3);
    // Read back through the scale, the point is where the pen came down and not in the corner of the box that
    // holds it.
    expect(stored(doc, id)[0]!.x).toBeCloseTo(300, 2);
    expect(stored(doc, id)[0]!.y).toBeCloseTo(300, 2);

    // Every pen makes a box the size of that pen, and the smallest of them is still something a pointer can
    // find: what reaches past a two-unit box is the click tolerance, which is six screen pixels and is the
    // reason a dot drawn with the fine pen is not a dot that can only be clicked by an ant.
    for (const thickness of PEN_THICKNESS_ORDER) {
      const dot = strokeOf(doc, draw(doc, [{ x: 60, y: 60 }], { thickness }));
      expect(dot.width).toBe(PEN_THICKNESS_WORLD[thickness]);
      expect(dot.height).toBe(PEN_THICKNESS_WORLD[thickness]);
      expect(STROKE_HIT_TOLERANCE_PX * 2).toBeGreaterThan(dot.width);
      expect(strokeHit(dot, { x: 60, y: 60 }, 1)).toBe(true);
      expect(strokeHit(dot, { x: 60 + STROKE_HIT_TOLERANCE_PX + 0.5, y: 60 }, 1)).toBe(false);
    }
  });

  it('TC-05: refuses a stroke with nothing in it, a colour it cannot paint and a thickness it cannot draw', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);
    const path = handwrittenLoop({ count: 40 });

    expect(createStroke(doc, { points: [] }, 'tester')).toBeNull();
    expect(createStroke(doc, { points: [{ x: Number.NaN, y: 4 }] }, 'tester')).toBeNull();
    // `'pink'` is a colour the board knows — for a sticky note. A pen cannot be pink, and a record that said
    // so would paint something nobody on any screen chose.
    expect(createStroke(doc, { points: path, color: 'pink' as PenColor }, 'tester')).toBeNull();
    expect(createStroke(doc, { points: path, thickness: 'huge' }, 'tester')).toBeNull();
    // A point that is not a point creates nothing either: it would be a box at `NaN`, taking a `z`, drawn by
    // nothing, unreachable by any pointer, and in a document five people have to put up with.
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 5 }] }, 'tester')).toBeNull();
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 4, y: 'five' } as unknown as Point] }, 'tester')).toBeNull();
    expect(createStroke(doc, { points: null as unknown as Point[] }, 'tester')).toBeNull();
    expect(createStroke(doc, { points: 'not a path' as unknown as Point[] }, 'tester')).toBeNull();
    // The six are the six, spelled as the settings spell them.
    expect(isPenColor('black')).toBe(true);
    expect(isPenColor('Black')).toBe(false);
    expect(isPenThickness('thin')).toBe(true);
    expect(isPenThickness('thin ')).toBe(false);

    // The document was not touched by any of it. Not one byte to five other people, and not one blank step in
    // anybody's undo history.
    expect(updates()).toBe(0);
    expect(strokeSnapshots(doc)).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-06: a resize scales the drawing in proportion, and leaves the width of its line alone', () => {
    const doc = newDoc();
    const id = draw(doc, handwrittenLoop({ count: 90 }), { thickness: 'medium' });
    const before = strokeOf(doc, id);
    const original = scaledPoints(before);
    const ratio = before.width / before.height;

    // Twice the box, held at its top-left: which is what an aspect-locked corner handle writes.
    const factor = 2;
    expect(resize(doc, id, before.width * factor, before.height * factor)).toBe(1);

    const after = strokeOf(doc, id);
    expect(after.width / after.height).toBeCloseTo(ratio, 9);
    // The base box is the drawing as it was drawn, and is never rewritten: it is the ruler that says how big
    // the drawing used to be, which is the only thing a later scale can be measured against.
    expect(after.baseWidth).toBe(before.baseWidth);
    expect(after.baseHeight).toBe(before.baseHeight);
    // The drawing itself was not rewritten at all: the same stored numbers, which is the whole point of storing
    // them inside the box.
    expect(after.points).toEqual(before.points);

    // The drawing grew with the box, point for point, from the corner it was held at.
    const grown = scaledPoints(after);
    expect(grown).toHaveLength(count(original));
    original.forEach((point, index) => {
      expect(grown[index]!.x).toBeCloseTo(before.x + (point.x - before.x) * factor, 2);
      expect(grown[index]!.y).toBeCloseTo(before.y + (point.y - before.y) * factor, 2);
    });

    // The pen is the pen. A stroke that was drawn with a medium nib is drawn with a medium nib at any size:
    // the record keeps the *name* of the thickness, and the width comes from the settings at draw time, so a
    // resize scales what was drawn and not the instrument that drew it.
    expect(after.thickness).toBe('medium');
    expect(strokePenWidth(after)).toBe(PEN_THICKNESS_WORLD.medium);
    expect(strokePenWidth(after)).toBe(strokePenWidth(before));

    // And shrink it back: the scale goes both ways, and a drawing that had been scaled to nothing would show
    // up here as a coordinate that is not where the arithmetic says it should be.
    resize(doc, id, before.width / 2, before.height / 2);
    const small = strokeOf(doc, id);
    expect(strokePenWidth(small)).toBe(PEN_THICKNESS_WORLD.medium);
    expect(small.width).toBeCloseTo(before.width / 2, 3);
    expect(scaledPoints(small)[0]!.x).toBeCloseTo(before.x + (original[0]!.x - before.x) / 2, 2);
  });

  it('TC-07: a click is on a stroke within six screen pixels of its line, and not on it beyond that', () => {
    const doc = newDoc();
    const id = draw(doc, underline({ count: 60, x: 100, y: 100, length: 300, rise: 0, jitter: 0 }));
    const stroke = strokeOf(doc, id);
    const line = scaledPoints(stroke);
    const on = line[Math.floor(count(line) / 2)]!;

    // The boundary the product answers at, measured rather than asserted from the same constant twice: a
    // point 5.9 units from the line is a click on it, and a point 6.1 units away is a click beside it.
    const within = { x: on.x, y: on.y + STROKE_HIT_TOLERANCE_PX - 0.1 };
    const beyond = { x: on.x, y: on.y + STROKE_HIT_TOLERANCE_PX + 0.1 };
    expect(distanceToPolyline(line, within)).toBeLessThan(STROKE_HIT_TOLERANCE_PX);
    expect(distanceToPolyline(line, beyond)).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);

    // At 100% a board unit is a screen pixel, so the tolerance is the setting itself.
    expect(strokeHit(stroke, on, 1)).toBe(true);
    expect(strokeHit(stroke, within, 1)).toBe(true);
    expect(strokeHit(stroke, beyond, 1)).toBe(false);

    // Zoomed in, the same six pixels of pointer accuracy reach a *smaller* distance in board units — which is
    // why the tolerance is divided by the zoom and why a stroke is as easy to hit at 400% as at 50%.
    expect(strokeHit(stroke, within, 2)).toBe(false);
    expect(strokeHit(stroke, { x: on.x, y: on.y + STROKE_HIT_TOLERANCE_PX / 2 - 0.1 }, 2)).toBe(true);
    // Zoomed out, it reaches farther into the board, for the same reason.
    expect(strokeHit(stroke, { x: on.x, y: on.y + STROKE_HIT_TOLERANCE_PX * 2 - 0.1 }, 0.5)).toBe(true);

    // A stroke that was drawn thin is easier to hit than a hairline: half the pen's own width counts, because
    // that is how much of the screen the painted line covers. Asked at 400%, where the six pixels of pointer
    // accuracy have shrunk to a year and a half of board units, so the only thing that can make this click a
    // hit is the paint the stroke itself lays down.
    const fat = strokeOf(doc, draw(doc, underline({ count: 30, length: 200, jitter: 0 }), { thickness: 'thick' }));
    const nib = PEN_THICKNESS_WORLD.thick;
    const fatPoint = scaledPoints(fat)[15]!;
    expect(strokeHit(fat, { x: fatPoint.x, y: fatPoint.y + nib / 2 - 0.1 }, 4)).toBe(true);
    expect(strokeHit(fat, { x: fatPoint.x, y: fatPoint.y + nib / 2 + 0.1 }, 4)).toBe(false);
    // And at a zoom low enough for the six pixels to be the wider reach again, the nib stops mattering.
    expect(strokeHit(fat, { x: fatPoint.x, y: fatPoint.y + nib / 2 + 0.1 }, 1)).toBe(true);
  });

  it('TC-08: paints a path out of the points, starting at one and curving through the rest', () => {
    const three: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 0 },
    ];
    const d = smoothPath(three);

    // Starts at a point, and curves: quadratic Béziers through the midpoints of the segments is what stops a
    // densely sampled curve looking faceted at 400%. A polygon of `L` commands would pass a test that only
    // asked "is there a path" and would fail the requirement.
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    // It finishes where the pen lifted: a stroke that stopped half a segment short of its last point would
    // have a stub missing from the end of every drawing on the board.
    expect(d.endsWith('L 20 0')).toBe(true);
    // The same points, the same path, every time: the component calls this on every render, so a renderer that
    // put the current time, or a random seed, into the data would produce a stroke that shimmers.
    expect(smoothPath(three)).toBe(d);
    // It is the drawing's own extent still: the curve passes through the midpoints of the segments, which is
    // what keeps it within a pixel of the line that was drawn.
    expect(d).toContain('20');
    // And nothing unusable in it: one `NaN` in path data is not an ugly line, it is *no line* — a browser
    // abandons the whole attribute.
    for (const forbidden of ['NaN', 'Infinity', 'undefined', 'null']) expect(d).not.toContain(forbidden);

    // The tap of a pen is one point, and one point has to be drawable: painted at itself, which with round
    // ends is a disc the width of the pen.
    const dot = smoothPath([{ x: 12, y: 30 }]);
    expect(dot).toContain('12');
    expect(dot).toContain('30');
    expect(dot).not.toContain('NaN');
    // A path of nothing is a path that draws nothing, said rather than invented.
    expect(smoothPath([])).toBe('');
    // Two points have no midpoint to curve through, so they are a straight line between them.
    expect(smoothPath([{ x: 0, y: 0 }, { x: 4, y: 4 }])).toContain('4');

    // The path data of a whole drawing is shorter than the drawing has points, which is the saving the
    // simplifier makes on the way to the renderer too.
    const drawn = zigzag({ corners: 6, perRun: 24 });
    const commands = (smoothPath(simplify(drawn, 1)).match(/[MQ]/g) ?? []).length;
    expect(commands).toBeLessThanOrEqual(count(drawn) - 2);
    // Six corners are six turns in the drawing: a simplifier that had eaten one would have produced a shorter
    // path and a different picture.
    expect(commands).toBeGreaterThanOrEqual(6);
  });
});

// --------------------------------------------------------------------------
// stroke.model — the record, and what sharing it costs
// --------------------------------------------------------------------------

describe('stroke.model', () => {
  it('stores the drawing, and the box is the drawing plus half a pen on every side', () => {
    const doc = newDoc();
    const path = letterAStrokes()[0]!;
    const id = draw(doc, path, { color: 'blue', thickness: 'thick', by: 'priya' });
    const stroke = strokeOf(doc, id);

    const box = extent(path);
    const pen = PEN_THICKNESS_WORLD.thick;

    expect(stroke.type).toBe(STROKE_OBJECT_TYPE);
    expect(stroke.color).toBe('blue');
    expect(stroke.thickness).toBe('thick');
    expect(stroke.createdBy).toBe('priya');

    // A stroke is painted *around* its points, so a box that stopped at the centreline would crop the paint at
    // the top and left of every stroke, and would sit the selection's handles on top of the drawing. Measured
    // to a thousandth of a board unit, which is the accuracy the record keeps its numbers at.
    expect(stroke.x).toBeCloseTo(box.x - pen / 2, 3);
    expect(stroke.y).toBeCloseTo(box.y - pen / 2, 3);
    expect(stroke.width).toBeCloseTo(box.width + pen, 3);
    expect(stroke.height).toBeCloseTo(box.height + pen, 3);
    // The base box is the box as it was drawn, which is the ruler every later size is measured against.
    expect(stroke.baseWidth).toBeCloseTo(stroke.width, 6);
    expect(stroke.baseHeight).toBeCloseTo(stroke.height, 6);

    // The points are stored relative to the box, which is what lets a box change without them: a resize writes
    // four numbers, and not four thousand.
    expect(stroke.points).toHaveLength(count(path) * 2);
    for (const point of scaledPoints(stroke)) {
      expect(point.x).toBeGreaterThanOrEqual(stroke.x - 0.001);
      expect(point.y).toBeGreaterThanOrEqual(stroke.y - 0.001);
    }
    // And they read back as the points that were drawn, to inside a hundredth of a board unit.
    path.forEach((point, index) => {
      const back = scaledPoints(stroke)[index]!;
      expect(Math.abs(back.x - point.x)).toBeLessThan(ROUND_TRIP);
      expect(Math.abs(back.y - point.y)).toBeLessThan(ROUND_TRIP);
    });
  });

  it('TC-07a: a stroke has a box of its own, which is what makes it movable', () => {
    const doc = newDoc();
    const id = draw(doc, handwrittenLoop());

    const reported = snapshot(doc);
    expect(reported).toHaveLength(1);
    expect(reported[0]!.type).toBe(STROKE_OBJECT_TYPE);
    expect(isStrokeSnapshot(reported[0])).toBe(true);

    // A stroke keeps its own box. An arrow's box is derived from the objects it joins, so an arrow has nothing
    // for a handle to drag; a stroke is where it was drawn, so it has a box, and a box is movable.
    expect(isDerivedBoxObjectType(STROKE_OBJECT_TYPE)).toBe(false);

    const before = strokeOf(doc, id);
    expect(moveObjects(doc, new Map([[id, { x: before.x - 40, y: before.y + 20 }]]))).toBe(1);
    const moved = strokeOf(doc, id);
    expect(moved.x).toBeCloseTo(before.x - 40, 6);
    expect(moved.y).toBeCloseTo(before.y + 20, 6);
    // Moving carries the drawing along: its points are relative to the box, and the box is what moved.
    const points = scaledPoints(moved);
    expect(points).toHaveLength(count(scaledPoints(before)));
    expect(points[0]!.x).toBeCloseTo(scaledPoints(before)[0]!.x - 40, 2);

    // The drawing kept its shape: moving an object moves it, it does not scale it. The distance between two
    // points of the drawing is the only thing a move cannot change.
    const span = (stroke: StrokeSnap) => {
      const [a, b] = scaledPoints(stroke);
      return Math.hypot(b!.x - a!.x, b!.y - a!.y);
    };
    expect(span(moved)).toBeCloseTo(span(before), 2);
  });

  it('costs exactly one transaction, and keeps the drawing faithful through the round trip', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);

    const id = draw(doc, noisySine({ count: 260 }), { color: 'purple', thickness: 'thin' });
    expect(updates()).toBe(1);

    const stroke = strokeOf(doc, id);
    expect(stroke.color).toBe('purple');
    // Nothing was resampled on the way in: what came out of the pen is what is in the record, and what is in
    // the record is what comes out again.
    expect(count(scaledPoints(stroke))).toBe(260);
    noisySine({ count: 260 }).forEach((point, index) => {
      const back = scaledPoints(stroke)[index]!;
      expect(Math.abs(back.x - point.x)).toBeLessThan(ROUND_TRIP);
      expect(Math.abs(back.y - point.y)).toBeLessThan(ROUND_TRIP);
    });
  });

  it('TC-08b: six colours, in the record rather than on the screen', () => {
    const doc = newDoc();
    const colours = Object.keys(PEN_COLORS) as PenColor[];
    expect(colours).toHaveLength(6);

    const ids = colours.map((color, index) =>
      draw(doc, straightRun(4 + index, { x: index * 50, y: 0 }, { x: index * 50 + 40, y: 30 }), { color }),
    );
    expect(new Set(ids).size).toBe(6);

    const strokes = strokeSnapshots(doc);
    expect(strokes.map((entry) => entry.color)).toEqual(colours);
    // Their stacking follows the pen: first drawn at the back, which is how a board gets drawn.
    expect(strokes.map((entry) => entry.z)).toEqual([1, 2, 3, 4, 5, 6]);

    for (const color of colours) {
      expect(isPenColor(color)).toBe(true);
      // The record stores a *name* and the screen needs a paint. A name outside the six paints the default
      // rather than nothing at all: a stroke that painted nothing would be a stroke people could not see, and
      // would still be there to click.
      expect(strokePaint(color)).toBe(PEN_COLORS[color]);
      expect(strokePaint(color)).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(strokePaint('teal')).toBe(PEN_COLORS[DEFAULT_PEN_COLOR]);
    expect(strokePaint(undefined)).toBe(PEN_COLORS[DEFAULT_PEN_COLOR]);
  });

  it('TC-08c: three thicknesses, and a stroke keeps the pen it was drawn with', () => {
    const doc = newDoc();
    expect(PEN_THICKNESS_ORDER).toEqual(['thin', 'medium', 'thick']);

    const loop = spiral({ turns: 2, perTurn: 40 });
    const ids = PEN_THICKNESS_ORDER.map((thickness) => draw(doc, loop, { thickness }));
    const strokes = ids.map((id) => strokeOf(doc, id));
    expect(strokes.map((entry) => entry.thickness)).toEqual([...PEN_THICKNESS_ORDER]);
    PEN_THICKNESS_ORDER.forEach((thickness, index) => {
      const pen = PEN_THICKNESS_WORLD[thickness];
      expect(isPenThickness(thickness)).toBe(true);
      expect(strokePenWidth(strokes[index]!)).toBe(pen);
      // A thicker pen is a taller box, by half a pen above and half below: the padding is not decoration, it
      // is why a fat stroke is not cropped by its own bounds.
      expect(strokes[index]!.height).toBeCloseTo(extent(loop).height + pen, 3);
      expect(strokes[index]!.baseHeight).toBeCloseTo(extent(loop).height + pen, 3);
    });
    // Each pen is a different width, and each is the width the settings give it: the record keeps a *name*, so
    // a change to the names on the toolbar cannot silently change the drawings people already made.
    expect(PEN_THICKNESS_WORLD.thin).toBeLessThan(PEN_THICKNESS_WORLD.medium);
    expect(PEN_THICKNESS_WORLD.medium).toBeLessThan(PEN_THICKNESS_WORLD.thick);

    // The default, for a caller with no opinion: the middle pen, which is the one the toolbar shows pressed.
    const plain = strokeOf(doc, draw(doc, loop));
    expect(plain.thickness).toBe(DEFAULT_PEN_THICKNESS);
    expect(plain.color).toBe(DEFAULT_PEN_COLOR);
    expect(strokePenWidth(plain)).toBe(PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS]);
  });

  it('reads a document it did not write: an unknown ink is drawn in the default, and its name is kept', () => {
    const doc = newDoc();
    const id = draw(doc, spiral({ turns: 1, perTurn: 30 }), { color: 'green' });
    const drawn = scaledPoints(strokeOf(doc, id));

    // A build that added a seventh ink, or a seventh nib, leaves the record of ours intact when it comes back
    // here. What falls back is what is *painted*, never what is written: the document is not rewritten to make
    // the lie tidy, because rewriting five people's documents to agree with one build's settings is how a
    // drawing loses its colour forever.
    rewrite(doc, id, { color: 'teal', thickness: 'ultra' });
    const stroke = strokeOf(doc, id);
    expect(stroke.color).toBe(DEFAULT_PEN_COLOR);
    expect(stroke.thickness).toBe(DEFAULT_PEN_THICKNESS);
    expect(strokePaint(stroke.color)).toBe(PEN_COLORS[DEFAULT_PEN_COLOR]);
    expect(strokePenWidth(stroke)).toBe(PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS]);
    expect(scaledPoints(stroke)).toHaveLength(count(drawn));
    const record = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    expect(record.get('color')).toBe('teal');
    expect(record.get('thickness')).toBe('ultra');

    // A box with nothing to scale by must not turn the drawing into `NaN`. The only honest answer left is the
    // size the drawing was drawn at, and that is the answer it gives.
    rewrite(doc, id, { baseWidth: 0, baseHeight: 0, width: 0, height: 0 });
    const unscaled = strokeOf(doc, id);
    expect(scaledPoints(unscaled)).toHaveLength(count(drawn));
    scaledPoints(unscaled).forEach((point, index) => {
      expect(point.x).toBeCloseTo(drawn[index]!.x, 2);
      expect(point.y).toBeCloseTo(drawn[index]!.y, 2);
    });
    expect(strokeHit(unscaled, drawn[0]!, 1)).toBe(true);
  });

  it('a stroke that stores no drawing is not reported as a stroke', () => {
    const doc = newDoc();
    const id = draw(doc, handwrittenLoop({ count: 30 }));

    // No position at all, and the board has nothing to place: not a stroke, not an object, not in a snapshot.
    rewrite(doc, id, { x: Number.NaN });
    expect(readStroke(doc, id)).toBeNull();
    expect(strokeSnapshots(doc)).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
    rewrite(doc, id, { x: 10, y: Number.NaN });
    expect(readStroke(doc, id)).toBeNull();

    // A drawing that cannot be read is a different matter: the record stays in the document, where a build that
    // can read it will find it, and this build declines to draw a picture it cannot place. It is not deleted on
    // the strength of one build's not understanding it.
    rewrite(doc, id, { y: 10, points: [] });
    expect(readStroke(doc, id)).toBeNull();
    expect(strokeSnapshots(doc)).toHaveLength(0);
    expect(isStrokeSnapshot(snapshot(doc)[0])).toBe(false);
    rewrite(doc, id, { points: [10, 10, Number.NaN, 20] });
    expect(readStroke(doc, id)).toBeNull();
    // A list of points with one number left over is not a list of points: the last coordinate of a drawing that
    // lost a digit on the way to somebody else's screen cannot be guessed at.
    rewrite(doc, id, { points: [1, 2, 3] });
    expect(readStroke(doc, id)).toBeNull();
    expect(strokeSnapshots(doc)).toHaveLength(0);
    expect(doc.getMap<Y.Map<unknown>>('objects').has(id)).toBe(true);
  });

  it('a letter is one stroke per lift of the pen', () => {
    const doc = newDoc();
    // Three strokes of a hand. Stored as one path this would be an A with a line drawn back up its left leg,
    // which is the mistake a drawing format that does not know about pen lifts makes.
    const ids = letterAStrokes().map((path) => draw(doc, path, { color: 'red' }));
    expect(ids).toHaveLength(3);

    const onBoard = strokeSnapshots(doc);
    expect(onBoard).toHaveLength(3);
    expect(onBoard.every((entry) => entry.color === 'red')).toBe(true);
    expect(new Set(onBoard.map((entry) => entry.id)).size).toBe(3);
    // Each letter-stroke is thinner than it is long, in the way the strokes of a letter are.
    expect(onBoard[2]!.width).toBeGreaterThan(onBoard[2]!.height);
  });

  it('one gesture that became two strokes is two objects, one transaction each', () => {
    const doc = newDoc();
    const long = longSpiral();
    const parts = splitPoints(long);
    const updates = countUpdates(doc);

    // The pen commits each part as it finishes it. One transaction each is what makes "undo takes back a
    // stroke" true of a stroke that was too long to be one stroke.
    const ids = parts.map((part) => draw(doc, part, { thickness: 'thin' }));
    expect(ids).toHaveLength(2);
    expect(updates()).toBe(2);
    // Where they join: the second part starts at the point the first one ended at, and both records say so.
    expect(lastOf(parts[0]!)).toEqual(firstOf(parts[1]!));

    const strokes = strokeSnapshots(doc);
    expect(strokes).toHaveLength(2);
    for (const stroke of strokes) expect(count(scaledPoints(stroke))).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    // Together they are everything that was drawn, and neither one is a drawing that had been cut short.
    expect(strokes.reduce((total, stroke) => total + count(scaledPoints(stroke)), 0)).toBe(count(long) + 1);
  });

  it('undoing a stroke takes that stroke and none of the strokes beside it', () => {
    const doc = newDoc();
    // The undo manager is opened before the strokes are drawn, because it can only take back what it saw: an
    // undo history starts where it starts, which is the same reason the app opens one at load.
    const manager = new Y.UndoManager(doc.getMap<Y.Map<unknown>>('objects'), {
      captureTimeout: 0,
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    });
    const letters = letterAStrokes().map((path) => draw(doc, path));

    // `undo()` answers whether there was anything of mine to take back, which is what the board's own undo
    // controller asks too: a step that did nothing visibly is still a step, and the next undo has to carry on
    // from where this one ended.
    expect(manager.undo()).not.toBeNull();
    expect(strokeSnapshots(doc).map((entry) => entry.id)).toEqual(letters.slice(0, 2));
    expect(snapshot(doc)).toHaveLength(2);

    expect(manager.redo()).not.toBeNull();
    expect(strokeSnapshots(doc)).toHaveLength(3);
    manager.destroy();
  });

  it('a stroke survives the round trip to another document, which is what sharing it is', () => {
    const here = newDoc();
    const id = draw(here, zigzag({ corners: 4, perRun: 20 }), { color: 'orange', thickness: 'thick' });

    const there = new Y.Doc();
    initDoc(there);
    Y.applyUpdate(there, Y.encodeStateAsUpdate(here));

    const shared = readStroke(there, id);
    expect(shared).not.toBeNull();
    expect(shared!.color).toBe('orange');
    expect(shared!.thickness).toBe('thick');
    expect(count(scaledPoints(shared!))).toBe(count(zigzag({ corners: 4, perRun: 20 })));
    expect(scaledPoints(shared!)[0]!.x).toBeCloseTo(scaledPoints(strokeOf(here, id))[0]!.x, 3);
    expect(strokeSnapshots(there)).toHaveLength(1);
  });
});
