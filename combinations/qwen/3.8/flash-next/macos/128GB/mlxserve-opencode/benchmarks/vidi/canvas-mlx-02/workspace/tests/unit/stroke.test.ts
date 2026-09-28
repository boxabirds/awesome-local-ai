// Story 11, stroke.model (unit): the freehand geometry and the stroke object,
// against a real Y.Doc and the recorded paths in tests/fixtures/pen-paths.ts.
//
// The rule the whole story rests on is the smoothing promise: a stroke may be
// simplified until it is cheap to store and quick to draw, but not by one pixel
// more than the person drew - so every test here measures the DISTANCE from a raw
// recorded point to the finished path, with the same shared polyline distance the
// board uses to select a stroke.
//
// The model half is the other half: a stroke is an ordinary board object, so what
// is stored is a box plus the path relative to that box, and the only thing a
// resize does is change the box - scaledPoints turns that back into a drawing.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify.ts';
import {
  createStroke,
  scaledPoints,
  isPenColor,
  isPenThickness,
  isStrokeSnapshot,
  STROKE_TYPE,
  type StrokeSnapshot,
} from '../../src/shared/objects/stroke.ts';
import { distanceToPolyline } from '../../src/shared/geometry/polyline.ts';
import {
  initDoc,
  objectsMapOf,
  objectsSnapshot,
  objectBounds,
  resizeObjects,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model.ts';
import type { Point, Rect } from '../../src/shared/geometry.ts';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../src/shared/config.ts';
import { HANDWRITTEN_LOOP, SPIRAL_5010, UNDERLINE } from '../fixtures/pen-paths.ts';

const BY = 'g_test';

function setup(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** How far the raw path strays from the simplified one (world units). */
function maxDeviation(raw: readonly Point[], result: readonly Point[]): number {
  let max = 0;
  for (const p of raw) max = Math.max(max, distanceToPolyline(result, p));
  return max;
}

/** Draw with the pen: the tool's own call, defaults and all. */
const draw = (
  doc: Y.Doc,
  points: readonly Point[],
  color = DEFAULT_PEN_COLOR,
  thickness = DEFAULT_PEN_THICKNESS,
): string | null => createStroke(doc, { points, color, thickness }, BY);

/** The nth stroke on the board. */
function strokeAt(doc: Y.Doc, n = 0): StrokeSnapshot {
  const obj = objectsSnapshot(doc).filter((o) => o.type === STROKE_TYPE)[n];
  if (!obj || !isStrokeSnapshot(obj)) throw new Error(`no stroke #${n} on the board`);
  return obj;
}

const boxOf = (s: StrokeSnapshot): Rect => objectBounds(s);

/** The box a stroke's path describes, padded by half the thickness on every side. */
const boxOfPath = (points: readonly Point[], thickness: number): Rect => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = thickness / 2;
  return {
    x: Math.min(...xs) - pad,
    y: Math.min(...ys) - pad,
    width: Math.max(...xs) - Math.min(...xs) + pad * 2,
    height: Math.max(...ys) - Math.min(...ys) + pad * 2,
  };
};

describe('simplify (TC-01, TC-02)', () => {
  it('keeps a handwritten loop within the tolerance of what was drawn, with fewer points', () => {
    const result = simplify(HANDWRITTEN_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX);

    // The promise: nothing the person drew is more than the tolerance away.
    expect(maxDeviation(HANDWRITTEN_LOOP, result)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX + 1e-9);
    // The point of doing it at all: the stroke is smaller than the recording.
    expect(result.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    // The ends belong to the person who drew them: first and last are kept exactly.
    expect(result[0]).toEqual(HANDWRITTEN_LOOP[0]);
    expect(result[result.length - 1]).toEqual(HANDWRITTEN_LOOP[HANDWRITTEN_LOOP.length - 1]);
  });

  it('is as faithful at 200% zoom as at 100%, because the tolerance is a screen distance', () => {
    // The Pen tool divides the pixel tolerance by the zoom it drew at, so drawing
    // at 200% smooths to half a world unit.
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / 2;
    const result = simplify(HANDWRITTEN_LOOP, tolerance);

    expect(maxDeviation(HANDWRITTEN_LOOP, result)).toBeLessThanOrEqual(tolerance + 1e-9);
    // Half a world unit of slack on a shaky line keeps a good deal more of it,
    // which is the trade the requirement makes: faithful first, small second.
    expect(result.length).toBeLessThanOrEqual(HANDWRITTEN_LOOP.length);
  });

  it('compresses a straight-ish run and refuses to round off a turn', () => {
    const line = simplify(UNDERLINE, 1);
    expect(maxDeviation(UNDERLINE, line)).toBeLessThanOrEqual(1 + 1e-9);
    expect(line.length).toBeLessThan(UNDERLINE.length);

    // A corner is not noise: dropping it would put the drawn point 50 units away.
    const corner: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ];
    expect(simplify(corner, 1)).toEqual(corner);

    // A point that lies ON the run between its neighbours is exactly what it may
    // drop, and drops.
    expect(simplify([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], 1)).toEqual(corner);
  });

  it('is total: throws nothing, invents nothing', () => {
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([{ x: 5, y: 7 }], 1)).toEqual([{ x: 5, y: 7 }]);
    // A tolerance that cannot be honoured by dropping points drops nothing.
    const weird: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(simplify(weird, Number.NaN)).toEqual(weird);
    expect(simplify(weird, -1)).toEqual(weird);
    expect(simplify(weird, 0)).toEqual(weird);
    // A point that is not a point is not carried into the result, and the run it
    // left behind is a straight line the middle of it may go.
    expect(
      simplify(
        [
          { x: 0, y: 0 },
          { x: Number.NaN, y: 4 },
          { x: 10, y: 10 },
          { x: 20, y: 20 },
        ],
        0.5,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 20 },
    ]);
  });
});

describe('splitPoints (TC-03)', () => {
  const at = (n: number): Point[] => Array.from({ length: n }, (_unused, i) => ({ x: i, y: i * 2 }));
  const last = (part: readonly Point[]): Point => part[part.length - 1];
  /** Every recorded point, with the join point each part repeats counted once. */
  const covered = (parts: readonly (readonly Point[])[]): Point[] =>
    parts.flatMap((part, i) => (i === 0 ? part.map((p) => ({ ...p })) : part.slice(1).map((p) => ({ ...p }))));

  it('splits one stroke into consecutive parts that share their join point', () => {
    const under = splitPoints(at(STROKE_MAX_POINTS - 1));
    const exact = splitPoints(at(STROKE_MAX_POINTS));
    const over = splitPoints(at(STROKE_MAX_POINTS + 1));

    // One stroke stays one stroke, up to and including the limit exactly.
    expect(under.length).toBe(1);
    expect(exact.length).toBe(1);
    expect(exact[0].length).toBe(STROKE_MAX_POINTS);

    // One point past it is two strokes, and the second starts where the first ended
    // - which is the only reason the finished drawing has no gap in it.
    expect(over.length).toBe(2);
    expect(over[0].length).toBe(STROKE_MAX_POINTS);
    expect(over[1].length).toBe(2);
    expect(over[1][0]).toEqual(last(over[0]));

    // Nothing is lost and nothing is reordered.
    expect(covered(over)).toEqual(at(STROKE_MAX_POINTS + 1));
  });

  it('keeps splitting a recording that goes on and on', () => {
    const parts = splitPoints(SPIRAL_5010);
    expect(parts.length).toBe(2);
    expect(parts.every((p) => p.length <= STROKE_MAX_POINTS)).toBe(true);
    expect(parts[1][0]).toEqual(last(parts[0]));
    expect(covered(parts)).toEqual(SPIRAL_5010.map((p) => ({ ...p })));

    // A small limit - the same code, a different setting - still joins and still
    // covers everything.
    const many = splitPoints(at(10), 4);
    expect(many.map((p) => p.length)).toEqual([4, 4, 4]);
    expect(many[1][0]).toEqual(last(many[0]));
    expect(many[2][0]).toEqual(last(many[1]));
    expect(covered(many)).toEqual(at(10));

    expect(splitPoints([])).toEqual([]);
    // A limit that is not a limit (0, 1, NaN) splits nothing rather than looping.
    expect(splitPoints(at(3), 0).length).toBe(1);
    expect(splitPoints(at(3), 1).length).toBe(1);
    expect(splitPoints(at(3), Number.NaN).length).toBe(1);
  });
});

describe('createStroke (TC-04, TC-05)', () => {
  it('turns a click into a round dot the diameter of the thickness', () => {
    const doc = setup();
    const thick = PEN_THICKNESS_WORLD.thick;
    const id = draw(doc, [{ x: 100, y: 100 }], 'red', 'thick');
    expect(typeof id).toBe('string');

    const stroke = strokeAt(doc);
    expect(stroke.id).toBe(id);
    expect(stroke.type).toBe('stroke');
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');
    expect(objectsMapOf(doc).get(id!)!.get('createdBy')).toBe(BY);

    // A dot's box is exactly the thickness square it draws, so it is selectable and
    // resizable like any object instead of an invisible point.
    expect(boxOf(stroke)).toEqual({ x: 100 - thick / 2, y: 100 - thick / 2, width: thick, height: thick });
    // One point stored, as a flattened pair, relative to the box it belongs to.
    expect(stroke.points).toEqual([thick / 2, thick / 2]);
    expect(stroke.baseWidth).toBe(thick);
    expect(stroke.baseHeight).toBe(thick);
    // And it draws as a zero-length round-capped path, which is what a dot is.
    expect(smoothPath(scaledPoints(stroke))).toBe('M 100 100 L 100 100');
  });

  it('stores a stroke as a box plus its path relative to that box', () => {
    const doc = setup();
    const points: Point[] = [
      { x: 10, y: 20 },
      { x: 60, y: 70 },
    ];
    expect(draw(doc, points, 'blue', 'thin')).toBeTruthy();

    const stroke = strokeAt(doc);
    expect(boxOf(stroke)).toEqual(boxOfPath(points, PEN_THICKNESS_WORLD.thin));
    expect(stroke.points).toEqual([1, 1, 51, 51]);
    expect(stroke.baseWidth).toBe(52);
    expect(stroke.baseHeight).toBe(52);
    // Scaled back at the size it was created at, the path is exactly what was drawn.
    expect(scaledPoints(stroke)).toEqual(points);
  });

  it('is one LOCAL_ORIGIN transaction, on top of everything else', () => {
    const doc = setup();
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));

    expect(draw(doc, HANDWRITTEN_LOOP.slice(0, 20))).toBeTruthy();
    expect(origins.length).toBe(1);
    expect(origins[0]).toBe(LOCAL_ORIGIN);

    // A second stroke goes above the first: the drawing is on top of the board it
    // annotates, exactly like a shape created after a note.
    const first = strokeAt(doc, 0);
    expect(draw(doc, UNDERLINE.slice(0, 10))).toBeTruthy();
    expect(strokeAt(doc, 1).z).toBe(first.z + 1);
  });

  it('refuses anything it cannot draw, without touching the doc', () => {
    const doc = setup();
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));

    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    // No points at all: nothing to draw.
    expect(draw(doc, [])).toBeNull();
    // A point that is not a number, anywhere in the path.
    expect(draw(doc, [{ x: 0, y: 0 }, { x: Number.NaN, y: 3 }])).toBeNull();
    expect(draw(doc, [{ x: 0, y: 0 }, { x: 4, y: Number.POSITIVE_INFINITY }])).toBeNull();
    // A colour that is a sticky note's, and a thickness that is not one of three.
    expect(draw(doc, points, 'pink' as never)).toBeNull();
    expect(draw(doc, points, 'red', 'huge' as never)).toBeNull();
    // Not an argument set at all.
    expect(createStroke(doc, undefined as never, BY)).toBeNull();
    expect(createStroke(doc, { points, color: 'red' } as never, BY)).toBeNull();

    // Every one of those left no trace: one write for the stroke that was valid.
    expect(draw(doc, points, 'red', 'thin')).toBeTruthy();
    expect(origins.filter((o) => o === LOCAL_ORIGIN).length).toBe(1);
    expect(objectsSnapshot(doc).length).toBe(1);
  });

  it('knows the six colours and three thicknesses and nothing else', () => {
    for (const color of Object.keys(PEN_COLORS)) expect(isPenColor(color)).toBe(true);
    for (const thickness of Object.keys(PEN_THICKNESS_WORLD)) expect(isPenThickness(thickness)).toBe(true);
    expect(isPenColor('yellow')).toBe(false); // a note colour is not a pen colour
    expect(isPenColor('')).toBe(false);
    expect(isPenColor(undefined)).toBe(false);
    expect(isPenThickness('huge')).toBe(false);
    expect(isPenThickness(2)).toBe(false);
    // The defaults the pen starts with are members of their own tables.
    expect(isPenColor(DEFAULT_PEN_COLOR)).toBe(true);
    expect(isPenThickness(DEFAULT_PEN_THICKNESS)).toBe(true);
  });

  it('reads back through the board model as an ordinary object', () => {
    const doc = setup();
    expect(draw(doc, [{ x: 5, y: 5 }])).toBeTruthy();
    const snap = objectsSnapshot(doc);
    expect(snap.length).toBe(1);
    expect(snap[0].type).toBe('stroke');
    expect(boxOf(snap[0] as StrokeSnapshot).width).toBeGreaterThan(0);

    // A stroke whose path is unreadable is invisible, never a NaN box: the board
    // must still open with one broken object on it.
    objectsMapOf(doc).get(snap[0].id)!.set('points', [1, 2, 3]);
    expect(objectsSnapshot(doc).length).toBe(0);
  });
});

describe('scaledPoints (TC-06)', () => {
  it('doubles the drawn line when the box doubles, and leaves the thickness alone', () => {
    const doc = setup();
    const points: Point[] = [
      { x: 11, y: 21 },
      { x: 61, y: 71 },
    ];
    expect(draw(doc, points, 'green', 'thin')).toBeTruthy();
    const before = scaledPoints(strokeAt(doc));
    const box0 = boxOf(strokeAt(doc));

    // The only thing a resize writes is the box (story 7's resize, exactly).
    const doubled: Rect = { x: box0.x, y: box0.y, width: box0.width * 2, height: box0.height * 2 };
    expect(resizeObjects(doc, new Map<string, Rect>([[strokeAt(doc).id, doubled]]))).toBe(1);
    const stroke = strokeAt(doc);
    const after = scaledPoints(stroke);
    const box = boxOf(stroke);

    expect(after.length).toBe(before.length);
    for (let i = 0; i < points.length; i++) {
      // Every point's offset from the box origin is exactly doubled.
      expect(after[i].x - box.x).toBeCloseTo((before[i].x - box0.x) * 2, 6);
      expect(after[i].y - box.y).toBeCloseTo((before[i].y - box0.y) * 2, 6);
    }
    // The line grew in proportion: the same shape at twice the size.
    expect(after[1].x - after[0].x).toBeCloseTo((before[1].x - before[0].x) * 2, 6);
    expect(after[1].y - after[0].y).toBeCloseTo((before[1].y - before[0].y) * 2, 6);
    // The pen did not change: resizing a stroke never makes its line thicker.
    expect(stroke.thickness).toBe('thin');
    expect(stroke.color).toBe('green');
    // The creation size is what it was: the scale is derived, never stored twice.
    expect(stroke.baseWidth).toBeCloseTo(box.width / 2, 6);
    expect(stroke.baseHeight).toBeCloseTo(box.height / 2, 6);
  });

  it('stretches a stroke whose box was resized out of proportion', () => {
    const doc = setup();
    expect(draw(doc, [{ x: 11, y: 21 }], 'purple', 'thin')).toBeTruthy();
    const stroke = strokeAt(doc);
    const box = boxOf(stroke);
    const stretched: Rect = { x: box.x + 40, y: box.y, width: box.width * 3, height: box.height / 2 };
    expect(resizeObjects(doc, new Map<string, Rect>([[stroke.id, stretched]]))).toBe(1);
    const scaled = scaledPoints(strokeAt(doc));
    const rel = strokeAt(doc).points;
    expect(scaled.length).toBe(1);
    expect(scaled[0].x).toBeCloseTo(box.x + 40 + rel[0] * 3, 6);
    expect(scaled[0].y).toBeCloseTo(box.y + rel[1] / 2, 6);
  });

  it('is total: a stroke it cannot scale yields no path', () => {
    const doc = setup();
    expect(draw(doc, [{ x: 1, y: 1 }, { x: 9, y: 9 }])).toBeTruthy();
    const stroke = strokeAt(doc);
    expect(scaledPoints({ ...stroke, width: 0 }).length).toBe(0);
    expect(scaledPoints({ ...stroke, baseWidth: 0 }).length).toBe(0);
    expect(scaledPoints({ ...stroke, baseHeight: Number.NaN }).length).toBe(0);
    expect(scaledPoints({ ...stroke, points: [1, 2, 3] }).length).toBe(0);
  });

  it('keeps the minimum size of a dot a dot rather than nothing', () => {
    // The smallest box a resize may leave behind still holds its own point, so a
    // dot resized to the floor is a dot and not a disappearance.
    const doc = setup();
    expect(draw(doc, [{ x: 50, y: 50 }], 'purple', 'thick')).toBeTruthy();
    const stroke = strokeAt(doc);
    const box = boxOf(stroke);
    const floor: Rect = { x: box.x, y: box.y, width: STROKE_MIN_SIZE_WORLD, height: STROKE_MIN_SIZE_WORLD };
    expect(resizeObjects(doc, new Map<string, Rect>([[stroke.id, floor]]))).toBe(1);
    const scaled = scaledPoints(strokeAt(doc));
    expect(scaled.length).toBe(1);
    // The dot is still inside the box it was shrunk into, so it is still a dot.
    const after = boxOf(strokeAt(doc));
    expect(scaled[0].x).toBeGreaterThanOrEqual(after.x);
    expect(scaled[0].x).toBeLessThanOrEqual(after.x + after.width);
    expect(scaled[0].y).toBeGreaterThanOrEqual(after.y);
    expect(scaled[0].y).toBeLessThanOrEqual(after.y + after.height);
  });
});

describe('hit distance on a stroke (TC-07)', () => {
  const tolerance = STROKE_HIT_TOLERANCE_PX; // at zoom 1, screen px == world units

  it('is inside 6 px of the line and outside it beyond, at the boundary exactly', () => {
    const doc = setup();
    expect(draw(doc, [{ x: 0, y: 100 }, { x: 200, y: 100 }], 'black', 'thin')).toBeTruthy();
    const points = scaledPoints(strokeAt(doc));
    const at = (dy: number): number => distanceToPolyline(points, { x: 100, y: 100 + dy });

    expect(at(0)).toBe(0);
    expect(at(5.9)).toBeLessThanOrEqual(tolerance);
    expect(at(6.1)).toBeGreaterThan(tolerance);
    // The tolerance the registry applies is the larger of this and half the
    // thickness, so a thick stroke is at least as easy to hit as it is to see.
    expect(Math.max(tolerance, PEN_THICKNESS_WORLD.thin / 2)).toBe(tolerance);
    expect(Math.max(tolerance, PEN_THICKNESS_WORLD.thick / 2)).toBe(tolerance);
  });

  it('measures the line as it is drawn, not the box around it', () => {
    const doc = setup();
    // A diagonal: the corners of its box are far from the line, the middle of the
    // box is on it.
    expect(draw(doc, [{ x: 0, y: 0 }, { x: 200, y: 200 }])).toBeTruthy();
    const stroke = strokeAt(doc);
    const points = scaledPoints(stroke);
    expect(distanceToPolyline(points, { x: 100, y: 100 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(points, { x: 190, y: 10 })).toBeGreaterThan(tolerance);
    // The box is bigger than the drawing's extent, by the padding on every side.
    expect(boxOf(stroke).width).toBeGreaterThan(200);
  });
});

describe('smoothPath (TC-08)', () => {
  const three: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 0 },
  ];

  it('draws a smooth curve through the points, deterministically', () => {
    const d = smoothPath(three);
    // A move to where the pen landed, then quadratics - and the path finishes
    // exactly where the pen lifted.
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toBe('M 0 0 Q 10 10 15 5 L 20 0');
    expect(smoothPath(three)).toBe(d);
    expect(smoothPath(three.map((p) => ({ ...p })))).toBe(d);
  });

  it('draws a dot for one point and nothing for none', () => {
    expect(smoothPath([])).toBe('');
    // A zero-length path with round caps is the dot the requirement asks for.
    expect(smoothPath([{ x: 3, y: 4 }])).toBe('M 3 4 L 3 4');
  });

  it('draws a recorded loop as one continuous path', () => {
    const line = simplify(HANDWRITTEN_LOOP, 1);
    const d = smoothPath(line);
    expect(d.startsWith('M')).toBe(true);
    // One quadratic per interior point, no gaps, nothing that is not a number.
    expect(d.split('Q').length).toBe(line.length - 1);
    expect(d).not.toContain('NaN');
    expect(smoothPath([{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 4, y: 4 }])).toBe('M 0 0 L 4 4');
  });
});
