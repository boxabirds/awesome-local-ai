/**
 * Connector geometry unit tests (TC-10, TC-14, TC-29) - pure functions, no Yjs.
 *
 * An arrow never stores where it is drawn: it stores which objects its ends are attached to, and
 * the line is resolved from those objects' live rectangles every frame (design key decision 4).
 * These functions are that resolution, and they are what makes an arrow follow a shape.
 *
 * "Nearest side" is the diagonal test the design names: a direction belongs to the side whose
 * cone - bounded by the rectangle's own diagonals - contains it. For a square that is 45 degrees,
 * for a wide box it is the angle of its diagonal.
 */
import { describe, expect, test } from 'vitest';
import type { Rect } from '../../src/shared/geometry';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { ConnectorSnap } from '../../src/shared/objects/connector';

const square: Rect = { x: 0, y: 0, width: 200, height: 200 };
const wide: Rect = { x: 0, y: 0, width: 200, height: 100 };
const tall: Rect = { x: 0, y: 0, width: 100, height: 400 };

/** A point on the circle of `radius` around the rect's centre: 0 degrees east, 90 degrees north. */
function orbit(rect: Rect, degrees: number, radius = 500): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: rect.x + rect.width / 2 + radius * Math.cos(radians),
    // screen y grows downwards, so north is minus
    y: rect.y + rect.height / 2 - radius * Math.sin(radians),
  };
}

describe('connectorGeometry.sideAnchor', () => {
  test('TC-10 the anchor of a side is its midpoint', () => {
    expect(sideAnchor(wide, 'top')).toEqual({ x: 100, y: 0 });
    expect(sideAnchor(wide, 'right')).toEqual({ x: 200, y: 50 });
    expect(sideAnchor(wide, 'bottom')).toEqual({ x: 100, y: 100 });
    expect(sideAnchor(wide, 'left')).toEqual({ x: 0, y: 50 });
  });

  test('TC-29 a rect with no size anchors on itself', () => {
    const dot: Rect = { x: 40, y: 60, width: 0, height: 0 };
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(sideAnchor(dot, side)).toEqual({ x: 40, y: 60 });
    }
  });
});

describe('connectorGeometry.nearestSide', () => {
  test('TC-10 for a square the side changes at 45 degrees, where its diagonals are', () => {
    expect(nearestSide(square, orbit(square, 0))).toBe('right');
    expect(nearestSide(square, orbit(square, 44))).toBe('right');
    expect(nearestSide(square, orbit(square, 46))).toBe('top');
    expect(nearestSide(square, orbit(square, 90))).toBe('top');
    expect(nearestSide(square, orbit(square, 134))).toBe('top');
    expect(nearestSide(square, orbit(square, 136))).toBe('left');
    expect(nearestSide(square, orbit(square, 180))).toBe('left');
    expect(nearestSide(square, orbit(square, 224))).toBe('left');
    expect(nearestSide(square, orbit(square, 226))).toBe('bottom');
    expect(nearestSide(square, orbit(square, 270))).toBe('bottom');
    expect(nearestSide(square, orbit(square, 314))).toBe('bottom');
    expect(nearestSide(square, orbit(square, 316))).toBe('right');
  });

  test('a box that is not square changes side at the angle of its own diagonal', () => {
    // a 200x100 box: the diagonal is at atan(50/100) = 26.6 degrees
    expect(nearestSide(wide, orbit(wide, 20))).toBe('right');
    expect(nearestSide(wide, orbit(wide, 30))).toBe('top');
    // a 100x400 box: atan(200/50) = 76 degrees, so most directions above it are the top
    expect(nearestSide(tall, orbit(tall, 10))).toBe('right');
    expect(nearestSide(tall, orbit(tall, 70))).toBe('right');
    expect(nearestSide(tall, orbit(tall, 80))).toBe('top');
  });

  test('the side does not depend on how far away the point is', () => {
    for (const radius of [1, 20, 5000]) {
      expect(nearestSide(wide, orbit(wide, 90, radius))).toBe('top');
      expect(nearestSide(wide, orbit(wide, 0, radius))).toBe('right');
      expect(nearestSide(wide, orbit(wide, 200, radius))).toBe('left');
      expect(nearestSide(wide, orbit(wide, 270, radius))).toBe('bottom');
    }
  });
});

describe('connectorGeometry.resolveEndpoints', () => {
  /** A 100x100 square at the origin and another 100 to the right of it. */
  const rects = new Map<string, Rect>([
    ['a', { x: 0, y: 0, width: 100, height: 100 }],
    ['b', { x: 200, y: 0, width: 100, height: 100 }],
  ]);

  const connector = (
    from: ConnectorSnap['from'],
    to: ConnectorSnap['to'],
  ): ConnectorSnap => ({
    id: 'c',
    type: 'connector',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    z: 1,
    createdAt: 0,
    createdBy: 'g_test',
    from,
    to,
    ends: { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
  });

  test('TC-29 an attached end is drawn at the anchor of the side nearest the other end', () => {
    expect(
      resolveEndpoints(
        connector(
          { kind: 'attached', objectId: 'a', fallback: { x: 999, y: 999 } },
          { kind: 'attached', objectId: 'b', fallback: { x: 999, y: 999 } },
        ),
        rects,
      ),
    ).toEqual({ from: { x: 100, y: 50 }, to: { x: 200, y: 50 } });
  });

  test('TC-29 when the object moves, the endpoint moves with it', () => {
    const arrow = connector(
      { kind: 'attached', objectId: 'a', fallback: { x: 0, y: 0 } },
      { kind: 'free', x: 300, y: 500 },
    );
    // the drag ended below and to the right, so the arrow leaves through the bottom
    expect(resolveEndpoints(arrow, rects)).toEqual({ from: { x: 50, y: 100 }, to: { x: 300, y: 500 } });

    const moved = new Map(rects);
    moved.set('a', { x: -300, y: -40, width: 100, height: 100 });
    // the same arrow now leaves through the right side of where the object went
    expect(resolveEndpoints(arrow, moved)).toEqual({ from: { x: -200, y: 10 }, to: { x: 300, y: 500 } });
  });

  test('TC-27 an attached object that is gone is drawn at the last place it was seen', () => {
    expect(
      resolveEndpoints(
        connector(
          { kind: 'attached', objectId: 'vanished', fallback: { x: 12, y: 34 } },
          { kind: 'attached', objectId: 'b', fallback: { x: 1, y: 2 } },
        ),
        rects,
      ),
    ).toEqual({ from: { x: 12, y: 34 }, to: { x: 200, y: 50 } });
  });

  test('TC-29 connectorBBox covers the line, in either direction', () => {
    expect(connectorBBox({ x: 100, y: 50 }, { x: 40, y: -20 })).toEqual({
      x: 40,
      y: -20,
      width: 60,
      height: 70,
    });
    // a straight horizontal line has no height, which is not a problem for anything
    expect(connectorBBox({ x: 0, y: 5 }, { x: 10, y: 5 })).toEqual({
      x: 0,
      y: 5,
      width: 10,
      height: 0,
    });
  });
});

describe('connectorGeometry.distanceToPolyline', () => {
  test('TC-14 the distance to a segment, exactly, on the line and off it', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(distanceToPolyline(line, { x: 5, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 5, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 5, y: 6.01 })).toBeCloseTo(6.01, 10);
  });

  test('TC-14 past an end it is the distance to that end, and the nearest leg of a longer path wins', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(distanceToPolyline(line, { x: 14, y: 0 })).toBeCloseTo(4, 10);
    expect(distanceToPolyline(line, { x: 11, y: 5 })).toBeCloseTo(1, 10);
    expect(distanceToPolyline(line, { x: 5, y: 5 })).toBeCloseTo(5, 10);
    // a single point is a path of one
    expect(distanceToPolyline([{ x: 3, y: 4 }], { x: 0, y: 0 })).toBeCloseTo(5, 10);
    // and nothing at all is infinitely far away, so a hit test on it is simply false
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});
