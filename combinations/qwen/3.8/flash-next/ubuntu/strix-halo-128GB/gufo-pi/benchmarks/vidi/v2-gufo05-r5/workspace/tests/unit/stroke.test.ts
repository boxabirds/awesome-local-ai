/**
 * The stroke model and its geometry, against a real Y.Doc (TC-01 to TC-08).
 *
 * Two halves here, both pure maths and both decided before anything touches the DOM:
 *
 *  * `simplify` / `splitPoints` / `smoothPath` - what a drag of hundreds of recorded samples becomes.
 *    The promise under test is the PRD's `pen.smooth`: smoothing may remove points, it may not move
 *    the line. A point the hand drew must stay within the tolerance of the path that is kept, which
 *    is what makes "smoother" and "faithful" the same statement rather than opposites.
 *  * `createStroke` / `scaledPoints` - a finished stroke is an ordinary object: a box, a z, one
 *    `LOCAL_ORIGIN` transaction, and a set of points that scale with the box while the thickness of
 *    the ink does not.
 *
 * Rejections are tested as loudly as acceptances (TC-05): a stroke with no points, a coordinate that
 * is not a number, a colour that does not exist and a thickness that never was must all leave the
 * board exactly as they found it - no object, and no update for anybody else to receive.
 */
import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  createStroke,
  hitStroke,
  scaledPoints,
  type PenColor,
  type PenThickness,
  type StrokeSnapshot,
} from '../../src/shared/objects/stroke';
import {
  createSticky,
  initDoc,
  isStrokeSnapshot,
  LOCAL_ORIGIN,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../src/shared/config';
import { HANDWRITTEN_LOOP, LONG_SPIRAL, UNDERLINE_PATH } from '../fixtures/pen-paths';

function board(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Every update this screen wrote, counted at the document. */
function watchLocalWrites(doc: Y.Doc): { count: number } {
  const seen = { count: 0 };
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) seen.count += 1;
  });
  return seen;
}

function strokeOf(doc: Y.Doc, id: string): StrokeSnapshot | undefined {
  const found = snapshot(doc).find((obj) => obj.id === id);
  return found && isStrokeSnapshot(found) ? found : undefined;
}

function strokesOf(doc: Y.Doc): StrokeSnapshot[] {
  return snapshot(doc).filter(isStrokeSnapshot);
}

/** Draws `points` through the model and returns the stroke that came out of the board. */
function draw(
  doc: Y.Doc,
  points: readonly { x: number; y: number }[],
  color: PenColor = 'black',
  thickness: PenThickness = 'medium',
): StrokeSnapshot {
  const id = createStroke(doc, { points, color, thickness }, 'tester');
  if (id === null) throw new Error('the model refused the stroke it should have taken');
  const stroke = strokeOf(doc, id);
  if (!stroke) throw new Error(`stroke ${id} is not in the snapshot`);
  return stroke;
}

/** The world point a stored point index lands on. */
function storedAt(stroke: StrokeSnapshot, index: number): { x: number; y: number } {
  return {
    x: stroke.x + (stroke.points[index * 2] ?? 0),
    y: stroke.y + (stroke.points[index * 2 + 1] ?? 0),
  };
}

describe('simplify keeps the line the hand drew (TC-01, TC-02)', () => {
  test('TC-01 a handwritten loop at tolerance 1 loses points and keeps every one of them within 1', () => {
    const raw = HANDWRITTEN_LOOP;
    const result = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);

    // the two ends of the gesture are never dropped: they are where the pen went down and lifted
    expect(result[0]).toEqual(raw[0]);
    expect(result[result.length - 1]).toEqual(raw[raw.length - 1]);
    // it did something: a hand-drawn circle of 400 samples is not 400 points of information
    expect(result.length).toBeLessThan(raw.length);
    expect(result.length).toBeGreaterThan(2);
    // and it did it honestly: no recorded point is further from the kept path than the tolerance
    for (const point of raw) {
      expect(distanceToPolyline(result, point)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);
    }
  });

  test('TC-01 a straight drag at any tolerance comes back as its two ends', () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 80, y: 0 },
      { x: 120, y: 0 },
    ];
    expect(simplify(straight, 1)).toEqual([straight[0], straight[3]]);
  });

  test('TC-01 an underline at tolerance 1 is shorter than it was and still under the same line', () => {
    const raw = UNDERLINE_PATH;
    const result = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(result.length).toBeLessThan(raw.length);
    for (const point of raw) {
      expect(distanceToPolyline(result, point)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);
    }
  });

  test('TC-02 the same drag at tolerance 0.5 (drawing at 200%) stays within 0.5 of every point', () => {
    const raw = HANDWRITTEN_LOOP;
    const zoom = 2;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / zoom;
    const result = simplify(raw, tolerance);

    for (const point of raw) {
      expect(distanceToPolyline(result, point)).toBeLessThanOrEqual(tolerance);
    }
    // finer work keeps more of the drawing: the same promise at twice the zoom is a tighter promise
    const coarse = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(result.length).toBeGreaterThan(coarse.length);
    expect(result.length).toBeLessThan(raw.length);
  });

  test('TC-01 a stroke of nothing, one point or two points is returned as it was given', () => {
    expect(simplify([], 1)).toEqual([]);
    const one = [{ x: 3, y: 4 }];
    expect(simplify(one, 1)).toEqual(one);
    const two = [
      { x: 0, y: 0 },
      { x: 9, y: 4 },
    ];
    expect(simplify(two, 1)).toEqual(two);
  });
});

describe('splitPoints cuts a very long drag (TC-03)', () => {
  const limit = STROKE_MAX_POINTS;

  test('TC-03 one point short of the limit stays one part', () => {
    const parts = splitPoints(LONG_SPIRAL.slice(0, limit - 1));
    expect(parts.length).toBe(1);
    expect(parts[0]?.length).toBe(limit - 1);
  });

  test('TC-03 exactly the limit is still one part', () => {
    const parts = splitPoints(LONG_SPIRAL.slice(0, limit));
    expect(parts.length).toBe(1);
    expect(parts[0]?.length).toBe(limit);
  });

  test('TC-03 one past the limit is two parts, and the second starts where the first ended', () => {
    const raw = LONG_SPIRAL.slice(0, limit + 1);
    const parts = splitPoints(raw);
    expect(parts.length).toBe(2);
    const first = parts[0] ?? [];
    const second = parts[1] ?? [];
    expect(first.length).toBe(limit);
    expect(second.length).toBe(2);
    // the shared join point is what makes the two strokes read as one line, with no gap between them
    expect(second[0]).toEqual(first[first.length - 1]);
    expect(second[1]).toEqual(raw[raw.length - 1]);
  });

  test('TC-03 a longer drag still shares a join point between every pair of parts', () => {
    const raw = LONG_SPIRAL.slice(0, limit + limit - 1);
    const parts = splitPoints(raw);
    expect(parts.length).toBe(2);
    for (let i = 1; i < parts.length; i += 1) {
      const previous = parts[i - 1] ?? [];
      expect((parts[i] ?? [])[0]).toEqual(previous[previous.length - 1]);
    }
    // nothing is invented: every part is a piece of what was drawn, in order
    const flat = parts.map((part) => part.length - 1).reduce((a, b) => a + b, 0) + 1;
    expect(flat).toBe(raw.length);
  });

  test('TC-03 an empty or short drag comes back whole, and a custom limit is honoured', () => {
    expect(splitPoints([])).toEqual([]);
    const three = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    expect(splitPoints(three)).toEqual([three]);
    expect(splitPoints(three, 2).length).toBe(2);
  });
});

describe('createStroke writes one object (TC-04, TC-05)', () => {
  test('TC-04 a single point is a dot whose box is the thickness, stored as one point', () => {
    const doc = board();
    const writes = watchLocalWrites(doc);
    const id = createStroke(doc, { points: [{ x: 100, y: 120 }], color: 'black', thickness: 'thick' }, 'tester');
    expect(id).not.toBeNull();

    const stroke = strokeOf(doc, id ?? '');
    expect(stroke).toBeDefined();
    const size = PEN_THICKNESS_WORLD.thick;
    // the box of a dot is the dot: a square the size of the pen, centred on where it was pressed
    expect(stroke?.width).toBe(size);
    expect(stroke?.height).toBe(size);
    expect(stroke?.x).toBe(100 - size / 2);
    expect(stroke?.y).toBe(120 - size / 2);
    // one point, flattened
    expect(stroke?.points.length).toBe(2);
    expect(storedAt(stroke!, 0)).toEqual({ x: 100, y: 120 });
    expect(stroke?.color).toBe('black');
    expect(stroke?.thickness).toBe('thick');
    expect(stroke?.baseWidth).toBe(size);
    expect(stroke?.baseHeight).toBe(size);
    // and that was exactly one transaction, so one undo step and one update on the wire
    expect(writes.count).toBe(1);
  });

  test('TC-04 a drawn line pads its box by half the thickness and stores points from its origin', () => {
    const doc = board();
    const points = [
      { x: 20, y: 40 },
      { x: 60, y: 20 },
      { x: 100, y: 60 },
    ];
    const stroke = draw(doc, points, 'red', 'thick');
    const half = PEN_THICKNESS_WORLD.thick / 2;
    expect(stroke.x).toBe(20 - half);
    expect(stroke.y).toBe(20 - half);
    expect(stroke.width).toBe(100 - 20 + half * 2);
    expect(stroke.height).toBe(60 - 20 + half * 2);
    // points are stored relative to the box, at the size the box had when the pen came up
    expect(stroke.points).toEqual([4, 24, 44, 4, 84, 44]);
    expect(stroke.baseWidth).toBe(stroke.width);
    expect(stroke.baseHeight).toBe(stroke.height);
    expect(stroke.z).toBeGreaterThan(0);
    expect(stroke.createdBy).toBe('tester');
  });

  test('TC-04 the stroke is on top of what was already on the board', () => {
    const doc = board();
    createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc);
    const topZ = Math.max(...before.map((obj: ObjectSnapshot) => obj.z));
    const stroke = draw(doc, UNDERLINE_PATH.slice(0, 4));
    expect(stroke.z).toBe(topZ + 1);
  });

  test('TC-05 nothing is written for a stroke the model cannot draw', () => {
    const cases: { label: string; points: readonly { x: number; y: number }[]; color: string; thickness: string }[] = [
      { label: 'no points at all', points: [], color: 'black', thickness: 'medium' },
      {
        label: 'a point that is not a number',
        points: [{ x: Number.NaN, y: 4 }],
        color: 'black',
        thickness: 'medium',
      },
      {
        label: 'an infinite coordinate',
        points: [
          { x: 0, y: 0 },
          { x: Number.POSITIVE_INFINITY, y: 1 },
        ],
        color: 'black',
        thickness: 'medium',
      },
      { label: 'a colour that does not exist', points: [{ x: 1, y: 1 }], color: 'pink', thickness: 'medium' },
      { label: 'a thickness that does not exist', points: [{ x: 1, y: 1 }], color: 'black', thickness: 'huge' },
    ];

    for (const testCase of cases) {
      const doc = board();
      const writes = watchLocalWrites(doc);
      const id = createStroke(
        doc,
        {
          points: testCase.points,
          color: testCase.color as PenColor,
          thickness: testCase.thickness as PenThickness,
        },
        'tester',
      );
      expect(id, testCase.label).toBeNull();
      expect(strokesOf(doc).length, `${testCase.label}: an object appeared`).toBe(0);
      // the whole point of deciding before the transaction: nobody receives a refusal
      expect(writes.count, `${testCase.label}: an update went out`).toBe(0);
    }
  });

  test('TC-05 a refused stroke does not disturb the board that already has things on it', () => {
    const doc = board();
    const stroke = draw(doc, UNDERLINE_PATH.slice(0, 5), 'green', 'thin');
    const writes = watchLocalWrites(doc);
    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'tester')).toBeNull();
    expect(writes.count).toBe(0);
    expect(strokesOf(doc)).toEqual([stroke]);
  });
});

describe('a stroke scales with its box, not with its ink (TC-06, TC-07)', () => {
  test('TC-06 doubling the box doubles every coordinate and leaves the thickness alone', () => {
    const doc = board();
    const stroke = draw(doc, HANDWRITTEN_LOOP.slice(0, 30), 'purple', 'thin');
    const before = scaledPoints(stroke);

    // the generic story 7 resize, writing only x, y, width and height
    const doubled = { x: stroke.x, y: stroke.y, width: stroke.width * 2, height: stroke.height * 2 };
    expect(resizeObjects(doc, new Map([[stroke.id, doubled]]))).toBe(1);

    const resized = strokeOf(doc, stroke.id);
    expect(resized).toBeDefined();
    const after = scaledPoints(resized!);
    expect(after.length).toBe(before.length);
    for (let i = 0; i < after.length; i += 1) {
      // the drawing grows in proportion, from the box it was recorded against
      expect(after[i]!.x - resized!.x).toBeCloseTo(2 * (before[i]!.x - stroke.x), 6);
      expect(after[i]!.y - resized!.y).toBeCloseTo(2 * (before[i]!.y - stroke.y), 6);
      // and it is the same number that was stored, times the scale, exactly
      expect(after[i]!.x).toBeCloseTo(resized!.x + (stroke.points[i * 2] ?? 0) * 2, 6);
    }
    // the ink is still the ink: a big drawing drawn with a fine pen stays fine
    expect(resized!.thickness).toBe('thin');
    expect(resized!.baseWidth).toBe(stroke.baseWidth);
    expect(resized!.width / resized!.height).toBeCloseTo(stroke.width / stroke.height, 9);
  });

  test('TC-07 a click within 6 screen pixels of the line at 1:1 selects the stroke, and one past it does not', () => {
    const doc = board();
    // a straight, thin line: the tolerance is what decides, not the thickness of the pen
    const stroke = draw(
      doc,
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 400, y: 0 },
      ],
      'black',
      'thin',
    );
    const points = scaledPoints(stroke);
    const on = points[Math.floor(points.length / 2)]!;

    expect(distanceToPolyline(points, on)).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(distanceToPolyline(points, { x: on.x, y: on.y + 5.9 })).toBeLessThanOrEqual(
      STROKE_HIT_TOLERANCE_PX,
    );
    expect(distanceToPolyline(points, { x: on.x, y: on.y + 6.1 })).toBeGreaterThan(
      STROKE_HIT_TOLERANCE_PX,
    );

    // the same three clicks, through the rule the registry uses at zoom 1
    expect(hitStroke(stroke, on, 1)).toBe(true);
    expect(hitStroke(stroke, { x: on.x, y: on.y + 5.9 }, 1)).toBe(true);
    expect(hitStroke(stroke, { x: on.x, y: on.y + 6.1 }, 1)).toBe(false);
  });

  test('TC-07 a thick stroke answers to a click as far out as half its own thickness', () => {
    const doc = board();
    const stroke = draw(
      doc,
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      'black',
      'thick',
    );
    const points = scaledPoints(stroke);
    const on = points[0]!;
    const edge = PEN_THICKNESS_WORLD.thick / 2;
    expect(edge).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX / 4);
    // at 400% the screen tolerance is 1.5 world units, so half the thickness (4) decides
    expect(hitStroke(stroke, { x: on.x, y: on.y + 3.9 }, 4)).toBe(true);
    expect(hitStroke(stroke, { x: on.x, y: on.y + 4.1 }, 4)).toBe(false);
    // at 50% the screen tolerance (12) is the larger of the two
    expect(hitStroke(stroke, { x: on.x, y: on.y + 11.9 }, 0.5)).toBe(true);
    expect(hitStroke(stroke, { x: on.x, y: on.y + 12.1 }, 0.5)).toBe(false);
  });
});

describe('smoothPath draws the simplified points as one curve (TC-08)', () => {
  test('TC-08 three points become M, one quadratic segment, and the last point', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 5 },
    ];
    const path = smoothPath(points);
    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('Q');
    // one interior point is one quadratic segment, pulled towards it and landing on the next
    // midpoint; the drawing then finishes on the point the path ends at
    expect((path.match(/Q/g) ?? []).length).toBe(1);
    expect((path.match(/M/g) ?? []).length).toBe(1);
    expect(path.endsWith('L 30 5')).toBe(true);
    // deterministic: the same points always draw the same path, on every screen
    expect(smoothPath(points)).toBe(path);
    expect(smoothPath([...points])).toBe(path);
  });

  test('TC-08 two points are a line and one point is a zero-length path for a round dot', () => {
    expect(smoothPath([{ x: 4, y: 6 }])).toBe('M 4 6 L 4 6');
    const line = smoothPath([
      { x: 0, y: 0 },
      { x: 12, y: 8 },
    ]);
    expect(line).toBe('M 0 0 L 12 8');
    expect(smoothPath([])).toBe('');
  });

  test('TC-08 a long simplified path is one curve with no gaps in it', () => {
    const simplified = simplify(HANDWRITTEN_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX);
    const path = smoothPath(simplified);
    expect((path.match(/M/g) ?? []).length).toBe(1);
    // every interior point gets exactly one quadratic segment
    expect((path.match(/Q/g) ?? []).length).toBe(simplified.length - 2);
    const first = simplified[0]!;
    const last = simplified[simplified.length - 1]!;
    expect(path.startsWith(`M ${first.x} ${first.y}`)).toBe(true);
    expect(path.endsWith(`L ${last.x} ${last.y}`)).toBe(true);
  });
});

describe('the pen palette is what the model accepts (settings)', () => {
  test('every colour name and thickness name the settings list is a stroke the model takes', () => {
    const doc = board();
    let expected = 0;
    for (const color of Object.keys(PEN_COLORS) as PenColor[]) {
      for (const thickness of Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]) {
        expected += 1;
        expect(
          createStroke(doc, { points: [{ x: expected, y: expected }], color, thickness }, 'tester'),
        ).not.toBeNull();
      }
    }
    expect(strokesOf(doc).length).toBe(expected);
    expect(Object.keys(PEN_COLORS).length).toBe(6);
    expect(Object.keys(PEN_THICKNESS_WORLD).length).toBe(3);
  });
});
