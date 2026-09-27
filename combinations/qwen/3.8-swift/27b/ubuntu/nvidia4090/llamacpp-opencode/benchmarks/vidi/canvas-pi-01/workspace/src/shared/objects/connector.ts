// Connector (arrow) object model (see spec: connector.model).
//
// A connector is a board object of type 'connector':
//   objects/<id>: Y.Map {
//     type: 'connector', x, y, width, height (stored 0; derived in snapshot),
//     z, createdAt, createdBy, from: Endpoint, to: Endpoint
//   }
//
// Endpoint = { kind: 'attached', objectId, fallback: Point }
//          | { kind: 'free', x, y }
//
// The endpoints' anchor points are resolved at render/snapshot time from the
// live object rectangles (connector-geometry), so moves and resizes by anyone
// redraw attached arrows without writes; deletions detach ends inside the
// same transaction (detachConnectorsTo, called by story 7's deleteObjects).
//
// board-model imports this module (deleteObjects → detachConnectorsTo) and
// this module imports board-model (LOCAL_ORIGIN), so this file's top level
// must stay free of side effects that touch board-model state: 'connector'
// is added to the model's known types from board-model itself.

import * as Y from 'yjs';
import {
  type Endpoint,
  endpointAnchorFor,
  isEndpoint,
  parseEndpoint,
  resolveEndpoints,
} from '../geometry/connector-geometry';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  STICKY_SIZE_WORLD,
} from '../config';
import {
  LOCAL_ORIGIN,
  type ObjectSnapshot,
} from '../board-model';
import type { Rect } from '../geometry';

export type { Endpoint } from '../geometry/connector-geometry';

/** A connector object (ObjectSnapshot with both endpoints present). */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** Highest z among all objects (0 when the board is empty). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const object of objects(doc).values()) {
    const z = object.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

/**
 * The live rect of every attachable object (every known object except
 * connectors; stickies without explicit size use STICKY_SIZE_WORLD).
 */
export function objectRects(doc: Y.Doc): ReadonlyMap<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [id, object] of objects(doc)) {
    if (object.get('type') === 'connector') continue;
    const x = object.get('x');
    const y = object.get('y');
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = object.get('width');
    const h = object.get('height');
    rects.set(id, {
      x,
      y,
      width: typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : STICKY_SIZE_WORLD,
      height: typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : STICKY_SIZE_WORLD,
    });
  }
  return rects;
}

/** Store an endpoint in a Y.Map, normalising attached fallbacks. */
function storeEndpoint(object: Y.Map<unknown>, key: 'from' | 'to', e: Endpoint, rects: ReadonlyMap<string, Rect>, other: Endpoint): void {
  if (e.kind === 'free') {
    object.set(key, { kind: 'free', x: e.x, y: e.y });
    return;
  }
  const rect = rects.get(e.objectId);
  const fallback = endpointAnchorFor(rect, other, rects, e.fallback);
  object.set(key, { kind: 'attached', objectId: e.objectId, fallback });
}

/**
 * Create a connector between two endpoints (attached objects and/or free
 * board points). Returns the new id; null (no transaction) when both ends
 * attach to the same object, the resolved length is below
 * CONNECTOR_MIN_LENGTH_WORLD, or an endpoint is malformed. Attached ends are
 * normalised: their fallback is recomputed as the current side anchor
 * toward the other end. One LOCAL_ORIGIN transaction on success.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null; // self-connection (connector.no_accidental)
  }
  const rects = objectRects(doc);
  const resolved = resolveEndpoints({ from, to }, rects);
  const length = Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const id = crypto.randomUUID();
  doc.transact(() => {
    const object = new Y.Map();
    object.set('type', 'connector');
    // x/y/width/height are derived in snapshot() from the resolved
    // endpoints; the stored values keep isValidObject happy.
    object.set('x', 0);
    object.set('y', 0);
    object.set('width', 0);
    object.set('height', 0);
    storeEndpoint(object, 'from', from, rects, to);
    storeEndpoint(object, 'to', to, rects, from);
    object.set('z', maxZ(doc) + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', by);
    objects(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Re-attach or detach one end of a connector (handle drag). Returns false
 * (no transaction) for a stale id, a malformed endpoint, non-finite points,
 * or attaching to the object the other end is already attached to.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  if (!isEndpoint(e)) return false;
  const object = objects(doc).get(id);
  if (object === undefined || object.get('type') !== 'connector') return false;
  const otherRaw = object.get(end === 'from' ? 'to' : 'from');
  const other = parseEndpoint(otherRaw);
  if (other === null) return false;
  if (e.kind === 'attached' && other.kind === 'attached' && e.objectId === other.objectId) {
    return false; // an end never attaches to the object at the other end
  }
  const rects = objectRects(doc);
  doc.transact(() => {
    storeEndpoint(object, end, e, rects, other);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detach every connector end that is attached to one of `deletedIds`, fixing
 * it free at its current anchor. MUST be called inside an open transaction
 * (story 7's deleteObjects) so the whole delete is one update.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const deleted = new Set(deletedIds);
  const rects = objectRects(doc); // before the objects are removed
  for (const object of objects(doc).values()) {
    if (object.get('type') !== 'connector') continue;
    for (const end of ['from', 'to'] as const) {
      const e = parseEndpoint(object.get(end));
      if (e === null || e.kind !== 'attached' || !deleted.has(e.objectId)) continue;
      const other = parseEndpoint(object.get(end === 'from' ? 'to' : 'from'));
      const anchor =
        other === null ? e.fallback : endpointAnchorFor(rects.get(e.objectId), other, rects, e.fallback);
      object.set(end, { kind: 'free', x: anchor.x, y: anchor.y });
    }
  }
}
