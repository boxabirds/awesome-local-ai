/**
 * Arrows (story 10): straight connectors between objects or free board points.
 *
 *   objects/<id>: Y.Map {
 *     type: 'connector', x: 0, y: 0, width: 0, height: 0, z, createdAt, createdBy,
 *     from: Endpoint, to: Endpoint
 *   }
 *
 * Endpoints are plain JSON values (replaced whole on change). Attached ends store no side: the
 * snapshot resolves them from the objects' current rects (connector.follow). The stored box is
 * never read; the snapshot derives it from the ends.
 */
import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import {
  CONNECTOR_TYPE,
  detachConnectorsTo,
  docRects,
  LOCAL_ORIGIN,
  maxZ,
  objectOf,
  type ObjectSnapshot,
} from '../board-model';
import {
  attachedAnchor,
  isValidEndpoint,
  readEndpoint,
  rectCentre,
  resolveEndpoints,
  type Endpoint,
} from '../geometry/connector-geometry';
import type { Point, Rect } from '../geometry';

export { CONNECTOR_TYPE, detachConnectorsTo, type Endpoint };

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  width: number;
  height: number;
  from: Endpoint;
  to: Endpoint;
  fromPoint: Point;
  toPoint: Point;
}

export function isConnector(obj: ObjectSnapshot): obj is ConnectorSnap {
  return obj.type === CONNECTOR_TYPE && obj.from !== undefined && obj.to !== undefined;
}

/** Where a new end aims (for the other end's side): a free point or the object's centre. */
function aimOf(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r ? rectCentre(r) : e.fallback;
}

/** An attached end with its fallback set to where it attaches now (unchanged when the object is gone). */
function withFallback(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (e.kind !== 'attached') return e;
  const r = rects.get(e.objectId);
  if (!r) return e;
  return { kind: 'attached', objectId: e.objectId, fallback: attachedAnchor(r, aimOf(other, rects)) };
}

function length(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Creates an arrow from `from` to `to`, above every other object. Attached ends get their
 * fallback set to the side anchor they attach to now; an end whose object is already gone
 * (deleted concurrently) keeps the caller's fallback, where it is drawn. Null (no transaction)
 * when both ends attach to the same object, an endpoint is malformed, or the arrow would be
 * shorter than CONNECTOR_MIN_LENGTH_WORLD (connector.no_accidental).
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!isValidEndpoint(from) || !isValidEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;
  const rects = docRects(doc);
  const ends = { from: withFallback(from, to, rects), to: withFallback(to, from, rects) };
  const pts = resolveEndpoints(ends, rects);
  if (!(length(pts.from, pts.to) >= CONNECTOR_MIN_LENGTH_WORLD)) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    const z = maxZ(doc) + 1;
    doc.getMap<Y.Map<unknown>>('objects').set(id, obj);
    obj.set('type', CONNECTOR_TYPE);
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('from', ends.from);
    obj.set('to', ends.to);
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
  }, LOCAL_ORIGIN);
  return id;
}

/** Same object for attached ends (the fallback is only a cache), same point for free ones. */
function sameEnd(a: Endpoint, b: Endpoint): boolean {
  if (a.kind === 'attached' && b.kind === 'attached') return a.objectId === b.objectId;
  return a.kind === 'free' && b.kind === 'free' && a.x === b.x && a.y === b.y;
}

/**
 * Re-attaches (attached) or detaches (free) one end (connector.reattach). If the other end is
 * orphaned (its object vanished), it is normalised to a free end at its fallback in the same
 * transaction. False (no transaction) for stale ids, malformed or non-finite endpoints,
 * attaching to the object at the other end, and no-ops.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  if (!isValidEndpoint(e)) return false;
  const obj = objectOf(doc, id);
  if (!obj || obj.get('type') !== CONNECTOR_TYPE) return false;
  const otherKey = end === 'from' ? 'to' : 'from';
  const other = readEndpoint(obj.get(otherKey));
  if (!other) return false;
  if (e.kind === 'attached' && other.kind === 'attached' && other.objectId === e.objectId) return false;
  const rects = docRects(doc);
  const next = withFallback(e, other, rects);
  const current = readEndpoint(obj.get(end));
  if (current && sameEnd(current, next)) return false;
  const orphaned = other.kind === 'attached' && !rects.has(other.objectId);
  doc.transact(() => {
    obj.set(end, next);
    if (orphaned) obj.set(otherKey, { kind: 'free', x: other.fallback.x, y: other.fallback.y });
  }, LOCAL_ORIGIN);
  return true;
}
