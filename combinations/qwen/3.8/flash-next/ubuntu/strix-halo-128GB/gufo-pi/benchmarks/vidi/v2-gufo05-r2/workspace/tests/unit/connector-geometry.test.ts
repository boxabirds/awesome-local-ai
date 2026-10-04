/**
 * Story 10: the maths an arrow is made of — how far a point is from its line, which
 * side of an object each end sits on, and the box it occupies.
 *
 * Nothing here touches a document or a browser: these are the numbers the connector
 * model, the arrow tool and the selection rule all agree on. The side tests use a
 * unit square wherever the answer does not depend on proportions, and a deliberately
 * wide rect where it does (TC-10), because the rule is about the diagonals.
 */

import { describe, expect, it } from 'vitest';

import {
  connectorBBox,
  endpointPosition,
  nearestSide,
  oppositeReference,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline, distanceToSegment, polylineBounds } from '../../src/shared/geometry/polyline';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import type { ConnectorEndpoint } from '../../src/shared/objects/connector';
import type { Point, Rect } from '../../src/shared/geometry';

const UNIT: Rect = { x: 0, y: 0, width: 100, height: 100 };

describe('distanceToPolyline (TC-14)', () => {
  const line: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  it('is the perpendicular distance for a point beside a horizontal segment', () => {
    expect(distanceToPolyline(line, { x: 40, y: 5 })).toBeCloseTo(5, 6);
    expect(distanceToSegment({ x: 40, y: -5 }, line[0], line[1])).toBeCloseTo(5, 6);
  });

  it('is the distance to the nearer end past the end of the segment', () => {
    expect(distanceToPolyline(line, { x: 130, y: 4 })).toBeCloseTo(Math.hypot(30, 4), 6);
    expect(distanceToPolyline(line, { x: -10, y: 0 })).toBeCloseTo(10, 6);
  });

  it('TC-14: measures the hit band exactly — 0, 5.99 and 6.01 units off the line', () => {
    // The tolerance itself is CONNECTOR_HIT_TOLERANCE_PX divided by the zoom, which
    // is what the registry's hit test turns these numbers into; here they are plain
    // board units, the same ones at 100%.
    expect(distanceToPolyline(line, { x: 40, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 40, y: 5.99 })).toBeCloseTo(5.99, 6);
    expect(distanceToPolyline(line, { x: 40, y: 6.01 })).toBeCloseTo(6.01, 6);
    expect(5.99 <= CONNECTOR_HIT_TOLERANCE_PX / 1).toBe(true);
    expect(6.01 <= CONNECTOR_HIT_TOLERANCE_PX / 1).toBe(false);
    // Half the zoom halves the band in board units: the same click is further away.
    expect(5.99 <= CONNECTOR_HIT_TOLERANCE_PX / 2).toBe(false);
    expect(5.99 <= CONNECTOR_HIT_TOLERANCE_PX / 0.5).toBe(true);
  });

  it('takes the nearest of several segments', () => {
    const elbow: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(distanceToPolyline(elbow, { x: 104, y: 60 })).toBeCloseTo(4, 6);
    expect(distanceToPolyline(elbow, { x: 50, y: 4 })).toBeCloseTo(4, 6);
    // Past the corner of the second segment, it is the corner that is nearest.
    expect(distanceToPolyline(elbow, { x: 103, y: 104 })).toBeCloseTo(5, 6);
  });

  it('treats one point as a dot, and no points as no line at all', () => {
    expect(distanceToPolyline([{ x: 10, y: 10 }], { x: 13, y: 14 })).toBeCloseTo(5, 6);
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Infinity);
  });

  it('skips an end a broken document left with rubbish in it', () => {
    const broken: Point[] = [
      { x: 0, y: 0 },
      { x: NaN, y: 0 },
    ];
    expect(distanceToPolyline(broken, { x: 0, y: 3 })).toBe(Infinity);
  });
});

describe('sideAnchor (TC-08)', () => {
  it('is the midpoint of the named side', () => {
    expect(sideAnchor(UNIT, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(UNIT, 'right')).toEqual({ x: 100, y: 50 });
    expect(sideAnchor(UNIT, 'bottom')).toEqual({ x: 50, y: 100 });
    expect(sideAnchor(UNIT, 'left')).toEqual({ x: 0, y: 50 });
  });

  it('lands on the outline of a box that is nowhere near the origin', () => {
    const r: Rect = { x: -300, y: 120, width: 40, height: 260 };
    expect(sideAnchor(r, 'top')).toEqual({ x: -280, y: 120 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: -280, y: 380 });
    expect(sideAnchor(r, 'left')).toEqual({ x: -300, y: 250 });
    expect(sideAnchor(r, 'right')).toEqual({ x: -260, y: 250 });
  });
});

describe('nearestSide (TC-10)', () => {
  it('switches at the diagonal of a square', () => {
    // B orbits A. Angles are measured the way a person points at a screen: 0 to the
    // right, 90 straight up.
    const orbit = (degrees: number): Point => {
      const radians = (degrees * Math.PI) / 180;
      return { x: 50 + 300 * Math.cos(radians), y: 50 - 300 * Math.sin(radians) };
    };
    expect(nearestSide(UNIT, orbit(0))).toBe('right');
    expect(nearestSide(UNIT, orbit(44))).toBe('right');
    expect(nearestSide(UNIT, orbit(46))).toBe('top');
    expect(nearestSide(UNIT, orbit(90))).toBe('top');
    // …and the other three quadrants follow the same rule.
    expect(nearestSide(UNIT, orbit(136))).toBe('left');
    expect(nearestSide(UNIT, orbit(224))).toBe('left');
    expect(nearestSide(UNIT, orbit(314))).toBe('bottom');
    expect(nearestSide(UNIT, orbit(359))).toBe('right');
    expect(nearestSide(UNIT, orbit(270))).toBe('bottom');
  });

  it('follows the proportions of the box, not the raw angle', () => {
    // The right wedge of a box spans the directions whose |dy/dx| stays under
    // height/width: a wide box has narrow left/right wedges and a wide top one.
    const wide: Rect = { x: 0, y: 0, width: 400, height: 100 };
    expect(nearestSide(wide, { x: 500, y: 30 })).toBe('right');
    expect(nearestSide(wide, { x: 500, y: -100 })).toBe('top');
    // The same direction against a square is well inside its diagonal.
    expect(nearestSide(UNIT, { x: 300, y: -80 })).toBe('right');
    // A tall box is the other way round: it keeps 'top' out to a shallow angle.
    expect(nearestSide({ x: 0, y: 0, width: 100, height: 400 }, { x: 60, y: -30 })).toBe('top');
    expect(nearestSide({ x: 0, y: 0, width: 100, height: 400 }, { x: 200, y: 210 })).toBe('right');
  });
});

describe('resolveEndpoints (TC-30)', () => {
  const attached = (objectId: string, fallbackX = 0, fallbackY = 0): ConnectorEndpoint => ({
    kind: 'attached',
    objectId,
    fallbackX,
    fallbackY,
  });
  const free = (x: number, y: number): ConnectorEndpoint => ({ kind: 'free', x, y });

  it('places both ends on the sides that face each other', () => {
    const rects = new Map<string, Rect>([
      ['a', { x: 0, y: 0, width: 100, height: 100 }],
      ['b', { x: 300, y: 0, width: 100, height: 100 }],
    ]);
    const ends = resolveEndpoints({ from: attached('a'), to: attached('b') }, rects);
    expect(ends.from).toEqual({ x: 100, y: 50 });
    expect(ends.to).toEqual({ x: 300, y: 50 });
  });

  it('flips the side an end uses when its object is dragged past the other', () => {
    const rects = new Map<string, Rect>([
      ['a', { x: 0, y: 0, width: 100, height: 100 }],
      ['b', { x: 0, y: 300, width: 100, height: 100 }],
    ]);
    const connector = { from: attached('a'), to: attached('b') };
    expect(resolveEndpoints(connector, rects).from).toEqual({ x: 50, y: 100 });
    // Now B goes above A instead of below it.
    rects.set('b', { x: 0, y: -300, width: 100, height: 100 });
    expect(resolveEndpoints(connector, rects).from).toEqual({ x: 50, y: 0 });
  });

  it('uses the stored fallback of an end whose object is gone', () => {
    const rects = new Map<string, Rect>([['b', { x: 300, y: 0, width: 100, height: 100 }]]);
    const ends = resolveEndpoints(
      { from: attached('gone', 12, 34), to: attached('b') },
      rects,
    );
    expect(ends.from).toEqual({ x: 12, y: 34 });
    expect(ends.to).toEqual({ x: 300, y: 50 });
  });

  it('leaves a free end exactly where it is', () => {
    const rects = new Map<string, Rect>([['b', { x: 300, y: 0, width: 100, height: 100 }]]);
    const ends = resolveEndpoints({ from: free(-5, 7), to: attached('b') }, rects);
    expect(ends.from).toEqual({ x: -5, y: 7 });
    expect(ends.to).toEqual({ x: 300, y: 50 });
  });

  it('faces an attached end at the middle of the object opposite it', () => {
    const rects = new Map<string, Rect>([['b', { x: 300, y: 200, width: 100, height: 100 }]]);
    expect(oppositeReference(attached('b'), rects)).toEqual({ x: 350, y: 250 });
    expect(oppositeReference(free(1, 2), rects)).toEqual({ x: 1, y: 2 });
    expect(oppositeReference(attached('gone', 8, 9), rects)).toEqual({ x: 8, y: 9 });
  });

  it('is stable when both ends share one box in a list of many', () => {
    const rects = new Map<string, Rect>([
      ['a', { x: 0, y: 0, width: 100, height: 100 }],
      ['c', { x: -900, y: -900, width: 50, height: 50 }],
    ]);
    const ends = resolveEndpoints({ from: attached('a'), to: attached('a') }, rects);
    // The tool refuses a self loop, but a document that holds one still draws
    // something rather than throwing.
    expect(ends.from).toEqual(ends.to);
  });
});

describe('connectorBBox', () => {
  it('squares up two ends in any direction', () => {
    expect(connectorBBox({ x: 10, y: 20 }, { x: 60, y: 90 })).toEqual({
      x: 10,
      y: 20,
      width: 50,
      height: 70,
    });
    expect(connectorBBox({ x: 60, y: 90 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 50,
      height: 70,
    });
    expect(connectorBBox({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });

  it('matches the bounds of the same points as a polyline', () => {
    const from = { x: -20, y: 30 };
    const to = { x: 40, y: -10 };
    expect(polylineBounds([from, to])).toEqual(connectorBBox(from, to));
  });

  it('is a box the ends themselves sit on, so a hit band extends past it', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 0, y: 100 };
    const box = connectorBBox(from, to);
    // A vertical arrow has no width, yet a click beside it must still select it.
    expect(box.width).toBe(0);
    expect(endpointPosition({ kind: 'free', x: 0, y: 0 }, to, new Map())).toEqual({ x: 0, y: 0 });
  });
});
