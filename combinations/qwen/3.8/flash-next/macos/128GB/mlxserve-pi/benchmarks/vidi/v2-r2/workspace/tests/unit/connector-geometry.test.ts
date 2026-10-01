// Connector geometry (story 10): the four side anchors, which side an arrow leans
// to, where the two ends of an arrow land, the box around them, and how near a
// click has to come to an arrow's line to be on it.
//
// Pure arithmetic, no Y.Doc and no React, so the rules that make an arrow follow the
// objects it points at are pinned at the same level as the object model.
// TC ids are the Acceptance Cases in
// spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md.

import { describe, expect, it } from 'vitest';
import {
  anchorOf,
  centre,
  connectorBBox,
  endpointPoint,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  SIDES,
  type Endpoint,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline, distanceToSegment } from '../../src/shared/geometry/polyline';
import type { Point, Rect } from '../../src/shared/geometry';

/** A rect at (x, y), `w` by `h`. */
function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, width: w, height: h };
}

function attached(objectId: string, fallback: Point = { x: 0, y: 0 }): Endpoint {
  return { kind: 'attached', objectId, fallback };
}

function free(x: number, y: number): Endpoint {
  return { kind: 'free', x, y };
}

describe("sideAnchor (TC-07)", () => {
  const box = rect(100, 200, 200, 120);

  // TC-07
  it("TC-07 puts each side's anchor at that side's midpoint", () => {
    expect(sideAnchor(box, 'top')).toEqual({ x: 200, y: 200 });
    expect(sideAnchor(box, 'right')).toEqual({ x: 300, y: 260 });
    expect(sideAnchor(box, 'bottom')).toEqual({ x: 200, y: 320 });
    expect(sideAnchor(box, 'left')).toEqual({ x: 100, y: 260 });
  });

  it("TC-07 names the four sides once each, and the centre is between them", () => {
    expect([...SIDES].sort()).toEqual(['bottom', 'left', 'right', 'top']);
    expect(centre(box)).toEqual({ x: 200, y: 260 });
    // every anchor is on the box, and the four of them are all different points
    const anchors = SIDES.map((side) => sideAnchor(box, side));
    expect(new Set(anchors.map((p) => `${p.x},${p.y}`)).size).toBe(4);
    for (const p of anchors) {
      expect(p.x === box.x || p.x === box.x + box.width || p.y === box.y || p.y === box.y + box.height).toBe(true);
    }
  });
});

describe("nearestSide (TC-08)", () => {
  const a = rect(0, 0, 100, 100);

  /** The centre of an object the same size as `a`, `distance` away at `degrees`. */
  function orbit(degrees: number, distance = 400): Point {
    const radians = (degrees * Math.PI) / 180;
    // the board's y axis points down, so a rising angle is a smaller y
    return { x: 50 + distance * Math.cos(radians), y: 50 - distance * Math.sin(radians) };
  }

  // TC-08: the side changes on the 45° diagonal, and only there.
  it("TC-08 takes the nearest side as the other end orbits, right through the 45° diagonal", () => {
    expect(nearestSide(a, orbit(0))).toBe('right');
    expect(nearestSide(a, orbit(44))).toBe('right');
    expect(nearestSide(a, orbit(46))).toBe('top');
    expect(nearestSide(a, orbit(90))).toBe('top');
  });

  it("TC-08 mirrors the four sides, and only the larger distance decides", () => {
    expect(nearestSide(a, orbit(180))).toBe('left');
    expect(nearestSide(a, orbit(270))).toBe('bottom');
    expect(nearestSide(a, orbit(316))).toBe('right'); // -44°, between right and bottom
    expect(nearestSide(a, orbit(304))).toBe('bottom'); // -56°
    expect(nearestSide(a, orbit(134))).toBe('top');
    expect(nearestSide(a, orbit(136))).toBe('left');
  });

  it("TC-08 is decided by the larger of the two distances, not by the angle alone", () => {
    // far to the right and a little above: still the right side
    expect(nearestSide(a, { x: 5000, y: 40 })).toBe('right');
    // barely above the centre and far to the left: the left side
    expect(nearestSide(a, { x: -5000, y: 45 })).toBe('left');
    // directly below, however far
    expect(nearestSide(a, { x: 50, y: 9000 })).toBe('bottom');
  });
});

describe("resolveEndpoints (TC-09, TC-10)", () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(300, 0, 100, 100);

  // TC-09: each end takes the side facing the other, and flips as the objects move.
  it("TC-09 joins A to B along the sides that face each other", () => {
    const rects = new Map([['A', a], ['B', b]]);
    const ends = resolveEndpoints({ from: attached('A'), to: attached('B') }, rects);
    expect(ends.from).toEqual({ x: 100, y: 50 });
    expect(ends.to).toEqual({ x: 300, y: 50 });
  });

  it("TC-09 switches both ends to the sides they now face when the objects move", () => {
    const rects = new Map([['A', a], ['B', b]]);
    const ends = resolveEndpoints({ from: attached('A'), to: attached('B') }, rects);

    // B moves above A: both ends move to the top
    rects.set('B', rect(0, -300, 100, 100));
    const above = resolveEndpoints({ from: attached('A'), to: attached('B') }, rects);
    expect(above.from).toEqual({ x: 50, y: 0 });
    expect(above.to).toEqual({ x: 50, y: -200 });
    expect(above).not.toEqual(ends);

    // B moves to A's left: the ends swap which sides they use
    rects.set('B', rect(-400, 0, 100, 100));
    const left = resolveEndpoints({ from: attached('A'), to: attached('B') }, rects);
    expect(left.from).toEqual({ x: 0, y: 50 });
    expect(left.to).toEqual({ x: -300, y: 50 });
  });

  it("TC-09 follows a resize of either object without anything being rewritten", () => {
    const ends = { from: attached('A'), to: attached('B') };
    const before = resolveEndpoints(ends, new Map([['A', a], ['B', b]]));
    // B grows to the left, so the side facing A moves with it: same sides,
    // different points, and nothing about the arrow was rewritten
    const after = resolveEndpoints(ends, new Map([['A', a], ['B', rect(200, 0, 300, 100)]]));
    expect(after.from).toEqual(before.from);
    expect(after.to).toEqual({ x: 200, y: 50 });
  });

  // TC-10: an end whose object is gone is drawn where it was attached, not dropped.
  it("TC-10 falls back to the stored point when the object an end points at is gone", () => {
    const rects = new Map([['B', b]]);
    const ends = resolveEndpoints({ from: attached('A', { x: 12, y: 7 }), to: attached('B') }, rects);
    expect(ends.from).toEqual({ x: 12, y: 7 });
    expect(ends.to).toEqual({ x: 300, y: 50 });
  });

  it("TC-10 falls back for both ends at once when both objects are gone", () => {
    const ends = resolveEndpoints(
      { from: attached('A', { x: 1, y: 2 }), to: attached('B', { x: 3, y: 4 }) },
      new Map(),
    );
    expect(ends).toEqual({ from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });
  });

  it("TC-10 leaves a free end exactly where it was pinned, object or no object", () => {
    const rects = new Map([['A', a]]);
    expect(resolveEndpoints({ from: free(7, 9), to: free(31, 44) }, rects)).toEqual({
      from: { x: 7, y: 9 },
      to: { x: 31, y: 44 },
    });
    expect(endpointPoint(free(7, 9))).toEqual({ x: 7, y: 9 });
    expect(endpointPoint(attached('A', { x: 1, y: 2 }))).toEqual({ x: 1, y: 2 });
  });

  it("TC-10 takes the object's own side for a mixed pair, ignoring the free end's object", () => {
    const rects = new Map([['A', a]]);
    const ends = resolveEndpoints({ from: attached('A'), to: free(500, 50) }, rects);
    expect(ends.from).toEqual({ x: 100, y: 50 });
    expect(ends.to).toEqual({ x: 500, y: 50 });
  });

  it("TC-10 aims at the object's centre, so an end never aims at the other end's edge", () => {
    const rects = new Map([['A', a], ['B', b]]);
    expect(anchorOf(attached('A'), centre(b), rects)).toEqual({ x: 100, y: 50 });
    expect(anchorOf(attached('A'), { x: 50, y: -100 }, rects)).toEqual({ x: 50, y: 0 });
    // an end naming nothing is drawn at its fallback rather than at the origin
    expect(anchorOf(attached('gone', { x: 5, y: 6 }), centre(b), rects)).toEqual({ x: 5, y: 6 });
  });
});

describe("connectorBBox (TC-11)", () => {
  // TC-11
  it("TC-11 boxes an arrow the same way whichever end is named first", () => {
    expect(connectorBBox({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
    expect(connectorBBox({ x: 100, y: 50 }, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  });

  it("TC-11 boxes a vertical and a horizontal arrow as a line, and both ends as a point", () => {
    expect(connectorBBox({ x: 10, y: 20 }, { x: 10, y: 90 })).toEqual({ x: 10, y: 20, width: 0, height: 70 });
    expect(connectorBBox({ x: 10, y: 20 }, { x: 80, y: 20 })).toEqual({ x: 10, y: 20, width: 70, height: 0 });
    expect(connectorBBox({ x: 6, y: 6 }, { x: 6, y: 6 })).toEqual({ x: 6, y: 6, width: 0, height: 0 });
  });

  it("TC-11 boxes an arrow that runs up and left from the corner both ends passed", () => {
    expect(connectorBBox({ x: 100, y: 90 }, { x: 40, y: 30 })).toEqual({ x: 40, y: 30, width: 60, height: 60 });
  });
});

describe("distanceToPolyline (TC-12)", () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

  // TC-12
  it("TC-12 measures the distance off the line, and the distance beyond its end", () => {
    expect(distanceToPolyline(line, { x: 50, y: 6 })).toBeCloseTo(6, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.1 })).toBeCloseTo(6.1, 10);
    expect(distanceToPolyline(line, { x: 200, y: 0 })).toBeCloseTo(100, 10);
  });

  it("TC-12 measures to the nearest segment of a longer polyline", () => {
    const elbow = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(distanceToPolyline(elbow, { x: 104, y: 60 })).toBeCloseTo(4, 10);
    expect(distanceToPolyline(elbow, { x: 50, y: 3 })).toBeCloseTo(3, 10);
    expect(distanceToPolyline(elbow, { x: 50, y: 50 })).toBeCloseTo(50, 10);
  });

  it("TC-12 answers the distance to a lone point, and nothing at all to no points", () => {
    expect(distanceToPolyline([{ x: 10, y: 10 }], { x: 13, y: 14 })).toBeCloseTo(5, 10);
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToPolyline([undefined as unknown as Point], { x: 0, y: 0 })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("TC-12 keeps a point off either end at the distance to that end", () => {
    expect(distanceToSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(10, 10);
    expect(distanceToSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -10, y: -10 })).toBeCloseTo(
      Math.SQRT2 * 10,
      10,
    );
    // a segment of no length is a point
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 9 })).toBeCloseTo(4, 10);
  });
});
