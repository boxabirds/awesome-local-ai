// Story 10, connector.model (unit): the connector object model and its geometry
// against a real Y.Doc.
//
// The rule under test is the one the whole story rests on: an attached end
// stores WHICH object it hangs on, not WHERE it is, so its point is recomputed
// from live rectangles - and the two rejection rules (an arrow to itself, an
// arrow too short to mean anything) are decided before any transaction opens.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createConnector,
  setConnectorEndpoint,
  detachConnectorsTo,
  getConnectorEnds,
  rectsById,
  type ConnectorSnapshot,
} from '../../src/shared/objects/connector.ts';
import { createShape } from '../../src/shared/objects/shape.ts';
import {
  initDoc,
  objectsMapOf,
  objectsSnapshot,
  objectBounds,
  moveObject,
  deleteObjects,
} from '../../src/shared/board-model.ts';
import {
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type Endpoint,
} from '../../src/shared/geometry/connector-geometry.ts';
import { distanceToPolyline } from '../../src/shared/geometry/polyline.ts';
import { CONNECTOR_MIN_LENGTH_WORLD, CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config.ts';
import type { Point, Rect } from '../../src/shared/geometry.ts';

const BY = 'g_test';

function setup(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts the doc's own update events: a refused write must not bump it. */
function updateCounter(doc: Y.Doc): () => number {
  let n = 0;
  doc.on('update', () => n++);
  return () => n;
}

/** Two shapes 300 board units apart, centres at (100,100) and (400,100). */
function twoShapes(doc: Y.Doc): { a: string; b: string } {
  const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 200 }, at: { x: 0, y: 0 } }, BY)!;
  const b = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 200, height: 200 }, at: { x: 0, y: 0 } }, BY)!;
  return { a, b };
}

function connectorOf(doc: Y.Doc, id: string): ConnectorSnapshot {
  const o = objectsSnapshot(doc).find((s) => s.id === id);
  if (!o || o.type !== 'connector') throw new Error(`no connector ${id}`);
  return o as ConnectorSnapshot;
}

function attached(objectId: string, at: Point): Endpoint {
  return { kind: 'attached', objectId, fallback: at };
}

describe('connector.model createConnector', () => {
  // TC-07: two attached ends are stored as attachments, each carrying the
  // fallback the design calls for (the anchor on the side that faces the other
  // end), in exactly one update.
  it('TC-07 stores both ends attached to their objects, with the facing anchor as fallback', () => {
    const doc = setup();
    const updates = updateCounter(doc);
    const { a, b } = twoShapes(doc);
    expect(updates()).toBe(2); // the two shapes

    const id = createConnector(doc, attached(a, { x: 999, y: 999 }), attached(b, { x: 999, y: 999 }), BY);

    expect(id).toBeTypeOf('string');
    expect(updates()).toBe(3); // exactly one more
    const c = connectorOf(doc, id!);
    expect(c.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } }); // A's right side
    expect(c.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 100 } }); // B's left side
    // And it draws between those anchors: the box spans the 100 units between them.
    expect(objectBounds(c)).toEqual({ x: 200, y: 100, width: 100, height: 1e-6 });
  });

  // TC-08: an arrow from a shape to itself is refused without a transaction.
  it('TC-08 refuses a connector from an object to itself', () => {
    const doc = setup();
    const { a } = twoShapes(doc);
    const updates = updateCounter(doc);
    const before = objectsSnapshot(doc).length;

    expect(createConnector(doc, attached(a, { x: 0, y: 0 }), attached(a, { x: 500, y: 500 }), BY)).toBeNull();
    expect(objectsSnapshot(doc)).toHaveLength(before);
    expect(updates()).toBe(0);
  });

  // TC-09: the minimum length is the boundary between a drag and a mistake:
  // 7.9 units is nothing, 8 is an arrow.
  it('TC-09 refuses a free-to-free arrow of 7.9 units and creates one of 8', () => {
    const doc = setup();
    const updates = updateCounter(doc);

    expect(
      createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 7.9, y: 0 }, BY),
    ).toBeNull();
    expect(updates()).toBe(0);

    const id = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 8, y: 0 }, BY);
    expect(id).toBeTypeOf('string');
    expect(updates()).toBe(1);
  });

  // Malformed ends are refused, not drawn: an unknown kind, an empty id, a NaN.
  it('refuses malformed endpoints without a transaction', () => {
    const doc = setup();
    const updates = updateCounter(doc);
    const { a } = twoShapes(doc);

    expect(createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'bogus' } as never, BY)).toBeNull();
    expect(createConnector(doc, attached('', { x: 1, y: 1 }), { kind: 'free', x: 100, y: 100 }, BY)).toBeNull();
    expect(createConnector(doc, attached(a, { x: Number.NaN, y: 1 }), { kind: 'free', x: 100, y: 100 }, BY)).toBeNull();
    expect(createConnector(doc, null as never, { kind: 'free', x: 0, y: 0 }, BY)).toBeNull();
    expect(updates()).toBe(2); // only the two shapes
  });

  // A connector whose stored ends are garbage is invisible rather than a NaN
  // rectangle on the board (forward compatibility in the other direction).
  it('leaves a connector with unparseable ends out of the snapshot', () => {
    const doc = setup();
    const m = new Y.Map<unknown>();
    m.set('type', 'connector');
    m.set('x', 0);
    m.set('y', 0);
    m.set('z', 1);
    m.set('from', { kind: 'attached', objectId: 'g_gone' }); // no fallback at all
    m.set('to', { kind: 'free', x: 10, y: 10 });
    objectsMapOf(doc).set('g_broken', m);
    expect(objectsSnapshot(doc).some((o) => o.id === 'g_broken')).toBe(false);
  });
});

describe('connector.model geometry', () => {
  // TC-10: as B orbits A the anchor on A follows the nearest side, and the side
  // switches exactly at the diagonal: 0 and 44 degrees are still 'right', 46 and
  // 90 are 'top'.
  it('TC-10 switches the anchored side at the rect diagonal as the other end orbits', () => {
    const rect: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const cx = 100;
    const cy = 100;
    const orbit = (deg: number): Point => ({
      x: cx + 300 * Math.cos((deg * Math.PI) / 180),
      y: cy - 300 * Math.sin((deg * Math.PI) / 180),
    });

    expect(nearestSide(rect, orbit(0))).toBe('right');
    expect(nearestSide(rect, orbit(44))).toBe('right');
    expect(nearestSide(rect, orbit(46))).toBe('top');
    expect(nearestSide(rect, orbit(90))).toBe('top');
    expect(nearestSide(rect, orbit(180))).toBe('left');
    expect(nearestSide(rect, orbit(270))).toBe('bottom');

    // The side anchors are the side MIDPOINTS, which lie on the boundary of a
    // rect, an ellipse and a diamond alike.
    expect(sideAnchor(rect, 'top')).toEqual({ x: 100, y: 0 });
    expect(sideAnchor(rect, 'right')).toEqual({ x: 200, y: 100 });
    expect(sideAnchor(rect, 'bottom')).toEqual({ x: 100, y: 200 });
    expect(sideAnchor(rect, 'left')).toEqual({ x: 0, y: 100 });
  });

  // TC-11: an end whose object is gone draws at its fallback - the point the
  // arrow had been using - and nothing throws. This is the state a board is in
  // while a colleague's delete has arrived and the local drag did not notice.
  it('TC-11 resolves an orphaned attached end at its fallback without throwing', () => {
    const doc = setup();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), BY)!;
    const c = connectorOf(doc, id);

    // B is no longer on the board (its rect is not in the map); A still is.
    const rects = rectsById(doc);
    rects.delete('g_never_there');
    const bRect = rects.get(b);
    expect(bRect).toBeDefined();
    rects.delete(b!);
    const ends = { from: c.from, to: { kind: 'attached', objectId: 'g_deleted', fallback: { x: 300, y: 250 } } as Endpoint };
    const resolved = resolveEndpoints(ends, rects);

    expect(resolved.to).toEqual({ x: 300, y: 250 }); // exactly the fallback
    expect(resolved.from).toEqual(sideAnchor(rects.get(a)!, 'right')); // the live side still anchors
    expect(Number.isFinite(resolved.from.x)).toBe(true);
  });

  // An arrow follows a move without a single write: the resolved end is a
  // function of the CURRENT rectangles only.
  it('follows a moved object with no write on the connector at all', () => {
    const doc = setup();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), BY)!;
    const before = objectsSnapshot(doc).find((o) => o.id === id)!;
    expect(objectBounds(before).x).toBeCloseTo(200, 6);

    const updates = updateCounter(doc);
    // B is dragged well below A: now A's BOTTOM faces it and B's TOP faces A.
    moveObject(doc, b, 300, 400);
    expect(updates()).toBe(1); // only B's move

    const after = connectorOf(doc, id);
    const ends = resolveEndpoints({ from: after.from, to: after.to }, rectsById(doc));
    expect(ends.from).toEqual({ x: 100, y: 200 }); // A's bottom midpoint
    expect(ends.to).toEqual({ x: 400, y: 400 }); // B's top midpoint
    // The stored attachment did not change.
    expect(after.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 100 } });
  });

  // TC-14: hit-testing an arrow is a distance to its centre line, in world
  // units, and the product's tolerance is 6 SCREEN pixels (divided by the zoom
  // by the registry's hit test, tested in the component tests).
  it('TC-14 measures the distance to the arrow at 0, 5.99 and 6.01 units', () => {
    const doc = setup();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), BY)!;
    const ends = resolveEndpoints(connectorOf(doc, id), rectsById(doc));
    expect(ends.from).toEqual({ x: 200, y: 100 });
    expect(ends.to).toEqual({ x: 300, y: 100 });

    expect(distanceToPolyline([ends.from, ends.to], { x: 250, y: 100 })).toBe(0);
    expect(distanceToPolyline([ends.from, ends.to], { x: 250, y: 105.99 })).toBeCloseTo(5.99, 6);
    expect(distanceToPolyline([ends.from, ends.to], { x: 250, y: 106.01 })).toBeCloseTo(6.01, 6);
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBe(6);
    expect(CONNECTOR_MIN_LENGTH_WORLD).toBe(8);
  });
});

describe('connector.model setConnectorEndpoint', () => {
  // TC-12: an end can be let go (attached -> free at a point), aimed at a new
  // object (free -> attached, stored with the anchor it now uses), and is
  // refused when it is aimed at the object the OTHER end already hangs on.
  it('TC-12 detaches, re-attaches, and refuses the object at the other end', () => {
    const doc = setup();
    const { a, b } = twoShapes(doc);
    const c = createShape(doc, { kind: 'ellipse', rect: { x: 700, y: 0, width: 200, height: 200 }, at: { x: 0, y: 0 } }, BY)!;
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), BY)!;
    const updates = updateCounter(doc);

    // 1. let the far end go free at a point
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 500, y: 400 })).toBe(true);
    expect(updates()).toBe(1);
    expect(getConnectorEnds(doc, id)!.to).toEqual({ kind: 'free', x: 500, y: 400 });

    // 2. aim it at a new object; the stored fallback becomes the anchor it uses
    expect(setConnectorEndpoint(doc, id, 'to', attached(c, { x: 0, y: 0 }))).toBe(true);
    expect(updates()).toBe(2);
    expect(getConnectorEnds(doc, id)!.to).toEqual({ kind: 'attached', objectId: c, fallback: { x: 700, y: 100 } });

    // 3. aim it at the object the OTHER end hangs on: refused, no transaction
    expect(setConnectorEndpoint(doc, id, 'to', attached(a, { x: 5, y: 5 }))).toBe(false);
    expect(updates()).toBe(2);
    expect(getConnectorEnds(doc, id)!.to).toEqual({ kind: 'attached', objectId: c, fallback: { x: 700, y: 100 } });

    // 4. a malformed end, a wrong end name, a stale id, a no-op are all refused
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: Number.NaN, y: 1 } as never)).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'middle' as never, { kind: 'free', x: 1, y: 1 } as never)).toBe(false);
    expect(setConnectorEndpoint(doc, 'g_stale', 'to', { kind: 'free', x: 1, y: 1 })).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', attached(c, { x: 700, y: 100 }))).toBe(false); // already there
    expect(updates()).toBe(2);
  });

  // TC-29: a connector deleted while its handle was being dragged ends the
  // interaction: false, and nothing is written to the doc.
  it('TC-29 refuses an endpoint of a connector that was deleted meanwhile', () => {
    const doc = setup();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), BY)!;
    deleteObjects(doc, [id]);
    const updates = updateCounter(doc);

    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 40, y: 40 })).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', attached(a, { x: 1, y: 1 }))).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('connector.model detach on delete', () => {
  // TC-13: deleting a shape that arrows hang on rewrites their ends INSIDE the
  // same transaction: one update event for the whole thing, the object gone, and
  // the end now free at the anchor the arrow was drawing at.
  it('TC-13 frees the attached ends in the same transaction as the delete', () => {
    const doc = setup();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), BY)!;
    expect(resolveEndpoints(connectorOf(doc, id), rectsById(doc)).from).toEqual({ x: 200, y: 100 });

    const updates = updateCounter(doc);
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(updates()).toBe(1); // ONE update event: objects and ends arrive together

    const ids = objectsSnapshot(doc).map((o) => o.id);
    expect(ids).not.toContain(a);
    expect(ids).toContain(id);
    const c = connectorOf(doc, id);
    expect(c.from).toEqual({ kind: 'free', x: 200, y: 100 }); // A's right-side anchor
    expect(c.to.kind).toBe('attached');
    // The arrow still draws, between the freed point and B's live anchor.
    const ends = resolveEndpoints(c, rectsById(doc));
    expect(ends).toEqual({ from: { x: 200, y: 100 }, to: { x: 300, y: 100 } });
  });

  // A delete that touches no arrow writes no arrow at all; and a connector is
  // deleted as an object like any other.
  it('writes nothing for connectors that were not attached to the deleted objects', () => {
    const doc = setup();
    const { a } = twoShapes(doc);
    const id = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 90, y: 0 }, BY)!;
    const updates = updateCounter(doc);

    expect(deleteObjects(doc, [a])).toBe(1);
    expect(updates()).toBe(1);
    expect(getConnectorEnds(doc, id)).toEqual({
      from: { kind: 'free', x: 0, y: 0 },
      to: { kind: 'free', x: 90, y: 0 },
    });
    // Both ends free: the arrow is not attached to anything and stays put.
    expect(resolveEndpoints(connectorOf(doc, id), rectsById(doc))).toEqual({
      from: { x: 0, y: 0 },
      to: { x: 90, y: 0 },
    });
    expect(deleteObjects(doc, [id])).toBe(1);
  });

  // detachConnectorsTo is exported for the delete path, and standalone it does
  // the same job in its own transaction (it never throws for an empty list).
  it('detaches nothing for an empty id list, and detaches both ends of a doubly attached arrow', () => {
    const doc = setup();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), BY)!;
    const updates = updateCounter(doc);

    detachConnectorsTo(doc, []);
    detachConnectorsTo(doc, ['g_never_there']);
    expect(updates()).toBe(0);

    detachConnectorsTo(doc, [a, b]);
    expect(updates()).toBe(1);
    expect(getConnectorEnds(doc, id)).toEqual({
      from: { kind: 'free', x: 200, y: 100 },
      to: { kind: 'free', x: 300, y: 100 },
    });
    // ...and the objects themselves are still there: detaching is not deleting.
    expect(objectsSnapshot(doc).map((o) => o.id)).toContain(a);
  });

  // An arrow may hang on another arrow (the PRD allows any board object as a
  // target); its own box is derived too, so the second arrow has something to
  // hang on.
  it('lets an arrow attach to an arrow, resolving through both', () => {
    const doc = setup();
    const { a, b } = twoShapes(doc);
    const first = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), BY)!;
    const second = createConnector(doc, attached(first, { x: 250, y: 100 }), { kind: 'free', x: 250, y: 400 }, BY);

    expect(second).toBeTypeOf('string');
    const boxes = new Map(objectsSnapshot(doc).map((o) => [o.id, objectBounds(o)]));
    expect(boxes.get(first)).toEqual({ x: 200, y: 100, width: 100, height: 1e-6 });
    // The second arrow starts at the first arrow's box: its anchor is a side of
    // THAT box, which is a real rect, so nothing is NaN anywhere.
    const ends = resolveEndpoints(connectorOf(doc, second!), rectsById(doc));
    expect(Number.isFinite(ends.from.x) && Number.isFinite(ends.from.y)).toBe(true);
    expect(ends.to).toEqual({ x: 250, y: 400 });
  });
});
