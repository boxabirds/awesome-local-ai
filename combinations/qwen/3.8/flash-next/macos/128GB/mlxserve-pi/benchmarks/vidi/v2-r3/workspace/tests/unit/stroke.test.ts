// stroke.model unit tests (TC-01 … TC-08) against a REAL Y.Doc.
//
// Two separate things are under test here and they are tested differently.
//
// The geometry (`simplify`, `splitPoints`, `smoothPath`) is maths with a promise
// attached to it: that a simplified stroke stays within a stated distance of the
// path the pointer actually took. So the assertions are about that promise, and on
// paths a hand actually drew — a loop and an underline — rather than on a straight
// line, which is the one path a simplifier finds easy and so proves nothing.
//
// The model (`createStroke`, `scaledPoints`) is Yjs behaviour: a rejected stroke
// must emit no update at all — not an empty one, not a rolled-back one — and an
// accepted one must be readable back through the board's own snapshot, because
// that snapshot and nothing else is what another person sees.
import { describe, expect, it, beforeEach } from 'vitest';
import { Doc } from 'yjs';
import {
  createStroke,
  scaledPoints,
  strokeHitTest,
  type StrokeSnapshot,
} from '../../src/shared/objects/stroke';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { initDoc, resizeObjects, snapshotAll } from '../../src/shared/board-model';
import { handwrittenLoop, spiral, underline } from '../fixtures/pen-paths';
import type { Point } from '../../src/shared/geometry';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';

/** The furthest any raw point sits from a polyline: the distance `simplify` swore
 *  it would keep the drawing within. */
function deviation(raw: readonly Point[], result: readonly Point[]): number {
  let worst = 0;
  for (const point of raw) worst = Math.max(worst, distanceToPolyline(point, result));
  return worst;
}

/** Counts the `update` events a doc emits: none at all is the whole of
 *  "wrote nothing, opened no transaction". */
function updateCounter(doc: Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count++;
  });
  return () => count;
}

function newDoc(): Doc {
  const doc = new Doc();
  initDoc(doc);
  return doc;
}

/** The stroke under `id`, read back the way the board reads it. */
function strokeOf(doc: Doc, id: string): StrokeSnapshot {
  const object = snapshotAll(doc).find((entry) => entry.id === id);
  if (object === undefined || object.type !== 'stroke') throw new Error(`stroke ${id} is not on the board`);
  return object;
}

const at = (x: number, y: number): Point => ({ x, y });

/** The numbers a path names, in the order it names them. */
function numbersIn(path: string): number[] {
  return path.split(/[^0-9.eE+-]+/).filter((part) => part !== '').map(Number);
}

let doc: Doc;
let updates: () => number;

beforeEach(() => {
  doc = newDoc();
  updates = updateCounter(doc);
});

/* ── TC-01, TC-02: smoothing stays faithful ───────────────────────────── */

describe('simplify', () => {
  it('TC-01 keeps a handwritten loop within one unit of the path that was drawn', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);

    // The promise: nothing the hand drew is further from the line than the tolerance.
    expect(deviation(raw, result)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX + 1e-9);
    // And it did put something down, or the promise would be worth nothing.
    expect(result.length).toBeLessThan(raw.length);
    // The ends belong to whoever drew: a stroke's line starts where the pointer went
    // down and ends where it came up, and no amount of tidying moves those two.
    expect(result[0]).toEqual(raw[0]);
    expect(result[result.length - 1]).toEqual(raw[raw.length - 1]);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('TC-01 holds on an underline too, where nearly every point is redundant', () => {
    const raw = underline();
    const result = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(deviation(raw, result)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX + 1e-9);
    expect(result.length).toBeLessThan(raw.length);
  });

  it('TC-02 keeps the same loop within half a unit at 200 %, where the tolerance is halved', () => {
    // What the tool asks for is STROKE_SIMPLIFY_TOLERANCE_PX / zoom; at zoom 2 that is 0.5.
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / 2;
    const raw = handwrittenLoop();
    const result = simplify(raw, tolerance);

    expect(deviation(raw, result)).toBeLessThanOrEqual(tolerance + 1e-9);
    // A tighter tolerance keeps strictly more of the drawing than a looser one:
    // fidelity is bought with points, and the drawing was faithful at both.
    expect(result.length).toBeGreaterThan(simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX).length);
  });

  it('leaves a path with nothing to spare exactly as it was drawn', () => {
    const triangle = [at(0, 0), at(10, 4), at(20, 0)];
    expect(simplify(triangle, 0.5)).toEqual(triangle);
    expect(simplify([at(1, 2)], 1)).toEqual([at(1, 2)]);
    expect(simplify([], 1)).toEqual([]);
  });

  it('drops a point that was only a hand shaking', () => {
    const drawn = [at(0, 0), at(5, 0.2), at(10, -0.2), at(15, 0.1), at(20, 0)];
    expect(simplify(drawn, 1)).toEqual([at(0, 0), at(20, 0)]);
  });

  it('survives a path longer than a recursive one would', () => {
    // All of STROKE_MAX_POINTS and then some: the longest stroke the product allows
    // is the length a simplifier that recursed once per point would blow its stack.
    const many = spiral(STROKE_MAX_POINTS + 10);
    const result = simplify(many, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(result.length).toBeGreaterThan(1);
    expect(result.length).toBeLessThan(many.length);
    expect(result[0]).toEqual(many[0]);
    expect(result[result.length - 1]).toEqual(many[many.length - 1]);
  });

  it('treats a tolerance of nothing as a request for the drawing itself', () => {
    const raw = handwrittenLoop();
    expect(simplify(raw, 0)).toEqual(raw);
  });
});

/* ── TC-03: the point limit, on both sides of it ──────────────────────── */

describe('splitPoints', () => {
  const long = spiral(STROKE_MAX_POINTS + 10);

  it('TC-03 leaves one point below the limit as a single part', () => {
    const parts = splitPoints(long.slice(0, STROKE_MAX_POINTS - 1));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS - 1);
  });

  it('TC-03 leaves the limit itself as a single part, which is the boundary', () => {
    const parts = splitPoints(long.slice(0, STROKE_MAX_POINTS));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[0]![STROKE_MAX_POINTS - 1]).toEqual(long[STROKE_MAX_POINTS - 1]);
  });

  it('TC-03 splits one point past the limit into two parts sharing their join', () => {
    const parts = splitPoints(long.slice(0, STROKE_MAX_POINTS + 1));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    // The join: the second part starts where the first one ended, so on the board
    // the two strokes meet and there is no gap nobody drew.
    expect(parts[1]![0]).toEqual(parts[0]![STROKE_MAX_POINTS - 1]);
    expect(parts[1]).toHaveLength(2);
  });

  it('keeps every point across the parts, joined one after the other', () => {
    const parts = splitPoints(long, 1000);
    expect(parts).toHaveLength(Math.ceil((STROKE_MAX_POINTS + 10) / 1000));
    const rejoined = parts.flatMap((part, index) => (index === 0 ? part : part.slice(1)));
    expect(rejoined).toHaveLength(long.length);
    expect(rejoined).toEqual([...long]);
  });

  it('answers a path with no points with no parts at all', () => {
    expect(splitPoints([])).toEqual([]);
  });
});

/* ── TC-04: a click is a dot ──────────────────────────────────────────── */

describe('createStroke with one point', () => {
  it('TC-04 makes a square the size of the thickness and stores one point', () => {
    const id = createStroke(doc, { points: [at(300, 200)], color: 'black', thickness: 'thick' }, 'me');
    expect(id).not.toBeNull();
    const stroke = strokeOf(doc, id!);
    const size = PEN_THICKNESS_WORLD.thick;

    expect(stroke.type).toBe('stroke');
    expect(stroke.width).toBe(size);
    expect(stroke.height).toBe(size);
    // Centred on the point that was pressed, which is all a dot is.
    expect(stroke.x).toBe(300 - size / 2);
    expect(stroke.y).toBe(200 - size / 2);
    // One point, flattened to two numbers, relative to the box it is drawn in.
    expect(stroke.points).toHaveLength(2);
    expect(stroke.points).toEqual([size / 2, size / 2]);
    expect(stroke.baseWidth).toBe(size);
    expect(stroke.baseHeight).toBe(size);
    expect(stroke.thickness).toBe('thick');
    expect(stroke.color).toBe('black');
    expect(stroke.createdBy).toBe('me');
  });

  it('leaves the dot half a thickness from every edge of its box, at any thickness', () => {
    for (const thickness of Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]) {
      const id = createStroke(doc, { points: [at(0, 0)], color: 'black', thickness }, 'me');
      const stroke = strokeOf(doc, id!);
      const size = PEN_THICKNESS_WORLD[thickness];
      // So that the round cap of a zero-length path fills the box and no more.
      expect(stroke.points).toEqual([size / 2, size / 2]);
      expect(stroke.width).toBe(size);
      expect(stroke.height).toBe(size);
    }
  });
});

/* ── TC-05: nothing worth storing writes nothing ──────────────────────── */

describe('createStroke rejects', () => {
  const good = {
    points: [at(0, 0), at(40, 20)],
    color: 'black' as PenColor,
    thickness: 'medium' as PenThickness,
  };

  it('TC-05 refuses every unusable stroke and opens no transaction for any of them', () => {
    const cases: { label: string; input: unknown }[] = [
      { label: 'no points', input: { ...good, points: [] } },
      { label: 'a NaN coordinate', input: { ...good, points: [at(0, 0), at(Number.NaN, 3)] } },
      { label: 'an Infinity coordinate', input: { ...good, points: [at(0, 0), at(Number.POSITIVE_INFINITY, 3)] } },
      { label: 'a missing coordinate', input: { ...good, points: [{ x: 1 } as unknown as Point] } },
      { label: 'a colour it does not have', input: { ...good, color: 'pink' } },
      { label: 'a thickness it does not have', input: { ...good, thickness: 'huge' } },
      { label: 'no colour at all', input: { ...good, color: undefined } },
      { label: 'no points at all', input: { ...good, points: undefined } },
      { label: 'a point that is not a point', input: { ...good, points: ['nope' as unknown as Point] } },
    ];

    for (const testCase of cases) {
      const before = updates();
      expect(createStroke(doc, testCase.input as never), testCase.label).toBeNull();
      expect(updates(), `${testCase.label} wrote to the document`).toBe(before);
    }
    expect(snapshotAll(doc)).toEqual([]);
  });

  it('writes exactly one update for a stroke it accepts', () => {
    const before = updates();
    expect(createStroke(doc, good, 'me')).not.toBeNull();
    expect(updates()).toBe(before + 1);
    expect(snapshotAll(doc)).toHaveLength(1);
  });

  it('pads the box by half the thickness, so a thick line is not clipped', () => {
    const id = createStroke(doc, { points: [at(10, 10), at(50, 30)], color: 'black', thickness: 'medium' }, 'me');
    const stroke = strokeOf(doc, id!);
    const half = PEN_THICKNESS_WORLD.medium / 2;
    expect(stroke.x).toBe(10 - half);
    expect(stroke.y).toBe(10 - half);
    expect(stroke.width).toBe(40 + PEN_THICKNESS_WORLD.medium);
    expect(stroke.height).toBe(20 + PEN_THICKNESS_WORLD.medium);
    expect(stroke.baseWidth).toBe(stroke.width);
    expect(stroke.baseHeight).toBe(stroke.height);
    expect(stroke.points).toEqual([half, half, 40 + half, 20 + half]);
  });

  it('stacks each new stroke above everything already on the board', () => {
    const first = createStroke(doc, good, 'me');
    const second = createStroke(doc, { ...good, points: [at(1, 1), at(9, 9)] }, 'me');
    expect(strokeOf(doc, first!).z).toBe(1);
    expect(strokeOf(doc, second!).z).toBe(2);
  });
});

/* ── TC-06: a resize scales the drawing, not the pen ──────────────────── */

describe('scaledPoints', () => {
  it('TC-06 doubles the coordinates when the box doubles, and leaves the pen alone', () => {
    // A stroke whose box begins at the board origin, so "doubled" has one meaning.
    const id = createStroke(doc, { points: [at(1, 1), at(61, 41)], color: 'red', thickness: 'thin' }, 'me');
    const before = strokeOf(doc, id!);
    const original = scaledPoints(before);

    resizeObjects(doc, new Map([[id!, { ...before, width: before.width * 2, height: before.height * 2 }]]));
    const after = strokeOf(doc, id!);
    const scaled = scaledPoints(after);

    expect(after.width).toBe(before.width * 2);
    expect(scaled).toHaveLength(original.length);
    for (let index = 0; index < original.length; index++) {
      expect(scaled[index]!.x).toBeCloseTo(original[index]!.x * 2, 6);
      expect(scaled[index]!.y).toBeCloseTo(original[index]!.y * 2, 6);
    }
    // What was drawn with a thin pen is still a thin line: the resize scaled the
    // drawing, and nobody asked it to scale the pen.
    expect(after.thickness).toBe('thin');
    expect(PEN_THICKNESS_WORLD[after.thickness]).toBe(PEN_THICKNESS_WORLD.thin);
  });

  it('scales the two directions separately, which is how the box was dragged', () => {
    const id = createStroke(doc, { points: [at(0, 0), at(20, 10)], color: 'black', thickness: 'medium' }, 'me');
    const before = strokeOf(doc, id!);
    resizeObjects(doc, new Map([[id!, { ...before, width: before.width * 3, height: before.height / 2 }]]));
    const scaled = scaledPoints(strokeOf(doc, id!));
    const half = PEN_THICKNESS_WORLD.medium / 2;
    expect(scaled[1]!.x).toBeCloseTo((20 + half) * 3 - half, 6);
    expect(scaled[1]!.y).toBeCloseTo((10 + half) / 2 - half, 6);
  });

  it('answers with the drawing as it was when nothing has been resized', () => {
    const id = createStroke(doc, { points: [at(5, 5), at(45, 25)], color: 'black', thickness: 'medium' }, 'me');
    expect(scaledPoints(strokeOf(doc, id!))).toEqual([at(5, 5), at(45, 25)]);
  });
});

/* ── TC-07: how near the line a click has to be ───────────────────────── */

describe('hit distance', () => {
  it('TC-07 is on the line at 0 units, on it at 5.9 and off it at 6.1', () => {
    const id = createStroke(doc, { points: [at(0, 0), at(100, 0)], color: 'black', thickness: 'medium' }, 'me');
    const stroke = strokeOf(doc, id!);
    const line = scaledPoints(stroke);

    expect(distanceToPolyline(at(50, 0), line)).toBe(0);
    expect(strokeHitTest(stroke, at(50, 5.9), 1)).toBe(true);
    expect(strokeHitTest(stroke, at(50, 6.1), 1)).toBe(false);
    expect(STROKE_HIT_TOLERANCE_PX).toBe(6);
  });

  it('keeps the corridor six screen pixels wide whatever the zoom', () => {
    const id = createStroke(doc, { points: [at(0, 0), at(100, 0)], color: 'black', thickness: 'medium' }, 'me');
    const stroke = strokeOf(doc, id!);
    // At 200 % six screen pixels are three board units; at 50 % they are twelve.
    expect(strokeHitTest(stroke, at(50, 2.9), 2)).toBe(true);
    expect(strokeHitTest(stroke, at(50, 3.1), 2)).toBe(false);
    expect(strokeHitTest(stroke, at(50, 11.9), 0.5)).toBe(true);
    expect(strokeHitTest(stroke, at(50, 12.1), 0.5)).toBe(false);
  });

  it('never asks for less than half its own thickness, which is wider than the corridor already', () => {
    const id = createStroke(doc, { points: [at(0, 0), at(100, 0)], color: 'black', thickness: 'thick' }, 'me');
    const stroke = strokeOf(doc, id!);
    // Half a thick line is 4 units and six screen pixels at 200 % is only 3, so the
    // line's own body is the wider of the two: a click inside it is on it.
    expect(strokeHitTest(stroke, at(50, 3.5), 2)).toBe(true);
    expect(strokeHitTest(stroke, at(50, 4.5), 2)).toBe(false);
  });

  it('says nothing is near a stroke with no points to be near', () => {
    const stroke: StrokeSnapshot = {
      id: 'x',
      type: 'stroke',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      z: 1,
      createdAt: 0,
      points: [],
      baseWidth: 10,
      baseHeight: 10,
      color: DEFAULT_PEN_COLOR,
      thickness: DEFAULT_PEN_THICKNESS,
    };
    expect(strokeHitTest(stroke, at(0, 0), 1)).toBe(false);
  });
});

/* ── TC-08: the path a stroke is drawn with ───────────────────────────── */

describe('smoothPath', () => {
  it('TC-08 draws three points as a move and quadratic segments, identically every time', () => {
    const points = [at(0, 0), at(10, 10), at(20, 0)];
    const path = smoothPath(points);

    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('Q');
    // Deterministic: the same points, the same string, because a path that differed
    // between two reads would be a stroke that differed between two screens.
    expect(smoothPath(points)).toBe(path);
    // And it finishes at the last point drawn to: a stroke that stopped short of it
    // would end somewhere the pointer never was.
    expect(path.endsWith('L20,0')).toBe(true);
  });

  it('draws a single point as a path of no length, which a round cap makes into a dot', () => {
    expect(smoothPath([at(3, 4)])).toBe('M3,4L3,4');
  });

  it('draws two points as a straight line, there being no midpoint to bend through', () => {
    expect(smoothPath([at(0, 0), at(6, 8)])).toBe('M0,0L6,8');
  });

  it('draws nothing for no points, which is the only honest answer', () => {
    expect(smoothPath([])).toBe('');
  });

  it('bends through the midpoint of every pair, and names no other place', () => {
    const points = [at(0, 0), at(10, 10), at(20, 0), at(30, 10)];
    const path = smoothPath(points);
    const legal = new Set<number>();
    for (let index = 0; index + 1 < points.length; index++) {
      legal.add((points[index]!.x + points[index + 1]!.x) / 2);
      legal.add((points[index]!.y + points[index + 1]!.y) / 2);
    }
    for (const point of points) {
      legal.add(point.x);
      legal.add(point.y);
    }
    // Every coordinate the path names is a drawn point or a midpoint between two of
    // them, which is what keeps the curve inside their hull and so within the
    // tolerance the simplification already kept it inside.
    expect(numbersIn(path).every((value) => legal.has(value))).toBe(true);
    // Every drawn point is named once, every gap between two of them names their
    // midpoint, and the two ends are named again where the line begins and finishes.
    expect(numbersIn(path)).toHaveLength(4 * points.length - 4);
  });

  it('names every one of the points it was handed, in the order it was handed them', () => {
    const points = simplify(handwrittenLoop(), STROKE_SIMPLIFY_TOLERANCE_PX);
    const path = smoothPath(points);
    const numbers = numbersIn(path);
    expect(numbers.slice(0, 2)).toEqual([points[0]!.x, points[0]!.y]);
    expect(numbers.slice(-2)).toEqual([
      points[points.length - 1]!.x,
      points[points.length - 1]!.y,
    ]);
  });
});

/* ── the settings this story adds, as the board's own numbers ─────────── */

describe('the pen settings', () => {
  it('offers six colours and three thicknesses, with defaults among them', () => {
    expect(Object.keys(PEN_COLORS)).toHaveLength(6);
    expect(Object.keys(PEN_THICKNESS_WORLD)).toEqual(['thin', 'medium', 'thick']);
    expect(PEN_COLORS[DEFAULT_PEN_COLOR]).toBe('#212121');
    expect(PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS]).toBe(4);
    expect(PEN_THICKNESS_WORLD.thin).toBeLessThan(PEN_THICKNESS_WORLD.medium);
    expect(PEN_THICKNESS_WORLD.medium).toBeLessThan(PEN_THICKNESS_WORLD.thick);
  });

  it('states the tolerance, the limit, the corridor and the minimum size', () => {
    expect(STROKE_SIMPLIFY_TOLERANCE_PX).toBe(1);
    expect(STROKE_MAX_POINTS).toBe(5000);
    expect(STROKE_HIT_TOLERANCE_PX).toBe(6);
    expect(STROKE_MIN_SIZE_WORLD).toBe(4);
    // A stroke's box is allowed to be far smaller than a note's, because the box is
    // around a drawing rather than being one.
    expect(STROKE_MIN_SIZE_WORLD).toBeLessThan(STICKY_MIN_SIZE_WORLD);
  });
});
