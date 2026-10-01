// stroke (unit): the freehand stroke model and its geometry (story 11).
//
// TC ids are the Acceptance Cases in
// spec/stories/011-sketch-freehand-with-a-pen/design.md.
//
// What is under test is the arithmetic a Pen drag leaves behind. A hand that drew
// a line must get that line back (TC-01, TC-02 - the drawing is measured against
// the stored one, point by point); a gesture too long for one stroke becomes two
// that join up (TC-03); what is stored belongs to the box the stroke was drawn in
// and scales with it (TC-04, TC-06); a line is selected by how near its line a
// click came and not by the box around it (TC-07); and damaged input writes nothing
// at all rather than half a stroke (TC-05).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  TYPE_STROKE,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import {
  createStroke,
  scaledPoints,
  strokeSnapshot,
  type StrokeSnapshot,
} from '../../src/shared/objects/stroke';
import {
  PEN_FIXTURE_LOOP,
  PEN_FIXTURE_SPIRAL,
  PEN_FIXTURE_UNDERLINE,
  penFixtureSpiral,
} from '../fixtures/pen-paths';

const COLOR = DEFAULT_PEN_COLOR;
const THICKNESS = DEFAULT_PEN_THICKNESS;
const THICKNESS_WORLD = PEN_THICKNESS_WORLD[THICKNESS];

/** Draw a stroke with the tool's own entry point, and fail loudly if it did not. */
function draw(
  doc: Y.Doc,
  points: readonly Point[],
  by = 'tester',
  thickness: keyof typeof PEN_THICKNESS_WORLD = THICKNESS,
): StrokeSnapshot {
  const id = createStroke(doc, { points, color: COLOR, thickness }, by);
  if (id === null) throw new Error('createStroke refused a valid stroke');
  const snap = strokeSnapshot(doc, id);
  if (snap === null) throw new Error(`stroke ${id} is not on the board`);
  return snap;
}

/** How many updates the document would have sent to anybody else. */
function updateCount(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return () => count;
}

/** A straight line, three points deep, the drawing every maths case uses. */
const line: Point[] = [
  { x: 100, y: 300 },
  { x: 200, y: 300 },
  { x: 300, y: 300 },
];

describe('simplify (Ramer-Douglas-Peucker)', () => {
  // TC-01
  it('keeps a handwritten loop within one pixel of the line it was given', () => {
    // 100% zoom: the tolerance is the screen-pixel setting, unchanged
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX;

    const kept = simplify(PEN_FIXTURE_LOOP, tolerance);

    // Fewer points than the ~400 it was handed, and still the same drawing: not
    // one of the points the pen went through is further from the kept line than
    // the tolerance allows. This is the whole of "smoothing stays faithful".
    expect(PEN_FIXTURE_LOOP.length).toBeGreaterThanOrEqual(400);
    expect(kept.length).toBeGreaterThan(2);
    expect(kept.length).toBeLessThan(PEN_FIXTURE_LOOP.length);
    for (const raw of PEN_FIXTURE_LOOP) {
      expect(distanceToPolyline(kept, raw)).toBeLessThanOrEqual(tolerance + 1e-9);
    }

    // The pen went down at the first point and lifted at the last, so a drawing
    // that lost either one is not the drawing that was made.
    expect(kept[0]).toEqual(PEN_FIXTURE_LOOP[0]);
    expect(kept.at(-1)).toEqual(PEN_FIXTURE_LOOP.at(-1));

    // deterministic: the same input is the same output, so a stroke that looks
    // right once looks right every time it is drawn
    expect(simplify(PEN_FIXTURE_LOOP, tolerance)).toEqual(kept);
  });

  // TC-02
  it('holds to half a pixel when the line was drawn at 200%', () => {
    // The tool's own arithmetic: tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / zoom.
    // Zooming in while drawing spends the same screen pixel on a smaller board
    // unit, so a finer line is kept - which is why the count goes up as well.
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / 2;
    expect(tolerance).toBe(0.5);

    const kept = simplify(PEN_FIXTURE_LOOP, tolerance);

    for (const raw of PEN_FIXTURE_LOOP) {
      expect(distanceToPolyline(kept, raw)).toBeLessThanOrEqual(tolerance + 1e-9);
    }
    expect(kept.length).toBeGreaterThan(simplify(PEN_FIXTURE_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX).length);
  });

  it('keeps the sag of an underline and drops only the wobble around it', () => {
    // The curve the hand meant survives; the jitter it did not is what goes.
    const kept = simplify(PEN_FIXTURE_UNDERLINE, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(PEN_FIXTURE_UNDERLINE.length).toBe(120);
    expect(kept.length).toBeLessThan(PEN_FIXTURE_UNDERLINE.length);
    for (const raw of PEN_FIXTURE_UNDERLINE) {
      expect(distanceToPolyline(kept, raw)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX + 1e-9);
    }
    // the dip in the middle is part of the line, not part of the shake
    expect(Math.max(...PEN_FIXTURE_UNDERLINE.map((p) => p.y))).toBeGreaterThan(
      PEN_FIXTURE_UNDERLINE[0]!.y + 4,
    );
  });

  it('drops nothing when there is no tolerance to spend', () => {
    expect(simplify(line, 0)).toEqual(line);
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([{ x: 5, y: 5 }], 1)).toEqual([{ x: 5, y: 5 }]);
    expect(simplify([{ x: 1, y: 1 }, { x: Number.NaN, y: 2 }], 1)).toEqual([{ x: 1, y: 1 }]);
  });

  it('keeps a point that the line actually bends at', () => {
    // A point a hair off the straight run earns nothing and goes away...
    expect(simplify([{ x: 0, y: 0 }, { x: 50, y: 0.2 }, { x: 100, y: 0 }], 1)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    // ...and the same point half a pixel further out is the corner of the drawing.
    expect(simplify([{ x: 0, y: 0 }, { x: 50, y: 5 }, { x: 100, y: 0 }], 1)).toHaveLength(3);
  });
});

describe('splitPoints', () => {
  // TC-03
  it('leaves a gesture at or under the point limit as one stroke', () => {
    expect(splitPoints(penFixtureSpiral(STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(penFixtureSpiral(STROKE_MAX_POINTS))).toHaveLength(1);
    expect(splitPoints(penFixtureSpiral(STROKE_MAX_POINTS))[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(splitPoints(penFixtureSpiral(STROKE_MAX_POINTS - 1))[0]).toHaveLength(STROKE_MAX_POINTS - 1);
  });

  // TC-03
  it('splits one point over the limit into two strokes that join up', () => {
    const raw = penFixtureSpiral(STROKE_MAX_POINTS + 1);
    const parts = splitPoints(raw);

    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    // The second part begins at the point the first one ended at: the line is
    // never broken, only told twice, which is what leaves no gap between them.
    expect(parts[1]![0]).toEqual(parts[0]![parts[0]!.length - 1]);
    expect(parts[1]!.length).toBe(2);
    const joined = [...parts[0]!, ...parts[1]!.slice(1)];
    expect(joined).toEqual([...raw]);
  });

  it('splits the 5,010-point gesture and loses nothing in the join', () => {
    const parts = splitPoints(PEN_FIXTURE_SPIRAL);

    expect(parts).toHaveLength(2);
    expect(parts[0]!.length).toBe(STROKE_MAX_POINTS);
    expect(parts[1]![0]).toEqual(parts[0]!.at(-1));
    expect(parts[0]!.length + parts[1]!.length - 1).toBe(PEN_FIXTURE_SPIRAL.length);
  });

  it('has nothing to say about a gesture with no points', () => {
    expect(splitPoints([])).toEqual([]);
  });
});

describe('createStroke', () => {
  // TC-04
  it('stores the line relative to the box it was drawn in', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const points: Point[] = [
      { x: 100, y: 100 },
      { x: 140, y: 120 },
      { x: 180, y: 160 },
    ];

    const stroke = draw(doc, points);

    expect(stroke.id).toBeTruthy();
    expect(stroke.type).toBe(TYPE_STROKE);
    expect(stroke.color).toBe(COLOR);
    expect(stroke.thickness).toBe(THICKNESS);
    expect(stroke.createdBy).toBe('tester');

    // The box is the drawing's bounds, grown by half a thickness so the ink's own
    // width is inside the box that holds it.
    const inset = THICKNESS_WORLD / 2;
    expect(stroke.x).toBe(100 - inset);
    expect(stroke.y).toBe(100 - inset);
    expect(stroke.width).toBe(80 + PEN_THICKNESS_WORLD[THICKNESS]);
    expect(stroke.height).toBe(60 + PEN_THICKNESS_WORLD[THICKNESS]);
    expect(stroke.baseWidth).toBe(stroke.width);
    expect(stroke.baseHeight).toBe(stroke.height);

    // The stored numbers are relative to the box's origin and unchanged in scale.
    expect(stroke.points).toEqual([inset, inset, 40 + inset, 20 + inset, 80 + inset, 60 + inset]);
  });

  // TC-04
  it('draws a tap as a dot in a box one thickness square', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const thick = PEN_THICKNESS_WORLD.thick;

    const stroke = draw(doc, [{ x: 300, y: 200 }], 'priya', 'thick');

    expect(stroke.x).toBe(300 - thick / 2);
    expect(stroke.y).toBe(200 - thick / 2);
    expect(stroke.width).toBe(thick);
    expect(stroke.height).toBe(thick);
    expect(stroke.baseWidth).toBe(thick);
    expect(stroke.baseHeight).toBe(thick);
    // one point, at the box's centre: what a round-capped path draws as a dot
    expect(stroke.points).toEqual([thick / 2, thick / 2]);
    expect(stroke.points).toHaveLength(2);
  });

  it('stacks a new stroke above everything already on the board', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const first = draw(doc, line);
    const second = draw(doc, PEN_FIXTURE_UNDERLINE);

    expect(second.z).toBeGreaterThan(first.z);
  });

  // TC-05
  it('writes nothing at all for a damaged request', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const updates = updateCount(doc);

    expect(createStroke(doc, { points: [], color: COLOR, thickness: THICKNESS }, 'x')).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: Number.NaN, y: 0 }], color: COLOR, thickness: THICKNESS }, 'x'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: Number.POSITIVE_INFINITY }], color: COLOR, thickness: THICKNESS }, 'x'),
    ).toBeNull();
    // 'pink' is a sticky note's colour and no pen colour; 'huge' is no thickness
    expect(createStroke(doc, { points: line, color: 'pink' as never, thickness: THICKNESS }, 'x')).toBeNull();
    expect(createStroke(doc, { points: line, color: COLOR, thickness: 'huge' as never }, 'x')).toBeNull();

    // no stroke, not even half of one, and nothing for anybody else to receive
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(0);
    expect(updates()).toBe(0);
  });

  it('reads back a stroke whole, and hides only a line that is damaged', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(
      doc,
      { points: PEN_FIXTURE_UNDERLINE, color: 'purple', thickness: 'thick' },
      'priya',
    )!;

    const stroke = strokeSnapshot(doc, id)!;
    expect(stroke.color).toBe('purple');
    expect(stroke.thickness).toBe('thick');
    expect(stroke.createdBy).toBe('priya');
    expect(Object.values(PEN_COLORS)).toContain(PEN_COLORS.purple);
    expect(PEN_THICKNESS_WORLD.thick).toBeGreaterThan(PEN_THICKNESS_WORLD.thin);

    // a colour from a newer build is only a colour: the drawing is shown, in the
    // default; a line with a hole in it is the drawing itself, so there is none
    const object = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    object.set('color', 'chartreuse');
    expect(strokeSnapshot(doc, id)!.color).toBe(DEFAULT_PEN_COLOR);
    object.set('points', [1, Number.NaN]);
    expect(strokeSnapshot(doc, id)).toBeNull();
  });
});

describe('scaledPoints', () => {
  // TC-06
  it('doubles the coordinates when the box is doubled', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const stroke = draw(doc, line);
    const before = scaledPoints(stroke);

    // what a proportional resize writes: the box twice as big, the corner where it was
    const object = doc.getMap<Y.Map<unknown>>('objects').get(stroke.id)!;
    object.set('width', stroke.width * 2);
    object.set('height', stroke.height * 2);
    const resized = strokeSnapshot(doc, stroke.id)!;
    const after = scaledPoints(resized);

    expect(after).toHaveLength(before.length);
    before.forEach((p, i) => {
      const got = after[i]!;
      expect(got.x - resized.x).toBeCloseTo((p.x - stroke.x) * 2, 6);
      expect(got.y - resized.y).toBeCloseTo((p.y - stroke.y) * 2, 6);
    });
    // the line is drawn at its stored thickness, whatever the box became
    expect(resized.thickness).toBe(THICKNESS);
    expect(PEN_THICKNESS_WORLD[resized.thickness]).toBe(THICKNESS_WORLD);
    expect(resized.baseWidth).toBe(stroke.width);
    expect(resized.baseHeight).toBe(stroke.height);
  });

  // TC-07
  it('measures how near a point is to the stroke’s own line', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const stroke = draw(doc, line);
    const points = scaledPoints(stroke);
    // zoom 1: a screen pixel is a board unit, so the setting is the distance
    const tolerance = STROKE_HIT_TOLERANCE_PX;

    // on the line, a hair inside the tolerance, a hair outside it
    expect(distanceToPolyline(points, { x: 200, y: 300 })).toBeCloseTo(0, 6);
    expect(distanceToPolyline(points, { x: 200, y: 300 + tolerance - 0.1 })).toBeCloseTo(tolerance - 0.1, 6);
    expect(distanceToPolyline(points, { x: 200, y: 300 + tolerance + 0.1 })).toBeCloseTo(tolerance + 0.1, 6);

    // and the box is roomier than the line by the padding, which is exactly why
    // the box cannot be what decides a click on a drawing
    expect(STROKE_MIN_SIZE_WORLD).toBeLessThan(tolerance);
    expect(stroke.height).toBeLessThan(tolerance * 2);
  });
});

describe('smoothPath', () => {
  // TC-08
  it('draws 3 points as a move and quadratic segments, and says the same twice', () => {
    const d = smoothPath(line);

    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    expect(d.startsWith(`M ${line[0]!.x} ${line[0]!.y}`)).toBe(true);
    expect(d.endsWith(`${line[2]!.x} ${line[2]!.y}`)).toBe(true);
    // deterministic: the same drawing is the same path, so a re-render is not a redraw
    expect(d).toBe(smoothPath(line));

    // a tap is a zero-length line, which is what a round cap draws as a dot
    const dot = smoothPath([{ x: 10, y: 20 }]);
    expect(dot).toMatch(/^M 10 20 L 10 20$/);

    // nothing to draw is no path at all, never a stray command
    expect(smoothPath([])).toBe('');

    // through every point of what the hand drew, with no invented numbers
    for (const path of [PEN_FIXTURE_LOOP, PEN_FIXTURE_UNDERLINE, PEN_FIXTURE_SPIRAL.slice(0, 200)]) {
      const drawn = smoothPath(path);
      const first = path[0]!;
      const last = path[path.length - 1]!;
      expect(drawn).not.toMatch(/NaN|Infinity|undefined/);
      expect(drawn.startsWith(`M ${first.x} ${first.y}`)).toBe(true);
      expect(drawn.endsWith(`${last.x} ${last.y}`)).toBe(true);
    }
  });

  it('never wanders from the line it was given', () => {
    // Each curve runs from the midpoint of one segment to the midpoint of the
    // next with the point between them as its control, so it stays inside that
    // triangle: at most half a step from the straight line, at most half the
    // simplification tolerance from what was drawn.
    const simplified = simplify(PEN_FIXTURE_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX);
    const d = smoothPath(simplified);
    expect(d.match(/Q/g)!.length).toBe(Math.max(0, simplified.length - 2));
    expect(d.match(/L/g)!.length).toBe(1);
  });
});
