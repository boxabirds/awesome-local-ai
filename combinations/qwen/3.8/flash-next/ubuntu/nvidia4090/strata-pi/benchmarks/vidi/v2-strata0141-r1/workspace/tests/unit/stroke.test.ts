import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  isStrokeSnapshot,
  objectSnapshots,
  resizeObjects,
} from '../../src/shared/board-model';
import {
  createStroke,
  scaledPoints,
  worldPoints,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import {
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop, longSpiral, underlinePath } from '../fixtures/pen-paths';

/**
 * Story 11 task 1 (`stroke.model`): TC-01 to TC-08.
 *
 * The whole contract is maths on a real Y.Doc: simplification has to stay
 * faithful to what was drawn (`pen.smooth`), the point limit has to split without
 * leaving a gap (`pen.long_stroke`), invalid input has to be refused without an
 * update (`pen.options`), a resize has to scale the drawn line in proportion
 * (`pen.resize`) and a hit test has to measure the **line**, not the box
 * (`pen.select`).
 */

function updatesIn(doc: Y.Doc, run: () => unknown): number {
  let count = 0;
  const listener = (): void => {
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

/** The strokes on the board, as the render model reads them. */
function strokesOf(doc: Y.Doc): readonly StrokeSnap[] {
  return objectSnapshots(doc).filter(isStrokeSnapshot);
}

function onlyStroke(doc: Y.Doc): StrokeSnap {
  const strokes = strokesOf(doc);
  expect(strokes).toHaveLength(1);
  return strokes[0]!;
}

/** The worst deviation of any raw point from the finished polyline. */
function maxDeviation(raw: readonly Point[], result: readonly Point[]): number {
  let worst = 0;
  for (const point of raw) {
    worst = Math.max(worst, distanceToPolyline(result, point));
  }
  return worst;
}

describe('simplify (`pen.smooth`)', () => {
  it('TC-01: a recorded loop at tolerance 1 stays within 1 unit and gets shorter', () => {
    const raw = handwrittenLoop();
    expect(raw.length).toBeGreaterThan(350);

    const result = simplify(raw, 1);

    expect(result.length).toBeGreaterThan(2);
    expect(result.length).toBeLessThan(raw.length);
    expect(maxDeviation(raw, result)).toBeLessThanOrEqual(1);
    // First and last are kept: a stroke is where the person started and stopped it.
    expect(result[0]).toEqual(raw[0]);
    expect(result[result.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it('TC-02: at zoom 200% the tolerance is 1/zoom = 0.5 world units', () => {
    const raw = handwrittenLoop();
    const tolerance = 1 / 2;
    const result = simplify(raw, tolerance);

    expect(result.length).toBeLessThan(raw.length);
    expect(maxDeviation(raw, result)).toBeLessThanOrEqual(tolerance);
  });

  it('an underline keeps its shape: fewer points, same path', () => {
    const raw = underlinePath();
    const result = simplify(raw, 1);
    expect(result.length).toBeLessThan(raw.length);
    expect(maxDeviation(raw, result)).toBeLessThanOrEqual(1);
    expect(result[0]).toEqual(raw[0]);
    expect(result[result.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it('two points and one point are already as simple as they get', () => {
    const two: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 4 },
    ];
    expect(simplify(two, 1)).toEqual(two);
    expect(simplify([{ x: 1, y: 2 }], 1)).toEqual([{ x: 1, y: 2 }]);
    expect(simplify([], 1)).toEqual([]);
  });
});

describe('splitPoints (`pen.long_stroke`)', () => {
  it('TC-03: one below, exactly at and one above STROKE_MAX_POINTS', () => {
    const points = longSpiral(STROKE_MAX_POINTS + 1);

    const justUnder = splitPoints(longSpiral(STROKE_MAX_POINTS - 1));
    expect(justUnder).toHaveLength(1);
    expect(justUnder[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const exactly = splitPoints(longSpiral(STROKE_MAX_POINTS));
    expect(exactly).toHaveLength(1);
    expect(exactly[0]).toHaveLength(STROKE_MAX_POINTS);

    const over = splitPoints(points);
    expect(over).toHaveLength(2);
    expect(over[0]).toHaveLength(STROKE_MAX_POINTS);
    // The join point belongs to both halves: the two strokes meet with no gap.
    expect(over[1]![0]).toEqual(over[0]![over[0]!.length - 1]);
    expect(over[1]![0]).toEqual(points[STROKE_MAX_POINTS - 1]);
    // Nothing is lost and nothing else is duplicated.
    const total = over.reduce((sum, part) => sum + part.length, 0);
    expect(total).toBe(points.length + 1);
  });

  it('a smaller limit splits into as many parts as needed, each sharing its join', () => {
    const raw: Point[] = Array.from({ length: 7 }, (_, index) => ({ x: index, y: index * 2 }));
    const parts = splitPoints(raw, 3);
    expect(parts.map((part) => part.length)).toEqual([3, 3, 3]);
    expect(parts[1]![0]).toEqual(raw[2]);
    expect(parts[2]![0]).toEqual(raw[4]);
    expect(parts[2]![2]).toEqual(raw[6]);
  });

  it('an empty or single-point path is one part or none', () => {
    expect(splitPoints([])).toEqual([]);
    expect(splitPoints([{ x: 1, y: 1 }])).toHaveLength(1);
  });
});

describe('createStroke (`pen.draw`, `pen.dot`, `pen.options`)', () => {
  it('TC-04: one point is a round dot the size of the thickness', () => {
    const doc = new Y.Doc();
    const thickness = PEN_THICKNESS_WORLD.thick;

    const id = createStroke(doc, { points: [{ x: 300, y: 200 }], color: 'black', thickness: 'thick' }, 'priya');
    expect(id).not.toBeNull();

    const stroke = onlyStroke(doc);
    expect(stroke.type).toBe('stroke');
    // bbox = thickness square: the point sits in the middle of it.
    expect(stroke.width).toBe(thickness);
    expect(stroke.height).toBe(thickness);
    expect(stroke.x).toBeCloseTo(300 - thickness / 2, 9);
    expect(stroke.y).toBeCloseTo(200 - thickness / 2, 9);
    expect(stroke.baseWidth).toBe(thickness);
    expect(stroke.baseHeight).toBe(thickness);
    // Flattened: one point, at the centre of its own box.
    expect(stroke.points).toHaveLength(2);
    expect(stroke.points[0]).toBeCloseTo(thickness / 2, 9);
    expect(stroke.points[1]).toBeCloseTo(thickness / 2, 9);
    expect(stroke.color).toBe('black');
    expect(stroke.thickness).toBe('thick');
  });

  it('a drag stores its points relative to its box, padded by half the thickness', () => {
    const doc = new Y.Doc();
    const raw = underlinePath();
    const id = createStroke(doc, { points: raw, color: 'red', thickness: 'thin' }, 'priya');
    expect(id).not.toBeNull();

    const stroke = onlyStroke(doc);
    const minX = Math.min(...raw.map((point) => point.x));
    const maxX = Math.max(...raw.map((point) => point.x));
    const minY = Math.min(...raw.map((point) => point.y));
    const maxY = Math.max(...raw.map((point) => point.y));
    const half = PEN_THICKNESS_WORLD.thin / 2;

    expect(stroke.x).toBeCloseTo(minX - half, 9);
    expect(stroke.y).toBeCloseTo(minY - half, 9);
    expect(stroke.width).toBeCloseTo(maxX - minX + half * 2, 9);
    expect(stroke.height).toBeCloseTo(maxY - minY + half * 2, 9);
    expect(stroke.baseWidth).toBeCloseTo(stroke.width, 9);
    expect(stroke.baseHeight).toBeCloseTo(stroke.height, 9);
    expect(stroke.points).toHaveLength(raw.length * 2);
    expect(stroke.points[0]).toBeCloseTo(raw[0]!.x - stroke.x, 9);

    // One transaction: one update event, one object, on top of everything.
    expect(stroke.z).toBe(1);
  });

  it('TC-05: empty points, a NaN point, an unknown colour and an unknown thickness are all refused', () => {
    const doc = new Y.Doc();
    const before = objectSnapshots(doc).length;

    const refused = updatesIn(doc, () => {
      expect(createStroke(doc, { points: [], color: 'black', thickness: 'thin' }, 'priya')).toBeNull();
      expect(
        createStroke(doc, { points: [{ x: Number.NaN, y: 4 }], color: 'black', thickness: 'thin' }, 'priya'),
      ).toBeNull();
      expect(
        createStroke(doc, { points: [{ x: 1, y: Number.POSITIVE_INFINITY }], color: 'black', thickness: 'thin' }, 'priya'),
      ).toBeNull();
      expect(
        createStroke(doc, { points: [{ x: 1, y: 2 }], color: 'pink' as PenColor, thickness: 'thin' }, 'priya'),
      ).toBeNull();
      expect(
        createStroke(doc, { points: [{ x: 1, y: 2 }], color: 'black', thickness: 'huge' as PenThickness }, 'priya'),
      ).toBeNull();
      expect(createStroke(doc, { points: [{ x: 1, y: 2 }], color: 'black', thickness: 'thin' }, 'priya')).not.toBeNull();
    });

    // Four refusals wrote nothing at all; only the last call created a stroke.
    expect(refused).toBe(1);
    expect(objectSnapshots(doc).length).toBe(before + 1);
    expect(strokesOf(doc)).toHaveLength(1);
  });

  it('a stroke is stacked above what is already on the board', () => {
    const doc = new Y.Doc();
    createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], color: 'black', thickness: 'thin' }, 'priya');
    createStroke(doc, { points: [{ x: 0, y: 10 }, { x: 20, y: 10 }], color: 'blue', thickness: 'medium' }, 'sam');
    const strokes = strokesOf(doc);
    expect(strokes.map((stroke) => stroke.z)).toEqual([1, 2]);
  });
});

describe('scaledPoints (`pen.resize`)', () => {
  it('TC-06: doubling width and height doubles every coordinate and leaves the thickness alone', () => {
    const doc = new Y.Doc();
    createStroke(doc, { points: underlinePath(), color: 'green', thickness: 'medium' }, 'priya');
    const stroke = onlyStroke(doc);

    const before = scaledPoints(stroke);
    const written = resizeObjects(doc, new Map([[stroke.id, {
      x: stroke.x,
      y: stroke.y,
      width: stroke.width * 2,
      height: stroke.height * 2,
    }] as const]));
    expect(written).toBe(1);

    const resized = onlyStroke(doc);
    const after = scaledPoints(resized);

    expect(after).toHaveLength(before.length);
    after.forEach((point, index) => {
      expect(point.x).toBeCloseTo(before[index]!.x * 2, 6);
      expect(point.y).toBeCloseTo(before[index]!.y * 2, 6);
    });
    // The line gets longer, not thicker, and the base it scales from is untouched.
    expect(resized.thickness).toBe('medium');
    expect(resized.baseWidth).toBeCloseTo(stroke.width, 9);
    expect(resized.baseHeight).toBeCloseTo(stroke.height, 9);
    expect(resized.width).toBeCloseTo(stroke.width * 2, 9);
  });

  it('a stroke that was never resized scales by 1', () => {
    const doc = new Y.Doc();
    createStroke(doc, { points: [{ x: 10, y: 10 }, { x: 30, y: 14 }], color: 'black', thickness: 'thin' }, 'priya');
    const stroke = onlyStroke(doc);
    const points = scaledPoints(stroke);
    expect(points[0]).toEqual({ x: 10 - stroke.x, y: 10 - stroke.y });
    expect(points[1]).toEqual({ x: 30 - stroke.x, y: 14 - stroke.y });
  });
});

describe('hit distance (`pen.select`)', () => {
  it('TC-07: 0, 5.9 and 6.1 units from the line at zoom 1 are inside, inside and outside', () => {
    const doc = new Y.Doc();
    createStroke(
      doc,
      { points: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }], color: 'black', thickness: 'thin' },
      'priya',
    );
    const stroke = onlyStroke(doc);
    const zoom = 1;
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[stroke.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / zoom,
    );
    expect(tolerance).toBe(STROKE_HIT_TOLERANCE_PX);

    const onLine = distanceToPolyline(scaledPoints(stroke), { x: 200 - stroke.x, y: 100 - stroke.y });
    const justInside = distanceToPolyline(scaledPoints(stroke), { x: 200 - stroke.x, y: 100 - stroke.y + 5.9 });
    const justOutside = distanceToPolyline(scaledPoints(stroke), { x: 200 - stroke.x, y: 100 - stroke.y + 6.1 });

    expect(onLine).toBe(0);
    expect(onLine).toBeLessThanOrEqual(tolerance);
    expect(justInside).toBeLessThanOrEqual(tolerance);
    expect(justOutside).toBeGreaterThan(tolerance);

    // The same measurement in world space agrees with it (what the hit test does).
    const line = worldPoints(stroke);
    expect(distanceToPolyline(line, { x: 200, y: 100 })).toBe(0);
    expect(distanceToPolyline(line, { x: 200, y: 105.9 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(line, { x: 200, y: 106.1 })).toBeGreaterThan(tolerance);
  });
});

describe('smoothPath (`pen.smooth`)', () => {
  it('TC-08: three points become one M, one Q segment and the last point, identically every time', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 5 },
    ];
    const path = smoothPath(points);

    expect(path.startsWith('M')).toBe(true);
    expect(path.split('Q')).toHaveLength(2); // one Q segment for three points
    expect(path).toContain('Q 10 20 20 12.5');
    expect(path.trim().endsWith('30 5')).toBe(true);
    expect(smoothPath(points)).toBe(path);
  });

  it('one point is a zero-length path: round caps make it a dot', () => {
    const path = smoothPath([{ x: 4, y: 7 }]);
    expect(path).toBe('M 4 7 L 4 7');
  });

  it('a long path stays finite and keeps its endpoints', () => {
    const raw = longSpiral(300);
    const path = smoothPath(simplify(raw, 1));
    expect(path.length).toBeGreaterThan(0);
    expect(path.length).toBeLessThan(50_000);
    expect(path.startsWith('M')).toBe(true);
    const numbers = path.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.every((value) => Number.isFinite(value))).toBe(true);
  });
});
