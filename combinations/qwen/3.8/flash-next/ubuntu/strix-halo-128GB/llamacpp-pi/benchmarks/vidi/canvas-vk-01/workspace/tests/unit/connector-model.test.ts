import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import {
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectSnapshots,
  registerBoardObjectType,
} from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import {
  createConnector,
  setConnectorEndpoint,
  type ConnectorSnapshot,
  type Endpoint,
} from '../../src/shared/objects/connector';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Point, Rect } from '../../src/shared/geometry';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';

/**
 * Story 10 connector.model — endpoints, side anchors, detach and hit distance
 * against a real Y.Doc. Every case also asserts the number of document updates:
 * a rejected call must write nothing at all.
 */

// The model only serialises types the client registered; in the browser the
// object registry does this, in a node unit test we say it out loud.
registerBoardObjectType('shape');
registerBoardObjectType('connector');

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function countUpdates(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return () => count;
}

function connectorSnapshot(doc: Y.Doc, id: string): ConnectorSnapshot {
  const found = objectSnapshots(doc).find((obj) => obj.id === id);
  if (found === undefined || found.type !== 'connector') {
    throw new Error(`connector ${id} is missing from the snapshot`);
  }
  return found;
}

/** A shape at `rect`, returned id. */
function shapeAt(doc: Y.Doc, rect: Rect): string {
  const id = createShape(
    doc,
    { kind: 'rect', rect, at: { x: rect.x, y: rect.y } },
    'g_test',
  );
  if (id === null) throw new Error('fixture shape was rejected');
  return id;
}

/** Every object rectangle except `withoutId` — the "object vanished" case. */
function rectsWithout(doc: Y.Doc, withoutId: string): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const obj of objectSnapshots(doc)) {
    if (obj.id !== withoutId) rects.set(obj.id, objectBounds(obj));
  }
  return rects;
}

const attached = (objectId: string, fallback: Point): Endpoint => ({
  kind: 'attached',
  objectId,
  fallback,
});

describe('connector model (TC-07 to TC-14, TC-29)', () => {
  it('TC-07: an arrow between two shapes 300 apart stores both ends and their fallbacks', () => {
    const doc = freshDoc();
    const a = shapeAt(doc, { x: 0, y: 0, width: 100, height: 100 });
    const b = shapeAt(doc, { x: 300, y: 0, width: 100, height: 100 });

    const updates = countUpdates(doc);
    const id = createConnector(
      doc,
      attached(a, { x: 0, y: 0 }),
      attached(b, { x: 0, y: 0 }),
      'g_test',
    );
    expect(id).toBeTypeOf('string');
    expect(updates()).toBe(1);

    const raw = objectMap(doc).get(id!)!;
    const storedFrom = raw.get('from') as Endpoint;
    const storedTo = raw.get('to') as Endpoint;
    expect(storedFrom).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(storedTo).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } });

    const snap = connectorSnapshot(doc, id!);
    expect(snap.fromPoint).toEqual({ x: 100, y: 50 });
    expect(snap.toPoint).toEqual({ x: 300, y: 50 });
    // The object bounds are the box around the arrow, not the stored zeros.
    expect(objectBounds(snap)).toEqual({ x: 100, y: 50, width: 200, height: 0 });
    expect(raw.get('createdBy')).toBe('g_test');
  });

  it('TC-08: an arrow from an object to itself is rejected without a transaction', () => {
    const doc = freshDoc();
    const a = shapeAt(doc, { x: 0, y: 0, width: 100, height: 100 });
    const updates = countUpdates(doc);
    expect(createConnector(doc, attached(a, { x: 100, y: 50 }), attached(a, { x: 0, y: 50 }), 'g_test')).toBeNull();
    expect(objectMap(doc).size).toBe(1);
    expect(updates()).toBe(0);
  });

  it('TC-09: a free arrow shorter than CONNECTOR_MIN_LENGTH_WORLD is rejected, exactly on it is kept', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    expect(
      createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD - 0.1, y: 0 }, 'g_test'),
    ).toBeNull();
    expect(updates()).toBe(0);

    const id = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 }, 'g_test');
    expect(id).toBeTypeOf('string');
    expect(updates()).toBe(1);
    const snap = connectorSnapshot(doc, id!);
    expect(snap.fromPoint).toEqual({ x: 0, y: 0 });
    expect(snap.toPoint).toEqual({ x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 });
  });

  it('TC-09: an end released over empty space stays free, the other stays attached', () => {
    const doc = freshDoc();
    const a = shapeAt(doc, { x: 0, y: 0, width: 100, height: 100 });
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), { kind: 'free', x: 500, y: 40 }, 'g_test');
    const snap = connectorSnapshot(doc, id!);
    expect(snap.from.kind).toBe('attached');
    expect(snap.to).toEqual({ kind: 'free', x: 500, y: 40 });
    expect(snap.fromPoint).toEqual({ x: 100, y: 50 });
  });

  it('TC-10: nearestSide walks the sides as the other end orbits, switching on the diagonal', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const center: Point = { x: 50, y: 50 };
    const at = (degrees: number): Point => {
      const rad = (degrees * Math.PI) / 180;
      return { x: center.x + 300 * Math.cos(rad), y: center.y - 300 * Math.sin(rad) };
    };
    expect(nearestSide(rect, at(0))).toBe('right');
    expect(nearestSide(rect, at(44))).toBe('right');
    expect(nearestSide(rect, at(46))).toBe('top');
    expect(nearestSide(rect, at(90))).toBe('top');
    expect(nearestSide(rect, at(180))).toBe('left');
    expect(nearestSide(rect, at(270))).toBe('bottom');
    // Side anchors are side midpoints, on the boundary of every shape kind.
    expect(sideAnchor(rect, 'right')).toEqual({ x: 100, y: 50 });
    expect(sideAnchor(rect, 'top')).toEqual({ x: 50, y: 0 });
  });

  it('TC-10: an arrow follows a move by anyone and switches to the nearer side', () => {
    const doc = freshDoc();
    const a = shapeAt(doc, { x: 0, y: 0, width: 100, height: 100 });
    const b = shapeAt(doc, { x: 300, y: 0, width: 100, height: 100 });
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), 'g_test');

    expect(connectorSnapshot(doc, id!).fromPoint).toEqual({ x: 100, y: 50 });

    // Drag B to the left of A (a single write, B only — the arrow is untouched).
    moveObjects(doc, new Map([[b, { x: -300, y: 0 }]]));
    const after = connectorSnapshot(doc, id!);
    expect(after.fromPoint).toEqual({ x: 0, y: 50 });
    expect(after.toPoint).toEqual({ x: -200, y: 50 });
  });

  it('TC-11: an end whose object is gone renders at its stored fallback', () => {
    const doc = freshDoc();
    const a = shapeAt(doc, { x: 0, y: 0, width: 100, height: 100 });
    const b = shapeAt(doc, { x: 300, y: 0, width: 100, height: 100 });
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), 'g_test');
    const snap = connectorSnapshot(doc, id!);
    const fallback = (objectMap(doc).get(id!)!.get('to') as Endpoint & { fallback: Point }).fallback;
    expect(fallback).toEqual({ x: 300, y: 50 });

    const resolved = resolveEndpoints(snap, rectsWithout(doc, b));
    expect(resolved.from).toEqual({ x: 100, y: 50 });
    expect(resolved.to).toEqual(fallback);
  });

  it('TC-12: an end handle detaches to a point, re-attaches to another object, and refuses the other end', () => {
    const doc = freshDoc();
    const a = shapeAt(doc, { x: 0, y: 0, width: 100, height: 100 });
    const b = shapeAt(doc, { x: 300, y: 0, width: 100, height: 100 });
    const c = shapeAt(doc, { x: 0, y: 300, width: 100, height: 100 });
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), 'g_test');

    expect(setConnectorEndpoint(doc, id!, 'to', { kind: 'free', x: 500, y: 0 })).toBe(true);
    let snap = connectorSnapshot(doc, id!);
    expect(snap.to).toEqual({ kind: 'free', x: 500, y: 0 });
    expect(snap.toPoint).toEqual({ x: 500, y: 0 });

    expect(setConnectorEndpoint(doc, id!, 'to', attached(c, { x: 0, y: 0 }))).toBe(true);
    snap = connectorSnapshot(doc, id!);
    expect(snap.to.kind).toBe('attached');
    // C sits below A, so A's end moves to its bottom and C's to its top.
    expect(snap.fromPoint).toEqual({ x: 50, y: 100 });
    expect(snap.toPoint).toEqual({ x: 50, y: 300 });

    const updates = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id!, 'to', attached(a, { x: 0, y: 0 }))).toBe(false);
    expect(updates()).toBe(0);
    expect(connectorSnapshot(doc, id!).to.kind).toBe('attached');
  });

  it('TC-12: setConnectorEndpoint on a free start end attaches it', () => {
    const doc = freshDoc();
    const a = shapeAt(doc, { x: 0, y: 0, width: 100, height: 100 });
    const id = createConnector(doc, { kind: 'free', x: 500, y: 0 }, attached(a, { x: 0, y: 0 }), 'g_test');
    expect(setConnectorEndpoint(doc, id!, 'from', attached(a, { x: 0, y: 0 }))).toBe(false);
    const b = shapeAt(doc, { x: 500, y: 0, width: 100, height: 100 });
    expect(setConnectorEndpoint(doc, id!, 'from', attached(b, { x: 0, y: 0 }))).toBe(true);
    const snap = connectorSnapshot(doc, id!);
    expect(snap.from.kind).toBe('attached');
    expect(snap.fromPoint).toEqual({ x: 500, y: 50 });
  });

  it('TC-13: deleting an object keeps its arrows, end fixed where it was attached, in one update', () => {
    const doc = freshDoc();
    const a = shapeAt(doc, { x: 0, y: 0, width: 100, height: 100 });
    const b = shapeAt(doc, { x: 300, y: 0, width: 100, height: 100 });
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), 'g_test');

    const updates = countUpdates(doc);
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(updates()).toBe(1);

    expect(objectMap(doc).has(a)).toBe(false);
    const snap = connectorSnapshot(doc, id!);
    expect(snap.from).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(snap.fromPoint).toEqual({ x: 100, y: 50 });
    expect(snap.to.kind).toBe('attached');
    expect(snap.toPoint).toEqual({ x: 300, y: 50 });
    expect(b).toBeTruthy();
  });

  it('TC-13: deleting an arrow detaches nothing and stays one update', () => {
    const doc = freshDoc();
    const a = shapeAt(doc, { x: 0, y: 0, width: 100, height: 100 });
    const b = shapeAt(doc, { x: 300, y: 0, width: 100, height: 100 });
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), 'g_test');
    const updates = countUpdates(doc);
    expect(deleteObjects(doc, [id!])).toBe(1);
    expect(updates()).toBe(1);
    expect(objectMap(doc).size).toBe(2);
  });

  it('TC-14: hit distance to the arrow line is the perpendicular distance', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    // Beyond the ends the distance is to the nearest endpoint.
    expect(distanceToPolyline(line, { x: 130, y: 0 })).toBeCloseTo(30, 10);
    // A bend is measured to the closest segment.
    const elbow = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(distanceToPolyline(elbow, { x: 100, y: 50 })).toBe(0);
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBe(6);
  });

  it('TC-29: setConnectorEndpoint on a deleted connector returns false without a transaction', () => {
    const doc = freshDoc();
    const a = shapeAt(doc, { x: 0, y: 0, width: 100, height: 100 });
    const b = shapeAt(doc, { x: 300, y: 0, width: 100, height: 100 });
    const id = createConnector(doc, attached(a, { x: 0, y: 0 }), attached(b, { x: 0, y: 0 }), 'g_test');
    objectSnapshots(doc); // ensure the snapshot path has run at least once

    const updates = countUpdates(doc);
    expect(deleteObjects(doc, [id!])).toBe(1);
    expect(setConnectorEndpoint(doc, id!, 'to', { kind: 'free', x: 0, y: 0 })).toBe(false);
    expect(setConnectorEndpoint(doc, id!, 'from', attached(b, { x: 0, y: 0 }))).toBe(false);
    expect(updates()).toBe(1); // only the delete
  });

  it('connectorBBox covers the arrow in any direction', () => {
    expect(connectorBBox({ x: 10, y: 20 }, { x: 60, y: 80 })).toEqual({ x: 10, y: 20, width: 50, height: 60 });
    expect(connectorBBox({ x: 60, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 50, height: 60 });
  });

  it('a sticky is a valid arrow target (arrows connect any object)', () => {
    const doc = freshDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    const rect = objectBounds(objectSnapshots(doc).find((o) => o.id === stickyId)!);
    expect(rect.width).toBeGreaterThan(0);
    const id = createConnector(doc, attached(stickyId, { x: 0, y: 0 }), { kind: 'free', x: 500, y: 0 }, 'g_test');
    const snap = connectorSnapshot(doc, id!);
    expect(snap.fromPoint).toEqual({
      x: rect.x + rect.width,
      y: rect.y + rect.height / 2,
    });
  });
});
