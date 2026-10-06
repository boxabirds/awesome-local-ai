/**
 * The stroke model and its geometry (story 11, TC-01 … TC-08).
 *
 * A stroke is the first object on this board whose *shape* is data: two hundred numbers in a `Y.Map`, plus
 * four that say where and how big. Everything these tests check is arithmetic on those numbers — how far
 * the smoothed line may stray from the line that was drawn (TC-01, TC-02), where a run that grew past the
 * point limit is cut and what the two halves have to agree about at the cut (TC-03), what a stroke with one
 * point in it is (TC-04), what the model refuses to write (TC-05), how a line drawn at one size is drawn at
 * another (TC-06, TC-07), and what the drawing instruction looks like (TC-08).
 *
 * Two things are deliberately *not* tested here because they are not this model's business: how a drag
 * becomes points (the Pen tool, and the component tests that drive it), and how a stroke is selected, moved
 * or resized (story 7, which does not know a stroke from a sticky note — the registry entries that make it
 * behave that way are tested in `tests/component/StrokeObject.test.tsx`).
 *
 * As with every other suite here, `doc.on('update', …)` is what gets counted: "a rejected stroke writes
 * nothing" is a statement about transactions, and the update event is the only honest way to count them
 * from outside.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  createSticky,
  deleteObjects,
  initDoc,
  OBJECTS_MAP,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_COLOR_NAMES,
  PEN_THICKNESS_NAMES,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import {
  createStroke,
  isPenColor,
  isPenThickness,
  isStrokeSnapshot,
  penThicknessWorld,
  scaledPoints,
  strokeColorOf,
  strokeHitRadius,
  type CreateStrokeInput,
  type StrokeSnapshot,
} from '../../src/shared/objects/stroke';
import { handwrittenLoop, longSpiral, maxDeviation, underline } from '../fixtures/pen-paths';

/* ------------------------------------------------------------------ helpers */

/** The number of updates a document has sent since this was called. */
const updates = (doc: Y.Doc): number[] => {
  const counts: number[] = [];
  let count = 0;
  doc.on('update', () => {
    count += 1;
    counts.push(count);
  });
  return counts;
};

/** A board with nothing on it but its schema. */
const emptyDoc = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc); // the board's own write, which is not one of the transactions under test
  return doc;
};

/** The stroke on the board, or the failure of the test that asked for one. */
const strokeAt = (doc: Y.Doc, id: string | null): StrokeSnapshot => {
  if (id === null) throw new Error('the stroke was not created');
  const found = snapshot(doc).find((object) => object.id === id);
  if (!isStrokeSnapshot(found)) throw new Error(`stroke ${id} is not on the board`);
  return found;
};

/** A board with one stroke on it, made the way the Pen tool makes one. */
const withStroke = (
  points: readonly Point[],
  color: PenColor = DEFAULT_PEN_COLOR,
  thickness: PenThickness = DEFAULT_PEN_THICKNESS,
): { doc: Y.Doc; id: string; stroke: StrokeSnapshot } => {
  const doc = emptyDoc();
  const id = createStroke(doc, { points, color, thickness }, 'priya');
  return { doc, id: id ?? '', stroke: strokeAt(doc, id) };
};

/** The flattened points of a stroke, back into points. */
const unflatten = (values: readonly number[]): Point[] => {
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push({ x: Number(values[index]), y: Number(values[index + 1]) });
  }
  return points;
};

/** A world point on a stroke's line: the middle of the segment between its first two points. */
const onTheLine = (points: readonly Point[]): Point => {
  const first = points[0] as Point;
  const second = (points[1] ?? first) as Point;
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
};

/* ------------------------------------------------------------------ the settings themselves */

describe('pen settings', () => {
  it('offers six colours and three thicknesses, in the order the toolbar draws them', () => {
    // The toolbar is a rendering of these two objects, so the order they are written in is the order a
    // person sees swatches in, and a setting added in the middle would move a button.
    expect(PEN_COLOR_NAMES).toEqual(['black', 'blue', 'red', 'green', 'orange', 'purple']);
    expect(PEN_THICKNESS_NAMES).toEqual(['thin', 'medium', 'thick']);
    expect(Object.keys(PEN_COLORS)).toHaveLength(6);
    expect(Object.keys(PEN_THICKNESS_WORLD)).toHaveLength(3);
  });

  it('starts black and medium, which is what an untouched toolbar has lit', () => {
    expect(DEFAULT_PEN_COLOR).toBe('black');
    expect(DEFAULT_PEN_THICKNESS).toBe('medium');
    expect(isPenColor(DEFAULT_PEN_COLOR)).toBe(true);
    expect(isPenThickness(DEFAULT_PEN_THICKNESS)).toBe(true);
  });

  it('names a colour every stroke is stored under, and draws it from the name', () => {
    expect(strokeColorOf('red')).toBe(PEN_COLORS.red);
    // A colour from a client with a bigger palette is drawn in the default rather than in nothing at all:
    // an invisible stroke is a stroke that appears to have been lost.
    expect(strokeColorOf('chartreuse' as PenColor)).toBe(PEN_COLORS[DEFAULT_PEN_COLOR]);
    expect(strokeColorOf(undefined as unknown as PenColor)).toBe(PEN_COLORS.black);
  });

  it('draws a thickness in world units, and the default for one it does not know', () => {
    expect(penThicknessWorld('thin')).toBe(2);
    expect(penThicknessWorld('medium')).toBe(4);
    expect(penThicknessWorld('thick')).toBe(8);
    expect(penThicknessWorld('huge' as PenThickness)).toBe(PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS]);
    // The floor a resize stops at is a floor on the *box*, not on the ink: a thin dot is 2 units across,
    // so the first drag of a corner can only grow it. That is the right way round — the alternative is a
    // stroke that shrinks to a box nobody can click in.
    expect(STROKE_MIN_SIZE_WORLD).toBe(4);
    expect(PEN_THICKNESS_NAMES.map(penThicknessWorld)).toEqual([2, 4, 8]);
  });

  it('keeps the smoothing and hit tolerances in screen pixels', () => {
    // Both are statements about a pointer and an eye, so both are stated in pixels and divided by the
    // zoom wherever they are used. A setting that silently became a world unit would make a stroke
    // impossible to pick up at 50 %.
    expect(STROKE_SIMPLIFY_TOLERANCE_PX).toBe(1);
    expect(STROKE_HIT_TOLERANCE_PX).toBe(6);
  });
});

/* ------------------------------------------------------------------ TC-01, TC-02: smoothing stays faithful */

describe('TC-01: simplify keeps a drawn loop within its tolerance', () => {
  const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX; // 1 world unit, which is 1 pixel at zoom 1
  /** The loop, smoothed the way a stroke drawn at 100 % is smoothed. */
  const result = (): Point[] => simplify(handwrittenLoop, tolerance);

  it('leaves every point the hand drew within the tolerance of the line that is kept', () => {
    // This single assertion *is* the PRD's "no point of the finished stroke lies farther than 1 screen
    // pixel from the path the user drew", for the zoom the stroke was drawn at.
    expect(maxDeviation(handwrittenLoop, result())).toBeLessThanOrEqual(tolerance);
  });

  it('writes fewer points than it was given', () => {
    // A simplifier that kept everything is faithful and useless: the whole point is the document that is
    // not carrying four hundred numbers for a shape that needs a hundred and ten.
    expect(result().length).toBeLessThan(handwrittenLoop.length);
    expect(result().length).toBeGreaterThan(1);
  });

  it('keeps the first and the last point, which are the ends of the pen', () => {
    expect(result()[0]).toEqual(handwrittenLoop[0]);
    expect(result()[result().length - 1]).toEqual(handwrittenLoop[handwrittenLoop.length - 1]);
  });

  it('returns the points it is given when there is nothing to throw away', () => {
    const three: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    // A corner a tolerance of 1 may not shave is a corner that stays, at any point count.
    expect(simplify(three, 1)).toEqual(three);
  });

  it('says nothing about points that never were', () => {
    expect(simplify([], 1)).toEqual([]);
    const one: Point[] = [{ x: 3, y: 4 }];
    expect(simplify(one, 1)).toEqual(one);
  });

  it('is a straight line when the tolerance is the whole wobble', () => {
    // The underline is 120 points of ±1.5 wobble on a 360-long run; a tolerance of 10 cannot see any of
    // it, and the honest answer to "what did they draw" becomes "a line from here to there".
    expect(simplify(underline, 10)).toHaveLength(2);
  });
});
describe('TC-02: the tolerance the zoom gives is the tolerance that is met', () => {
  it('holds every drawn point within 0.5 units at 200 %', () => {
    // The tool divides the pixel tolerance by the zoom, so a stroke drawn at 200 % is smoothed to half a
    // world unit — finer, because at that zoom a pixel is a finer thing.
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / 2;
    const result = simplify(handwrittenLoop, tolerance);
    expect(maxDeviation(handwrittenLoop, result)).toBeLessThanOrEqual(tolerance);
    expect(result.length).toBeLessThan(handwrittenLoop.length);
  });

  it('holds them within 2 units at 50 %, and keeps fewer points for it', () => {
    const coarse = simplify(handwrittenLoop, STROKE_SIMPLIFY_TOLERANCE_PX / 0.5);
    expect(maxDeviation(handwrittenLoop, coarse)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX / 0.5);
    // Zoomed out, the same drawing is made of fewer pixels, so it may be made of fewer numbers too.
    expect(coarse.length).toBeLessThan(simplify(handwrittenLoop, STROKE_SIMPLIFY_TOLERANCE_PX).length);
  });

  it('does not simplify at all when the tolerance is not a number, or is negative', () => {
    // A tolerance that means nothing is a caller that measured nothing; points are kept rather than
    // thrown away on the strength of it.
    expect(simplify(underline, Number.NaN)).toEqual([...underline]);
    expect(simplify(underline, -1)).toEqual([...underline]);
    expect(simplify(underline, 0).length).toBeLessThanOrEqual(underline.length);
  });
});

/* ------------------------------------------------------------------ TC-03: the point limit */

describe('TC-03: splitPoints cuts a long run into pieces that join', () => {
  const spiral = longSpiral; // 5,010 points, i.e. the limit plus ten
  const countAt = (count: number): Point[] => spiral.slice(0, count);

  it('leaves a run below the limit alone', () => {
    const parts = splitPoints(countAt(STROKE_MAX_POINTS - 1));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS - 1);
  });

  it('leaves a run of exactly the limit alone', () => {
    const parts = splitPoints(countAt(STROKE_MAX_POINTS));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
  });

  it('cuts a run past the limit into two, and the second starts where the first ended', () => {
    const parts = splitPoints(countAt(STROKE_MAX_POINTS + 1));
    expect(parts).toHaveLength(2);
    const first = parts[0] as Point[];
    const second = parts[1] as Point[];
    expect(first).toHaveLength(STROKE_MAX_POINTS);
    // The shared point is the whole of what makes two strokes read as one line: the first ends on it and
    // the second begins on it, so there is no segment missing between them and no gap to see.
    expect(second[0]).toEqual(first[first.length - 1]);
    expect(second).toHaveLength(2);
  });

  it('covers every point, in order, exactly once apart from the joins', () => {
    const parts = splitPoints(countAt(STROKE_MAX_POINTS + 10));
    const joined = parts.reduce<Point[]>((all, part) => (all.length === 0 ? [...part] : [...all, ...part.slice(1)]), []);
    expect(joined).toEqual(countAt(STROKE_MAX_POINTS + 10));
  });

  it('keeps every piece at or under the limit and at least two points long', () => {
    // A piece of one point would be a stroke that is a dot in the middle of a line, which is a visible
    // defect at the join, so the splitter does not make one.
    for (const count of [5001, 7500, 12000]) {
      for (const part of splitPoints(countAt(count))) {
        expect(part.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
        expect(part.length).toBeGreaterThanOrEqual(2);
      }
    }
    // A limit smaller than the setting behaves the same way, which is what the boundary above rests on.
    for (const count of [1, 2, 3, 4, 5, 10]) {
      const parts = splitPoints(countAt(count), 3);
      for (const part of parts) {
        expect(part.length).toBeLessThanOrEqual(3);
        expect(part.length).toBeGreaterThanOrEqual(Math.min(2, count));
      }
      const covered = parts.reduce<Point[]>((all, part) => (all.length === 0 ? [...part] : [...all, ...part.slice(1)]), []);
      expect(covered).toEqual(countAt(count));
    }
  });

  it('takes its limit from the setting when it is not told one', () => {
    expect(splitPoints(countAt(STROKE_MAX_POINTS + 1))[0]).toHaveLength(STROKE_MAX_POINTS);
  });

  it('says nothing about a run that never was, and refuses a limit that is not a number', () => {
    expect(splitPoints([])).toEqual([]);
    expect(splitPoints(underline, Number.NaN)).toHaveLength(1);
    expect(splitPoints(underline, 1)).toHaveLength(1);
    expect(splitPoints(underline, 0)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ TC-04: a dot */

describe('TC-04: one point is a dot, and a dot is an object', () => {
  const dot = (color: PenColor = 'black', thickness: PenThickness = 'thick') =>
    withStroke([{ x: 100, y: 100 }], color, thickness);

  it('is a box exactly one thickness across', () => {
    const { stroke } = dot();
    // The bbox is the point padded by half a thickness on every side, which for one point is the point
    // itself grown into the round dot the PRD asks for: 8 world units across for a thick pen, drawn as a
    // zero-length stroke with a round cap.
    expect(stroke.width).toBe(PEN_THICKNESS_WORLD.thick);
    expect(stroke.height).toBe(PEN_THICKNESS_WORLD.thick);
    expect(stroke.x).toBe(100 - PEN_THICKNESS_WORLD.thick / 2);
    expect(stroke.y).toBe(100 - PEN_THICKNESS_WORLD.thick / 2);
  });

  it('stores the one point relative to its own box', () => {
    const { stroke } = dot();
    expect(stroke.points).toHaveLength(2);
    // The centre of the dot, in units since the box's top-left: half a thickness in from each side.
    expect(stroke.points).toEqual([PEN_THICKNESS_WORLD.thick / 2, PEN_THICKNESS_WORLD.thick / 2]);
    expect(scaledPoints(stroke)).toEqual([{ x: 100, y: 100 }]);
  });

  it('is listed by the snapshot as a stroke, above everything else', () => {
    // The dot the Pen tool makes after a note was put down is drawn on top of that note, because it was
    // drawn after it — the same stacking rule every other object gets from `maxZ`, and the one a stroke
    // drawn round a cluster of notes depends on.
    const doc = emptyDoc();
    const sticky = createSticky(doc, { x: 100, y: 100 });
    const id = createStroke(doc, { points: [{ x: 100, y: 100 }], color: 'black', thickness: 'thick' }, 'priya');
    const stroke = snapshot(doc).find((object) => object.id === id);
    const note = snapshot(doc).find((object) => object.id === sticky);
    expect(isStrokeSnapshot(stroke)).toBe(true);
    expect(isStrokeSnapshot(note)).toBe(false);
    expect(stroke?.type).toBe('stroke');
    expect(Number(stroke?.z)).toBeGreaterThan(Number(note?.z));
  });

  it('is drawn in the colour and thickness it was drawn with', () => {
    const { stroke } = dot();
    expect(stroke.color).toBe('black');
    expect(stroke.thickness).toBe('thick');
    expect(stroke.baseWidth).toBe(PEN_THICKNESS_WORLD.thick);
    expect(stroke.baseHeight).toBe(PEN_THICKNESS_WORLD.thick);
  });

  it('records who drew it', () => {
    const { doc, id } = dot();
    const raw = (doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get(id) as Y.Map<unknown>).get('createdBy');
    expect(raw).toBe('priya');
  });

  it('is one transaction', () => {
    const { doc } = dot();
    const counts = updates(doc);
    createStroke(doc, { points: [{ x: 1, y: 1 }], color: 'blue', thickness: 'thin' }, 'sam');
    expect(counts).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ TC-05: what is refused */

describe('TC-05: an invalid stroke writes nothing', () => {
  const rejected: [string, () => CreateStrokeInput][] = [
    ['no points at all', () => ({ points: [], color: 'black', thickness: 'thin' })],
    ['a coordinate that is not a number', () => ({ points: [{ x: Number.NaN, y: 4 }], color: 'black', thickness: 'thin' })],
    ['an infinite coordinate', () => ({ points: [{ x: 1, y: Number.POSITIVE_INFINITY }], color: 'black', thickness: 'thin' })],
    ['a point that is not a point', () => ({ points: [null as unknown as Point], color: 'black', thickness: 'thin' })],
    ['a colour it has no ink for', () => ({ points: [{ x: 1, y: 1 }], color: 'pink' as PenColor, thickness: 'thin' })],
    ['a thickness it cannot draw', () => ({ points: [{ x: 1, y: 1 }], color: 'black', thickness: 'huge' as PenThickness })],
    ['no points and no colour', () => ({ points: [], color: 'pink' as PenColor })],
  ];

  for (const [what, input] of rejected) {
    it(`refuses ${what}: no stroke, and no transaction at all`, () => {
      const doc = emptyDoc();
      const counts = updates(doc);
      expect(createStroke(doc, input(), 'priya')).toBeNull();
      // Not "no stroke and one wasted transaction": an undo stack full of writes that wrote nothing is a
      // history whose steps do not match the things a person did.
      expect(counts).toHaveLength(0);
      expect(snapshot(doc)).toEqual([]);
    });
  }

  it('refuses a document that is not a document', () => {
    expect(() => createStroke(undefined as unknown as Y.Doc, { points: [{ x: 0, y: 0 }] })).toThrow(TypeError);
  });

  it('refuses a stroke whose points are all in the same place only when there are none', () => {
    // Five points on one spot is a pointer that trembled without moving: a dot is a fair reading of it,
    // and it is the same box a one-point stroke gets.
    const points = Array.from({ length: 5 }, () => ({ x: 10, y: 10 }));
    const { stroke } = withStroke(points, 'black', 'thin');
    expect(stroke.width).toBe(PEN_THICKNESS_WORLD.thin);
    expect(stroke.height).toBe(PEN_THICKNESS_WORLD.thin);
  });
});

/* ------------------------------------------------------------------ the points, and where they live */

describe('a finished stroke stores a line, not a drag', () => {
  it('pads the box by half a thickness so the ink is never cut by the box', () => {
    const { stroke } = withStroke(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      'red',
      'medium',
    );
    const pad = PEN_THICKNESS_WORLD.medium / 2;
    expect(stroke.x).toBe(0 - pad);
    expect(stroke.y).toBe(0 - pad);
    expect(stroke.width).toBe(100 + pad * 2);
    expect(stroke.height).toBe(50 + pad * 2);
    // The base size is the size it was drawn at, and it never changes: it is the denominator every later
    // render scales against.
    expect(stroke.baseWidth).toBe(stroke.width);
    expect(stroke.baseHeight).toBe(stroke.height);
  });

  it('stores points relative to the box, in the order they were drawn', () => {
    const { stroke } = withStroke(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      'red',
      'medium',
    );
    expect(unflatten(stroke.points)).toEqual([
      { x: PEN_THICKNESS_WORLD.medium / 2, y: PEN_THICKNESS_WORLD.medium / 2 },
      { x: 100 + PEN_THICKNESS_WORLD.medium / 2, y: PEN_THICKNESS_WORLD.medium / 2 },
      { x: 100 + PEN_THICKNESS_WORLD.medium / 2, y: 50 + PEN_THICKNESS_WORLD.medium / 2 },
    ]);
  });

  it('reads back the same line it was given, in world units', () => {
    const { stroke } = withStroke(underline, 'blue', 'thin');
    const points = scaledPoints(stroke);
    expect(points).toHaveLength(underline.length);
    expect(maxDeviation(points, underline)).toBeLessThanOrEqual(1e-9);
  });

  it('holds the points as plain numbers in the document', () => {
    const { doc, id } = withStroke(underline, 'blue', 'thin');
    const entry = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get(id) as Y.Map<unknown>;
    const stored = entry.get('points');
    expect(Array.isArray(stored)).toBe(true);
    expect((stored as number[]).every((value) => typeof value === 'number' && Number.isFinite(value))).toBe(true);
    expect((stored as number[]).length).toBe(underline.length * 2);
  });

  it('is not disturbed by a stroke that arrives from somebody else', () => {
    const mine = emptyDoc();
    const theirs = emptyDoc();
    const id = createStroke(theirs, { points: underline, color: 'green', thickness: 'thick' }, 'sam');
    Y.applyUpdate(mine, Y.encodeStateAsUpdate(theirs));
    const stroke = strokeAt(mine, id);
    expect(stroke.color).toBe('green');
    expect(scaledPoints(stroke)).toHaveLength(underline.length);
  });

  it('survives being deleted with everything else', () => {
    const { doc, id } = withStroke(underline);
    createSticky(doc, { x: 0, y: 0 });
    expect(deleteObjects(doc, [id])).toBe(1);
    expect(snapshot(doc).some((object) => object.id === id)).toBe(false);
  });
});

/* ------------------------------------------------------------------ TC-06: scaled points */

describe('TC-06: a resized stroke scales its line and nothing else', () => {
  const corner = (): { doc: Y.Doc; id: string; stroke: StrokeSnapshot } =>
    withStroke(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      'purple',
      'medium',
    );

  /** The same stroke resized by the story 7 gesture, which is the only way a stroke gets resized. */
  const resized = (
    factor: number,
    axis: 'width' | 'height' | 'both',
  ): { stroke: StrokeSnapshot; before: Point[] } => {
    const { doc, id, stroke } = corner();
    const before = scaledPoints(stroke);
    const width = axis === 'height' ? stroke.width! : stroke.width! * factor;
    const height = axis === 'width' ? stroke.height! : stroke.height! * factor;
    resizeObjects(doc, new Map([[id, { x: stroke.x, y: stroke.y, width, height }]]));
    return { stroke: strokeAt(doc, id), before };
  };

  it('doubles every coordinate of the line when the box doubles', () => {
    const { stroke: grown, before } = resized(2, 'both');
    expect(grown.width).toBe(200 + PEN_THICKNESS_WORLD.medium * 2);
    expect(grown.height).toBe(100 + PEN_THICKNESS_WORLD.medium * 2);
    const after = scaledPoints(grown);
    expect(after).toHaveLength(before.length);
    after.forEach((point, index) => {
      // Measured from the box's own top-left, which is what "the line doubled" means when the box is the
      // thing that was dragged: the drawing grew from where it stood, it did not slide away.
      const was = { x: (before[index] as Point).x - grown.x!, y: (before[index] as Point).y - grown.y! };
      const now = { x: point.x - grown.x!, y: point.y - grown.y! };
      expect(now.x).toBeCloseTo(was.x * 2, 6);
      expect(now.y).toBeCloseTo(was.y * 2, 6);
    });
  });

  it('leaves the thickness alone, because thickness is a choice and not a shape', () => {
    // The ink of a stroke that was enlarged twice does not become twice as thick: a sketch that grew is
    // the same sketch drawn with the same pen.
    const { stroke } = resized(2, 'both');
    expect(stroke.thickness).toBe('medium');
    expect(penThicknessWorld(stroke.thickness)).toBe(4);
  });

  it('scales one axis alone when a handle is dragged that way', () => {
    const { stroke: wider } = resized(3, 'width');
    const points = scaledPoints(wider);
    // The third point was drawn at (100, 50), which is 102 across and 52 down from the box's corner — the
    // corner starts half a medium pen up and to the left. Tripling the width triples the 102 and leaves
    // the 52 alone, because only the east handle was dragged.
    expect(points[2]?.x).toBeCloseTo(wider.x! + (100 + 2) * 3, 6);
    expect(points[2]?.y).toBeCloseTo(wider.y! + (50 + 2), 6);
  });

  it('draws the line where the box is, after a move', () => {
    const { doc, id, stroke } = withStroke(underline, 'blue', 'thin');
    const moved = { x: stroke.x + 500, y: stroke.y - 200, width: stroke.width!, height: stroke.height! };
    resizeObjects(doc, new Map([[id, moved]]));
    const points = scaledPoints(strokeAt(doc, id));
    expect(points[0]?.x).toBeCloseTo((underline[0] as Point).x + 500, 6);
    expect(points[0]?.y).toBeCloseTo((underline[0] as Point).y - 200, 6);
  });

  it('refuses a size that is not a size rather than drawing a line of NaN', () => {
    const { doc, id } = withStroke(underline, 'blue', 'thin');
    // Story 7's resize is the only writer, and it refuses a non-finite rectangle; so the document cannot
    // hold a stroke with a width that is not a number — unless a newer client wrote one, which is what a
    // render has to be able to meet.
    const entry = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get(id) as Y.Map<unknown>;
    doc.transact(() => {
      entry.set('width', Number.NaN);
      entry.set('baseWidth', 0);
    });
    const broken = strokeAt(doc, id);
    expect(() => scaledPoints(broken)).not.toThrow();
    expect(scaledPoints(broken).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });
});

/* ------------------------------------------------------------------ TC-07: how near is on the line */

describe('TC-07: a click is on the line when it is near the line', () => {
  const stroke = (): StrokeSnapshot =>
    withStroke(
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      'black',
      'medium',
    ).stroke;
  const line = (): Point[] => scaledPoints(stroke());
  const middle = (): Point => onTheLine(line());

  it('is on it at zero distance', () => {
    expect(distanceToPolyline(line(), middle())).toBe(0);
    expect(STROKE_HIT_TOLERANCE_PX).toBe(6);
  });

  it('is still on it 5.9 units away at zoom 1', () => {
    const near = { x: middle().x, y: middle().y + 5.9 };
    expect(distanceToPolyline(line(), near)).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);
    expect(distanceToPolyline(line(), near)).toBeLessThanOrEqual(strokeHitRadius(stroke(), 1));
  });

  it('is not on it 6.1 units away at zoom 1', () => {
    const far = { x: middle().x, y: middle().y + 6.1 };
    expect(distanceToPolyline(line(), far)).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
    expect(distanceToPolyline(line(), far)).toBeGreaterThan(strokeHitRadius(stroke(), 1));
  });

  it('never asks for less than half the ink, because the ink is clickable all of it', () => {
    // A thick line is 8 units wide, so a click 4.5 units off the centre of it is on the ink even though it
    // is farther than the tolerance at this zoom.
    const thick = withStroke(
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      'black',
      'thick',
    ).stroke;
    expect(strokeHitRadius(thick, 2)).toBe(PEN_THICKNESS_WORLD.thick / 2);
    expect(strokeHitRadius(thick, 1)).toBe(STROKE_HIT_TOLERANCE_PX);
  });

  it('gets finer as the board gets bigger, in world units', () => {
    // 6 screen pixels at 200 % is 3 world units: the same difficulty of click, whatever the zoom.
    expect(strokeHitRadius(stroke(), 2)).toBe(3);
    expect(strokeHitRadius(stroke(), 0.5)).toBe(12);
  });

  it('asks something impossible of a zoom that is not a zoom', () => {
    // Better unclickable than clickable from anywhere: a board that cannot say the zoom does not get to
    // select things by accident.
    expect(strokeHitRadius(stroke(), Number.NaN)).toBe(Number.POSITIVE_INFINITY);
    expect(strokeHitRadius(stroke(), 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

/* ------------------------------------------------------------------ TC-08: the drawing instruction */

describe('TC-08: smoothPath draws the kept points as one smooth line', () => {
  const three: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 20 },
    { x: 20, y: 0 },
  ];

  it('starts at the first point and curves through the rest', () => {
    const d = smoothPath(three);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    // Deterministic, because it is a string in a `d` attribute that a test and a renderer both read.
    expect(smoothPath(three)).toBe(d);
  });

  it('begins and ends where the line begins and ends', () => {
    // The curve is what a person sees; if it did not start and stop on their first and last point, every
    // stroke would be short at both ends by whatever the curve pulled in.
    const d = smoothPath(three);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('20 0')).toBe(true);
  });

  it('says nothing for points that were never drawn', () => {
    expect(smoothPath([])).toBe('');
  });

  it('makes a zero-length path for one point, which is what draws the dot', () => {
    // A subpath with a round cap and no length is a filled circle of the stroke's width, which is the dot
    // the PRD asks for — drawn by the same element as every line, with no second code path.
    const d = smoothPath([{ x: 12, y: 34 }]);
    expect(d).toBe('M 12 34 L 12 34');
  });

  it('draws two points as a straight run, because there is no midpoint to curve through', () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 40, y: 10 },
    ]);
    expect(d).toBe('M 0 0 L 40 10');
  });

  it('curves from the midpoint of each segment to the next, controlled by the point between', () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 0 },
      { x: 30, y: 20 },
    ]);
    expect(d).toBe('M 0 0 Q 10 20 15 10 Q 20 0 25 10 L 30 20');
  });

  it('is the same string for the same line, however the numbers arrived', () => {
    const points: Point[] = [
      { x: 1.005, y: 2 },
      { x: 3, y: 4.5 },
      { x: 5, y: 6 },
    ];
    expect(smoothPath(points)).toBe(smoothPath(points.map((point) => ({ x: point.x + 0, y: point.y + 0 }))));
    // Rounded to a sub-pixel precision and never in exponential notation, which an SVG path cannot read.
    expect(smoothPath(points)).not.toContain('e+');
  });
});

/* ------------------------------------------------------------------ the snapshot's reading of a stroke */

describe('a stroke the document cannot be trusted about', () => {
  /** A stroke written straight into the document, the way a newer client's would arrive. */
  const seededStroke = (fields: Record<string, unknown>): StrokeSnapshot => {
    const doc = emptyDoc();
    const id = 'stroke-like';
    doc.transact(() => {
      const map = new Y.Map<unknown>();
      map.set('type', 'stroke');
      map.set('x', 0);
      map.set('y', 0);
      map.set('width', 100);
      map.set('height', 40);
      map.set('z', 1);
      map.set('createdAt', 1);
      map.set('points', [0, 0, 100, 40]);
      map.set('baseWidth', 100);
      map.set('baseHeight', 40);
      map.set('color', 'black');
      map.set('thickness', 'medium');
      for (const [key, value] of Object.entries(fields)) map.set(key, value);
      doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).set(id, map);
    });
    const found = snapshot(doc).find((object) => object.id === id);
    if (!isStrokeSnapshot(found)) throw new Error('the stroke was not read back');
    return found;
  };

  it('is read with the fields it has, and defaults for the ones it has not', () => {
    const stroke = seededStroke({});
    expect(stroke.color).toBe('black');
    expect(stroke.thickness).toBe('medium');
    expect(stroke.points).toHaveLength(4);
    expect(scaledPoints(stroke)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 40 },
    ]);
  });

  it('falls back to the defaults for a colour or thickness it has never heard of', () => {
    const stroke = seededStroke({ color: 'pink', thickness: 'huge' });
    expect(stroke.color).toBe(DEFAULT_PEN_COLOR);
    expect(stroke.thickness).toBe(DEFAULT_PEN_THICKNESS);
  });

  it('reads a line it cannot draw as no line at all, rather than as NaN', () => {
    expect(scaledPoints(seededStroke({ points: 'not a line' }))).toEqual([]);
    expect(scaledPoints(seededStroke({ points: [0, 0, Number.NaN, 4] }))).toEqual([{ x: 0, y: 0 }]);
    expect(scaledPoints(seededStroke({ points: [0, 0, 1] }))).toEqual([{ x: 0, y: 0 }]);
    expect(scaledPoints(seededStroke({ points: null }))).toEqual([]);
  });

  it('draws at 1:1 when it was never told what size the line was drawn at', () => {
    // A stroke written by a client that stored no base size is as big as the box it is in; guessing a
    // scale from a missing number would be a line drawn twice as large as anybody asked for.
    expect(scaledPoints(seededStroke({ baseWidth: 0, baseHeight: 0 }))).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 40 },
    ]);
    expect(scaledPoints(seededStroke({ baseWidth: Number.NaN }))).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 40 },
    ]);
  });
});
