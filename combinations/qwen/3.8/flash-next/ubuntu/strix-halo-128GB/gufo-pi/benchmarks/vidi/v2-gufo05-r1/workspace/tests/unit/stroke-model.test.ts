/**
 * The stroke model and its geometry (`stroke.model`, `stroke.simplify`, `stroke.split`):
 * create a stroke from a captured path, simplify it faithfully, split an over-long path, scale
 * a stored path when its box is resized, and measure the distance that decides a click.
 *
 * A real `Y.Doc` again, and `update` counting, because the two facts that matter — a rejected
 * stroke writes nothing (and so syncs and undoes nothing), and an accepted one is a single
 * change — are only visible in the update stream.
 *
 * TC-01 createStroke, square loop: bbox correct, points length matches, z one above the highest
 * TC-02 simplify keeps every raw point within tolerance, output strictly smaller; straight → 2
 * TC-03 splitPoints, 5010 with max 5000: two parts sharing their boundary point, none over max
 * TC-04 a single point becomes a stroke with width === height === thickness and 2 stored coords
 * TC-05 smoothPath output starts with M and contains C
 * TC-06 scaledPoints after doubling width and height doubles every coordinate
 * TC-07 distanceToPolyline(scaledPoints) at 0 / 5.9 / 6.1 units, within/within/outside at zoom 1
 * TC-08 simplify, 20 000 straight points → 2 points, no stack overflow
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { initDoc, objectSnapshots, createSticky } from '../../src/shared/board-model';
import {
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Point } from '../../src/shared/geometry';
import {
  createStroke,
  scaledPoints,
  strokeHitTest,
  worldPoints,
  STROKE_TYPE,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';

/** Count the `update` events a document fires while a block runs. */
function countUpdates(doc: Y.Doc, run: () => void): number {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  doc.on('update', listener);
  try {
    run();
  } finally {
    doc.off('update', listener);
  }
  return count;
}

/** The one stroke on the board, or fail with a readable message. */
function theStroke(doc: Y.Doc): StrokeSnap {
  const stroke = objectSnapshots(doc).find((object) => object.type === STROKE_TYPE);
  if (!stroke) throw new Error('no stroke on the board');
  return stroke as StrokeSnap;
}

/** A closed square loop, corners at (0,0)–(100,100), sampled along each edge. */
function squareLoop(): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= 10; i += 1) pts.push({ x: i * 10, y: 0 });
  for (let i = 1; i <= 10; i += 1) pts.push({ x: 100, y: i * 10 });
  for (let i = 1; i <= 10; i += 1) pts.push({ x: 100 - i * 10, y: 100 });
  for (let i = 1; i < 10; i += 1) pts.push({ x: 0, y: 100 - i * 10 });
  return pts;
}

describe('createStroke (stroke.model)', () => {
  it('TC-01 stores a square loop with a padded bbox, its points, one above the top', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // A note under the stroke, so "one above the highest" is about more than an empty board.
    createSticky(doc, { x: -500, y: -500 });
    const before = objectSnapshots(doc).reduce((top, o) => Math.max(top, o.z), -Infinity);

    let id = '';
    const updates = countUpdates(doc, () => {
      const made = createStroke(doc, { points: squareLoop(), color: 'black', thickness: 'thin' }, 'me');
      if (made) id = made;
    });

    const stroke = theStroke(doc);
    expect(updates).toBe(1);
    expect(id).toBeTruthy();
    expect(stroke.createdBy).toBe('me');
    expect(stroke.color).toBe('black');
    expect(stroke.thickness).toBe('thin');

    // The loop spans (0,0)–(100,100); thin pen (2 units) pads by 1 on every side.
    const half = PEN_THICKNESS_WORLD.thin / 2;
    expect(stroke.x).toBeCloseTo(0 - half, 6);
    expect(stroke.y).toBeCloseTo(0 - half, 6);
    expect(stroke.width).toBeCloseTo(100 + half * 2, 6);
    expect(stroke.height).toBeCloseTo(100 + half * 2, 6);
    // 41 raw points → 82 stored coordinates, and the base box equals the creation box.
    expect(stroke.points).toHaveLength(squareLoop().length * 2);
    expect(stroke.baseWidth).toBeCloseTo(stroke.width, 6);
    expect(stroke.baseHeight).toBeCloseTo(stroke.height, 6);
    // It sits directly above everything already on the board.
    expect(stroke.z).toBe(before + 1);
  });

  it('TC-04 a single point is a dot: box is a thickness square, two coordinates, at the centre', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const made = createStroke(doc, { points: [{ x: 40, y: 60 }], color: 'red', thickness: 'thick' }, 'me');
    expect(made).toBeTruthy();
    const stroke = theStroke(doc);
    const size = PEN_THICKNESS_WORLD.thick;
    expect(stroke.width).toBeCloseTo(size, 6);
    expect(stroke.height).toBeCloseTo(size, 6);
    expect(stroke.points).toHaveLength(2);
    // The stored point is the box centre, so a round cap lands exactly on the click.
    expect(stroke.points[0]).toBeCloseTo(size / 2, 6);
    expect(stroke.points[1]).toBeCloseTo(size / 2, 6);
    expect(stroke.baseWidth).toBeCloseTo(size, 6);
  });

  it('rejects an empty path and a non-finite coordinate without writing anything', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const updates = countUpdates(doc, () => {
      expect(createStroke(doc, { points: [], color: 'black', thickness: 'thin' }, 'me')).toBeNull();
      expect(
        createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'thin' }, 'me'),
      ).toBeNull();
      expect(
        createStroke(doc, { points: [{ x: 0, y: Infinity }], color: 'black', thickness: 'thin' }, 'me'),
      ).toBeNull();
    });
    expect(updates).toBe(0);
    expect(objectSnapshots(doc)).toHaveLength(0);
  });
});

describe('simplify / split / smooth (stroke.simplify, stroke.split)', () => {
  /** Every raw point must lie within `tolerance` of the simplified polyline. */
  function maxDeviation(raw: readonly Point[], out: readonly Point[]): number {
    let worst = 0;
    for (const p of raw) worst = Math.max(worst, distanceToPolyline([...out], p));
    return worst;
  }

  it('TC-02 keeps within tolerance, is strictly smaller, and reduces a straight line to two', () => {
    // A gently wobbling path: raw samples off a straight line by at most ~0.4 units.
    const raw: Point[] = [];
    for (let x = 0; x <= 200; x += 1) raw.push({ x, y: Math.sin(x / 8) * 0.4 });

    const tolerance = 1;
    const out = simplify(raw, tolerance);

    // Faithful: nothing strays further than the tolerance from the output.
    expect(maxDeviation(raw, out)).toBeLessThanOrEqual(tolerance + 1e-9);
    // Useful: strictly fewer points than we started with.
    expect(out.length).toBeLessThan(raw.length);
    // Ends are kept.
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);

    // A truly straight line needs only its endpoints.
    const straight: Point[] = [];
    for (let x = 0; x <= 500; x += 1) straight.push({ x, y: 10 });
    expect(simplify(straight, tolerance)).toHaveLength(2);
  });

  it('TC-03 splits 5010 points into two parts sharing their boundary, neither over the max', () => {
    const raw: Point[] = Array.from({ length: 5010 }, (_, i) => ({ x: i, y: (i % 7) * 3 }));
    const parts = splitPoints(raw, 5000);

    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(5000);
    // The hand-off: the last point of the first part *is* the first point of the second.
    expect(parts[1]![0]).toEqual(parts[0]![parts[0]!.length - 1]);
    expect(parts.every((part) => part.length <= 5000)).toBe(true);
    // Nothing lost and no duplicate beyond the shared join: 5000 + (11 - 1 shared) = 5010.
    const distinct = parts[0]!.length + parts[1]!.length - 1;
    expect(distinct).toBe(5010);
    // And the last part ends on the last raw point.
    expect(parts[1]![parts[1]!.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it('leaves a path at or under the max untouched', () => {
    const raw: Point[] = Array.from({ length: 5000 }, (_, i) => ({ x: i, y: 0 }));
    const parts = splitPoints(raw, 5000);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(5000);
  });

  it('TC-05 / TC-08 writes a smooth path that starts with M, uses Q segments, and is deterministic', () => {
    const path = smoothPath(squareLoop());
    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('Q');
    expect(path).not.toContain('C');
    // A three-point path starts with M and uses a Q segment, deterministically.
    const three: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 5 },
    ];
    expect(smoothPath(three)).toBe(smoothPath(three));
    expect(smoothPath(three).startsWith('M')).toBe(true);
    expect(smoothPath(three)).toContain('Q');
    // A lone point is a bare move; nothing draws for no points.
    expect(smoothPath([{ x: 3, y: 4 }])).toMatch(/^M/);
    expect(smoothPath([])).toBe('');
  });

  it('TC-08 reduces 20 000 collinear points to two without overflowing the stack', () => {
    const raw: Point[] = Array.from({ length: 20_000 }, (_, i) => ({ x: i, y: i * 0.5 }));
    expect(() => {
      const out = simplify(raw, 1);
      expect(out).toHaveLength(2);
    }).not.toThrow();
  });
});

describe('scaledPoints and hit distance (stroke.model, pen.select)', () => {
  function strokeDoc(points: Point[], thickness: PenThickness): StrokeSnap {
    const doc = new Y.Doc();
    initDoc(doc);
    createStroke(doc, { points, color: 'blue' as PenColor, thickness }, 'me');
    return theStroke(doc);
  }

  it('TC-06 doubling the box doubles every scaled coordinate', () => {
    const base = strokeDoc(
      [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
        { x: 50, y: 25 },
      ],
      'thin',
    );
    const local = scaledPoints(base);
    const stretched: StrokeSnap = {
      ...base,
      width: base.width * 2,
      height: base.height * 2,
    };
    const doubled = scaledPoints(stretched);
    expect(doubled).toHaveLength(local.length);
    doubled.forEach((p, i) => {
      expect(p.x).toBeCloseTo(local[i]!.x * 2, 6);
      expect(p.y).toBeCloseTo(local[i]!.y * 2, 6);
    });
  });

  it('TC-07 measures 0 and 5.9 inside tolerance and 6.1 outside it at zoom 1', () => {
    // A horizontal line; the medium pen keeps the screen tolerance at 6 units at zoom 1.
    const stroke = strokeDoc(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      'medium',
    );
    // Sanity: at creation the world polyline reproduces the drawn path.
    expect(worldPoints(stroke)[0]).toEqual({ x: 0, y: 0 });
    expect(worldPoints(stroke).length).toBe(2);

    expect(strokeHitTest(stroke, { x: 50, y: 0 }, 1)).toBe(true); // 0 from the line
    expect(strokeHitTest(stroke, { x: 50, y: 5.9 }, 1)).toBe(true); // within tolerance
    expect(strokeHitTest(stroke, { x: 50, y: 6.1 }, 1)).toBe(false); // just outside

    // The tolerance is the max of half-thickness and 6/zoom; at 4× zoom 6/zoom is 1.5, still
    // under half the medium thickness (2), so 2 is the reach there.
    expect(strokeHitTest(stroke, { x: 50, y: 2 }, 4)).toBe(true);
    expect(strokeHitTest(stroke, { x: 50, y: 2.1 }, 4)).toBe(false);

    // Far from any point of the line, off the end: not a hit.
    expect(strokeHitTest(stroke, { x: 500, y: 0 }, 1)).toBe(false);
  });
});
