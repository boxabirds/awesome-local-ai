import { describe, expect, it } from 'vitest';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Point } from '../../src/shared/geometry';

/** Task 15 (`connector.tolerance`): the polyline maths an arrow is selected with. */

const on = (x: number, y: number): Point => ({ x, y });

describe('distanceToPolyline (`connector.tolerance`)', () => {
  const segment: readonly Point[] = [on(0, 0), on(100, 0)];

  it('a point on the line has distance 0', () => {
    expect(distanceToPolyline(segment, on(0, 0))).toBe(0);
    expect(distanceToPolyline(segment, on(50, 0))).toBe(0);
    expect(distanceToPolyline(segment, on(100, 0))).toBe(0);
  });

  it('5.99 px away is 5.99', () => {
    expect(distanceToPolyline(segment, on(50, 5.99))).toBeCloseTo(5.99, 10);
  });

  it('6.01 px away is 6.01', () => {
    expect(distanceToPolyline(segment, on(50, 6.01))).toBeCloseTo(6.01, 10);
  });

  it('beyond the end of the segment the distance is to the endpoint, not to the line', () => {
    expect(distanceToPolyline(segment, on(110, 0))).toBeCloseTo(10, 10);
    expect(distanceToPolyline(segment, on(-5, 0))).toBeCloseTo(5, 10);
    expect(distanceToPolyline(segment, on(110, 5))).toBeCloseTo(Math.hypot(10, 5), 10);
  });

  it('the nearest segment of a multi-segment polyline is the one measured', () => {
    const elbow: readonly Point[] = [on(0, 0), on(100, 0), on(100, 100)];
    expect(distanceToPolyline(elbow, on(100, 50))).toBe(0);
    expect(distanceToPolyline(elbow, on(50, 50))).toBeCloseTo(50, 10);
    expect(distanceToPolyline(elbow, on(105, 50))).toBeCloseTo(5, 10);
    // The vertical leg is nearer than the corner here: 3, not hypot(3, 4).
    expect(distanceToPolyline(elbow, on(103, 4))).toBeCloseTo(3, 10);
  });

  it('a diagonal segment measures the perpendicular distance', () => {
    const diagonal: readonly Point[] = [on(0, 0), on(100, 100)];
    expect(distanceToPolyline(diagonal, on(50, 50))).toBeCloseTo(0, 10);
    // The perpendicular from (50, 60) to the line y = x is 10 / sqrt(2).
    expect(distanceToPolyline(diagonal, on(50, 60))).toBeCloseTo(10 / Math.SQRT2, 10);
  });

  it('a single point polyline is the distance to that point', () => {
    expect(distanceToPolyline([on(3, 4)], on(0, 0))).toBeCloseTo(5, 10);
  });

  it('an empty polyline is Infinity, so nothing is ever selected by it', () => {
    expect(distanceToPolyline([], on(0, 0))).toBe(Number.POSITIVE_INFINITY);
  });

  it('a zero-length segment does not divide by zero', () => {
    expect(distanceToPolyline([on(10, 10), on(10, 10)], on(13, 14))).toBeCloseTo(5, 10);
  });
});
