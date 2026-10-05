/**
 * Unit tests for the connector model and its geometry (story 10, `connector.model`,
 * TC-07 to TC-14 and TC-29).
 *
 * A real `Y.Doc`, as every model suite in this codebase uses one, and the same two questions as the shape
 * suite: what is stored, and how many transactions did that cost. For arrows the second question has a third
 * form — *where is the box* — because an arrow stores no box, and a board that reported the zeroes it stores
 * would have selection outlines in the top-left corner of every board.
 *
 * The geometry is tested as geometry: rectangles handed in, points handed back. No component, no DOM, no
 * zoom, and no pointer, because none of those change which side of a box a point is on.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  snapshot,
} from '../../src/shared/board-model';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';
import {
  SIDES,
  attachedEndpoint,
  connectorBBox,
  freeEndpoint,
  isEndpoint,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline, distanceToSegment } from '../../src/shared/geometry/polyline';
import {
  CONNECTOR_OBJECT_TYPE,
  connectorSnapshots,
  createConnector,
  detachConnectorsTo,
  isConnectorSnapshot,
  readConnector,
  setConnectorEndpoint,
} from '../../src/shared/objects/connector';
import type { ConnectorEnd, ConnectorSnap, Endpoint } from '../../src/shared/objects/connector';
import { SHAPE_OBJECT_TYPE } from '../../src/shared/objects/shape';
// The shapes in these tests are the things the arrows point at, and the board only reports an object of a
// type it has been told about — the same rule that stops a client from selecting an object it cannot draw.
// Importing the module is what tells the board about the type, exactly as the client's registry does.
import '../../src/shared/objects/shape';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Starts counting `update` events; returns a reader of the count. */
function countUpdates(doc: Y.Doc): () => number {
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return () => updates;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/**
 * An object of a given box, written without the connector model.
 *
 * Shapes are used as the things arrows point at, because a shape takes a box of any size and an arrow does
 * not care what it is attached to — that is what "arrows connect shapes, sticky notes, and any other board
 * object" is checked with.
 */
function seedBox(doc: Y.Doc, id: string, rect: Rect, z = 1): Y.Map<unknown> {
  const objects = objectsOf(doc);
  const object = new Y.Map<unknown>();
  doc.transact(() => {
    object.set('type', SHAPE_OBJECT_TYPE);
    object.set('kind', 'rect');
    object.set('x', rect.x);
    object.set('y', rect.y);
    object.set('width', rect.width);
    object.set('height', rect.height);
    object.set('fill', 'white');
    object.set('stroke', 'dark');
    object.set('label', new Y.Text(''));
    object.set('z', z);
    object.set('createdAt', 1_700_000_000_000);
    objects.set(id, object);
  });
  return object;
}

/** The board's boxes as the connector model sees them. */
function rectsOf(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of snapshot(doc)) {
    if (object.type === CONNECTOR_OBJECT_TYPE) continue;
    rects.set(object.id, objectBounds(object));
  }
  return rects;
}

/** The arrow under test. Throws when it is not there, so a broken read never reads as a passing test. */
function arrow(doc: Y.Doc, id: string): ConnectorSnap {
  const found = readConnector(doc, id);
  if (found === null) throw new Error(`no arrow "${id}" on the board`);
  return found;
}

/** Two boxes 300 board units apart in their centres, side by side. */
const A: Rect = { x: 0, y: 0, width: 200, height: 200 };
const B: Rect = { x: 300, y: 0, width: 200, height: 200 };

describe('connector.geometry sideAnchor', () => {
  it('gives the midpoint of each side, which is on the boundary of a rect, an ellipse and a diamond', () => {
    const rect: Rect = { x: 10, y: 20, width: 200, height: 100 };
    expect(sideAnchor(rect, 'top')).toEqual({ x: 110, y: 20 });
    expect(sideAnchor(rect, 'right')).toEqual({ x: 210, y: 70 });
    expect(sideAnchor(rect, 'bottom')).toEqual({ x: 110, y: 120 });
    expect(sideAnchor(rect, 'left')).toEqual({ x: 10, y: 70 });
    expect(SIDES).toEqual(['top', 'right', 'bottom', 'left']);
  });

  it('follows the box it is given, so a resized object moves the anchor without a write', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const before = sideAnchor(rect, 'right');
    const after = sideAnchor({ ...rect, width: 300 }, 'right');
    expect(after.x - before.x).toBe(200);
  });
});

describe('connector.geometry nearestSide', () => {
  it('TC-10: an object orbiting a square switches sides at its diagonal', () => {
    const rect: Rect = { x: -50, y: -50, width: 100, height: 100 };
    const orbit = (degrees: number, radius = 300): Point => ({
      x: (radius * Math.cos((degrees * Math.PI) / 180)) / 1,
      y: -(radius * Math.sin((degrees * Math.PI) / 180)) / 1,
    });

    expect(nearestSide(rect, orbit(0))).toBe('right');
    expect(nearestSide(rect, orbit(44))).toBe('right');
    expect(nearestSide(rect, orbit(46))).toBe('top');
    expect(nearestSide(rect, orbit(90))).toBe('top');
  });

  it('names the other two sides for the other quarters', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(nearestSide(rect, { x: -500, y: 60 })).toBe('left');
    expect(nearestSide(rect, { x: 40, y: 500 })).toBe('bottom');
  });

  it('measures in the box proportions, so the wedges follow the shape of the box', () => {
    const toward: Point = { x: 400, y: -120 };
    // Up and to the right of both boxes. On a box four times as wide as it is tall, the diagonal from the
    // centre is shallow, so this point is well inside the top wedge: the short side it faces is the top one.
    expect(nearestSide({ x: 0, y: 0, width: 400, height: 100 }, toward)).toBe('top');
    // On a box four times as tall as it is wide the diagonal is steep, and the same point is beside the box
    // rather than above it.
    expect(nearestSide({ x: 0, y: 0, width: 100, height: 400 }, toward)).toBe('right');
  });
});

describe('connector.geometry resolveEndpoints', () => {
  it('draws both ends at the sides that face each other', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    seedBox(doc, 'b', B);
    const id = createConnector(doc, attachedEndpoint('a', { x: 200, y: 100 }), attachedEndpoint('b', { x: 300, y: 100 }), 'dana');

    const ends = resolveEndpoints(arrow(doc, id!), rectsOf(doc));
    expect(ends).toEqual({ from: { x: 200, y: 100 }, to: { x: 300, y: 100 } });
  });

  it('TC-11: an end whose object is not on the board is drawn at its stored point and nothing throws', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    const fallback = { x: 640, y: 120 };
    const ends = resolveEndpoints(
      { from: attachedEndpoint('a', { x: 200, y: 100 }), to: attachedEndpoint('gone', fallback) },
      rectsOf(doc),
    );

    // The end that is left over is not hidden and not sent to the origin: it is where the arrow was.
    expect(ends.to).toEqual(fallback);
    // The other end still points at the object it has, towards that point.
    expect(ends.from).toEqual({ x: 200, y: 100 });
  });

  it('switches sides when the object it points at moves, without anything being written', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    seedBox(doc, 'b', B);
    const id = createConnector(doc, attachedEndpoint('a', { x: 200, y: 100 }), attachedEndpoint('b', { x: 300, y: 100 }), 'dana');
    const before = resolveEndpoints(arrow(doc, id!), rectsOf(doc));
    expect(before.from).toEqual({ x: 200, y: 100 });

    const updates = countUpdates(doc);
    // B is dragged to the left of A, past it.
    expect(moveObjects(doc, new Map([['b', { x: -400, y: 0 }]]))).toBe(1);
    // The arrow itself was not touched: the move wrote one object, and the arrow's record is what it was.
    expect(updates()).toBe(1);

    const after = resolveEndpoints(arrow(doc, id!), rectsOf(doc));
    expect(after.from).toEqual({ x: 0, y: 100 });
    expect(after.to).toEqual({ x: -200, y: 100 });
    expect(objectsOf(doc).get(id!)!.get('from')).toEqual({ kind: 'attached', objectId: 'a', fallback: { x: 200, y: 100 } });
  });

  it('answers a free end with the point it stores, whatever is around it', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    const ends = resolveEndpoints(
      { from: freeEndpoint({ x: -50, y: 500 }), to: attachedEndpoint('a', { x: 100, y: 200 }) },
      rectsOf(doc),
    );
    expect(ends.from).toEqual({ x: -50, y: 500 });
    // The attached end faces the free one, which is below it.
    expect(ends.to).toEqual({ x: 100, y: 200 });
  });

  it('is not confused by an end that is not an end', () => {
    const ends = resolveEndpoints({ from: freeEndpoint({ x: 1, y: 2 }), to: null as unknown as Endpoint }, new Map());
    expect(Number.isFinite(ends.to.x)).toBe(true);
  });
});

describe('connector.geometry connectorBBox', () => {
  it('is the box the line covers, whichever way the arrow points', () => {
    expect(connectorBBox({ x: 10, y: 20 }, { x: 60, y: 90 })).toEqual({ x: 10, y: 20, width: 50, height: 70 });
    expect(connectorBBox({ x: 60, y: 90 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 50, height: 70 });
  });

  it('has no height when both ends share a row, and no width when they share a column', () => {
    expect(connectorBBox({ x: 0, y: 40 }, { x: 100, y: 40 })).toEqual({ x: 0, y: 40, width: 100, height: 0 });
    expect(connectorBBox({ x: 40, y: 0 }, { x: 40, y: 100 })).toEqual({ x: 40, y: 0, width: 0, height: 100 });
  });
});

describe('connector.geometry distanceToPolyline', () => {
  it('TC-14: measures the distance to a segment, including on the boundary of the tolerance', () => {
    const from: Point = { x: 0, y: 0 };
    const to: Point = { x: 100, y: 0 };

    expect(distanceToPolyline([from, to], { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline([from, to], { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline([from, to], { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    // The same answer from the other side of the line, and from beyond its middle.
    expect(distanceToPolyline([from, to], { x: 50, y: -6.01 })).toBeCloseTo(6.01, 10);
    expect(distanceToSegment(from, to, { x: 50, y: 3 })).toBeCloseTo(3, 10);
  });

  it('measures to the nearest end rather than to the line extended past it', () => {
    const from: Point = { x: 0, y: 0 };
    const to: Point = { x: 100, y: 0 };
    expect(distanceToPolyline([from, to], { x: 130, y: 0 })).toBe(30);
    expect(distanceToPolyline([from, to], { x: -30, y: 40 })).toBe(50);
  });

  it('takes the shortest of several segments, which is what a long arrow is', () => {
    const points: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(distanceToPolyline(points, { x: 100, y: 50 })).toBe(0);
    expect(distanceToPolyline(points, { x: 50, y: 50 })).toBeCloseTo(50, 10);
  });

  it('is infinitely far from a line that has nothing in it', () => {
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToPolyline([{ x: 0, y: 0 }], { x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
    // A segment of no length is a point, and the distance to a point is a distance, not `NaN`: a `NaN`
    // compares false against everything, which would make a dot that can never be clicked.
    expect(distanceToPolyline([{ x: 5, y: 5 }, { x: 5, y: 5 }], { x: 5, y: 9 })).toBe(4);
    expect(Number.isNaN(distanceToPolyline([{ x: 5, y: 5 }, { x: 5, y: 5 }], { x: 0, y: 0 }))).toBe(false);
  });
});

describe('connector.model createConnector', () => {
  it('TC-07: an arrow between two objects stores two attached ends, each pinned to the side it is drawn at', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    seedBox(doc, 'b', B, 2);
    const updates = countUpdates(doc);

    // The tool hands over the points it released on; the model turns them into anchors.
    const id = createConnector(doc, attachedEndpoint('a', { x: 150, y: 90 }), attachedEndpoint('b', { x: 320, y: 110 }), 'dana');
    expect(id).toBeTypeOf('string');
    expect(updates()).toBe(1);

    const connector = arrow(doc, id!);
    expect(connector.type).toBe('connector');
    expect(connector.from).toEqual({ kind: 'attached', objectId: 'a', fallback: { x: 200, y: 100 } });
    expect(connector.to).toEqual({ kind: 'attached', objectId: 'b', fallback: { x: 300, y: 100 } });
    expect(connector.createdBy).toBe('dana');
    expect(connector.z).toBe(3); // above both boxes it joins

    // The board reports the arrow where its ends are, not at the zeroes it stores.
    const reported = snapshot(doc).find((object) => object.id === id);
    expect(reported).toBeDefined();
    expect(objectBounds(reported!)).toEqual({ x: 200, y: 100, width: 100, height: 0 });
    expect(isConnectorSnapshot(reported)).toBe(true);
  });

  it('TC-08: an arrow from an object to itself is refused with null and no transaction', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    const updates = countUpdates(doc);

    const id = createConnector(
      doc,
      attachedEndpoint('a', { x: 0, y: 100 }),
      attachedEndpoint('a', { x: 200, y: 100 }),
      'dana',
    );
    expect(id).toBeNull();
    expect(updates()).toBe(0);
    expect(connectorSnapshots(doc)).toHaveLength(0);
  });

  it('TC-09: an arrow of less than the minimum length is refused, and exactly the minimum is created', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);

    const short = CONNECTOR_MIN_LENGTH_WORLD - 0.1;
    expect(createConnector(doc, freeEndpoint({ x: 0, y: 0 }), freeEndpoint({ x: short, y: 0 }), 'dana')).toBeNull();
    expect(createConnector(doc, freeEndpoint({ x: 0, y: 0 }), freeEndpoint({ x: 0, y: -short }), 'dana')).toBeNull();
    expect(updates()).toBe(0);

    const id = createConnector(
      doc,
      freeEndpoint({ x: 0, y: 0 }),
      freeEndpoint({ x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 }),
      'dana',
    );
    expect(id).toBeTypeOf('string');
    expect(updates()).toBe(1);
    expect(objectBounds(arrow(doc, id!))).toEqual({ x: 0, y: 0, width: CONNECTOR_MIN_LENGTH_WORLD, height: 0 });
  });

  it('measures the length between where the ends are drawn, not how far the pointer travelled', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    seedBox(doc, 'b', { x: 2_000, y: 0, width: 200, height: 200 }, 2);

    // Two drags of ten pixels, one on each object, three hundred units apart: the arrow is long, so it is real.
    const id = createConnector(doc, attachedEndpoint('a', { x: 190, y: 100 }), attachedEndpoint('b', { x: 2_010, y: 100 }), 'dana');
    expect(id).toBeTypeOf('string');
  });

  it('an arrow to empty space is free at the point it was released, and an arrow from empty space starts free', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);

    const id = createConnector(doc, freeEndpoint({ x: -20, y: -30 }), attachedEndpoint('a', { x: 210, y: 110 }), 'dana');
    const connector = arrow(doc, id!);
    expect(connector.from).toEqual({ kind: 'free', x: -20, y: -30 });
    expect(connector.to.kind).toBe('attached');
  });

  it('TC-06-shaped errors: an end that is not an end creates nothing and opens no transaction', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);

    expect(createConnector(doc, freeEndpoint({ x: Number.NaN, y: 0 }), freeEndpoint({ x: 100, y: 0 }), 'dana')).toBeNull();
    expect(createConnector(doc, { kind: 'attached', objectId: '' } as unknown as Endpoint, freeEndpoint({ x: 100, y: 0 }), 'dana')).toBeNull();
    expect(createConnector(doc, null as unknown as Endpoint, freeEndpoint({ x: 100, y: 0 }), 'dana')).toBeNull();
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('does not keep the object it was handed, and cannot be edited through its snapshot', () => {
    const doc = newDoc();
    const id = createConnector(doc, freeEndpoint({ x: 0, y: 0 }), freeEndpoint({ x: 100, y: 0 }), 'dana');
    const connector = arrow(doc, id!);
    // The snapshot is frozen: writing through it would be editing the document behind Yjs's back.
    expect(Object.isFrozen(connector)).toBe(true);
    expect(Object.isFrozen(connector.from)).toBe(true);
  });

  it('an arrow that ends at an object that is already gone is still created, at the point it was aimed at', () => {
    const doc = newDoc();
    const aim = { x: 400, y: 100 };
    const id = createConnector(doc, freeEndpoint({ x: 0, y: 100 }), attachedEndpoint('deleted-while-drawing', aim), 'dana');
    expect(id).toBeTypeOf('string');
    // The race in progress: created, drawn, and pointing at the place the object was.
    expect(resolveEndpoints(arrow(doc, id!), rectsOf(doc))).toEqual({ from: { x: 0, y: 100 }, to: aim });
  });
});

describe('connector.model setConnectorEndpoint', () => {
  /** A board with three boxes and one arrow from the first to the second. */
  function withArrow(): { doc: Y.Doc; id: string } {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    seedBox(doc, 'b', B, 2);
    seedBox(doc, 'c', { x: 0, y: 400, width: 200, height: 200 }, 3);
    const id = createConnector(doc, attachedEndpoint('a', { x: 200, y: 100 }), attachedEndpoint('b', { x: 300, y: 100 }), 'dana');
    return { doc, id: id! };
  }

  it('TC-12: dragging an end onto empty space makes it free at the point it was dropped', () => {
    const { doc, id } = withArrow();
    const updates = countUpdates(doc);

    expect(setConnectorEndpoint(doc, id, 'to', freeEndpoint({ x: 900, y: 700 }))).toBe(true);
    expect(updates()).toBe(1);
    expect(arrow(doc, id).to).toEqual({ kind: 'free', x: 900, y: 700 });
    expect(objectBounds(arrow(doc, id))).toEqual({ x: 200, y: 100, width: 700, height: 600 });
  });

  it('TC-12: dragging an end onto a third object attaches it there, at the side it will be drawn at', () => {
    const { doc, id } = withArrow();
    const updates = countUpdates(doc);

    expect(setConnectorEndpoint(doc, id, 'to', attachedEndpoint('c', { x: 150, y: 380 }))).toBe(true);
    expect(updates()).toBe(1);
    expect(arrow(doc, id).to).toEqual({ kind: 'attached', objectId: 'c', fallback: { x: 100, y: 400 } });
  });

  it('TC-12: dragging an end onto the object at the other end is refused with false and no transaction', () => {
    const { doc, id } = withArrow();
    const updates = countUpdates(doc);

    expect(setConnectorEndpoint(doc, id, 'to', attachedEndpoint('a', { x: 0, y: 100 }))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', attachedEndpoint('b', { x: 300, y: 100 }))).toBe(false);
    expect(updates()).toBe(0);
    // The arrow the person had is the arrow they still have.
    expect(arrow(doc, id).to).toEqual({ kind: 'attached', objectId: 'b', fallback: { x: 300, y: 100 } });
  });

  it('TC-29: an arrow that is not there cannot have its ends moved', () => {
    const { doc, id } = withArrow();
    deleteObjects(doc, [id]);
    const updates = countUpdates(doc);

    expect(setConnectorEndpoint(doc, id, 'to', freeEndpoint({ x: 10, y: 10 }))).toBe(false);
    expect(setConnectorEndpoint(doc, 'no-such-arrow', 'to', freeEndpoint({ x: 10, y: 10 }))).toBe(false);
    expect(updates()).toBe(0);
  });

  it('a point that is not a point, and an end that is not an end, are refused', () => {
    const { doc, id } = withArrow();
    const updates = countUpdates(doc);

    expect(setConnectorEndpoint(doc, id, 'to', freeEndpoint({ x: 10, y: Number.NaN }))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', attachedEndpoint('c', { x: 1, y: 2 }))).toBe(true);
    // A parameter type is a promise to TypeScript, not a check on what arrives: the server and any code
    // that reads a document hand us plain values, and an end that is neither of the two is refused rather
    // than written to a field nobody reads.
    expect(setConnectorEndpoint(doc, id, 'aside' as unknown as ConnectorEnd, freeEndpoint({ x: 40, y: 40 }))).toBe(false);
    expect(updates()).toBe(1);
  });

  it('an end dragged where it already is writes nothing', () => {
    const { doc, id } = withArrow();
    const updates = countUpdates(doc);

    expect(setConnectorEndpoint(doc, id, 'to', attachedEndpoint('b', { x: 300, y: 100 }))).toBe(false);
    expect(updates()).toBe(0);
  });

  it('an arrow whose far end was re-attached is drawn to the new object, not to where it used to point', () => {
    const { doc, id } = withArrow();
    setConnectorEndpoint(doc, id, 'to', attachedEndpoint('c', { x: 150, y: 380 }));
    const ends = resolveEndpoints(arrow(doc, id), rectsOf(doc));
    expect(ends.from).toEqual({ x: 100, y: 200 }); // A's bottom, facing C below it
    expect(ends.to).toEqual({ x: 100, y: 400 }); // C's top
  });
});

describe('connector.model detachConnectorsTo', () => {
  it('TC-13: deleting the object at an end keeps the arrow, its end free where the object side was, in one update', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    seedBox(doc, 'b', B, 2);
    const id = createConnector(doc, attachedEndpoint('a', { x: 200, y: 100 }), attachedEndpoint('b', { x: 300, y: 100 }), 'dana');
    const updates = countUpdates(doc);

    expect(deleteObjects(doc, ['a'])).toBe(1);
    // One update for the delete *and* the detach: one undo brings the box back with the arrow attached again.
    expect(updates()).toBe(1);

    const connector = arrow(doc, id!);
    expect(connector.from).toEqual({ kind: 'free', x: 200, y: 100 });
    expect(connector.to).toEqual({ kind: 'attached', objectId: 'b', fallback: { x: 300, y: 100 } });
    // The box it pointed at is gone; the box it pointed at and the arrow between them are what is left.
    expect(snapshot(doc).map((object) => object.id)).toEqual(['b', id!]);
  });

  it('an arrow with an end at each deleted object keeps both ends where they were', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    seedBox(doc, 'b', B, 2);
    const id = createConnector(doc, attachedEndpoint('a', { x: 200, y: 100 }), attachedEndpoint('b', { x: 300, y: 100 }), 'dana');
    const updates = countUpdates(doc);

    expect(deleteObjects(doc, ['a', 'b'])).toBe(2);
    expect(updates()).toBe(1);
    expect(arrow(doc, id!).from).toEqual({ kind: 'free', x: 200, y: 100 });
    expect(arrow(doc, id!).to).toEqual({ kind: 'free', x: 300, y: 100 });
  });

  it('arrows that point at something else are not written when a box is deleted', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    seedBox(doc, 'b', B, 2);
    seedBox(doc, 'c', { x: 0, y: 600, width: 200, height: 200 }, 3);
    createConnector(doc, attachedEndpoint('b', { x: 300, y: 100 }), attachedEndpoint('c', { x: 100, y: 600 }), 'dana');
    const updates = countUpdates(doc);

    expect(deleteObjects(doc, ['a'])).toBe(1);
    // The delete is one update; the arrow, which points at neither deleted object... it points at b and c, so
    // it has nothing to say and nothing is written about it.
    expect(updates()).toBe(1);
  });

  it('detachConnectorsTo called on its own is a transaction of its own, and no detach is no transaction', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    seedBox(doc, 'b', B, 2);
    const id = createConnector(doc, attachedEndpoint('a', { x: 200, y:100 }), attachedEndpoint('b', { x: 300, y: 100 }), 'dana');
    const updates = countUpdates(doc);

    detachConnectorsTo(doc, ['a']);
    expect(updates()).toBe(1);
    detachConnectorsTo(doc, ['a']);
    detachConnectorsTo(doc, []);
    expect(updates()).toBe(1);
    expect(arrow(doc, id!).from.kind).toBe('free');
  });

  it('an end attached to an object whose box has gone falls back to the point it was drawn at', () => {
    const doc = newDoc();
    const objects = objectsOf(doc);
    // An arrow pointing at an object that is not on this board — the state a document arrives in when a
    // colleague deletes an object in a tab nobody shares a memory with.
    const connector = new Y.Map<unknown>();
    doc.transact(() => {
      connector.set('type', CONNECTOR_OBJECT_TYPE);
      connector.set('x', 0);
      connector.set('y', 0);
      connector.set('width', 0);
      connector.set('height', 0);
      connector.set('z', 1);
      connector.set('createdAt', 1_700_000_000_000);
      connector.set('from', { kind: 'attached', objectId: 'gone', fallback: { x: 640, y: 480 } });
      connector.set('to', freeEndpoint({ x: 100, y: 100 }));
      objects.set('orphan', connector);
    });

    detachConnectorsTo(doc, ['gone']);
    expect(readConnector(doc, 'orphan')!.from).toEqual({ kind: 'free', x: 640, y: 480 });

    // And the arrow is still on the board, drawn where it was.
    expect(objectBounds(snapshot(doc).find((object) => object.id === 'orphan')!)).toEqual({
      x: 100,
      y: 100,
      width: 540,
      height: 380,
    });
  });

  it('an arrow being deleted itself is not rewritten first', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    seedBox(doc, 'b', B, 2);
    const id = createConnector(doc, attachedEndpoint('a', { x: 200, y: 100 }), attachedEndpoint('b', { x: 300, y: 100 }), 'dana');
    const updates = countUpdates(doc);

    expect(deleteObjects(doc, [id!, 'a'])).toBe(2);
    expect(updates()).toBe(1);
    expect(connectorSnapshots(doc)).toHaveLength(0);
  });
});

describe('connector.model and the board operations', () => {
  it('an arrow is not moved by a drag of its body, because its position is its two ends', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    seedBox(doc, 'b', B, 2);
    const id = createConnector(doc, attachedEndpoint('a', { x: 200, y: 100 }), attachedEndpoint('b', { x: 300, y: 100 }), 'dana');
    const updates = countUpdates(doc);

    expect(moveObjects(doc, new Map([[id!, { x: 900, y: 900 }]]))).toBe(0);
    expect(updates()).toBe(0);
    expect(objectsOf(doc).get(id!)!.get('x')).toBe(0);
  });

  it('a group of an object and the arrow attached to it moves, and the arrow comes with it', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    seedBox(doc, 'b', B, 2);
    const id = createConnector(doc, attachedEndpoint('a', { x: 200, y: 100 }), attachedEndpoint('b', { x: 300, y: 100 }), 'dana');
    const before = objectBounds(snapshot(doc).find((object) => object.id === id)!);

    expect(moveObjects(doc, new Map([['b', { x: 500, y: 0 }]]))).toBe(1);
    const after = objectBounds(snapshot(doc).find((object) => object.id === id)!);
    expect(before).toEqual({ x: 200, y: 100, width: 100, height: 0 });
    // The arrow was never told to move, and it is two hundred units longer: it starts where it started,
    // because the shape it starts at did not move, and it ends where the other shape now is.
    expect(after).toEqual({ x: 200, y: 100, width: 300, height: 0 });
  });

  it('an arrow of a document nobody wrote with this model is reported, or left off, and never crashes a read', () => {
    const doc = newDoc();
    const objects = objectsOf(doc);
    const broken = new Y.Map<unknown>();
    doc.transact(() => {
      broken.set('type', CONNECTOR_OBJECT_TYPE);
      broken.set('z', 1);
      broken.set('from', { kind: 'free', x: 0, y: 0 });
      objects.set('broken', broken);
    });

    expect(readConnector(doc, 'broken')).toBeNull();
    expect(snapshot(doc).map((object) => object.id)).toEqual([]);
    expect(isEndpoint(broken.get('to'))).toBe(false);
  });

  it('an arrow is still an object for the board: it has a stacking number and can be deleted', () => {
    const doc = newDoc();
    seedBox(doc, 'a', A);
    const id = createConnector(doc, freeEndpoint({ x: 0, y: 0 }), freeEndpoint({ x: 300, y: 0 }), 'dana');
    expect(arrow(doc, id!).z).toBe(2);
    expect(deleteObjects(doc, [id!])).toBe(1);
    expect(readConnector(doc, id!)).toBeNull();
  });

  it('a sticky note is a thing an arrow can be attached to, like anything else', () => {
    const doc = newDoc();
    // `createSticky` is given where the middle of the note goes, which is what a drag that makes a note is.
    const note = createSticky(doc, { x: 0, y: 0 });
    seedBox(doc, 'b', B, 2);
    const id = createConnector(doc, attachedEndpoint(note, { x: 100, y: 100 }), attachedEndpoint('b', { x: 300, y: 100 }), 'dana');
    const ends = resolveEndpoints(arrow(doc, id!), rectsOf(doc));
    // The note's right side, facing the box to its right: half its width out, on its middle row.
    expect(ends.from).toEqual({ x: STICKY_SIZE_WORLD / 2, y: 0 });
    expect(ends.to).toEqual({ x: B.x, y: STICKY_SIZE_WORLD / 2 });
  });
});
