// connector.model (TC-07 to TC-14, TC-29): arrows, their geometry and detach-on-delete.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  deleteObjects,
  initDoc,
  moveObjects,
  objectRects,
  objectsSnapshot,
} from '../../src/shared/board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  type ConnectorSnap,
  type Endpoint,
  createConnector,
  setConnectorEndpoint,
} from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc) {
  const counter = { n: 0 };
  doc.on('update', () => counter.n++);
  return counter;
}

function shapeAt(doc: Y.Doc, rect: Rect) {
  return createShape(doc, { kind: 'rect', rect, at: { x: rect.x, y: rect.y } }, 'g')!;
}

const connectorOf = (doc: Y.Doc, id: string) =>
  objectsSnapshot(doc).find((o) => o.id === id) as ConnectorSnap | undefined;
const attached = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });

/** A at (0,0) 100x100 and B 300 to its right. */
function twoShapes() {
  const doc = freshDoc();
  const a = shapeAt(doc, { x: 0, y: 0, width: 100, height: 100 });
  const b = shapeAt(doc, { x: 400, y: 0, width: 100, height: 100 });
  return { doc, a, b };
}

describe('connector.model createConnector', () => {
  it('TC-07 attached to attached stores both ends with fallbacks at the facing side midpoints', () => {
    const { doc, a, b } = twoShapes();
    const updates = countUpdates(doc);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    const id = createConnector(doc, attached(a), attached(b), 'g_test')!;
    expect(id).toEqual(expect.any(String));
    expect(updates.n).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    const c = connectorOf(doc, id)!;
    expect(c.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(c.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } });
    // The box is derived from the resolved ends; the arrow is on top.
    expect(c).toMatchObject({ type: 'connector', x: 100, y: 50, width: 300, height: 0, z: 3 });
    expect((doc.getMap('objects').get(id) as Y.Map<unknown>).get('createdBy')).toBe('g_test');
  });

  it('TC-08 both ends on the same object creates nothing', () => {
    const { doc, a } = twoShapes();
    const updates = countUpdates(doc);
    expect(createConnector(doc, attached(a), attached(a), 'g')).toBeNull();
    expect(updates.n).toBe(0);
  });

  it('TC-09 free ends 7.9 apart create nothing; exactly the minimum length creates an arrow', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    expect(createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0), 'g')).toBeNull();
    expect(updates.n).toBe(0);
    const id = createConnector(doc, free(0, 0), free(0, CONNECTOR_MIN_LENGTH_WORLD), 'g')!;
    expect(connectorOf(doc, id)).toMatchObject({ from: free(0, 0), to: free(0, CONNECTOR_MIN_LENGTH_WORLD) });
    expect(updates.n).toBe(1);
  });

  it('rejects invalid ends and ends on an arrow', () => {
    const { doc, a, b } = twoShapes();
    const arrow = createConnector(doc, attached(a), attached(b), 'g')!;
    const updates = countUpdates(doc);
    expect(createConnector(doc, free(Number.NaN, 0), free(100, 0), 'g')).toBeNull();
    expect(createConnector(doc, free(0, 0), attached(arrow), 'g')).toBeNull();
    expect(updates.n).toBe(0);
  });
});

describe('connector.model geometry', () => {
  it('TC-10 the nearest side switches from right to top at the diagonal', () => {
    const a: Rect = { x: -50, y: -50, width: 100, height: 100 };
    const at = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      // Board y grows downwards: 90° is straight up.
      return { x: 300 * Math.cos(rad), y: -300 * Math.sin(rad) };
    };
    expect([0, 44, 46, 90].map((d) => nearestSide(a, at(d)))).toEqual(['right', 'right', 'top', 'top']);
    expect(nearestSide(a, { x: -300, y: 10 })).toBe('left');
    expect(nearestSide(a, { x: 10, y: 300 })).toBe('bottom');
    expect(sideAnchor(a, 'top')).toEqual({ x: 0, y: -50 });
    expect(sideAnchor(a, 'left')).toEqual({ x: -50, y: 0 });
    expect(connectorBBox({ x: 10, y: 50 }, { x: -5, y: 20 })).toEqual({ x: -5, y: 20, width: 15, height: 30 });
  });

  it('arrows follow moves and switch sides with no writes to the arrow', () => {
    const { doc, a, b } = twoShapes();
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    // B moves below A.
    moveObjects(doc, new Map([[b, { x: 0, y: 400 }]]));
    const ends = resolveEndpoints(connectorOf(doc, id)!, objectRects(doc));
    expect(ends).toEqual({ from: { x: 50, y: 100 }, to: { x: 50, y: 400 } });
  });

  it('TC-11 an end whose object is missing is drawn at its fallback without throwing', () => {
    const { doc, a, b } = twoShapes();
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    const c = connectorOf(doc, id)!;
    const rects = objectRects(doc);
    rects.delete(b);
    expect(resolveEndpoints(c, rects)).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    // B removed without detaching (a concurrent remote delete): the snapshot still reads.
    doc.transact(() => doc.getMap('objects').delete(b), 'remote');
    expect(connectorOf(doc, id)).toMatchObject({ x: 100, y: 50, width: 300, height: 0 });
  });

  it('TC-14 distanceToPolyline gives exact distances around a segment', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: -6.01 })).toBeCloseTo(6.01, 10);
    // Beyond the end: distance to the end point.
    expect(distanceToPolyline(line, { x: 103, y: 4 })).toBeCloseTo(5, 10);
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Infinity);
  });
});

describe('connector.model setConnectorEndpoint', () => {
  it('TC-12 frees an end, attaches it to another object, and rejects the object at the other end', () => {
    const { doc, a, b } = twoShapes();
    const c3 = shapeAt(doc, { x: 0, y: 400, width: 100, height: 100 });
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    const updates = countUpdates(doc);

    expect(setConnectorEndpoint(doc, id, 'to', free(600, 300))).toBe(true);
    expect(connectorOf(doc, id)!.to).toEqual(free(600, 300));
    expect(updates.n).toBe(1);

    expect(setConnectorEndpoint(doc, id, 'to', attached(c3))).toBe(true);
    expect(connectorOf(doc, id)!.to).toEqual({ kind: 'attached', objectId: c3, fallback: { x: 50, y: 400 } });
    expect(updates.n).toBe(2);

    expect(setConnectorEndpoint(doc, id, 'to', attached(a))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', attached('missing'))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', attached(id))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', free(Infinity, 0))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', attached(c3))).toBe(false);
    expect(updates.n).toBe(2);
  });

  it('TC-29 a deleted connector id is rejected', () => {
    const { doc, a, b } = twoShapes();
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    deleteObjects(doc, [id]);
    const updates = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', free(0, 500))).toBe(false);
    expect(updates.n).toBe(0);
  });

  it('an orphaned end is normalised to a free end at its fallback on the next write', () => {
    const { doc, a, b } = twoShapes();
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    doc.transact(() => doc.getMap('objects').delete(b), 'remote');
    expect(setConnectorEndpoint(doc, id, 'from', free(0, 300))).toBe(true);
    expect(connectorOf(doc, id)).toMatchObject({ from: free(0, 300), to: free(400, 50) });
  });
});

describe('connector.model delete target', () => {
  it('TC-13 deleting an attached object frees that end at its anchor in exactly one update', () => {
    const { doc, a, b } = twoShapes();
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    const updates = countUpdates(doc);
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(updates.n).toBe(1);
    expect(objectsSnapshot(doc).some((o) => o.id === a)).toBe(false);
    const c = connectorOf(doc, id)!;
    expect(c.from).toEqual(free(100, 50));
    expect(c.to).toMatchObject({ kind: 'attached', objectId: b });
  });

  it('deleting an arrow together with its objects leaves nothing behind', () => {
    const { doc, a, b } = twoShapes();
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    expect(deleteObjects(doc, [a, b, id])).toBe(3);
    expect(objectsSnapshot(doc)).toHaveLength(0);
  });

  it('moving an arrow moves only its free ends', () => {
    const { doc, a } = twoShapes();
    const id = createConnector(doc, attached(a), free(300, 300), 'g')!;
    const before = connectorOf(doc, id)!;
    expect(moveObjects(doc, new Map([[id, { x: before.x + 10, y: before.y + 20 }]]))).toBe(1);
    const after = connectorOf(doc, id)!;
    expect(after.to).toEqual(free(310, 320));
    expect(after.from).toMatchObject({ kind: 'attached', objectId: a });
  });
});
