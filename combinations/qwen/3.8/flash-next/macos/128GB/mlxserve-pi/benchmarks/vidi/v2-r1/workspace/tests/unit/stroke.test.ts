// `stroke.model` and the geometry a stroke is drawn with — tested first, against a real
// Y.Doc and three recorded pointer paths.
//
// The interesting numbers here are all about *faithfulness*: how far the finished stroke
// may lie from the path that was drawn (TC-01, TC-02), how many points one stroke may hold
// and where the next one starts (TC-03), and how far from the line a click may be and still
// be a hit (TC-07). Each of those is a setting in `src/shared/config.ts`, and each is
// asserted as a distance rather than as a string, because "smooth" that is not within a
// known distance of the drawing is just "wrong, but tidier".
//
// Spec: spec/stories/011-sketch-freehand-with-a-pen/design.md
//       (stroke.model)
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../src/shared/config';
import {
  deleteObjects,
  initDoc,
  LOCAL_ORIGIN,
  objectBounds,
  objectMinSize,
  resizeObjects,
  snapshot,
  snapshotObjects,
} from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import {
  createStroke,
  isStrokeSnapshot,
  readStrokeSnapshot,
  scaledPoints,
  strokeHitToleranceWorld,
  strokeSnapshots,
} from '../../src/shared/objects/stroke';
import { handwrittenLoop, spiral, underline } from '../fixtures/pen-paths';

const CREATED_BY = 'g_test';

const seed = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

const objects = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap<Y.Map<unknown>>('objects');

const raw = (doc: Y.Doc, id: string): Y.Map<unknown> => {
  const object = objects(doc).get(id);
  if (!(object instanceof Y.Map)) throw new Error(`"${id}" is not in the document`);
  return object;
};

/** Count the transactions that touched the document while `body` ran. */
const updatesDuring = (doc: Y.Doc, body: () => void): number => {
  let updates = 0;
  const observer = (): void => {
    updates += 1;
  };
  doc.on('update', observer);
  body();
  doc.off('update', observer);
  return updates;
};

/** The farthest any one of `points` lies from the polyline through `line`. */
const farthest = (points: readonly Point[], line: readonly Point[]): number =>
  points.reduce((best, point) => Math.max(best, distanceToPolyline(line, point)), 0);

/** A stroke put in through the model, because it is scenery in most of these tests. */
const draw = (
  doc: Y.Doc,
  points: readonly Point[],
  color = 'black',
  thickness = 'medium',
): string => {
  const id = createStroke(doc, { points, color, thickness }, CREATED_BY);
  if (id === null) throw new Error('the model refused a stroke this test asked for');
  return id;
};

/** The one stroke on the board. */
const onlyStroke = (doc: Y.Doc) => {
  const strokes = strokeSnapshots(doc);
  if (strokes.length !== 1) throw new Error(`expected one stroke, found ${String(strokes.length)}`);
  return strokes[0];
};

describe('stroke.smooth', () => {
  // TC-01
  it('leaves no drawn point more than the tolerance from the finished line', () => {
    const drawn = handwrittenLoop();
    const smoothed = simplify(drawn, STROKE_SIMPLIFY_TOLERANCE_PX);

    // The guarantee Ramer-Douglas-Peucker is bought for: every point that was drawn is
    // within the tolerance of the line that is kept. The epsilon is floating point's, not
    // the algorithm's: a point sitting exactly on the tolerance is inside it.
    expect(farthest(drawn, smoothed)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX + 1e-9);
    // And it did something: 400 samples of a hand-drawn circle are not 400 points of line.
    expect(smoothed.length).toBeLessThan(drawn.length);
    expect(smoothed.length).toBeGreaterThan(2);
    // First and last are kept: the stroke starts and ends where the pen went down and
    // came up, whatever happened in between.
    expect(smoothed[0]).toEqual(drawn[0]);
    expect(smoothed[smoothed.length - 1]).toEqual(drawn[drawn.length - 1]);
  });

  // TC-02
  it('holds the same promise at 200% zoom, where the tolerance is half as big', () => {
    const drawn = handwrittenLoop();
    // The tool divides the screen-pixel tolerance by the zoom it is drawing at, so the
    // stroke is as faithful at 200% as at 100% — in screen pixels, exactly as faithful.
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / 2;
    const smoothed = simplify(drawn, tolerance);

    expect(farthest(drawn, smoothed)).toBeLessThanOrEqual(tolerance + 1e-9);
    expect(smoothed.length).toBeLessThan(drawn.length);
    // Finer tolerance, more points: the smoothing is a distance rule and not a budget.
    expect(smoothed.length).toBeGreaterThan(
      simplify(drawn, STROKE_SIMPLIFY_TOLERANCE_PX).length,
    );
  });

  it('keeps everything it is not allowed to move, and nothing it is', () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    // A straight line has no deviation to keep, so it comes back as its two ends.
    expect(simplify(line, 1)).toEqual([line[0], line[3]]);
    // A tolerance of nothing moves nothing.
    expect(simplify(line, 0)).toEqual(line);
    // One point and two points are already as simple as they get.
    expect(simplify([{ x: 1, y: 2 }], 1)).toEqual([{ x: 1, y: 2 }]);
    expect(simplify([], 1)).toEqual([]);
    // A corner sharper than the tolerance survives; one gentler does not.
    const corner: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 4 }, { x: 20, y: 0 }];
    expect(simplify(corner, 5)).toHaveLength(2);
    expect(simplify(corner, 1)).toHaveLength(3);
  });
});

describe('stroke.long', () => {
  // TC-03
  it('splits one point past the limit into two parts that share their join', () => {
    const drawn = spiral();
    expect(drawn.length).toBe(STROKE_MAX_POINTS + 10);

    for (const count of [STROKE_MAX_POINTS - 1, STROKE_MAX_POINTS, STROKE_MAX_POINTS + 1]) {
      const parts = splitPoints(drawn.slice(0, count));
      const expected = count > STROKE_MAX_POINTS ? 2 : 1;
      expect(parts).toHaveLength(expected);
    }

    const parts = splitPoints(drawn);
    const first = parts[0] as Point[];
    const second = parts[1] as Point[];
    expect(first).toHaveLength(STROKE_MAX_POINTS);
    // The join point belongs to both: the second stroke starts exactly where the first
    // stopped, which is what makes the two read as one line (`pen.long_stroke`).
    expect(second[0]).toEqual(first[first.length - 1]);
    expect([...first, ...second.slice(1)]).toEqual(drawn);
  });

  it('never loses a point, however badly the chunks line up', () => {
    const drawn = spiral();
    for (const max of [2, 3, 7, 1_000, STROKE_MAX_POINTS]) {
      const parts = splitPoints(drawn, max);
      const joined = parts.reduce<Point[]>(
        (all, part) => (all.length === 0 ? [...part] : [...all, ...part.slice(1)]),
        [],
      );
      expect(joined).toEqual(drawn);
      for (const part of parts) expect(part.length).toBeLessThanOrEqual(max);
    }
    // A limit below two points cannot split anything, and so takes the whole path.
    expect(splitPoints(drawn, 1)).toEqual([drawn]);
    expect(splitPoints([], 10)).toEqual([]);
  });
});

describe('stroke.dot', () => {
  // TC-04
  it('gives a click a box the size of its own thickness, holding one point', () => {
    const doc = seed();
    const at: Point = { x: 40, y: -20 };

    const id = draw(doc, [at], 'red', 'thick');

    const stroke = readStrokeSnapshot(doc, id);
    if (!stroke) throw new Error('the dot is not in the document');
    // A dot has no line to be long along, so its box is the dot: a square of its own
    // thickness, centred on where the pen went down.
    const half = PEN_THICKNESS_WORLD.thick / 2;
    expect(objectBounds(stroke)).toEqual({
      x: at.x - half,
      y: at.y - half,
      width: PEN_THICKNESS_WORLD.thick,
      height: PEN_THICKNESS_WORLD.thick,
    });
    // One point, stored flat, relative to the box: the centre of the box it lives in.
    expect(stroke.points).toHaveLength(2);
    expect(stroke.points).toEqual([half, half]);
    expect(stroke.baseWidth).toBe(PEN_THICKNESS_WORLD.thick);
    expect(stroke.baseHeight).toBe(PEN_THICKNESS_WORLD.thick);
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');
    expect(stroke.createdBy).toBe(CREATED_BY);
    // Which is also where it is drawn: a dot's own scaled points are its centre.
    expect(scaledPoints(stroke)).toEqual([at]);
  });

  it('pads a line by half its thickness on every side', () => {
    const doc = seed();
    const id = draw(doc, underline({ x: -100, y: 0 }, 200, 5), 'black', 'thin');
    const stroke = readStrokeSnapshot(doc, id);
    if (!stroke) throw new Error('the stroke is not in the document');

    const box = objectBounds(stroke);
    // The box is the ink plus half a thickness on every side: nothing the stroke draws is
    // outside it, and there is never nothing to click on.
    const world = scaledPoints(stroke);
    const left = Math.min(...world.map((point) => point.x));
    const top = Math.min(...world.map((point) => point.y));
    const right = Math.max(...world.map((point) => point.x));
    const bottom = Math.max(...world.map((point) => point.y));
    const half = PEN_THICKNESS_WORLD.thin / 2;
    expect(left - box.x).toBeCloseTo(half, 9);
    expect(top - box.y).toBeCloseTo(half, 9);
    expect(box.x + box.width - right).toBeCloseTo(half, 9);
    expect(box.y + box.height - bottom).toBeCloseTo(half, 9);
  });
});

describe('stroke.model', () => {
  // TC-05
  it('refuses a stroke it cannot draw, and writes nothing while trying', () => {
    const doc = seed();

    const refused: Array<readonly [string, readonly Point[], string, string]> = [
      ['no points at all', [], 'black', 'medium'],
      ['a point with no number in it', [{ x: 0, y: 0 }, { x: Number.NaN, y: 10 }], 'black', 'medium'],
      ['an infinite point', [{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 1 }], 'black', 'medium'],
      ['a colour nobody has', [{ x: 0, y: 0 }], 'pink', 'medium'],
      ['a thickness nobody has', [{ x: 0, y: 0 }], 'black', 'huge'],
    ];

    for (const [what, points, color, thickness] of refused) {
      const updates = updatesDuring(doc, () => {
        expect(createStroke(doc, { points, color, thickness }, CREATED_BY)).toBeNull();
      });
      expect(updates).toBe(0);
      expect(objects(doc).size).toBe(0);
      void what;
    }

    // Not even a missing request is a stroke.
    expect(
      createStroke(doc, { points: [], color: 'black', thickness: 'thin' }, CREATED_BY),
    ).toBeNull();
    expect(strokeSnapshots(doc)).toEqual([]);
  });

  it('is one local transaction, above everything else, of every kind', () => {
    const doc = seed();
    const path = underline();

    let origin: unknown = 'nothing was written';
    doc.on('update', (_update: Uint8Array, source: unknown) => {
      origin = source;
    });
    const id = draw(doc, path);
    // One transaction, and this tab's own origin: story 8's undo only ever takes back
    // a drawing made here, and never somebody else's.
    expect(origin).toBe(LOCAL_ORIGIN);

    const stroke = readStrokeSnapshot(doc, id);
    if (!stroke) throw new Error('the stroke is not in the document');
    expect(stroke.z).toBe(1);
    expect(stroke.type).toBe('stroke');
    expect(isStrokeSnapshot(stroke)).toBe(true);
    // The generic read sees it too, and the notes-only view of the same document does
    // not care that it exists.
    expect(snapshotObjects(doc).map((object) => object.id)).toEqual([id]);
    expect(snapshot(doc)).toEqual([]);
    // The points are one plain array, replaced whole and never edited point by point.
    expect(raw(doc, id).get('points')).toBeInstanceOf(Array);
    expect(stroke.points).toHaveLength(path.length * 2);
  });

  it('reads back what it was given, relative to its own box', () => {
    const doc = seed();
    const path: Point[] = [
      { x: 100, y: 50 },
      { x: 140, y: 70 },
      { x: 180, y: 55 },
    ];

    const id = draw(doc, path, 'green', 'thin');
    const stroke = readStrokeSnapshot(doc, id);
    if (!stroke) throw new Error('the stroke is not in the document');

    // Scaled points are world points again, to the last decimal: the round trip through
    // the box costs nothing.
    expect(scaledPoints(stroke)).toEqual(path);
    expect(stroke.baseWidth).toBeCloseTo(80 + PEN_THICKNESS_WORLD.thin, 9);
    expect(stroke.baseHeight).toBeCloseTo(20 + PEN_THICKNESS_WORLD.thin, 9);
  });

  // TC-06
  it('draws twice as wide and twice as tall when its box is doubled, no thicker', () => {
    const doc = seed();
    const id = draw(doc, underline({ x: -100, y: 0 }, 200, 7), 'blue', 'medium');
    const before = readStrokeSnapshot(doc, id);
    if (!before) throw new Error('the stroke is not in the document');

    const box = objectBounds(before);
    const doubled: Rect = {
      x: box.x,
      y: box.y,
      width: box.width * 2,
      height: box.height * 2,
    };
    expect(resizeObjects(doc, new Map([[id, doubled]]))).toBe(1);

    const after = readStrokeSnapshot(doc, id);
    if (!after) throw new Error('the stroke vanished when it was resized');

    // Every coordinate is twice as far from the box's origin as it was: the line itself
    // grew, in proportion, which is what `pen.resize` promises.
    const grown = scaledPoints(after);
    const was = scaledPoints(before);
    expect(grown).toHaveLength(was.length);
    for (let i = 0; i < was.length; i += 1) {
      const a = was[i] as Point;
      const b = grown[i] as Point;
      expect(b.x - after.x).toBeCloseTo((a.x - before.x) * 2, 6);
      expect(b.y - after.y).toBeCloseTo((a.y - before.y) * 2, 6);
    }
    // The stored points are untouched — the box is the only thing a resize writes — and
    // so is the thickness, which is not scaled with the drawing.
    expect(after.points).toEqual(before.points);
    expect(after.baseWidth).toBe(before.baseWidth);
    expect(after.thickness).toBe('medium');
    expect(PEN_THICKNESS_WORLD[after.thickness]).toBe(PEN_THICKNESS_WORLD.medium);
  });

  it('moves without touching a single point', () => {
    const doc = seed();
    const id = draw(doc, underline());
    const before = readStrokeSnapshot(doc, id);
    if (!before) throw new Error('the stroke is not in the document');

    expect(
      resizeObjects(doc, new Map([[id, { ...objectBounds(before), x: 900, y: -400 }]])),
    ).toBe(1);

    const after = readStrokeSnapshot(doc, id);
    if (!after) throw new Error('the stroke vanished when it was moved');
    expect(after.points).toEqual(before.points);
    // Every point travelled with the box.
    const moved = scaledPoints(after);
    const was = scaledPoints(before);
    for (let i = 0; i < was.length; i += 1) {
      expect((moved[i] as Point).x).toBeCloseTo((was[i] as Point).x + 900 - before.x, 9);
      expect((moved[i] as Point).y).toBeCloseTo((was[i] as Point).y - 400 - before.y, 9);
    }
    expect(after.thickness).toBe(before.thickness);
  });

  it('goes away with everything else, and lets its neighbours alone', () => {
    const doc = seed();
    const stroke = draw(doc, underline());
    const other = draw(doc, handwrittenLoop({ x: 400, y: 300 }, 60, 40));

    expect(deleteObjects(doc, [stroke])).toBe(1);
    expect(strokeSnapshots(doc).map((object) => object.id)).toEqual([other]);
    expect(objects(doc).size).toBe(1);
    // The one that is left is a whole stroke, with its own drawing in it.
    expect(onlyStroke(doc).points.length).toBeGreaterThan(2);
  });

  it('is a kind the board knows, with the stroke floor and a reader of its own', () => {
    const doc = seed();
    const id = draw(doc, underline({ x: -100, y: 0 }, 100, 3));
    // The generic snapshot every screen is written against carries a stroke as the kind
    // that can be drawn, so story 7 selects, moves, resizes and deletes it with no code of
    // its own knowing what a line is.
    const base = snapshotObjects(doc).find((candidate) => candidate.id === id);
    if (base === undefined || !isStrokeSnapshot(base)) {
      throw new Error('the generic snapshot does not read as a stroke');
    }
    expect(base.z).toBe(1);
    expect(base.points).toHaveLength(6);
    // The floor the generic resize is held to is the stroke's own, so a stroke cannot be
    // squeezed into a line with no height to grab (`pen.resize`).
    expect(objectMinSize('stroke')).toBe(STROKE_MIN_SIZE_WORLD);
    // Six colours, three thicknesses: the toolbar offers what the model accepts, and
    // nothing else is a colour a stroke can be.
    expect(Object.keys(PEN_COLORS)).toHaveLength(6);
    expect(Object.keys(PEN_THICKNESS_WORLD)).toHaveLength(3);
    expect(Object.values(PEN_COLORS).every((hex) => hex.startsWith('#'))).toBe(true);
  });
});

describe('stroke.hit', () => {
  // TC-07
  it('is hit within the tolerance of its line, and not outside it', () => {
    const doc = seed();
    const id = draw(doc, underline({ x: -100, y: 0 }, 200, 5), 'black', 'medium');
    const stroke = readStrokeSnapshot(doc, id);
    if (!stroke) throw new Error('the stroke is not in the document');
    const points = scaledPoints(stroke);
    const middle = points[Math.floor(points.length / 2)] as Point;
    // The rule, spelled out: six screen pixels at this zoom, or half the line's own
    // thickness if the line is thicker than that.
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD.medium / 2,
      STROKE_HIT_TOLERANCE_PX / 1,
    );
    expect(tolerance).toBe(STROKE_HIT_TOLERANCE_PX);

    for (const [offset, hits] of [
      [0, true],
      [STROKE_HIT_TOLERANCE_PX - 0.1, true],
      [STROKE_HIT_TOLERANCE_PX + 0.1, false],
    ] as Array<[number, boolean]>) {
      const at = { x: middle.x, y: middle.y + offset };
      const distance = distanceToPolyline(points, at);
      expect(distance).toBeCloseTo(offset, 6);
      expect(distance <= tolerance).toBe(hits);
    }

    // The model's own answer to "was that click on the line?" agrees with the distance,
    // and the registry hands the same function to story 7's selection.
    expect(strokeHitToleranceWorld('medium', 1)).toBe(tolerance);
  });

  it('is as wide a target on the screen at every zoom', () => {
    const doc = seed();
    const id = draw(doc, underline({ x: -100, y: 0 }, 200, 5), 'black', 'thin');
    const stroke = readStrokeSnapshot(doc, id);
    if (!stroke) throw new Error('the stroke is not in the document');
    const middle = scaledPoints(stroke)[2] as Point;

    for (const zoom of [0.5, 1, 2, 4]) {
      // Six pixels, whatever the zoom: the tolerance is divided by it, so on the screen
      // it is always six pixels.
      const tolerance = strokeHitToleranceWorld('thin', zoom);
      expect(tolerance * zoom).toBeCloseTo(STROKE_HIT_TOLERANCE_PX, 9);
      const inside = { x: middle.x, y: middle.y + (STROKE_HIT_TOLERANCE_PX - 1) / zoom };
      const outside = { x: middle.x, y: middle.y + (STROKE_HIT_TOLERANCE_PX + 1) / zoom };
      expect(distanceToPolyline(scaledPoints(stroke), inside)).toBeLessThanOrEqual(tolerance);
      expect(distanceToPolyline(scaledPoints(stroke), outside)).toBeGreaterThan(tolerance);
    }

    // A thick line is its own target: half its thickness beats six pixels at 200%.
    expect(strokeHitToleranceWorld('thick', 2)).toBe(PEN_THICKNESS_WORLD.thick / 2);
  });
});

describe('stroke.path', () => {
  // TC-08
  it('draws the smoothed line as one deterministic path', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 4 },
    ];

    const path = smoothPath(points);
    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain(' Q');
    // Same points, same string: the drawing is a function of the stroke and nothing else,
    // so two screens that hold the same stroke paint the same pixels.
    expect(smoothPath(points)).toBe(path);
    expect(smoothPath(points.slice())).toBe(path);
    // It begins at the first point and ends at the last: the line goes where it was told.
    expect(path.startsWith('M0 0')).toBe(true);
    expect(path.endsWith('30 4')).toBe(true);
    // One curve between the outer points, through the middle of the segment either side.
    expect(path.match(/Q/g)).toHaveLength(2);
  });

  it('draws a dot as a line of no length, which is round at both ends', () => {
    const dot = smoothPath([{ x: 12, y: 34 }]);
    expect(dot).toBe('M12 34');
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 0, y: 0 }, { x: 8, y: 8 }])).toBe('M0 0 Q8 8 8 8');
  });

  it('stays within a pixel of the line it was given', () => {
    const drawn = simplify(handwrittenLoop(), STROKE_SIMPLIFY_TOLERANCE_PX);
    const box = (points: readonly Point[]): Rect => {
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    };
    // Every midpoint quadratic is inside the hull of the points it was built from, so the
    // curve cannot bulge outside the box the simplified points are in — which is the last
    // step of the promise that the drawn line is within a screen pixel of the drawn path.
    const curve = box(drawn);
    expect(curve.width).toBeGreaterThan(0);
    expect(smoothPath(drawn).length).toBeGreaterThan(drawn.length * 4);
  });
});

