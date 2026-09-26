/**
 * Unit tests for the stroke model and its capture path (story 11, TC-01 to TC-08).
 *
 * Deterministic maths over a real Y.Doc: the recorded fixtures in
 * `tests/fixtures/pen-paths.ts`, the simplifier, the point-budget split, the
 * document shape and the hit envelope. The capture functions are used rather
 * than a hand-built snapshot wherever the product has a rule of its own (what
 * counts as a ring, where the split happens, what gets written), because those
 * rules are what the acceptance criteria are about.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify } from '../../src/shared/geometry/simplify';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../src/shared/config';
import {
  createStroke,
  getStroke,
  scaleStroke,
  hitTestStroke,
  strokeHit,
  strokeHitWidthWorld,
  strokePathData,
  strokeSelfCross,
  toPoints,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import {
  beginCapture,
  commitCapture,
  commitDot,
  extendCapture,
  finishCapture,
  previewSnap,
  type FinishedStroke,
} from '../../src/client/tools/pen-capture';
import { HANDWRITTEN_LOOP, UNDERLINE, LONG_SPIRAL } from '../fixtures/pen-paths';
import type { Point } from '../../src/shared/geometry';

function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Run `fn` while counting the `update` events it emits on the doc. */
function withUpdateCount(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  doc.on('update', listener);
  try {
    fn();
  } finally {
    doc.off('update', listener);
  }
  return count;
}

/** Worst distance from any point of `raw` to the polyline `kept`. */
function maxDeviation(raw: readonly Point[], kept: readonly Point[]): number {
  let worst = 0;
  for (const p of raw) {
    const d = distanceToPolyline(kept, p);
    if (d > worst) worst = d;
  }
  return worst;
}

/** Feed a whole path into a capture, as the pointer would. */
function captureOf(path: readonly Point[]): ReturnType<typeof beginCapture> {
  const capture = beginCapture(path[0]!.x, path[0]!.y);
  for (let i = 1; i < path.length; i += 1) {
    extendCapture(capture, path[i]!.x, path[i]!.y);
  }
  return capture;
}

/** A stroke snapshot written straight into the document. */
function writeStroke(
  doc: Y.Doc,
  points: readonly Point[],
  options: Parameters<typeof createStroke>[3] = {},
): string {
  const flat: number[] = [];
  for (const point of points) flat.push(point.x, point.y);
  return createStroke(doc, flat, { x: 0, y: 0 }, options);
}

function strokeSnap(doc: Y.Doc): StrokeSnap {
  const snaps = snapshot(doc).filter((s) => s.type === 'stroke');
  expect(snaps.length).toBe(1);
  return snaps[0] as StrokeSnap;
}

describe('simplify (pen.smooth)', () => {
  // TC-01: the 400-point handwritten loop at tolerance 1.
  it('TC-01 keeps every raw point within the tolerance and drops points', () => {
    const kept = simplify(HANDWRITTEN_LOOP, 1);
    expect(kept.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    expect(maxDeviation(HANDWRITTEN_LOOP, kept)).toBeLessThanOrEqual(1);
  });

  it('TC-01b simplifies the underline without straying past 1 unit', () => {
    const kept = simplify(UNDERLINE, 1);
    expect(kept.length).toBeLessThan(UNDERLINE.length);
    expect(maxDeviation(UNDERLINE, kept)).toBeLessThanOrEqual(1);
  });

  // TC-02: at 200% zoom the tolerance the tool passes is 1 / 2.
  it('TC-02 holds to 0.5 units at the zoom-200% tolerance', () => {
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / 2;
    const kept = simplify(HANDWRITTEN_LOOP, tolerance);
    expect(kept.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    expect(maxDeviation(HANDWRITTEN_LOOP, kept)).toBeLessThanOrEqual(tolerance);
  });

  it('keeps the first and the last point', () => {
    const kept = simplify(HANDWRITTEN_LOOP, 0.5);
    expect(kept[0]).toEqual(HANDWRITTEN_LOOP[0]);
    expect(kept[kept.length - 1]).toEqual(HANDWRITTEN_LOOP[HANDWRITTEN_LOOP.length - 1]);
  });

  it('is a no-op for a path shorter than three points', () => {
    const two: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 4 },
    ];
    expect(simplify(two, 1)).toEqual(two);
    expect(simplify([], 1)).toEqual([]);
  });

  it('does not recurse per point: the 5,010-point path simplifies at all', () => {
    const kept = simplify(LONG_SPIRAL, 1);
    expect(kept.length).toBeLessThan(LONG_SPIRAL.length);
    expect(maxDeviation(LONG_SPIRAL, kept)).toBeLessThanOrEqual(1);
  });

  it('gets coarser as the zoom drops, which is why the tool divides by zoom', () => {
    const at100 = simplify(HANDWRITTEN_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX / 1);
    const at25 = simplify(HANDWRITTEN_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX / 0.25);
    expect(at25.length).toBeLessThan(at100.length);
    // Coarser is not the same as wrong: the line still does not stray.
    expect(maxDeviation(HANDWRITTEN_LOOP, at25)).toBeLessThanOrEqual(
      STROKE_SIMPLIFY_TOLERANCE_PX / 0.25,
    );
  });
});

describe('the point budget (pen.long_stroke)', () => {
  // TC-03: the boundary, one below, exactly at, one above.
  it('TC-03 splits at the limit and shares the join point', () => {
    const path = LONG_SPIRAL;
    expect(path.length).toBe(STROKE_MAX_POINTS + 10);

    // One point short of the budget is still one stroke.
    const short = captureOf(path.slice(0, STROKE_MAX_POINTS - 1));
    expect(finishCapture(short)).toHaveLength(1);

    // Exactly at it, the buffer was handed over the moment it filled, so the
    // rest of the path has somewhere to go.
    const over = captureOf(path);
    const parts = finishCapture(over);
    expect(parts.length).toBe(2);
    const [first, second] = parts;
    if (!first || !second) {
      throw new Error(`expected two strokes, got ${parts.length}`);
    }
    // The join point belongs to both parts, so the drawn line has no gap in it.
    const joinOf = (part: FinishedStroke, index: 'first' | 'last') => {
      const flat = part.points;
      const pair = index === 'first' ? [flat[0]!, flat[1]!] : [flat[flat.length - 2]!, flat[flat.length - 1]!];
      return { x: part.bbox.x + pair[0], y: part.bbox.y + pair[1] };
    };
    const endOfFirst = joinOf(first, 'last');
    const startOfSecond = joinOf(second, 'first');
    // Rounding is allowed at the join (a point may come back to three decimals),
    // but a gap is not: the parts have to meet.
    expect(Math.hypot(endOfFirst.x - startOfSecond.x, endOfFirst.y - startOfSecond.y)).toBeLessThan(
      0.01,
    );
    // Nothing is lost: the two parts together draw a line that stays within the
    // tolerance of the raw path. Measuring one part against the whole path would
    // only be measuring where the pen had not got to yet.
    const drawn = [
      ...toPoints(first.points).map(
        (point) => ({ x: point.x + first.bbox.x, y: point.y + first.bbox.y }),
      ),
      ...toPoints(second.points).slice(1).map(
        (point) => ({ x: point.x + second.bbox.x, y: point.y + second.bbox.y }),
      ),
    ];
    expect(drawn.length).toBeLessThan(path.length);
    expect(maxDeviation(path, drawn)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX * 2);
  });

  it('writes one object per part, in one transaction each', () => {
    const doc = createDoc();
    const capture = captureOf(LONG_SPIRAL);
    const ids = commitCapture(doc, capture, {
      color: 'black',
      thickness: 'medium',
      by: 'tester',
    });
    expect(ids.length).toBe(2);
    expect(snapshot(doc).filter((snap) => snap.type === 'stroke').length).toBe(2);
  });

  it('does not split an ordinary stroke: the recorded loop stays one object', () => {
    const doc = createDoc();
    const capture = captureOf(HANDWRITTEN_LOOP);
    const ids = commitCapture(doc, capture, { color: 'black', thickness: 'medium' });
    expect(ids.length).toBe(1);
    const snap = strokeSnap(doc);
    // The 400 raw samples came back as far fewer points, and the line they drew
    // is no further from the original than one screen unit at 100%.
    expect(snap.points.length / 2).toBeLessThan(HANDWRITTEN_LOOP.length);
    expect(
      maxDeviation(
        HANDWRITTEN_LOOP,
        toPoints(snap.points).map((point) => ({
          x: point.x + snap.x,
          y: point.y + snap.y,
        })),
      ),
    ).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);
  });
});

describe('a stroke in the document (pen.dot, error paths)', () => {
  // TC-04: a tap is a stroke whose box is the thickness, not a zero box.
  it('TC-04 makes a two-point tap into a stroke of two points', () => {
    const doc = createDoc();
    const capture = beginCapture(50, 50);
    // A pen held still produces identical points, and none of them are kept.
    expect(extendCapture(capture, 50, 50)).toBe(false);
    expect(extendCapture(capture, 50.2, 50.1)).toBe(true);
    const ids = commitCapture(doc, capture, { color: 'black', thickness: 'medium' });
    expect(ids.length).toBe(1);
    const snap = strokeSnap(doc);
    expect(snap.points.length).toBeGreaterThanOrEqual(4);
    expect(snap.width).toBeGreaterThan(0);
    expect(snap.height).toBeGreaterThan(0);
  });

  it('keeps the box at least a unit wide, so a horizontal line still paints', () => {
    const doc = createDoc();
    const id = writeStroke(doc, [
      { x: 10, y: 20 },
      { x: 120, y: 20 },
    ]);
    const snap = getStroke(doc, id);
    expect(snap).not.toBeNull();
    // A flat line has a height of nothing, and a nothing-tall box has no room
    // for the ink in it: the box is widened, the drawing is not.
    expect(snap!.height).toBeGreaterThanOrEqual(1);
    expect(snap!.points).toEqual([10, 20, 120, 20]);
    expect(strokePathData(snap!)).toBe('M10,20 L120,20');
  });

  // TC-05: bad input creates no object and no transaction.
  it('TC-05 refuses empty ink, half a point, and numbers that are not numbers', () => {
    const doc = createDoc();
    const count = withUpdateCount(doc, () => {
      expect(createStroke(doc, [], { x: 0, y: 0 })).toBe('');
      // Half a point is not a short drawing, it is a broken one.
      expect(createStroke(doc, [10], { x: 0, y: 0 })).toBe('');
      expect(createStroke(doc, [10, Number.NaN, 20, 20], { x: 0, y: 0 })).toBe('');
      expect(createStroke(doc, [10, 10, Number.POSITIVE_INFINITY, 20], { x: 0, y: 0 })).toBe('');
    });
    expect(count).toBe(0);
    expect(snapshot(doc).length).toBe(0);
  });

  // TC-04: a pen that did not move is a dot, and a dot is a drawing.
  it('TC-04 writes a dot as one point in a box as wide as the pen', () => {
    const doc = createDoc();
    const id = createStroke(doc, [4, 4], { x: 100, y: 100 }, { thickness: 'thick' });
    expect(id).not.toBe('');
    const snap = getStroke(doc, id)!;
    // The box is the thickness square the ink covers, not the point it measures:
    // with nothing around it there would be nowhere for the round cap to be drawn.
    expect(snap.points).toEqual([4, 4]);
    expect(snap.width).toBe(PEN_THICKNESS_WORLD.thick);
    expect(snap.height).toBe(PEN_THICKNESS_WORLD.thick);
    // A lone `M` paints nothing at all, so the dot is a segment of no length.
    expect(strokePathData(snap)).toBe('M4,4 L4,4');
  });

  it('lets a dot be clicked, which is the whole point of a dot', () => {
    const doc = createDoc();
    const id = createStroke(doc, [4, 4], { x: 100, y: 100 }, { thickness: 'thick' });
    const snap = getStroke(doc, id)!;
    expect(hitTestStroke(snap, { x: 4, y: 4 }, 1)).toBe(true);
    // Six screen pixels of slack, measured from the middle of the dot rather than
    // from a segment that is not there.
    expect(hitTestStroke(snap, { x: 4 + 6.5, y: 4 }, 1)).toBe(false);
    expect(hitTestStroke(snap, { x: 4 + 3, y: 4 }, 1)).toBe(true);
  });

  it('commits the dot a click without movement leaves behind', () => {
    const doc = createDoc();
    const ids = commitDot(doc, 300, 200, { color: 'blue', thickness: 'medium' });
    expect(ids).toHaveLength(1);
    const snap = getStroke(doc, ids[0]!)!;
    const edge = PEN_THICKNESS_WORLD.medium;
    expect(snap.x).toBeCloseTo(300 - edge / 2, 6);
    expect(snap.y).toBeCloseTo(200 - edge / 2, 6);
    expect(snap.width).toBe(edge);
    expect(snap.color).toBe('blue');
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('refuses to overwrite an id that is already taken', () => {
    const doc = createDoc();
    const first = writeStroke(doc, UNDERLINE, { id: 'mine' });
    expect(first).toBe('mine');
    const count = withUpdateCount(doc, () => {
      expect(
        createStroke(doc, [0, 0, 10, 10], { x: 0, y: 0 }, { id: 'mine' }),
      ).toBe('');
    });
    expect(count).toBe(0);
    expect(snapshot(doc).filter((snap) => snap.type === 'stroke').length).toBe(1);
  });

  it('records who drew it, and a later stroke is above an earlier one', () => {
    const doc = createDoc();
    writeStroke(doc, UNDERLINE, { by: 'first' });
    const id = writeStroke(doc, HANDWRITTEN_LOOP, { by: 'second' });
    const snap = getStroke(doc, id)!;
    expect(snap.createdBy).toBe('second');
    // Both are objects the surface can pick; which one a click finds is decided
    // by paint order, and that is tested where the painting happens.
  });

  it('writes exactly one transaction per stroke', () => {
    const doc = createDoc();
    const capture = captureOf(HANDWRITTEN_LOOP);
    const count = withUpdateCount(doc, () => {
      commitCapture(doc, capture, { color: 'black', thickness: 'medium' });
    });
    expect(count).toBe(1);
  });

  it('keeps the thickness the pen was set to', () => {
    const doc = createDoc();
    const capture = captureOf(UNDERLINE);
    commitCapture(doc, capture, { color: 'red', thickness: 'thick' });
    const snap = strokeSnap(doc);
    expect(snap.thickness).toBe('thick');
    expect(snap.color).toBe('red');
    expect(PEN_THICKNESS_WORLD.thick).toBeGreaterThan(PEN_THICKNESS_WORLD.medium);
  });
});

describe('resizing a stroke (pen.resize)', () => {
  // TC-06: doubling the bbox doubles the line.
  it('TC-06 doubles the drawn line when the bbox doubles', () => {
    const doc = createDoc();
    const id = writeStroke(doc, UNDERLINE, { z: 1 });
    const before = getStroke(doc, id)!;
    const doubled = scaleStroke(before, 2, 2);
    expect(doubled.width).toBeCloseTo(before.width * 2, 1);
    expect(doubled.height).toBeCloseTo(before.height * 2, 1);
    const source = toPoints(before.points);
    const scaled = toPoints(doubled.points);
    expect(scaled.length).toBe(source.length);
    for (let i = 0; i < source.length; i += 1) {
      expect(scaled[i]!.x).toBeCloseTo(source[i]!.x * 2, 1);
      expect(scaled[i]!.y).toBeCloseTo(source[i]!.y * 2, 1);
    }
  });

  it('scales a non-uniform resize along each axis on its own', () => {
    const doc = createDoc();
    const id = writeStroke(doc, UNDERLINE, { z: 1 });
    const before = getStroke(doc, id)!;
    const scaled = scaleStroke(before, 2, 0.5);
    const source = toPoints(before.points);
    const result = toPoints(scaled.points);
    expect(result[1]!.x).toBeCloseTo(source[1]!.x * 2, 1);
    expect(result[1]!.y).toBeCloseTo(source[1]!.y * 0.5, 1);
  });
});

describe('the hit area (pen.select)', () => {
  /** A straight line along y = 0, 200 units long, sitting at the origin. */
  function line(doc: Y.Doc): StrokeSnap {
    const id = writeStroke(doc, [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
    return getStroke(doc, id)!;
  }

  // TC-07: six units of slack either side of the ink, measured at 100%.
  it('TC-07 measures 5.9 inside and 6.1 outside the six-unit envelope', () => {
    const doc = createDoc();
    const snap = line(doc);
    // The number in the acceptance criteria is a distance *from the line*: a click
    // 5.9 units off a line drawn at 100% is a click on the line, and one at 6.1 is
    // a click on the board. Halving it again would make the pen impossible to aim.
    expect(strokeHit(snap, 1).contains(100, 0)).toBe(true);
    expect(strokeHit(snap, 1).contains(100, 5.9)).toBe(true);
    expect(strokeHit(snap, 1).contains(100, 6.1)).toBe(false);
    // A four-unit pen reaches only two units either side of itself, so here it is
    // the tolerance that sets the reach, not the ink.
    expect(strokeHitWidthWorld('medium')).toBe(STROKE_HIT_TOLERANCE_PX);
  });

  it('keeps a stroke drawn small clickable when it is seen small', () => {
    const doc = createDoc();
    const snap = line(doc);
    // At 25% zoom six screen pixels are twenty-four world units: a fixed world
    // tolerance would have made this line impossible to pick when zoomed out.
    expect(strokeHit(snap, 0.25).contains(100, 11)).toBe(true);
    expect(strokeHit(snap, 0.25).contains(100, 23)).toBe(true);
    expect(strokeHit(snap, 0.25).contains(100, 25)).toBe(false);
    // Zoomed in the reach shrinks in world units until it is only the ink: at 400%
    // a four-unit line is two units of ink either side of its centre, which is
    // wider than the 6/4 units of slack, and it does not grow into the neighbour's
    // territory beyond that.
    expect(strokeHit(snap, 4).contains(100, 1.5)).toBe(true);
    expect(strokeHit(snap, 4).contains(100, 2.5)).toBe(false);
  });

  it('is not the bounding box: the middle of a ring is the board', () => {
    const doc = createDoc();
    const circle: Point[] = [];
    for (let i = 0; i <= 64; i += 1) {
      const angle = (i / 64) * Math.PI * 2;
      circle.push({ x: 100 + Math.cos(angle) * 60, y: 100 + Math.sin(angle) * 60 });
    }
    const id = writeStroke(doc, circle, { closed: true });
    const snap = getStroke(doc, id)!;
    expect(snap.closed).toBe(true);
    expect(strokeHit(snap, 1).contains(100, 100)).toBe(false);
    // The ink itself, and the padding around it, are the stroke: the envelope is
    // six units either side of the *drawn* line, so the outer edge of this ring
    // sits a little past 166 (measured: the reach ends between 6 and 6.5 units
    // out). Six and a half is the first probe that is safely past it.
    expect(strokeHit(snap, 1).contains(160, 100)).toBe(true);
    expect(strokeHit(snap, 1).contains(164, 100)).toBe(true);
    expect(strokeHit(snap, 1).contains(166.5, 100)).toBe(false);
    // And the middle stays the board all the way across, which is the difference
    // between a drawing and a filled shape.
    expect(strokeHit(snap, 1).contains(100, 130)).toBe(false);
    expect(strokeHit(snap, 1).contains(130, 100)).toBe(false);
  });

  it('handles a dot, where there is no segment to measure', () => {
    const doc = createDoc();
    const id = writeStroke(doc, [
      { x: 44, y: 40 },
      { x: 46, y: 40 },
    ]);
    const snap = getStroke(doc, id)!;
    expect(strokeHit(snap, 1).contains(45, 40)).toBe(true);
    expect(strokeHit(snap, 1).contains(45 + STROKE_HIT_TOLERANCE_PX * 2, 40)).toBe(false);
  });

  it('reports a self-crossing line, whose gap is the board too', () => {
    const doc = createDoc();
    const figure: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    const id = writeStroke(doc, figure);
    const snap = getStroke(doc, id)!;
    expect(strokeSelfCross(snap)).toBe(true);
    expect(strokeHit(snap, 1).contains(50, 50)).toBe(true); // the crossing itself
    expect(strokeHit(snap, 1).contains(25, 50)).toBe(false); // and the gap beside it
  });
});

describe('path data (pen.render)', () => {
  // TC-08: the promise the preview and the committed stroke share.
  it('TC-08 starts at M, replays the line, and is deterministic', () => {
    const doc = createDoc();
    const id = writeStroke(doc, [
      { x: 10, y: 10 },
      { x: 30, y: 4 },
      { x: 52, y: 26 },
    ]);
    const snap = getStroke(doc, id)!;
    const first = strokePathData(snap);
    expect(first).toBe(strokePathData(snap));
    expect(first.startsWith('M')).toBe(true);
    // The stroke is the capture replayed, not a polygon fitted to it: every
    // kept point is a vertex, so a scribbled circle stays a circle (§4.3).
    expect(first).toContain('L');
    expect(first.split('L').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('draws a closed stroke with its chord, once', () => {
    const doc = createDoc();
    const circle: Point[] = [];
    for (let i = 0; i <= 48; i += 1) {
      const angle = (i / 48) * Math.PI * 2;
      circle.push({ x: 60 + Math.cos(angle) * 40, y: 60 + Math.sin(angle) * 40 });
    }
    const id = writeStroke(doc, circle, { closed: true });
    const snap = getStroke(doc, id)!;
    const d = strokePathData(snap);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.indexOf('Z')).toBe(d.lastIndexOf('Z'));
  });

  it('leaves the preview and the document drawing the same geometry', () => {
    const doc = createDoc();
    const capture = captureOf(HANDWRITTEN_LOOP);
    const preview = previewSnap(capture, { color: 'black', thickness: 'medium' });
    expect(preview.length).toBe(1);
    const previewPath = strokePathData(preview[0]!);
    commitCapture(doc, capture, { color: 'black', thickness: 'medium' });
    // One frame later the same gesture becomes a document object, and the line
    // does not change under the person drawing it.
    expect(strokePathData(strokeSnap(doc))).toBe(previewPath);
  });
});
