// Assertions every story 11 test makes about a drawing, without `!` and without
// `[points.length - 1] as Point`.
//
// A stroke is a list of points, and the things a test wants to say about one are always the
// same four: this is the point the pen went down at, this is the point it came up at, this
// point is the same place as that one, and this point is this far from the drawing. Written
// out here once, they read as sentences in the tests below instead of as index arithmetic,
// and a test that asked for a point that is not there fails as a sentence rather than as
// `undefined is not an object`.
import { expect } from 'vitest';
import type { Point } from '../../../src/shared/geometry';
import { distanceToSegment } from '../../../src/shared/geometry/polyline';

/** The point the pen went down: the first one stored, or a failure that says so. */
export const firstPoint = (points: readonly Point[]): Point => {
  const point = points[0];
  if (point === undefined) throw new Error('expected a stroke to hold at least one point');
  return point;
};

/** The point the pen came up at. */
export const lastPoint = (points: readonly Point[]): Point => {
  const point = points[points.length - 1];
  if (point === undefined) throw new Error('expected a stroke to hold at least one point');
  return point;
};

export const penTest = {
  /** Two points are the same place on the board, to six decimal places. */
  samePoint(a: Point, b: Point): void {
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
  },

  /** Two points are the same place on the board, to within a tolerance. */
  near(a: Point, b: Point, tolerance: number): void {
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(tolerance);
  },

  /** How far a point is from the nearest part of a path, in board units. */
  distanceFromPath(point: Point, path: readonly Point[]): number {
    if (path.length === 1) {
      const only = firstPoint(path);
      return Math.hypot(point.x - only.x, point.y - only.y);
    }
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index + 1 < path.length; index += 1) {
      const distance = distanceToSegment(point, path[index] as Point, path[index + 1] as Point);
      if (distance < best) best = distance;
    }
    return best;
  },

  firstPoint,
  lastPoint,
};
