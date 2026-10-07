/**
 * The stroke model and the geometry behind it - `tests/unit/stroke.test.ts`.
 *
 * A stroke is the first object on this board that is stored as a shape rather than as a
 * box, so the unit layer has real decisions to check: which points of a drag are kept
 * (`pen.smooth`), where a drag too long for one object is cut (`pen.long_stroke`), how a
 * trail becomes a box and back again (`pen.resize`), how near a line a click has to be
 * (`pen.select`), and what a stroke that cannot be drawn must never do (`pen.dot` and the
 * invalid-input cases in `pen.share`).
 *
 * Two things are checked by every case that could write nothing at all: the return value
 * and the number of `update` events the document produced. "Rejected" is not a fact about
 * a return value alone - a function that answers `null` after opening a transaction has
 * already sent a sync message to five screens and put an empty step on this tab's undo
 * stack, and the only way to see that from outside is to count what the document emitted.
 *
 * No React, no SVG, no layout. What a stroke looks like is `StrokeObject`'s problem, and
 * what a pen feels like is the Pen tool's; here everything is arithmetic on a `Y.Doc`.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  DOC_OBJECTS_MAP,
  initDoc,
  objectBounds,
  objectSnapshot,
  createSticky,
} from '../../src/shared/board-model.js';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../src/shared/config.js';
import type { PenColor, PenThickness } from '../../src/shared/objects/stroke.js';
import { distanceToPolyline } from '../../src/shared/geometry/polyline.js';
import { simplify, simplifyToleranceAt, smoothPath, splitPoints } from '../../src/shared/geometry/simplify.js';
import {
  createStroke,
  scaledPoints,
  strokeIsAt,
  strokePoints,
  strokeSnapshots,
  strokeThickness,
  type StrokeSnap,
} from '../../src/shared/objects/stroke.js';
import type { Point } from '../../src/shared/board-model.js';
import { circle, scribble, zigzag, PATH_CENTRE } from '../fixtures/pen-paths.js';

const newDoc = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>(DOC_OBJECTS_MAP) as unknown as Y.Map<Y.Map<unknown>>;

const mapOf = (doc: Y.Doc, id: string): Y.Map<unknown> | undefined => objectsMap(doc).get(id);

/** Count the transactions a call actually puts on the document. */
const countUpdates = (doc: Y.Doc, run: () => void): number => {
  let updates = 0;
  const observer = (): void => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    run();
  } finally {
    doc.off('update', observer);
  }
  return updates;
};

/** A trail of `count` points along a shallow arc, which is what a hand makes. */
const arc = (count: number): Point[] =>
  Array.from({ length: count }, (_unused, index) => ({
    x: index * 4,
    y: 40 + Math.sin(index / 6) * 18,
  }));

/** A horizontal line at `y` from x = 0 to x = 100, in world units. */
const horizontal = (y: number): Point[] => [
  { x: 0, y },
  { x: 50, y },
  { x: 100, y },
];

/** The stroke a test can hold: created, then read back out of the document. */
const drawnStroke = (doc: Y.Doc, id: string): StrokeSnap => {
  const found = strokeSnapshots(doc).find((stroke) => stroke.id === id);
  if (found === undefined) throw new Error(`the board has no stroke ${id}`);
  return found;
};

/* ------------------------------------------------------- pen.smooth (TC-01, TC-02) */

describe('simplify (TC-01, TC-02: pen.smooth)', () => {
  it('keeps a drawing within the tolerance of what was drawn', () => {
    // The design's promise, in the direction a person would notice: no point they drew
    // ends up further from the stored line than the tolerance they were drawing at.
    const result = simplify(scribble, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(result.length).toBeLessThan(scribble.length);
    for (const point of scribble) {
      expect(distanceToPolyline(result, point)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);
    }
  });

  it('keeps the ends of the trail whatever the tolerance', () => {
    // The first and last points are where the stroke starts and stops; a simplifier
    // that dropped them would move the drawing rather than thin it.
    const result = simplify(scribble, 40);
    expect(result[0]).toEqual({ x: scribble[0].x, y: scribble[0].y });
    expect(result[result.length - 1]).toEqual({
      x: scribble[scribble.length - 1].x,
      y: scribble[scribble.length - 1].y,
    });
  });

  it('never invents a point (the kept points are drawn points)', () => {
    const result = simplify(scribble, STROKE_SIMPLIFY_TOLERANCE_PX);
    const drawn = new Set(scribble.map((point) => `${point.x},${point.y}`));
    for (const point of result) expect(drawn.has(`${point.x},${point.y}`)).toBe(true);
  });

  it('keeps a curve drawn at 200% within half a unit, which is one screen pixel', () => {
    // The tolerance a stroke is simplified at is `STROKE_SIMPLIFY_TOLERANCE_PX / zoom`,
    // so the same drag at 200% is held to half a *board* unit - and the line someone drew
    // close up keeps the detail they drew, rather than being smoothed to the size of
    // everything else on the board.
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / 2;
    const result = simplify(circle, tolerance);
    expect(result.length).toBeLessThan(circle.length);
    for (const point of circle) {
      expect(distanceToPolyline(result, point)).toBeLessThanOrEqual(tolerance);
    }
  });

  it('keeps at least as much of the drawing as a coarser tolerance would', () => {
    const close = simplify(circle, STROKE_SIMPLIFY_TOLERANCE_PX / 2);
    const far = simplify(circle, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(close.length).toBeGreaterThanOrEqual(far.length);
  });

  it('keeps every point of a drawing made of corners at a fine tolerance', () => {
    // A zigzag is all corners: each one is further from the line its neighbours suggest
    // than a pixel, so thinning it at one pixel would be erasing the shape.
    expect(simplify(zigzag, 1)).toHaveLength(zigzag.length);
  });

  it('drops the points along a straight stretch', () => {
    const straight = Array.from({ length: 50 }, (_unused, index) => ({ x: index * 6, y: 20 }));
    expect(simplify(straight, 1)).toHaveLength(2);
  });

  it('leaves a trail of one or two points alone', () => {
    // Boundary: there is nothing between two points to drop, and nothing at all in one.
    expect(simplify([{ x: 4, y: 5 }], 1)).toEqual([{ x: 4, y: 5 }]);
    expect(simplify([{ x: 4, y: 5 }, { x: 9, y: 9 }], 1)).toHaveLength(2);
    expect(simplify([], 1)).toEqual([]);
  });

  it('returns the trail as it was for a tolerance of nothing', () => {
    // 0 and less-than-0 are "deviate by no amount", which is the same request as "do not
    // simplify" - and the copy is not the caller's array, so a caller cannot be harmed.
    const input = arc(20);
    expect(simplify(input, 0)).toEqual(input);
    expect(simplify(input, -3)).toEqual(input);
    expect(simplify(input, Number.NaN)).toEqual(input);
  });

  it('drops a point that is not a pair of finite numbers', () => {
    // A NaN that reached a `d` attribute would be a stroke that draws nothing on every
    // other screen; it is dropped here, once, rather than defended against downstream.
    const input = [{ x: 0, y: 0 }, { x: Number.NaN, y: 4 }, { x: 10, y: 10 }];
    expect(simplify(input, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });
});

/* ------------------------------------------- the tolerance is a screen distance */

describe('simplifyToleranceAt (why the tolerance is divided by the zoom)', () => {
  it('is the configured pixel tolerance at 100 %', () => {
    expect(simplifyToleranceAt(1)).toBe(STROKE_SIMPLIFY_TOLERANCE_PX);
  });

  it('shrinks in board units as the board gets bigger, so the screen sees the same slack', () => {
    // The point of the division, in one line: at 200 % a board unit is two pixels, so half a
    // board unit is the same one pixel of tolerance the person saw at 100 %. A drag that was
    // simplified away at 100 % is kept at 400 % - which is why zooming in does not turn a
    // careful drawing into a polygon.
    expect(simplifyToleranceAt(2)).toBe(STROKE_SIMPLIFY_TOLERANCE_PX / 2);
    expect(simplifyToleranceAt(0.5)).toBe(STROKE_SIMPLIFY_TOLERANCE_PX * 2);
    expect(simplifyToleranceAt(4) * 4).toBeCloseTo(simplifyToleranceAt(1), 10);
  });

  it('falls back to the 100 % tolerance when the board does not know its zoom', () => {
    // A camera is read from a state that is being set up, and a tolerance of Infinity would
    // take the whole trail away - down to two points - on the first frame of a board.
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(simplifyToleranceAt(zoom)).toBe(STROKE_SIMPLIFY_TOLERANCE_PX);
    }
  });
});

/* ---------------------------------------------------- pen.long_stroke (TC-03) */

describe('splitPoints (TC-03: pen.long_stroke)', () => {
  it('leaves a trail one point short of the limit alone', () => {
    const parts = splitPoints(arc(STROKE_MAX_POINTS - 1));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS - 1);
  });

  it('leaves a trail of exactly the limit alone', () => {
    // Boundary: the limit counts points, so this is the last trail that is one stroke.
    const parts = splitPoints(arc(STROKE_MAX_POINTS));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
  });

  it('cuts a trail one point over the limit into two', () => {
    const parts = splitPoints(arc(STROKE_MAX_POINTS + 1));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
  });

  it('starts the second piece at the point the first one ended', () => {
    // The shared point is the whole design: two objects whose ends are the same point
    // draw as one line, because one round cap lies under the other. Pieces that merely
    // stopped and started would leave a gap at every join.
    const parts = splitPoints(arc(STROKE_MAX_POINTS + 1));
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
  });

  it('keeps every point, in order, across the pieces', () => {
    const input = arc(STROKE_MAX_POINTS * 2 + 100);
    const parts = splitPoints(input);
    expect(parts).toHaveLength(3);
    const withoutJoins = parts.reduce<Point[]>((all, part, index) => {
      if (index === 0) return [...part];
      const previous = parts[index - 1][parts[index - 1].length - 1];
      const first = part[0];
      // The joins are the only repeats: everything else is exactly the trail.
      return [...all, ...(first.x === previous.x && first.y === previous.y ? part.slice(1) : part)];
    }, []);
    expect(withoutJoins).toEqual(input);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
  });

  it('answers nothing for a trail of nothing', () => {
    expect(splitPoints([])).toEqual([]);
  });
});

/* --------------------------------------------------------- pen.dot (TC-04) */

describe('createStroke (TC-04: pen.dot)', () => {
  it('gives a dot the square the pen draws, centred on where the pointer was', () => {
    const doc = newDoc();
    const at = { x: 300, y: 200 };
    const id = createStroke(doc, { points: [at], thickness: 'thick' }, 'drawer');
    expect(typeof id).toBe('string');
    const stroke = drawnStroke(doc, id as string);
    const size = PEN_THICKNESS_WORLD.thick;
    expect(stroke.width).toBe(size);
    expect(stroke.height).toBe(size);
    expect(stroke.x).toBe(at.x - size / 2);
    expect(stroke.y).toBe(at.y - size / 2);
    expect(objectBounds(stroke)).toEqual({
      x: at.x - size / 2,
      y: at.y - size / 2,
      width: size,
      height: size,
    });
  });

  it('stores one point as two numbers, at the middle of that square', () => {
    // The trail is flat (`[x0, y0, x1, y1, ...]`), so a dot is two numbers; and it is
    // stored relative to the box, which is why it sits at half the pen rather than at 0.
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 300, y: 200 }], thickness: 'thick' }) as string;
    const stroke = drawnStroke(doc, id);
    expect(stroke.points).toHaveLength(2);
    expect(strokePoints(stroke.points)).toEqual([
      { x: PEN_THICKNESS_WORLD.thick / 2, y: PEN_THICKNESS_WORLD.thick / 2 },
    ]);
    expect(stroke.baseWidth).toBe(PEN_THICKNESS_WORLD.thick);
    expect(stroke.baseHeight).toBe(PEN_THICKNESS_WORLD.thick);
  });

  it('is a dot of the pen, and clickable where it was drawn', () => {
    const doc = newDoc();
    const at = { x: 300, y: 200 };
    const id = createStroke(doc, { points: [at], thickness: 'thin' }) as string;
    const stroke = drawnStroke(doc, id);
    expect(strokeThickness(stroke)).toBe(PEN_THICKNESS_WORLD.thin);
    expect(strokeIsAt(stroke, at, 1)).toBe(true);
    // 10 units away is 10 units away from a 2-unit pen and a 6-pixel tolerance alike.
    expect(strokeIsAt(stroke, { x: at.x + 10, y: at.y }, 1)).toBe(false);
  });

  it('puts the dot on top of what was already there', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const stickyZ = objectSnapshot(doc).find((object) => object.id === sticky)?.z ?? 0;
    const id = createStroke(doc, { points: [{ x: 10, y: 10 }] }) as string;
    expect(drawnStroke(doc, id).z).toBe(stickyZ + 1);
  });

  it('remembers who drew it, and defaults the ink and the pen', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 10, y: 10 }] }, 'Priya') as string;
    const stroke = drawnStroke(doc, id);
    expect(stroke.createdBy).toBe('Priya');
    expect(stroke.color).toBe(DEFAULT_PEN_COLOR);
    expect(stroke.thickness).toBe(DEFAULT_PEN_THICKNESS);
    expect(stroke.type).toBe('stroke');
    expect(stroke.createdAt).toBeGreaterThan(0);
  });

  it('leaves the creator out when the tab had no name to give', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 10, y: 10 }] }) as string;
    expect(drawnStroke(doc, id).createdBy).toBeUndefined();
    expect(mapOf(doc, id)?.get('createdBy')).toBeUndefined();
  });

  it('is one transaction, and one object', () => {
    const doc = newDoc();
    let id = '';
    const updates = countUpdates(doc, () => {
      id = createStroke(doc, { points: arc(40) }, 'drawer') ?? '';
    });
    expect(updates).toBe(1);
    expect(strokeSnapshots(doc)).toHaveLength(1);
    expect(id).toBeTruthy();
    expect(objectsMap(doc).has(id)).toBe(true);
  });

  it('takes the default ink and the default pen when the call names neither', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 4, y: 4 }] }) as string;
    const stroke = drawnStroke(doc, id);
    expect(stroke.color).toBe(DEFAULT_PEN_COLOR);
    expect(stroke.thickness).toBe(DEFAULT_PEN_THICKNESS);
  });
});

/* ------------------------------------------- invalid input (TC-05: pen.share, D1) */

describe('createStroke (TC-05: invalid input must not create a stroke)', () => {
  it('writes nothing for a trail of no points', () => {
    const doc = newDoc();
    let result: string | null = 'not-called';
    const updates = countUpdates(doc, () => {
      result = createStroke(doc, { points: [] }, 'drawer');
    });
    expect(result).toBeNull();
    expect(updates).toBe(0);
    expect(objectsMap(doc).size).toBe(0);
  });

  it('writes nothing for a point that is not a number', () => {
    // The whole trail is rejected rather than the bad point dropped: a stroke missing
    // the point in the middle of a turn is not the stroke that was drawn, and it would
    // arrive on five screens as though it had been.
    const doc = newDoc();
    const bad: Point[] = [
      { x: 0, y: 0 },
      { x: Number.NaN, y: 10 },
      { x: 20, y: 20 },
    ];
    let result: string | null = 'not-called';
    const updates = countUpdates(doc, () => {
      result = createStroke(doc, { points: bad }, 'drawer');
    });
    expect(result).toBeNull();
    expect(updates).toBe(0);
    expect(strokeSnapshots(doc)).toHaveLength(0);
  });

  it('writes nothing for an infinite point, an undefined one, or a missing pair', () => {
    const doc = newDoc();
    const cases: Point[][] = [
      [{ x: Number.POSITIVE_INFINITY, y: 1 }],
      [{ x: 1, y: Number.NEGATIVE_INFINITY }],
      [{ x: undefined as unknown as number, y: 1 }],
      [undefined as unknown as Point],
    ];
    for (const points of cases) {
      let result: string | null = 'not-called';
      const updates = countUpdates(doc, () => {
        result = createStroke(doc, { points }, 'drawer');
      });
      expect(result).toBeNull();
      expect(updates).toBe(0);
    }
    expect(strokeSnapshots(doc)).toHaveLength(0);
  });

  it('writes nothing for an ink the palette has not, or a pen that does not exist', () => {
    const doc = newDoc();
    const points = [{ x: 1, y: 1 }];
    // '' and 'BLACK' are the two ways a value that looks like a colour is not one: a
    // palette that is asked for a name it has not does not draw in a guess. They are held
    // as `unknown` because the point of the test is the document's tolerance, not the
    // compiler's: the model is what has to refuse them.
    const colours: unknown[] = ['pink', '', 'BLACK', 'blue ', 42, true, []];
    const pens: unknown[] = ['huge', '', 'Medium', 'medium ', 0, false, {}];
    for (const color of colours) {
      let result: string | null = 'not-called';
      const updates = countUpdates(doc, () => {
        result = createStroke(doc, { points, color: color as PenColor }, 'drawer');
      });
      expect(result).toBeNull();
      expect(updates).toBe(0);
    }
    for (const thickness of pens) {
      let result: string | null = 'not-called';
      const updates = countUpdates(doc, () => {
        result = createStroke(doc, { points, thickness: thickness as PenThickness }, 'drawer');
      });
      expect(result).toBeNull();
      expect(updates).toBe(0);
    }
    expect(strokeSnapshots(doc)).toHaveLength(0);
  });

  it('writes nothing when there is no trail to store at all', () => {
    const doc = newDoc();
    let result: string | null = 'not-called';
    const updates = countUpdates(doc, () => {
      result = createStroke(doc, undefined as unknown as { points: Point[] }, 'drawer');
    });
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('still writes a stroke it can draw, after all that', () => {
    // The rejections above must not have left the document in a state where a good
    // stroke is refused too.
    const doc = newDoc();
    expect(createStroke(doc, { points: [{ x: 5, y: 5 }] })).toEqual(expect.any(String));
    expect(Object.keys(PEN_COLORS)).toHaveLength(6);
    expect(strokeSnapshots(doc)).toHaveLength(1);
  });
});

/* -------------------------------------------------- pen.resize (TC-06) */

describe('scaledPoints (TC-06: pen.resize)', () => {
  it('doubles every coordinate when the box is doubled', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: horizontal(30) }, 'drawer') as string;
    const stroke = drawnStroke(doc, id);
    const before = scaledPoints(stroke);
    expect(before).toEqual(strokePoints(stroke.points));

    // The resize is story 7's: two numbers on the object, the trail untouched. This is
    // what the object is drawn from afterwards.
    const resized: StrokeSnap = { ...stroke, width: (stroke.width as number) * 2, height: (stroke.height as number) * 2 };
    const after = scaledPoints(resized);
    expect(after).toHaveLength(before.length);
    for (let index = 0; index < before.length; index += 1) {
      expect(after[index].x).toBeCloseTo(before[index].x * 2, 6);
      expect(after[index].y).toBeCloseTo(before[index].y * 2, 6);
    }
  });

  it('leaves the ink alone while it scales the drawing', () => {
    // The pen is not a dimension: a stroke drawn twice as big is twice as long and
    // exactly as thick, which is what a person means by resizing a drawing.
    const doc = newDoc();
    const id = createStroke(doc, { points: horizontal(30), thickness: 'thick' }, 'drawer') as string;
    const stroke = drawnStroke(doc, id);
    const resized: StrokeSnap = { ...stroke, width: 400, height: 400 };
    expect(strokeThickness(resized)).toBe(PEN_THICKNESS_WORLD.thick);
    expect(resized.thickness).toBe('thick');
    expect(resized.points).toEqual(stroke.points);
  });

  it('scales each axis by its own factor when the box is stretched', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: horizontal(30) }, 'drawer') as string;
    const stroke = drawnStroke(doc, id);
    const baseWidth = stroke.baseWidth;
    const stretched: StrokeSnap = { ...stroke, width: baseWidth * 3 };
    for (let index = 0; index < strokePoints(stroke.points).length; index += 1) {
      expect(scaledPoints(stretched)[index].x).toBeCloseTo(strokePoints(stroke.points)[index].x * 3, 6);
    }
  });

  it('draws the points where they were put when there is nothing to scale from', () => {
    // A perfectly flat stroke still has a box: its height is the pen, because the box is
    // the ink's edge and not the trail's. That padding is what gives a horizontal line a
    // selection outline, a marquee and a resize handle at all.
    const doc = newDoc();
    const flatId = createStroke(doc, { points: horizontal(0) }, 'drawer') as string;
    const line = drawnStroke(doc, flatId);
    expect(line.height).toBe(PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS]);
    expect(line.baseHeight).toBe(PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS]);

    // And the fallback, which only a damaged or hand-written document can reach: with no
    // base to scale from there is no scale to apply, so the points are drawn where they
    // were put rather than at the origin, and 0/0 never becomes a coordinate.
    const broken: StrokeSnap = { ...line, baseHeight: 0, height: 120 };
    const scaled = scaledPoints(broken);
    for (const point of scaled) expect(Number.isFinite(point.y)).toBe(true);
    expect(scaled.map((point) => point.y)).toEqual(strokePoints(line.points).map((point) => point.y));
  });

  it('falls back to the size it came with when the box is missing', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: horizontal(30) }, 'drawer') as string;
    const stroke = drawnStroke(doc, id);
    const lost: StrokeSnap = { ...stroke, width: undefined, height: undefined };
    expect(scaledPoints(lost)).toEqual(strokePoints(stroke.points));
  });
});

/* ----------------------------------------------- pen.select (TC-07) */

describe('strokeIsAt (TC-07: pen.select)', () => {
  // A line from (0,30) to (100,30) with the default pen: the tolerance at zoom 1 is
  // STROKE_HIT_TOLERANCE_PX, because a 6-pixel target is wider than a 4-unit pen.
  const doc = newDoc();
  const id = createStroke(doc, { points: horizontal(30) }, 'drawer') as string;
  const stroke = drawnStroke(doc, id);
  const tolerance = STROKE_HIT_TOLERANCE_PX;

  it('counts a click on the line as a click on the line', () => {
    expect(strokeIsAt(stroke, { x: 50, y: 30 }, 1)).toBe(true);
    // The trail is stored from the box, so the distance the hit test measures is the
    // distance from the click to the box's own coordinates - which is what this checks
    // the hit test is doing, rather than checking the geometry module twice.
    expect(distanceToPolyline(scaledPoints(stroke), { x: 50 - stroke.x, y: 30 - stroke.y })).toBe(0);
  });

  it('counts a click 5.9 units off the line as a hit, and 6.1 as a miss', () => {
    // The boundaries either side of the tolerance, at zoom 1: 5.9 is inside a 6-pixel
    // target and 6.1 is outside it, and a stroke whose tolerance drifted a tenth would
    // pass an assertion written at whole numbers.
    expect(strokeIsAt(stroke, { x: 50, y: 30 + tolerance - 0.1 }, 1)).toBe(true);
    expect(strokeIsAt(stroke, { x: 50, y: 30 + tolerance + 0.1 }, 1)).toBe(false);
  });

  it('misses a click beside the ends of the line', () => {
    // The tolerance is around the line, not around its bounding box: 20 units past the
    // end of a stroke is a click on the board next to it.
    expect(strokeIsAt(stroke, { x: 120, y: 30 }, 1)).toBe(false);
  });

  it('keeps the target the size of the screen at 200% and at 50%', () => {
    // Board units per screen pixel is what the zoom divides: at 200% six screen pixels
    // are three board units, at 50% they are twelve. The same distance from the line is a
    // hit at one zoom and a miss at the other, and that is the whole promise - the line
    // is as easy to catch close up as it is far off.
    expect(strokeIsAt(stroke, { x: 50, y: 30 + 2.9 }, 2)).toBe(true);
    expect(strokeIsAt(stroke, { x: 50, y: 30 + 3.1 }, 2)).toBe(false);
    expect(strokeIsAt(stroke, { x: 50, y: 30 + 11 }, 0.5)).toBe(true);
    expect(strokeIsAt(stroke, { x: 50, y: 30 + 13 }, 0.5)).toBe(false);
  });

  it('never asks for less than the ink itself', () => {
    // A thick pen at 200%: six screen pixels is three board units, and half the ink is
    // four. A click that landed on ink the person could see, and was told was empty board,
    // would be the tool disagreeing with the screen.
    const thickDoc = newDoc();
    const thickId = createStroke(thickDoc, { points: horizontal(30), thickness: 'thick' }, 'drawer') as string;
    const thick = drawnStroke(thickDoc, thickId);
    expect(strokeIsAt(thick, { x: 50, y: 33.5 }, 2)).toBe(true);
    expect(strokeIsAt(thick, { x: 50, y: 30 + 4.1 }, 2)).toBe(false);
  });

  it('is a miss for a stroke with nothing to hit', () => {
    const empty: StrokeSnap = { ...stroke, points: [] };
    expect(strokeIsAt(empty, { x: 50, y: 30 }, 1)).toBe(false);
    expect(strokeIsAt(stroke, { x: Number.NaN, y: 30 }, 1)).toBe(false);
  });

  it('is a hit inside a loop only on the line, not in the middle', () => {
    // The rule that keeps a loop from swallowing the board inside it: the middle of a
    // drawn circle is 90 units from its own ink, and clicking there is a click on the
    // board, which starts a marquee rather than a selection.
    const loopDoc = newDoc();
    const loopId = createStroke(loopDoc, { points: circle }, 'drawer') as string;
    const loop = drawnStroke(loopDoc, loopId);
    const centre = { x: PATH_CENTRE.x, y: PATH_CENTRE.y };
    expect(strokeIsAt(loop, centre, 1)).toBe(false);
    expect(strokeIsAt(loop, { x: PATH_CENTRE.x, y: PATH_CENTRE.y - 90 }, 1)).toBe(true);
  });
});

/* ---------------------------------------------------- smoothPath (TC-08) */

describe('smoothPath (TC-08)', () => {
  it('moves to the first point and bends with quadratics through the rest', () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 4 },
      { x: 20, y: 0 },
    ]);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(' Q ');
    expect(d.endsWith('L 20 0')).toBe(true);
    // A curve aims at the middle of every pair, which is where the bend belongs.
    expect(d).toBe('M 0 0 Q 10 4 15 2 L 20 0');
  });

  it('answers the same path for the same points, twice', () => {
    const d = () => smoothPath(zigzag);
    expect(d()).toBe(d());
  });

  it('draws a single point as a path of no length, which is a round cap', () => {
    expect(smoothPath([{ x: 7, y: 9 }])).toBe('M 7 9 L 7 9');
  });

  it('draws two points as a straight line', () => {
    expect(smoothPath([{ x: 7, y: 9 }, { x: 11, y: 13 }])).toBe('M 7 9 L 11 13');
  });

  it('answers nothing at all for no points', () => {
    expect(smoothPath([])).toBe('');
  });

  it('writes no NaN for a point that is not a number', () => {
    // `d="M NaN NaN"` is not a path: the browser draws nothing and says nothing, so the
    // stroke would be on the board, on the wire, and invisible on every screen.
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 2 },
      { x: 4, y: 4 },
    ]);
    expect(d).not.toContain('NaN');
    expect(d).toBe('M 0 0 L 4 4');
  });

  it('keeps three decimals, which is far below a screen pixel', () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 0.0004, y: 1.23456 },
      { x: 2, y: 2 },
    ]);
    expect(d).toBe('M 0 0 Q 0 1.235 1 1.617 L 2 2');
  });
});

/* --------------------------------------- the type, as the model knows it */

describe('stroke registration', () => {
  it('is a type the document and the snapshot both know', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: arc(12) }, 'drawer') as string;
    const snapshot = objectSnapshot(doc).find((object) => object.id === id);
    expect(snapshot?.type).toBe('stroke');
    expect(snapshot?.id).toBe(id);
    expect((snapshot as StrokeSnap).points).toHaveLength(24);
    expect(STROKE_MIN_SIZE_WORLD).toBeLessThanOrEqual(PEN_THICKNESS_WORLD.thick);
    expect(STROKE_SIMPLIFY_TOLERANCE_PX).toBe(1);
    expect(STROKE_MAX_POINTS).toBe(5000);
  });
});
