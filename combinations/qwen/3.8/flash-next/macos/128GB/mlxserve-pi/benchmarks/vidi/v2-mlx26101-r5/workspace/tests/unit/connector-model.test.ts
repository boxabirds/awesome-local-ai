/**
 * The connector model and its geometry (story 10, TC-07 … TC-14, TC-29).
 *
 * An arrow is two ends, and the whole design of it is that the ends are *not* points. An attached end
 * names an object; where it is drawn is a question answered from the rectangles the board has right
 * now, which is what lets an arrow follow an object that a stranger moved a millisecond ago without a
 * single byte about the arrow ever going over the wire.
 *
 * So these tests are mostly about three things: which side of an object an end sits on (TC-10), what
 * happens when the object on the other end is gone (TC-11, TC-13), and how far a click may be from the
 * line and still be on it (TC-14). Transactions are counted the way every other suite here counts
 * them, because "the object is gone and the arrow stayed" is one step of the history and not two.
 */

import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createSticky,
  deleteObjects,
  initDoc,
  isConnectorSnapshot,
  LOCAL_ORIGIN,
  moveObjects,
  OBJECTS_MAP,
  objectBounds,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';
import {
  createConnector,
  detachConnectorsTo,
  setConnectorEndpoint,
  type ConnectorSnapshot,
  type Endpoint,
  type Side,
} from '../../src/shared/objects/connector';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createShape, type ShapeSnapshot } from '../../src/shared/objects/shape';
import { createText } from '../../src/shared/objects/text';

/** An end that names an object. The fallback is only what the tool guessed; the model replaces it. */
const attached = (objectId: string, fallback: Point = { x: 0, y: 0 }): Endpoint => ({ kind: 'attached', objectId, fallback });

const at = (x: number, y: number): FreeEnd => ({ kind: 'free', x, y });

/** The free half of an endpoint, which is the half that has coordinates to do arithmetic with. */
type FreeEnd = { kind: 'free'; x: number; y: number };

const updates = (doc: Y.Doc): number[] => {
  const counts: number[] = [];
  let count = 0;
  doc.on('update', () => {
    count += 1;
    counts.push(count);
  });
  return counts;
};

const countOn = (doc: Y.Doc): number => snapshot(doc).length;

/** The arrow on the board, or the failure of the test that asked for one. */
const connectorAt = (doc: Y.Doc, id: string | null): ConnectorSnapshot => {
  if (id === null) throw new Error('the arrow was not created');
  const found = snapshot(doc).find((object) => object.id === id);
  if (found === undefined || !isConnectorSnapshot(found)) throw new Error(`arrow ${id} is not on the board`);
  return found;
};

/** A shape, by whichever name it goes by in this suite. */
const shapeAt = (doc: Y.Doc, id: string | null): ShapeSnapshot => {
  if (id === null) throw new Error('the shape was not created');
  const found = snapshot(doc).find((object) => object.id === id);
  if (found === undefined || found.type !== 'shape') throw new Error(`shape ${id} is not on the board`);
  return found as ShapeSnapshot;
};

/** Where every object on this board is, which is what an attached end is drawn from. */
const rectsOf = (doc: Y.Doc): Map<string, Rect> => new Map(snapshot(doc).map((object) => [object.id, objectBounds(object)]));

/** Both ends of an arrow as they are drawn on a board that holds the whole document. */
const resolve = (connector: ConnectorSnapshot, doc: Y.Doc): { from: Point; to: Point } =>
  resolveEndpoints(connector, rectsOf(doc));

/** The point an end is drawn at according to the document alone — its anchor or its place. */
const pointOf = (endpoint: Endpoint | undefined): Point | undefined => {
  if (endpoint === undefined) return undefined;
  return endpoint.kind === 'free' ? { x: endpoint.x, y: endpoint.y } : endpoint.fallback;
};

/** A shape made the way the shape tool makes one. */
const rectShape = (doc: Y.Doc, rect: Rect): string => {
  const id = createShape(doc, { kind: 'rect', rect });
  if (id === null) throw new Error('the shape was not created');
  return id;
};

/** The colour a note is stored as, straight out of the document. */
const colorOfNote = (doc: Y.Doc, id: string): unknown => {
  const entry: unknown = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get(id);
  return entry instanceof Y.Map ? entry.get('color') : undefined;
};

/** A delete that never told the arrows — what a board written by a build from before this story looks like. */
const vanish = (doc: Y.Doc, id: string): void => {
  doc.transact(() => {
    doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).delete(id);
  }, LOCAL_ORIGIN);
};

/** The middle of the straight line between two points. */
const midpoint = (from: Point, to: Point): Point => ({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });

/** A point `distance` world units off the line between two points, to one side of it. */
const awayFromLine = (from: Point, to: Point, distance: number): Point => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const middle = midpoint(from, to);
  return { x: middle.x + (-(to.y - from.y) / length) * distance, y: middle.y + ((to.x - from.x) / length) * distance };
};

/** The connector's own rule for "is this click on the arrow", in one line: see TC-14 and TC-20. */
const clickLandsOn = (ends: { from: Point; to: Point }, point: Point, zoom: number): boolean =>
  distanceToPolyline([ends.from, ends.to], point) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;

describe('sideAnchor', () => {
  const rect = { x: 100, y: 200, width: 300, height: 100 };

  it('is the midpoint of the side it is asked for', () => {
    expect(sideAnchor(rect, 'top')).toEqual({ x: 250, y: 200 });
    expect(sideAnchor(rect, 'bottom')).toEqual({ x: 250, y: 300 });
    expect(sideAnchor(rect, 'left')).toEqual({ x: 100, y: 250 });
    expect(sideAnchor(rect, 'right')).toEqual({ x: 400, y: 250 });
  });

  it('is on the box, whatever the box is', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const point = sideAnchor(rect, side);
      expect(point.x).toBeGreaterThanOrEqual(rect.x);
      expect(point.x).toBeLessThanOrEqual(rect.x + rect.width);
      expect(point.y).toBeGreaterThanOrEqual(rect.y);
      expect(point.y).toBeLessThanOrEqual(rect.y + rect.height);
    }
  });

  it('stays a point when the box is not a box', () => {
    expect(sideAnchor({ x: 5, y: 5, width: 0, height: 0 }, 'top')).toEqual({ x: 5, y: 5 });
    // A side this build has never heard of came from a newer client, and an arrow still has to be drawn.
    expect(Number.isNaN(sideAnchor(rect, ('nope' as unknown) as Side).x)).toBe(false);
  });
});

describe('nearestSide', () => {
  // TC-10
  it('turns from the right side to the top as the other object passes the diagonal', () => {
    const a = { x: 0, y: 0, width: 200, height: 200 };
    const centre = { x: 100, y: 100 };
    // B orbits A's centre; the point handed over is somewhere in B's direction from A's centre.
    const orbit = (degrees: number, radius = 400) => {
      const radians = (degrees * Math.PI) / 180;
      return { x: centre.x + Math.cos(radians) * radius, y: centre.y - Math.sin(radians) * radius };
    };

    expect(nearestSide(a, orbit(0))).toBe('right');
    expect(nearestSide(a, orbit(44))).toBe('right');
    expect(nearestSide(a, orbit(46))).toBe('top');
    expect(nearestSide(a, orbit(90))).toBe('top');
    // …and the same rule the rest of the way round, because a side that only works in the top-right
    // quadrant is a side that gets arrows pointing out of the back of an object. The angles either side
    // of each diagonal are one degree off it on purpose: dead on a diagonal two sides are equally near
    // and the answer is a coin flip of floating point, which is what the next test is about.
    expect(nearestSide(a, orbit(134))).toBe('top');
    expect(nearestSide(a, orbit(136))).toBe('left');
    expect(nearestSide(a, orbit(180))).toBe('left');
    expect(nearestSide(a, orbit(224))).toBe('left');
    expect(nearestSide(a, orbit(226))).toBe('bottom');
    expect(nearestSide(a, orbit(270))).toBe('bottom');
    expect(nearestSide(a, orbit(314))).toBe('bottom');
    expect(nearestSide(a, orbit(316))).toBe('right');
  });

  it('is decided by direction and not by distance', () => {
    const a = { x: 0, y: 0, width: 200, height: 200 };
    // Far away to the right, and immediately above: the same answer for both, because the side an
    // arrow leaves from is about where it is going and not how far.
    expect(nearestSide(a, { x: 10000, y: 100 })).toBe('right');
    expect(nearestSide(a, { x: 101, y: 50 })).toBe('top');
  });

  it('gives one answer to the exact diagonal, and keeps giving it', () => {
    const a = { x: 0, y: 0, width: 200, height: 200 };
    // Dead on 45° two sides are equally near. The answer only has to be one of them, and it must not
    // change between two frames of a board that has not moved: a side that flips on a still board is
    // an arrow that flickers.
    const diagonal = nearestSide(a, { x: 500, y: -300 });
    expect(['top', 'right']).toContain(diagonal);
    expect(nearestSide(a, { x: 500, y: -300 })).toBe(diagonal);
    // The point on the far side of the same diagonal gets the side on the far side of the object, which
    // is the same tie broken the same way: a board that is still must not have an arrow changing its
    // mind between one frame and the next.
    expect(nearestSide(a, { x: -300, y: 500 })).toBe(diagonal === 'top' ? 'bottom' : 'left');
  });

  it('has an answer for an object it is inside, for a point that is not a point and a box that is not a box', () => {
    const a = { x: 0, y: 0, width: 200, height: 200 };
    const sides = ['top', 'right', 'bottom', 'left'];
    expect(sides).toContain(nearestSide(a, { x: 100, y: 100 }));
    expect(sides).toContain(nearestSide(a, { x: Number.NaN, y: 0 }));
    expect(sides).toContain(nearestSide({ x: 5, y: 5, width: 0, height: 0 }, { x: 50, y: 50 }));
  });
});

describe('connectorBBox', () => {
  it('is the box that covers both ends, whichever way the arrow points', () => {
    expect(connectorBBox({ x: 100, y: 200 }, { x: 300, y: 400 })).toEqual({ x: 100, y: 200, width: 200, height: 200 });
    expect(connectorBBox({ x: 300, y: 400 }, { x: 100, y: 200 })).toEqual({ x: 100, y: 200, width: 200, height: 200 });
  });

  it('is a line when the arrow is a line, and a point when it is a point', () => {
    // Deliberate: the box of an arrow drawn between the middles of two shapes stacked one over the
    // other has no width, and nothing pretends otherwise. What an arrow *is* is answered by the
    // distance from its line; a box invented wider would select an arrow a marquee never came near.
    expect(connectorBBox({ x: 100, y: 200 }, { x: 100, y: 400 })).toEqual({ x: 100, y: 200, width: 0, height: 200 });
    expect(connectorBBox({ x: 7, y: 9 }, { x: 7, y: 9 })).toEqual({ x: 7, y: 9, width: 0, height: 0 });
  });

  it('has an answer for a point that is not a point, and does not throw', () => {
    expect(() => connectorBBox({ x: Number.NaN, y: 0 }, { x: 1, y: 1 })).not.toThrow();
    expect(() => connectorBBox({ x: Number.POSITIVE_INFINITY, y: 0 }, { x: 1, y: 1 })).not.toThrow();
  });
});

describe('distanceToPolyline', () => {
  // TC-14
  it('is how far a click is from the arrow, to the last unit', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    // The tolerance itself, which TC-20 spends a browser making sure of.
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBe(6);
  });

  it('is the distance to the line and not to its ends', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    // Squarely opposite the middle of a long line: 3 units, not 50.
    expect(distanceToPolyline(line, { x: 50, y: 3 })).toBeCloseTo(3, 10);
  });

  it('is the distance to the nearest end when the click is beyond the line', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(line, { x: 103, y: 4 })).toBeCloseTo(5, 10);
    expect(distanceToPolyline(line, { x: -10, y: 0 })).toBeCloseTo(10, 10);
  });

  it('walks a polyline that has corners, which is what story 11 will want', () => {
    // An L: right, then down. A point in the crook is 1 unit from the line and far from both ends.
    const l = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(distanceToPolyline(l, { x: 99, y: 99 })).toBeCloseTo(1, 10);
    expect(distanceToPolyline(l, { x: 50, y: 50 })).toBeCloseTo(50, 10);
    expect(distanceToPolyline(l, { x: 150, y: 50 })).toBeCloseTo(50, 10);
  });

  it('has an answer for the shapes a broken document can hold', () => {
    expect(distanceToPolyline([], { x: 3, y: 4 })).toBe(Number.POSITIVE_INFINITY);
    // One point is not a line; it is a place, and the distance to a place is the distance to it.
    expect(distanceToPolyline([{ x: 3, y: 4 }], { x: 0, y: 0 })).toBe(5);
    // A point that is not a point is skipped rather than poisoning the whole answer with NaN: the two
    // ends that are still places are nearer than anything else, and an arrow nobody can click is a worse
    // bug than an arrow with a hole in it.
    expect(distanceToPolyline([{ x: 0, y: 0 }, { x: Number.NaN, y: 4 }, { x: 10, y: 4 }], { x: 1, y: 1 })).toBeCloseTo(
      Math.SQRT2,
      10,
    );
  });
});

describe('createConnector', () => {
  let doc: Y.Doc;
  let a: string;
  let b: string;
  let c: string;

  // A board with three shapes on it: A and B side by side, C below A.
  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    a = rectShape(doc, { x: 0, y: 0, width: 200, height: 120 });
    b = rectShape(doc, { x: 500, y: 0, width: 200, height: 120 });
    c = rectShape(doc, { x: 0, y: 400, width: 200, height: 120 });
  });

  // TC-07
  it('attaches both ends to the two objects, and stores where each end was drawn', () => {
    const counts = updates(doc);

    const id = createConnector(doc, attached(a), attached(b), 'me');

    const connector = connectorAt(doc, id);
    expect(connector.type).toBe('connector');
    expect(connector.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(connector.to).toMatchObject({ kind: 'attached', objectId: b });
    // Each end's fallback is the anchor it was drawn at: A's right side, B's left side, both at the
    // middle of their height. The guess the tool made is gone, replaced by the object's own side.
    expect(pointOf(connector.from)).toEqual({ x: 200, y: 60 });
    expect(pointOf(connector.to)).toEqual({ x: 500, y: 60 });
    // The box is the box the two ends make, and it is 300 units from A to B.
    expect(connector.x).toBe(200);
    expect(connector.width).toBe(300);
    expect(counts).toEqual([1]);
  });

  it('stacks an arrow above the objects it joins, and itself above itself', () => {
    const first = createConnector(doc, attached(a), attached(b), 'me') as string;
    const second = createConnector(doc, attached(b), attached(c), 'me') as string;

    expect(connectorAt(doc, second).z).toBeGreaterThan(connectorAt(doc, first).z);
    expect(connectorAt(doc, first).z).toBeGreaterThan(shapeAt(doc, c).z);
  });

  // TC-08
  it('refuses to join an object to itself, and writes nothing when it does', () => {
    const counts = updates(doc);

    expect(createConnector(doc, attached(a), attached(a), 'me')).toBeNull();
    // The same object named at both ends with two different guesses is still the same object.
    expect(createConnector(doc, attached(a, { x: 0, y: 0 }), attached(a, { x: 900, y: 900 }), 'me')).toBeNull();

    expect(counts).toEqual([]);
    expect(countOn(doc)).toBe(3); // three shapes, no arrows
  });

  // TC-09
  it('refuses an arrow too short to be an arrow, and takes one exactly as long as it may be', () => {
    const counts = updates(doc);
    const short = at(900, 700);
    const near = at(short.x + CONNECTOR_MIN_LENGTH_WORLD - 0.1, short.y);
    const exact = at(short.x + CONNECTOR_MIN_LENGTH_WORLD, short.y);

    expect(createConnector(doc, short, near, 'me')).toBeNull();
    expect(counts).toEqual([]);

    const id = createConnector(doc, short, exact, 'me');
    expect(id).not.toBeNull();
    expect(counts).toEqual([1]);
    expect(connectorAt(doc, id).from).toEqual(short);
    expect(connectorAt(doc, id).to).toEqual(exact);
  });

  it('measures the length of an arrow between objects by the ends it draws, not by their centres', () => {
    // Two shapes 3 units apart: the arrow between their sides would be 3 units of arrowhead, which is
    // the clutter the rule is there to prevent, even though the shapes' centres are 203 units apart.
    const close = rectShape(doc, { x: 203, y: 0, width: 200, height: 120 });
    expect(createConnector(doc, attached(a), attached(close), 'me')).toBeNull();

    const far = rectShape(doc, { x: 200 + CONNECTOR_MIN_LENGTH_WORLD, y: 0, width: 200, height: 120 });
    expect(createConnector(doc, attached(a), attached(far), 'me')).not.toBeNull();
  });

  it('writes an arrow to an object that vanished mid-drag, drawn where the pointer let go', () => {
    // The race the design names: somebody else deletes B between the release and the write.
    const counts = updates(doc);
    const release = { x: 700, y: 60 };
    vanish(doc, b);

    const id = createConnector(doc, attached(a), attached(b, release), 'me');

    const connector = connectorAt(doc, id);
    expect(connector.to).toMatchObject({ kind: 'attached', objectId: b });
    // The end is kept as attached — the person did release it on the object — and drawn where they let
    // go, so the arrow that appears is the arrow that was dragged.
    expect(resolve(connector, doc)).toEqual({ from: { x: 200, y: 60 }, to: release });
    expect(counts.length).toBeGreaterThan(0);
  });

  it('keeps the object’s own side as the fallback rather than the guess it was handed', () => {
    const release = { x: 999, y: 999 };

    const id = createConnector(doc, attached(a, release), attached(b, release), 'me') as string;

    const connector = connectorAt(doc, id);
    // A release point is a guess; the object's side is the answer, and the side is what the document
    // keeps for the day the object is gone.
    expect(pointOf(connector.from)).toEqual({ x: 200, y: 60 });
    expect(pointOf(connector.to)).toEqual({ x: 500, y: 60 });
  });

  it('refuses ends that are not ends, and writes nothing when it does', () => {
    const counts = updates(doc);

    expect(createConnector(doc, at(Number.NaN, 0), at(400, 0), 'me')).toBeNull();
    expect(createConnector(doc, attached('', { x: 0, y: 0 }), attached(b), 'me')).toBeNull();
    expect(createConnector(doc, null as never, attached(b), 'me')).toBeNull();
    expect(createConnector(doc, attached(a), { kind: 'somewhere' } as never, 'me')).toBeNull();

    expect(counts).toEqual([]);
    expect(countOn(doc)).toBe(3);
  });

  it('joins an arrow to a sticky note and to a piece of text, because an arrow joins board objects', () => {
    const note = createSticky(doc, { x: 900, y: 0 }, 'yellow') as string;
    const text = createText(doc, { x: 900, y: 400 }, 'me') as string;

    const id = createConnector(doc, attached(note), attached(text), 'me');

    const connector = connectorAt(doc, id);
    expect(connector.from).toMatchObject({ kind: 'attached', objectId: note });
    expect(connector.to).toMatchObject({ kind: 'attached', objectId: text });
    // …and the ends are on the shapes those objects actually are, which is the only reason the rects
    // map is keyed by id and not by type.
    expect(Number.isFinite(resolve(connector, doc).from.x)).toBe(true);
  });

  it('writes nothing at all to something that is not a document', () => {
    expect(() => createConnector({} as Y.Doc, attached(a), attached(b), 'me')).toThrow(TypeError);
  });
});

describe('resolveEndpoints', () => {
  let doc: Y.Doc;
  let a: string;
  let b: string;
  let c: string;
  let id: string;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    a = rectShape(doc, { x: 0, y: 0, width: 200, height: 120 });
    b = rectShape(doc, { x: 500, y: 0, width: 200, height: 120 });
    c = rectShape(doc, { x: 0, y: 400, width: 200, height: 120 });
    id = createConnector(doc, attached(a), attached(b), 'me') as string;
  });

  // TC-10, from the other side: not the side that would be chosen but the line that is drawn.
  it('draws each end on the side of its object that faces the other, and turns them as the objects do', () => {
    expect(resolve(connectorAt(doc, id), doc)).toEqual({ from: { x: 200, y: 60 }, to: { x: 500, y: 60 } });

    // B goes above A: the sides change, and nothing in the document about the arrow changed to make it.
    const counts = updates(doc);
    moveObjects(doc, new Map([[b, { x: 0, y: -400 }]]));
    expect(resolve(connectorAt(doc, id), doc)).toEqual({ from: { x: 100, y: 0 }, to: { x: 100, y: -280 } });

    // B goes to A's left: the ends swap sides, which is the arrow turning itself round.
    moveObjects(doc, new Map([[b, { x: -500, y: 0 }]]));
    expect(resolve(connectorAt(doc, id), doc)).toEqual({ from: { x: 0, y: 60 }, to: { x: -300, y: 60 } });

    // The only writes are the two moves. An arrow that followed by rewriting itself would be two more,
    // twice a second, forever.
    expect(counts.length).toBe(2);
  });

  it('follows a resize as well as a move, because the rectangle is the whole answer', () => {
    resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 400, height: 120 }]]));

    expect(resolve(connectorAt(doc, id), doc).from).toEqual({ x: 400, y: 60 });
  });

  it('follows a stranger’s move as faithfully as it follows this screen’s own', () => {
    // Story 3's job is to deliver somebody else's move; this suite's job is to be unable to tell the
    // difference once it has arrived, which is what "no extra writes" is really promising.
    const theirs = new Y.Doc();
    initDoc(theirs);
    Y.applyUpdate(theirs, Y.encodeStateAsUpdate(doc)); // the same board, on their screen

    const counts = updates(theirs);
    // They move B. This screen only receives.
    moveObjects(theirs, new Map([[b, { x: 800, y: 300 }]]));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(theirs));

    // Both boards draw the same arrow, from the same two ends, and the only write anywhere was a move.
    expect(resolve(connectorAt(doc, id), doc)).toEqual(resolve(connectorAt(doc, id), theirs));
    // B is a long way off to the lower right now, so the end on it is on B's own left side — which is a
    // position in the document about B, and not one byte in the document about the arrow.
    expect(resolve(connectorAt(doc, id), doc).to).toEqual({ x: 800, y: 360 });
    expect(counts).toEqual([1]);
  });

  // TC-11
  it('draws an end at its fallback when its object is not on the board', () => {
    const connector = connectorAt(doc, id);
    const rects = rectsOf(doc);
    rects.delete(b); // what the board looks like for the instant that a delete wins the race

    expect(() => resolveEndpoints(connector, rects)).not.toThrow();
    expect(resolveEndpoints(connector, rects)).toEqual({
      // A is still there, so A's end is still on A's side.
      from: { x: 200, y: 60 },
      // B is not, so B's end is exactly where B's side used to be.
      to: { x: 500, y: 60 },
    });
  });

  it('draws both ends at their fallbacks when neither object is there', () => {
    const connector = connectorAt(doc, id);

    expect(resolveEndpoints(connector, new Map())).toEqual({ from: { x: 200, y: 60 }, to: { x: 500, y: 60 } });
  });

  it('draws a free end exactly where it was left, however much its neighbours move', () => {
    const free = createConnector(doc, attached(a), at(900, 60), 'me') as string;

    expect(connectorAt(doc, free).to).toEqual({ kind: 'free', x: 900, y: 60 });
    expect(resolve(connectorAt(doc, free), doc).to).toEqual({ x: 900, y: 60 });

    moveObjects(doc, new Map([[b, { x: 10, y: 10 }]]));

    expect(resolve(connectorAt(doc, free), doc).to).toEqual({ x: 900, y: 60 });
  });

  it('aims a free end at the object the other end is on, because a line has to point somewhere', () => {
    // A free end has no side of its own, but the attached end still has to choose a side, and the only
    // thing it can choose towards is the free end's point.
    const free = createConnector(doc, attached(a), at(100, -400), 'me') as string;

    expect(resolve(connectorAt(doc, free), doc)).toEqual({ from: { x: 100, y: 0 }, to: { x: 100, y: -400 } });
  });

  it('has an answer for an endpoint that is neither, and for a connector that has none', () => {
    const broken = { ...connectorAt(doc, id), from: { kind: 'sideways' } as never };

    const ends = resolveEndpoints(broken, rectsOf(doc));
    expect(Number.isFinite(ends.from.x)).toBe(true);
    expect(Number.isFinite(ends.from.y)).toBe(true);
    expect(() => resolveEndpoints(broken, new Map())).not.toThrow();
    expect(() => resolveEndpoints({} as never, new Map())).not.toThrow();
  });

  it('joins an arrow to another arrow, because an arrow is a board object too', () => {
    const second = createConnector(doc, attached(c), attached(b), 'me') as string;
    const third = createConnector(doc, attached(a), attached(second), 'me') as string;

    const ends = resolve(connectorAt(doc, third), doc);
    // The arrow at the far end is drawn between its own two ends, so this one points into the box that
    // arrow covers rather than at nothing.
    expect(ends.to.x).toBe(connectorAt(doc, second).x);
    expect(ends.to.y).toBeGreaterThan(connectorAt(doc, second).y);
  });

  it('counts a connector in the boxes it resolves against, so an arrow can be joined like anything else', () => {
    const second = createConnector(doc, attached(c), attached(b), 'me') as string;
    const rects = rectsOf(doc);
    // The map the board hands over holds every object, arrows included.
    expect(rects.get(second)).toEqual({
      x: connectorAt(doc, second).x,
      y: connectorAt(doc, second).y,
      width: connectorAt(doc, second).width,
      height: connectorAt(doc, second).height,
    });
  });
});

describe('setConnectorEndpoint', () => {
  let doc: Y.Doc;
  let a: string;
  let b: string;
  let c: string;
  let id: string;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    a = rectShape(doc, { x: 0, y: 0, width: 200, height: 120 });
    b = rectShape(doc, { x: 500, y: 0, width: 200, height: 120 });
    c = rectShape(doc, { x: 0, y: 400, width: 200, height: 120 });
    id = createConnector(doc, attached(a), attached(b), 'me') as string;
  });

  // TC-12
  it('lets go of an end and fixes it to the place it was released at', () => {
    const counts = updates(doc);

    expect(setConnectorEndpoint(doc, id, 'to', at(700, 30))).toBe(true);

    const connector = connectorAt(doc, id);
    expect(connector.to).toEqual({ kind: 'free', x: 700, y: 30 });
    expect(connector.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(counts).toEqual([1]);
  });

  it('attaches an end to the object it was released over, with that object’s side as its fallback', () => {
    expect(setConnectorEndpoint(doc, id, 'to', attached(c, { x: 999, y: 999 }))).toBe(true);

    const connector = connectorAt(doc, id);
    expect(connector.to).toMatchObject({ kind: 'attached', objectId: c });
    // C is below A, so the end is drawn on C's top side, which is the side that faces the other end —
    // and not at the release point, which was nowhere near C.
    expect(pointOf(connector.to)).toEqual({ x: 100, y: 400 });
    expect(resolve(connector, doc)).toEqual({ from: { x: 100, y: 120 }, to: { x: 100, y: 400 } });
  });

  // TC-12, the negative half.
  it('refuses to point an end at the object the other end is already on', () => {
    const counts = updates(doc);

    // The arrow would be a dot: both ends on one object.
    expect(setConnectorEndpoint(doc, id, 'to', attached(a, { x: 200, y: 60 }))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', attached(b, { x: 500, y: 60 }))).toBe(false);

    expect(counts).toEqual([]); // nothing written, so nothing to undo
    expect(connectorAt(doc, id).to).toMatchObject({ kind: 'attached', objectId: b });
    expect(connectorAt(doc, id).from).toMatchObject({ kind: 'attached', objectId: a });
  });

  it('refuses an end that is not an end', () => {
    const counts = updates(doc);

    expect(setConnectorEndpoint(doc, id, 'to', at(Number.NaN, 0))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', attached('', { x: 0, y: 0 }))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'sideways' as never, attached(c))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', null as never)).toBe(false);

    expect(counts).toEqual([]);
  });

  // TC-29
  it('says no to a connector that is not on the board any more', () => {
    deleteObjects(doc, [id]);
    const counts = updates(doc);

    expect(setConnectorEndpoint(doc, id, 'to', attached(c))).toBe(false);
    expect(counts).toEqual([]);
  });

  it('says no to a sticky note that happens to be in the same selection', () => {
    const note = createSticky(doc, { x: 900, y: 0 }, 'yellow') as string;

    expect(setConnectorEndpoint(doc, note, 'to', attached(c))).toBe(false);
    expect(colorOfNote(doc, note)).toBe('yellow');
  });

  it('writes nothing when the end already is what it is being asked to become', () => {
    const counts = updates(doc);

    // The handle went down on B's left side and came back to B's left side. An undo step that undoes
    // nothing is worse than no undo step, so there is no write either.
    expect(setConnectorEndpoint(doc, id, 'to', attached(b, { x: 123, y: 456 }))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', attached(a, { x: 200, y: 60 }))).toBe(false);

    expect(counts).toEqual([]);
  });

  it('keeps a stale end honest: fixing one end stops the other one pretending', () => {
    // A board from before this story — or a delete by a client that never heard of arrows — leaves an
    // end attached to an object that is gone. It draws at its fallback, which is honest enough to look
    // at and dishonest enough to be called attached.
    vanish(doc, b);
    expect(connectorAt(doc, id).to).toMatchObject({ kind: 'attached', objectId: b });

    const counts = updates(doc);
    expect(setConnectorEndpoint(doc, id, 'from', attached(c))).toBe(true);

    const after = connectorAt(doc, id);
    expect(after.from).toMatchObject({ kind: 'attached', objectId: c });
    // The end that had nothing left to point at is a point now, at the side of the object it lost.
    expect(after.to).toEqual({ kind: 'free', x: 500, y: 60 });
    expect(counts).toEqual([1]); // one step: the end that moved and the end that stopped pretending
  });

  it('leaves a healthy end attached when one end is moved', () => {
    expect(setConnectorEndpoint(doc, id, 'to', at(700, 30))).toBe(true);

    expect(connectorAt(doc, id).from).toMatchObject({ kind: 'attached', objectId: a });
    expect(pointOf(connectorAt(doc, id).from)).toEqual({ x: 200, y: 60 });
  });
});

describe('detachConnectorsTo', () => {
  let doc: Y.Doc;
  let a: string;
  let b: string;
  let c: string;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    a = rectShape(doc, { x: 0, y: 0, width: 200, height: 120 });
    b = rectShape(doc, { x: 500, y: 0, width: 200, height: 120 });
    c = rectShape(doc, { x: 0, y: 400, width: 200, height: 120 });
  });

  // TC-13
  it('leaves the arrow where its object was, in the one transaction that removed the object', () => {
    const id = createConnector(doc, attached(a), attached(b), 'me') as string;
    const counts = updates(doc);

    expect(deleteObjects(doc, [b])).toBe(1);

    expect(counts).toEqual([1]); // one update: the object gone and the arrow let go, together
    expect(countOn(doc)).toBe(3); // A, C and the arrow; the object is gone
    const connector = connectorAt(doc, id);
    expect(connector.from).toMatchObject({ kind: 'attached', objectId: a });
    // B's end is a point now, at the side of B it was drawn on: the arrow is exactly where it was.
    expect(connector.to).toEqual({ kind: 'free', x: 500, y: 60 });
    expect(resolve(connector, doc)).toEqual({ from: { x: 200, y: 60 }, to: { x: 500, y: 60 } });
    // …drawn as a line of the same length it was, which is the whole point of the exercise.
    expect(connector.width).toBe(300);
  });

  it('lets go of every arrow that was holding the object, and only those', () => {
    const first = createConnector(doc, attached(a), attached(b), 'me') as string;
    const second = createConnector(doc, attached(b), attached(c), 'me') as string;
    const third = createConnector(doc, attached(a), attached(c), 'me') as string;
    const untouched = connectorAt(doc, third);

    expect(deleteObjects(doc, [b])).toBe(1);

    expect(connectorAt(doc, first).to).toEqual({ kind: 'free', x: 500, y: 60 });
    expect(connectorAt(doc, second).from).toEqual({ kind: 'free', x: 500, y: 60 });
    // The arrow that never touched B is untouched, in every byte of it: a detach that rewrote z or a
    // fallback it was not asked about is a detach that made work for story 3.
    expect(connectorAt(doc, third)).toEqual(untouched);
  });

  it('lets go of both ends of an arrow when both of its objects go in one delete', () => {
    const id = createConnector(doc, attached(a), attached(b), 'me') as string;
    const counts = updates(doc);

    expect(deleteObjects(doc, [a, b])).toBe(2);

    expect(counts).toEqual([1]);
    const connector = connectorAt(doc, id);
    expect(connector.from).toEqual({ kind: 'free', x: 200, y: 60 });
    expect(connector.to).toEqual({ kind: 'free', x: 500, y: 60 });
    // Two objects gone and an arrow left behind: the arrow is the only thing still drawn of the three.
    expect(snapshot(doc).filter(isConnectorSnapshot).length).toBe(1);
  });

  it('leaves an arrow whose object was already gone alone, because it is already a point', () => {
    const id = createConnector(doc, attached(a), attached(b), 'me') as string;
    vanish(doc, b);
    const counts = updates(doc);

    detachConnectorsTo(doc, [b]);

    // Nothing to let go of. The arrow still names B, which is the orphaned state, and it still draws at
    // its fallback; a detach that quietly rewrote it would be a write nobody asked for, on a board that
    // is already showing the right thing.
    expect(counts).toEqual([]);
    expect(connectorAt(doc, id).to).toMatchObject({ kind: 'attached', objectId: b });
  });

  it('does nothing when the ids it is given are none, or are not arrows’ problems', () => {
    const note = createSticky(doc, { x: 900, y: 0 }, 'yellow') as string;
    const id = createConnector(doc, attached(a), attached(note), 'me') as string;
    const counts = updates(doc);

    detachConnectorsTo(doc, []);
    detachConnectorsTo(doc, ['no-such-object']);

    expect(counts).toEqual([]);
    expect(connectorAt(doc, id).to).toMatchObject({ kind: 'attached', objectId: note });
  });

  it('detaches arrows that point at a deleted arrow', () => {
    const second = createConnector(doc, attached(b), attached(c), 'me') as string;
    const third = createConnector(doc, attached(a), attached(second), 'me') as string;

    expect(deleteObjects(doc, [second])).toBe(1);

    const end = connectorAt(doc, third).to;
    expect(end.kind).toBe('free');
    if (end.kind !== 'free') return;
    // The middle of the left edge of the box the deleted arrow covered — which is where its end was being
    // drawn, and the only answer that leaves this arrow where it was.
    expect({ x: end.x, y: end.y }).toEqual({ x: 200, y: 260 });
  });

  it('is safe to call on a board with no arrows on it at all', () => {
    const counts = updates(doc);

    expect(() => detachConnectorsTo(doc, [a, b, c, 'nope'])).not.toThrow();
    // The three shapes were never holding anything, so the board is byte for byte what it was.
    expect(counts).toEqual([]);
  });

  it('detaches inside the delete, so a board that syncs mid-delete never shows an arrow with no end', () => {
    const id = createConnector(doc, attached(a), attached(b), 'me') as string;
    const counts = updates(doc);

    // One update, in which both the delete and the detach are already there: a person on the other end
    // of that update sees an arrow attached to nothing for no instant at all.
    deleteObjects(doc, [b]);

    expect(counts).toEqual([1]);
    expect(connectorAt(doc, id).to.kind).toBe('free');
  });
});

describe('an arrow’s box, and how far a click has to be to select it', () => {
  let doc: Y.Doc;
  let a: string;
  let b: string;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    a = rectShape(doc, { x: 0, y: 0, width: 200, height: 120 });
    b = rectShape(doc, { x: 500, y: 400, width: 200, height: 120 });
  });

  it('is the box of the two ends it draws, derived on every read and never stored', () => {
    const id = createConnector(doc, attached(a), attached(b), 'me') as string;
    const entry: unknown = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get(id);
    if (!(entry instanceof Y.Map)) throw new Error('the arrow is not on the board');
    // What the document holds for a size is nothing at all: an arrow has no size of its own, and a
    // stored one would be a size that goes out of date the moment anything moves.
    expect(entry.get('x')).toBe(0);
    expect(entry.get('y')).toBe(0);
    expect(entry.get('width')).toBe(0);
    expect(entry.get('height')).toBe(0);

    const connector = connectorAt(doc, id);
    expect(connector.x).toBe(200);
    expect(connector.y).toBe(60);
    expect(connector.width).toBe(300);
    expect(connector.height).toBe(400);
  });

  it('is redrawn from the ends the day one of its objects moves, with no write about the arrow', () => {
    const id = createConnector(doc, attached(a), attached(b), 'me') as string;
    const before = connectorAt(doc, id);

    moveObjects(doc, new Map([[a, { x: 500, y: 400 }]]));

    const after = connectorAt(doc, id);
    expect(after).not.toEqual(before);
    // The two shapes are on top of each other now, so there is very little arrow left to draw.
    expect(after.width ?? 0).toBeLessThan(before.width ?? 0);
  });

  // TC-14, at the zooms TC-20 will spend a browser checking: the tolerance is in screen pixels, so the
  // world distance a click may miss by doubles at 50 % and halves at 200 %.
  it('is clicked on within six screen pixels of its line, at any zoom', () => {
    const id = createConnector(doc, attached(a), attached(b), 'me') as string;
    const ends = resolve(connectorAt(doc, id), doc);

    for (const zoom of [0.5, 1, 2]) {
      const tolerance = CONNECTOR_HIT_TOLERANCE_PX / zoom;
      expect(clickLandsOn(ends, awayFromLine(ends.from, ends.to, tolerance / 2), zoom)).toBe(true);
      expect(clickLandsOn(ends, awayFromLine(ends.from, ends.to, tolerance * 1.5), zoom)).toBe(false);
    }
    // Halfway between the two ends, straight at the middle of the board, is on the arrow at any zoom.
    for (const zoom of [0.5, 1, 2]) expect(clickLandsOn(ends, midpoint(ends.from, ends.to), zoom)).toBe(true);
  });

  it('outlines itself with the stroke and the arrowhead the settings say', () => {
    expect(CONNECTOR_STROKE_WIDTH_WORLD).toBe(2);
    expect(CONNECTOR_ARROWHEAD_SIZE_WORLD).toBe(10);
  });
});
