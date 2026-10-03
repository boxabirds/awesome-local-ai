// connector.model unit tests (story 10, TC-07 to TC-14, TC-29).
//
// An arrow stores which two objects it joins and nothing about how it looks, so the
// contract of this module is mostly geometry: where an end attaches, what happens when
// the object it is joined to moves (nothing is written), and what happens when that
// object dies (one field becomes a point, in the same transaction as the death).
//
// The geometry functions are called directly with plain numbers, and the model
// functions are called on a real Y.Doc so "wrote nothing" can be asserted as "zero
// `update` events" — the only honest way to say nothing went on the wire and undo has
// nothing to rewind.

import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  connectorLength,
  connectorSnapshot,
  endpointStoredPoint,
  createConnector,
  detachConnectorsTo,
  objectRectsFromDoc,
  setConnectorEndpoint,
} from '../../src/shared/objects/connector';
import {
  connectorBBox,
  endpointAnchor,
  endToward,
  isEndpoint,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  sideAnchors,
  type Endpoint,
  type Side,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline, distanceToSegment } from '../../src/shared/geometry/polyline';
import {
  createSticky,
  deleteObjects,
  LOCAL_ORIGIN,
  moveObjects,
  objectBounds,
  objectRects,
  objectSnapshots,
  resizeObjects,
} from '../../src/shared/board-model';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { createShape } from '../../src/shared/objects/shape';

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** How many `update` events (committed transactions) `fn` produces. */
function updatesDuring(doc: Y.Doc, fn: () => unknown): number {
  let count = 0;
  const handler = () => {
    count += 1;
  };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return count;
}

function raw(doc: Y.Doc, id: string): Y.Map<unknown> {
  const map = objectsMap(doc).get(id);
  if (!map) throw new Error(`object ${id} is not in the document`);
  return map;
}

/** The stored end of an arrow, narrowed; throws when it is not there. */
function storedEnd(doc: Y.Doc, id: string, end: 'from' | 'to'): Endpoint {
  const value = raw(doc, id).get(end);
  if (!isEndpoint(value)) throw new Error(`${end} of ${id} is not a sound endpoint`);
  return value;
}

/** The connector snapshot of `id`; throws when the model does not see one. */
function needConnector(doc: Y.Doc, id: string) {
  const snap = connectorSnapshot(doc, id);
  if (!snap) throw new Error(`connector ${id} is not in the document`);
  return snap;
}

/** A sticky note (a 200x200 square) whose top-left is (x, y). */
function square(doc: Y.Doc, x: number, y: number): string {
  const half = STICKY_SIZE_WORLD / 2;
  return createSticky(doc, { x: x + half, y: y + half });
}

/** A point `distance` away from the centre of `rect`, at `degrees` (0 = east, 90 = north). */
function orbit(rect: { x: number; y: number; width: number; height: number }, degrees: number, distance = 300) {
  const center = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
  const radians = (degrees * Math.PI) / 180;
  // Screen coordinates: y grows downwards, so "north" is negative y.
  return {
    x: center.x + distance * Math.cos(radians),
    y: center.y - distance * Math.sin(radians),
  };
}

describe('connector.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-07 stores both ends as joins, each with the anchor it draws at', () => {
    const a = square(doc, 0, 0); // 0..200
    const b = square(doc, 500, 0); // 500..700: 300 apart

    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } },
      'dana',
    );
    expect(id).toBeTruthy();
    expect(raw(doc, id!).get('type')).toBe('connector');
    expect(raw(doc, id!).get('createdBy')).toBe('dana');
    expect(raw(doc, id!).get('z')).toBe(3);

    const from = storedEnd(doc, id!, 'from');
    const to = storedEnd(doc, id!, 'to');
    // What is stored is the *join*, never a side or a point the client invented: the
    // anchor is recomputed from the objects, which is why it follows them.
    expect(from).toMatchObject({ kind: 'attached', objectId: a });
    expect(to).toMatchObject({ kind: 'attached', objectId: b });
    // Each fallback is the midpoint of the side facing the other object, which is
    // also where the arrow is drawn.
    expect(from.kind === 'attached' && from.fallback).toEqual({ x: 200, y: 100 });
    expect(to.kind === 'attached' && to.fallback).toEqual({ x: 500, y: 100 });

    // One transaction: one update on the wire, one step of undo.
    expect(updatesDuring(doc, () => createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 1000, y: 0 }, 'dana'))).toBe(1);

    // The arrow's box is derived from where it draws: it owns no position (TC-29's
    // other half, and what frames its selection).
    const snap = needConnector(doc, id!);
    expect(objectBounds(snap)).toEqual({ x: 200, y: 100, width: 300, height: 0 });
    expect(snap.endpoints).toEqual({ from: { x: 200, y: 100 }, to: { x: 500, y: 100 } });
  });

  it('TC-07b an arrow follows its objects with nothing written', () => {
    const a = square(doc, 0, 0);
    const b = square(doc, 500, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } },
      'dana',
    )!;
    const before = JSON.stringify(raw(doc, id).get('from'));

    // Somebody else drags the second square down past the first: one move, one update.
    const updates = updatesDuring(doc, () =>
      expect(moveObjects(doc, new Map([[b, { x: 150, y: 400 }]]))).toBe(1),
    );
    expect(updates).toBe(1);
    // The arrow was not touched, and yet it now points somewhere else: the snapshot
    // resolved it from the objects it joins. (connector.follows.)
    expect(JSON.stringify(raw(doc, id).get('from'))).toBe(before);
    const snap = needConnector(doc, id);
    expect(snap.endpoints.from).toEqual({ x: 100, y: 200 });
    expect(snap.endpoints.to).toEqual({ x: 250, y: 400 });
  });

  it('TC-08 an arrow from an object to itself is refused with nothing written', () => {
    const a = square(doc, 0, 0);
    const updates = updatesDuring(doc, () => {
      expect(
        createConnector(
          doc,
          { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
          { kind: 'attached', objectId: a, fallback: { x: 200, y: 200 } },
          'dana',
        ),
      ).toBeNull();
    });
    expect(updates).toBe(0);
    expect(objectsMap(doc).size).toBe(1);
  });

  it('TC-09 a drag shorter than the minimum creates nothing; exactly the minimum does', () => {
    const short = updatesDuring(doc, () =>
      expect(
        createConnector(
          doc,
          { kind: 'free', x: 0, y: 0 },
          { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD - 0.1, y: 0 },
          'dana',
        ),
      ).toBeNull(),
    );
    // A stray click is not an arrow, and saying so costs nothing on the wire.
    expect(short).toBe(0);
    expect(objectsMap(doc).size).toBe(0);

    const exact = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 },
      'dana',
    );
    expect(exact).toBeTruthy();
    expect(connectorLength({ from: { kind: 'free', x: 0, y: 0 }, to: { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 } }, objectRectsFromDoc(doc))).toBe(
      CONNECTOR_MIN_LENGTH_WORLD,
    );

    // The length that is measured is the *resolved* one: two squares that touch yield
    // an arrow of no length between them, however far the pointer travelled.
    const a = square(doc, 0, 0);
    const b = square(doc, 200, 0);
    const updates = updatesDuring(doc, () =>
      expect(
        createConnector(
          doc,
          { kind: 'attached', objectId: a, fallback: { x: -400, y: 100 } },
          { kind: 'attached', objectId: b, fallback: { x: 600, y: 100 } },
          'dana',
        ),
      ).toBeNull(),
    );
    expect(updates).toBe(0);
  });

  it('TC-10 the side an arrow uses switches as the other end goes past the diagonal', () => {
    const a = square(doc, 0, 0);
    const rect = objectRects(doc).get(a)!;
    expect(rect).toEqual({ x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });

    // The four connection points are the midpoints of the four sides — on the boundary
    // of a rectangle, and of an ellipse or diamond of the same box.
    expect(sideAnchors(rect)).toEqual({
      top: { x: 100, y: 0 },
      right: { x: 200, y: 100 },
      bottom: { x: 100, y: 200 },
      left: { x: 0, y: 100 },
    });
    expect(sideAnchor(rect, 'right')).toEqual({ x: 200, y: 100 });

    // As B orbits A, the side flips at the diagonal — halfway between due east and
    // due north, and nowhere else.
    const cases: [number, Side][] = [
      [0, 'right'],
      [44, 'right'],
      [46, 'top'],
      [90, 'top'],
      [134, 'top'],
      [136, 'left'],
      [180, 'left'],
      [224, 'left'],
      [226, 'bottom'],
      [270, 'bottom'],
      [314, 'bottom'],
      [316, 'right'],
    ];
    for (const [degrees, expected] of cases) {
      expect(nearestSide(rect, orbit(rect, degrees))).toBe(expected);
    }

    // The resolved endpoints use the same rule on both ends, so the arrow is drawn
    // between two side midpoints and never into the middle of a shape.
    const b = square(doc, 500, -400);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'dana',
    )!;
    const resolved = resolveEndpoints(needConnector(doc, id), objectRects(doc));
    expect(resolved).toEqual({ from: { x: 200, y: 100 }, to: { x: 500, y: -300 } });
  });

  it('TC-11 an end whose object is gone draws at the point it was left at', () => {
    const a = square(doc, 0, 0);
    const b = square(doc, 500, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } },
      'dana',
    )!;
    const storedTo = storedEnd(doc, id, 'to');
    if (storedTo.kind !== 'attached') throw new Error('the head of a new arrow should be a join');
    const rects = objectRects(doc);
    // A board as this client sees it, with the object it joined missing from the boxes
    // — a peer deleted it, or it came from a type this client cannot read.
    rects.delete(b);

    let resolved: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
    expect(() => {
      resolved = resolveEndpoints(needConnector(doc, id), rects);
    }).not.toThrow();
    // The arrow does not vanish and does not jump to a corner: the end that lost its
    // object stays where it was last drawn, and the other end still follows its object.
    expect(resolved).toEqual({ from: { x: 200, y: 100 }, to: storedTo.fallback });

    // An end with no fallback to go home to is not an end at all.
    expect(isEndpoint({ kind: 'attached', objectId: 'x' })).toBe(false);
    expect(isEndpoint({ kind: 'attached', objectId: '' , fallback: { x: 0, y: 0 } })).toBe(false);
    expect(isEndpoint({ kind: 'free', x: 0, y: Number.NaN })).toBe(false);
    expect(isEndpoint({ kind: 'somewhere', x: 0, y: 0 })).toBe(false);
    expect(endpointStoredPoint({ kind: 'free', x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });

  it('TC-12 an end can be moved to empty space or to another object, but not to its own', () => {
    const a = square(doc, 0, 0);
    const b = square(doc, 500, 0);
    const c = square(doc, 0, 500);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } },
      'dana',
    )!;

    // Drag the head onto a third object: one write, one update, and the tail is not
    // spoken about.
    expect(updatesDuring(doc, () => expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: c, fallback: { x: 0, y: 0 } })).toBe(true))).toBe(1);
    expect(storedEnd(doc, id, 'to')).toMatchObject({ kind: 'attached', objectId: c });
    // The fallback of a joined end is kept up to date with where it draws now, so the
    // day its object dies it stays where it was.
    expect(needConnector(doc, id).endpoints).toEqual({ from: { x: 100, y: 200 }, to: { x: 100, y: 500 } });

    // Pull the tail onto the object the head is now joined to: refused, and nothing
    // at all is written — not even the end that would have been fine. An arrow from a
    // shape to itself is a dot nobody asked for, and a client holding one end cannot
    // know it would make one.
    const refused = updatesDuring(doc, () =>
      expect(setConnectorEndpoint(doc, id, 'from', { kind: 'attached', objectId: c, fallback: { x: 0, y: 0 } })).toBe(false),
    );
    expect(refused).toBe(0);
    expect(storedEnd(doc, id, 'from')).toMatchObject({ kind: 'attached', objectId: a });

    // The other end follows the same rule.
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } })).toBe(false);

    // Release the head over empty space: the end is fixed at the release point...
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 900, y: -30 })).toBe(true);
    expect(storedEnd(doc, id, 'to')).toEqual({ kind: 'free', x: 900, y: -30 });
    // ...and now the tail may join C, because the head is no longer there.
    expect(updatesDuring(doc, () =>
      expect(setConnectorEndpoint(doc, id, 'from', { kind: 'attached', objectId: c, fallback: { x: 0, y: 0 } })).toBe(true),
    )).toBe(1);
    expect(storedEnd(doc, id, 'from')).toMatchObject({ kind: 'attached', objectId: c });
    // A point that is not a point, an end that is not an end, and an object that is
    // not an arrow are all refused.
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: Number.NaN, y: 0 })).toBe(false);
    // An `end` that is neither of the two: TypeScript forbids it, so it arrives
    // through a cast, the way a value from a peer that does not share our types does.
    expect(setConnectorEndpoint(doc, id, 'middle' as 'from', { kind: 'free', x: 0, y: 0 })).toBe(false);
    expect(setConnectorEndpoint(doc, a, 'to', { kind: 'free', x: 0, y: 0 })).toBe(false);
    // None of them wrote anything.
    expect(updatesDuring(doc, () => {
      setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: Number.NaN, y: 0 });
      setConnectorEndpoint(doc, a, 'to', { kind: 'free', x: 0, y: 0 });
    })).toBe(0);

    // An arrow between a shape and a free point is a legal arrow, and a long one.
    expect(connectorLength(needConnector(doc, id), objectRects(doc))).toBeGreaterThan(
      CONNECTOR_MIN_LENGTH_WORLD,
    );
  });

  it('TC-13 deleting an object releases the arrows that pointed at it, in one update', () => {
    const a = square(doc, 0, 0);
    const b = square(doc, 500, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } },
      'dana',
    )!;

    // A's last anchor, as the board currently sees it.
    const anchor = endpointAnchor(
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      endToward({ kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } }, objectRects(doc)),
      objectRects(doc),
    );
    expect(anchor).toEqual({ x: 200, y: 100 });

    const updates = updatesDuring(doc, () => deleteObjects(doc, [a]));
    // The release is inside the delete's own transaction: one update on the wire, one
    // step of undo, and no moment when the board held an arrow to a missing object.
    expect(updates).toBe(1);
    expect(objectsMap(doc).has(a)).toBe(false);
    expect(objectsMap(doc).has(id)).toBe(true);
    const from = storedEnd(doc, id, 'from');
    expect(from).toEqual({ kind: 'free', x: anchor.x, y: anchor.y });
    // The other end is not even rewritten: it is still a join to the object it joined.
    expect(storedEnd(doc, id, 'to')).toMatchObject({ kind: 'attached', objectId: b });
    // The arrow is still an arrow, drawn from the place it was left at to the side of
    // the object that survived.
    expect(needConnector(doc, id).endpoints).toEqual({
      from: anchor,
      to: { x: 500, y: 100 },
    });
  });

  it('TC-13b an arrow that loses both ends is two free points, and detach leaves others alone', () => {
    const a = square(doc, 0, 0);
    const b = square(doc, 500, 0);
    const kept = square(doc, 0, 500);
    const both = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } },
      'dana',
    )!;
    const untouched = createConnector(
      doc,
      { kind: 'attached', objectId: kept, fallback: { x: 0, y: 0 } },
      { kind: 'free', x: 900, y: 900 },
      'dana',
    )!;
    const untouchedBefore = JSON.stringify(raw(doc, untouched).get('from'));

    expect(deleteObjects(doc, [a, b])).toBe(2);
    expect(storedEnd(doc, both, 'from').kind).toBe('free');
    expect(storedEnd(doc, both, 'to').kind).toBe('free');
    // An arrow that did not point at what died is not written at all.
    expect(JSON.stringify(raw(doc, untouched).get('from'))).toBe(untouchedBefore);

    // detachConnectorsTo is also callable on its own, inside an open transaction (the
    // way deleteObjects uses it); empty input writes nothing at all.
    expect(
      updatesDuring(doc, () => {
        detachConnectorsTo(doc, []);
        detachConnectorsTo(doc, ['nobody-here']);
      }),
    ).toBe(0);
    // An arrow to an object that is already gone is left as it is: it has nothing left
    // to release.
    expect(
      updatesDuring(doc, () => detachConnectorsTo(doc, [a])),
    ).toBe(0);
  });

  it('TC-14 the distance to an arrow is the distance to its line, not to its box', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);

    // The boundary of "can I select this arrow?" at the default tolerance: 6.01 is a
    // miss, 5.99 is a hit, and being inside the bounding box is not the question.
    const tolerance = 6;
    expect(distanceToPolyline(line, { x: 50, y: 5.99 }) <= tolerance).toBe(true);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 }) <= tolerance).toBe(false);

    // Past either end, the distance is to the end of the line, not to the infinite
    // line through it.
    expect(distanceToPolyline(line, { x: 200, y: 0 })).toBe(100);
    expect(distanceToPolyline(line, { x: -10, y: 0 })).toBe(10);
    // A diagonal arrow measures perpendicularly, which is what makes the tolerance
    // feel the same thickness at any angle.
    expect(distanceToPolyline([{ x: 0, y: 0 }, { x: 100, y: 100 }], { x: 100, y: 0 })).toBeCloseTo(
      Math.SQRT2 * 50,
      10,
    );

    // A polyline of more than two points (story 11's pen strokes) takes the nearest of
    // all its segments; a point list with nothing in it can never be hit.
    expect(distanceToPolyline([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }], { x: 0, y: 50 })).toBe(0);
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Infinity);
    expect(distanceToPolyline([{ x: 5, y: 5 }], { x: 5, y: 9 })).toBe(4);
    expect(distanceToSegment({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('TC-29 an arrow that is gone cannot be edited, and its box was never its own', () => {
    const a = square(doc, 0, 0);
    const b = square(doc, 500, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } },
      'dana',
    )!;
    // The stored position fields are placeholders: 0/0/0/0, because an arrow's box is
    // derived from the objects it joins.
    expect(raw(doc, id).get('x')).toBe(0);
    expect(raw(doc, id).get('width')).toBe(0);
    expect(objectBounds(needConnector(doc, id))).toEqual({ x: 200, y: 100, width: 300, height: 0 });

    expect(deleteObjects(doc, [id])).toBe(1);
    // The person still holding that end has lost the arrow: false, and not one byte
    // written. Their handle simply has nothing left to drag.
    const updates = updatesDuring(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 40, y: 40 })).toBe(false);
      expect(connectorSnapshot(doc, id)).toBeUndefined();
    });
    expect(updates).toBe(0);
    expect(objectsMap(doc).has(id)).toBe(false);

    // A connector's box follows a resize too: it is the bounds of the line, so making
    // an object bigger moves the arrow's end and the box with it.
    const other = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } },
      'dana',
    )!;
    const before = objectBounds(needConnector(doc, other));
    expect(before).toEqual({ x: 200, y: 100, width: 300, height: 0 });
    // The object the arrow starts from grows to twice its width: its end slides along
    // to the new side midpoint and the arrow's box gets shorter, with nothing written
    // to the arrow at all.
    resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 400, height: 200 }]]));
    expect(needConnector(doc, other).endpoints.from).toEqual({ x: 400, y: 100 });
    const after = objectBounds(needConnector(doc, other));
    expect(after).toEqual({ x: 400, y: 100, width: 100, height: 0 });
  });

  it('derives boxes for every type, so an arrow can join a shape or another arrow', () => {
    const sticky = square(doc, 0, 0);
    const shape = createShape(doc, { kind: 'ellipse', rect: { x: 400, y: 0, width: 200, height: 120 }, at: { x: 400, y: 0 } }, 'dana')!;
    const rects = objectRects(doc);
    expect(rects.get(shape)).toEqual({ x: 400, y: 0, width: 200, height: 120 });
    // A sticky note that carries no size still has a box, so an arrow joins it where a
    // person sees it (TC-33's rule).
    expect(rects.get(sticky)).toEqual({ x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    expect(rects.get(sticky)).toEqual(objectRectsFromDoc(doc).get(sticky));

    // An arrow between a sticky note and a shape: the shape's nearest side to the note
    // is its left, at the middle of its height.
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: sticky, fallback: { x: 200, y: 0 } },
      { kind: 'attached', objectId: shape, fallback: { x: 400, y: 0 } },
      'dana',
    )!;
    expect(needConnector(doc, id).endpoints).toEqual({
      from: { x: 200, y: 100 },
      to: { x: 400, y: 60 },
    });

    // And an arrow can join an arrow, because a connector has a box like anything else.
    const second = createConnector(
      doc,
      { kind: 'attached', objectId: id, fallback: { x: 0, y: 0 } },
      { kind: 'free', x: 300, y: 400 },
      'dana',
    );
    expect(second).toBeTruthy();

    // A box is a box: the bounds of two points, whichever way the arrow runs.
    expect(connectorBBox({ x: 500, y: 100 }, { x: 100, y: 500 })).toEqual({ x: 100, y: 100, width: 400, height: 400 });
    expect(connectorBBox({ x: 100, y: 500 }, { x: 500, y: 100 })).toEqual({ x: 100, y: 100, width: 400, height: 400 });
    expect(connectorBBox({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });

  it('reads an arrow written by another client, and one that is not sound', () => {
    // A well-formed arrow written by a peer, in a transaction that is not ours: the
    // local origin is what tells undo to leave it alone.
    const a = square(doc, 0, 0);
    doc.transact(() => {
      const map = new Y.Map<unknown>();
      map.set('type', 'connector');
      map.set('x', 0);
      map.set('y', 0);
      map.set('width', 0);
      map.set('height', 0);
      map.set('z', 4);
      map.set('createdAt', 0);
      map.set('createdBy', 'elsewhere');
      map.set('from', { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } });
      map.set('to', { kind: 'free', x: 600, y: 100 });
      objectsMap(doc).set('peer-arrow', map);
    });
    const seen = objectSnapshots(doc).find((s) => s.id === 'peer-arrow');
    expect(seen).toBeDefined();
    expect(objectBounds(seen!)).toEqual({ x: 200, y: 100, width: 400, height: 0 });

    // An arrow whose endpoint is not sound is not painted, and does not break the
    // read of the rest of the board.
    doc.transact(() => {
      const map = new Y.Map<unknown>();
      map.set('type', 'connector');
      map.set('z', 5);
      map.set('from', { kind: 'attached', objectId: 'gone-now' });
      map.set('to', { kind: 'free', x: 0, y: 0 });
      objectsMap(doc).set('broken-arrow', map);
    });
    expect(objectSnapshots(doc).find((s) => s.id === 'broken-arrow')).toBeUndefined();
    expect(objectSnapshots(doc).some((s) => s.id === 'peer-arrow')).toBe(true);
    expect(objectSnapshots(doc).filter((s) => s.type === 'connector')).toHaveLength(1);
  });

  it('a new arrow lands on top, in the local origin, whatever else is on the board', () => {
    square(doc, 0, 0);
    createShape(doc, { at: { x: 900, y: 0 } }, 'dana');
    const b = square(doc, 500, 0);
    const rects = objectRects(doc);
    const ids = [...rects.keys()];
    let origin: unknown = 'nothing';
    doc.on('update', (_u: Uint8Array, o: unknown) => {
      origin = o;
    });
    const first = ids[0]!;
    expect(ids).toHaveLength(3);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: first, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'dana',
    );
    expect(id).toBeTruthy();
    expect(origin).toBe(LOCAL_ORIGIN);
    expect(raw(doc, id!).get('z')).toBe(4);
    expect(raw(doc, id!).get('createdAt')).toBeTypeOf('number');
    // The default size of a shape and the size of a note are named settings, not
    // numbers this module repeats.
    expect(SHAPE_DEFAULT_SIZE_WORLD).toBeGreaterThan(0);
  });
});
