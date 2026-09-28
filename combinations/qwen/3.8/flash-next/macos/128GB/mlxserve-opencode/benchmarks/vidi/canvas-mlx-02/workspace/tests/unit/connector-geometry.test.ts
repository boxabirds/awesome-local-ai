// Story 10, connector geometry (unit): the pure functions behind every arrow,
// argued on their own because the tools, the registry hit test and the snapshot
// all call the same ones. No Yjs here - these are the world-unit rules.
import { describe, it, expect } from 'vitest';
import {
  connectorBBox,
  isEndpoint,
  nearestSide,
  rectOfEnd,
  referencePoint,
  resolveEndpoints,
  SIDES,
  CONNECTOR_EMPTY_AXIS_FLOOR,
  type Endpoint,
} from '../../src/shared/geometry/connector-geometry.ts';
import { distanceToPolyline, distanceToSegment } from '../../src/shared/geometry/polyline.ts';
import type { Rect } from '../../src/shared/geometry.ts';

const SQUARE: Rect = { x: 0, y: 0, width: 200, height: 200 };
const WIDE: Rect = { x: 0, y: 0, width: 400, height: 100 };

describe('connector geometry nearestSide', () => {
  it('splits a square at its diagonal and a wide rect shallower than 45 degrees', () => {
    // A wide rect's diagonal is shallow: a point only 20 degrees below the
    // horizontal is already steeper than it, so the end flips to a long side.
    expect(nearestSide(WIDE, { x: 400, y: 0 })).toBe('right');
    expect(nearestSide(WIDE, { x: 300, y: 150 })).toBe('bottom');
    expect(nearestSide(WIDE, { x: -200, y: 30 })).toBe('left');
  });

  it('answers a side for a point inside the rect, on the centre and on the diagonal', () => {
    expect(SIDES).toEqual(['top', 'right', 'bottom', 'left']);
    expect(nearestSide(SQUARE, { x: 100, y: 100 })).toBe('right'); // the centre: a defined side anyway
    expect(nearestSide(SQUARE, { x: 400, y: 400 })).toBe('right'); // exact diagonal: horizontal wins the tie
    expect(nearestSide(SQUARE, { x: -200, y: -200 })).toBe('left');
    expect(nearestSide(SQUARE, { x: Number.NaN, y: 3 })).toBe('right'); // never undefined, never NaN
  });
});

describe('connector geometry resolveEndpoints', () => {
  const a: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 0, y: 0 } };
  const b: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 7, y: 7 } };
  const rects = new Map<string, Rect>([
    ['A', { x: 0, y: 0, width: 200, height: 200 }],
    ['B', { x: 300, y: 0, width: 200, height: 200 }],
  ]);

  it('anchors both ends on the sides that face each other', () => {
    expect(resolveEndpoints({ from: a, to: b }, rects)).toEqual({ from: { x: 200, y: 100 }, to: { x: 300, y: 100 } });
    // Swapping the ends swaps the anchors: the arrow is symmetric.
    expect(resolveEndpoints({ from: b, to: a }, rects)).toEqual({ from: { x: 300, y: 100 }, to: { x: 200, y: 100 } });
  });

  it('uses the fallback of an end whose rect is missing, and of a free end', () => {
    const missing = new Map<string, Rect>([['A', rects.get('A')!]]);
    expect(resolveEndpoints({ from: a, to: b }, missing).to).toEqual({ x: 7, y: 7 });
    const free = resolveEndpoints({ from: { kind: 'free', x: 1, y: 2 }, to: b }, rects);
    expect(free.from).toEqual({ x: 1, y: 2 });
    expect(free.to).toEqual({ x: 300, y: 100 });
  });

  it('still answers two finite points when nothing is known at all', () => {
    const resolved = resolveEndpoints({ from: a, to: b }, new Map());
    expect(Number.isFinite(resolved.from.x) && Number.isFinite(resolved.from.y)).toBe(true);
    expect(Number.isFinite(resolved.to.x) && Number.isFinite(resolved.to.y)).toBe(true);
  });
});

describe('connector geometry connectorBBox', () => {
  it('spans the two points in any direction and floors the empty axis', () => {
    expect(connectorBBox({ x: 200, y: 100 }, { x: 300, y: 100 })).toEqual({
      x: 200,
      y: 100,
      width: 100,
      height: CONNECTOR_EMPTY_AXIS_FLOOR,
    });
    expect(connectorBBox({ x: 300, y: 400 }, { x: 100, y: 50 })).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 350,
    });
    // A box of exactly 0 would be read as "no size stored" by objectBounds.
    const point = connectorBBox({ x: 5, y: 5 }, { x: 5, y: 5 });
    expect(point.width).toBeGreaterThan(0);
    expect(point.height).toBeGreaterThan(0);
  });
});

describe('connector geometry endpoints as stored', () => {
  it('accepts only a well-formed attached or free end', () => {
    expect(isEndpoint({ kind: 'attached', objectId: 'A', fallback: { x: 1, y: 2 } })).toBe(true);
    expect(isEndpoint({ kind: 'free', x: 1, y: 2 })).toBe(true);
    expect(isEndpoint({ kind: 'attached', objectId: '', fallback: { x: 1, y: 2 } })).toBe(false);
    expect(isEndpoint({ kind: 'attached', objectId: 'A' })).toBe(false);
    expect(isEndpoint({ kind: 'attached', objectId: 'A', fallback: { x: 1, y: Number.NaN } })).toBe(false);
    expect(isEndpoint({ kind: 'free', x: 1 })).toBe(false);
    expect(isEndpoint({ kind: 'other', x: 1, y: 2 })).toBe(false);
    expect(isEndpoint(undefined)).toBe(false);
    expect(isEndpoint('A')).toBe(false);
  });

  it('looks an attached end up by object id and aims at the live centre', () => {
    const end: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 0, y: 0 } };
    const rects = new Map<string, Rect>([['A', SQUARE]]);
    expect(rectOfEnd(end, rects)).toEqual(SQUARE);
    expect(referencePoint(end, rects)).toEqual({ x: 100, y: 100 }); // the CENTRE, which moves
    expect(referencePoint({ kind: 'free', x: 3, y: 4 }, rects)).toEqual({ x: 3, y: 4 });
    expect(referencePoint({ kind: 'attached', objectId: 'gone', fallback: { x: 8, y: 9 } }, rects)).toEqual({
      x: 8,
      y: 9,
    });
  });
});

describe('polyline distance', () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

  it('measures perpendicular distance inside the segment and endpoint distance beyond it', () => {
    expect(distanceToSegment({ x: 50, y: 6 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(6);
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 140, y: 3 })).toBeCloseTo(Math.hypot(40, 3), 6);
    expect(distanceToPolyline(line, { x: -4, y: 0 })).toBe(4);
  });

  it('takes the minimum over several segments and totals a degenerate polyline', () => {
    const zig = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(distanceToPolyline(zig, { x: 100, y: 50 })).toBe(0);
    expect(distanceToPolyline(zig, { x: 50, y: 60 })).toBe(50); // the nearer of the two segments
    expect(distanceToPolyline([], { x: 1, y: 1 })).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToPolyline([{ x: 10, y: 10 }], { x: 13, y: 14 })).toBe(5);
    expect(distanceToPolyline(line, { x: Number.NaN, y: 0 })).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToPolyline([line[0], { x: 100, y: Number.NaN }], { x: 50, y: 0 })).toBe(Number.POSITIVE_INFINITY);
    // A zero-length segment is a point, not a division by zero.
    expect(distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});
