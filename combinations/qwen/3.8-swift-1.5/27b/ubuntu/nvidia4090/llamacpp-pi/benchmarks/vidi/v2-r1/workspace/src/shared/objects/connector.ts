/**
 * Story 10: connector (arrow) object model.
 *
 * Schema (per object id in the `objects` Y.Map):
 * ```
 * Y.Map {
 *   type: 'connector', x: 0, y: 0, width: 0, height: 0,
 *   z, createdAt, createdBy,
 *   from: Endpoint, to: Endpoint
 * }
 * ```
 *
 * Endpoint = { kind: 'attached', objectId: string, fallback: { x, y } }
 *          | { kind: 'free', x: number, y: number }
 *
 * x/y/width/height are stored as 0 and derived in snapshot() via
 * connectorBBox(resolveEndpoints(...)).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';
import { sideAnchor, nearestSide } from '../geometry/connector-geometry';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

/** Cast a generic snapshot to its connector flavour. */
export function asConnector(snap: ObjectSnapshot): ConnectorSnap {
  return snap as ConnectorSnap;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getMaxZ(doc: Y.Doc): number {
  let maxZ = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  return maxZ;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Get the rect of an object from the doc (for computing fallback anchors).
 */
function getObjRect(doc: Y.Doc, id: string): Rect | null {
  const obj = objectsMap(doc).get(id);
  if (!obj) return null;
  const x = obj.get('x') as number;
  const y = obj.get('y') as number;
  const w = obj.get('width') as number;
  const h = obj.get('height') as number;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  return { x, y, width: w, height: h };
}

/**
 * Resolve an endpoint to a concrete point given the doc (for fallback
 * computation at creation time).
 */
function resolveEndpointPoint(doc: Y.Doc, ep: Endpoint, other: Point): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = getObjRect(doc, ep.objectId);
  if (!rect) return { ...ep.fallback };
  const side = nearestSide(rect, other);
  return sideAnchor(rect, side);
}

/**
 * Create a connector between two endpoints.
 *
 * Rejects (returns null, no transaction):
 * - Both ends attached to the same object
 * - Resolved length < CONNECTOR_MIN_LENGTH_WORLD
 * - Non-finite free points
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  // Validate free endpoints
  if (from.kind === 'free' && !isFinitePoint({ x: from.x, y: from.y })) return null;
  if (to.kind === 'free' && !isFinitePoint({ x: to.x, y: to.y })) return null;

  // Reject self-connection
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;

  // Compute resolved points for length check and fallback
  const toPoint = resolveEndpointPoint(doc, to, { x: 0, y: 0 });

  // Recompute with proper "toward" for each endpoint
  const fromResolved = from.kind === 'free'
    ? { x: from.x, y: from.y }
    : resolveEndpointPoint(doc, from, toPoint);
  const toResolved = to.kind === 'free'
    ? { x: to.x, y: to.y }
    : resolveEndpointPoint(doc, to, fromResolved);

  const length = Math.hypot(toResolved.x - fromResolved.x, toResolved.y - fromResolved.y);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  // Compute fallbacks
  const fromFallback = from.kind === 'attached'
    ? resolveEndpointPoint(doc, from, toResolved)
    : { x: from.x, y: from.y };
  const toFallback = to.kind === 'attached'
    ? resolveEndpointPoint(doc, to, fromResolved)
    : { x: to.x, y: to.y };

  const finalFrom: Endpoint = from.kind === 'attached'
    ? { kind: 'attached', objectId: from.objectId, fallback: fromFallback }
    : { kind: 'free', x: from.x, y: from.y };
  const finalTo: Endpoint = to.kind === 'attached'
    ? { kind: 'attached', objectId: to.objectId, fallback: toFallback }
    : { kind: 'free', x: to.x, y: to.y };

  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set('type', 'connector');
  obj.set('x', 0);
  obj.set('y', 0);
  obj.set('width', 0);
  obj.set('height', 0);
  obj.set('z', getMaxZ(doc) + 1);
  obj.set('createdAt', Date.now());
  obj.set('createdBy', by);
  obj.set('from', finalFrom);
  obj.set('to', finalTo);

  doc.transact(() => {
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set one endpoint of a connector.
 * Returns false for: stale id, non-finite free point, attaching to the
 * object at the opposite end.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'connector') return false;

  if (e.kind === 'free' && !isFinitePoint({ x: e.x, y: e.y })) return false;

  // Check if attaching to the opposite end's object
  const otherEnd = obj.get(end === 'from' ? 'to' : 'from') as Endpoint | undefined;
  if (e.kind === 'attached' && otherEnd?.kind === 'attached' && e.objectId === otherEnd.objectId) {
    return false;
  }

  doc.transact(() => {
    obj.set(end, e);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Detach all connector ends attached to any of `deletedIds`.
 * Must be called inside an open transaction (the caller's).
 * Each attached end becomes free at the current anchor point.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const deletedSet = new Set(deletedIds);
  const objects = objectsMap(doc);

  objects.forEach((obj) => {
    if (obj.get('type') !== 'connector') return;
    for (const end of ['from', 'to'] as const) {
      const ep = obj.get(end) as Endpoint | undefined;
      if (ep?.kind === 'attached' && deletedSet.has(ep.objectId)) {
        // Convert to free at the fallback point
        obj.set(end, { kind: 'free', x: ep.fallback.x, y: ep.fallback.y });
      }
    }
  });
}

/**
 * Resolve connector endpoints to concrete points given a map of object
 * rects. Attached ends are placed at the nearest side anchor; if the target
 * is missing (orphaned), the fallback point is used.
 */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  function resolveOne(ep: Endpoint, other: Point): Point {
    if (ep.kind === 'free') return { x: ep.x, y: ep.y };
    const rect = rects.get(ep.objectId);
    if (!rect) return { x: ep.fallback.x, y: ep.fallback.y };
    const side = nearestSide(rect, other);
    return sideAnchor(rect, side);
  }

  // Two-pass: resolve each endpoint knowing where the other will be.
  // First pass: use fallbacks for the "other" direction.
  const fromApprox = c.from.kind === 'free'
    ? { x: c.from.x, y: c.from.y }
    : { x: c.from.fallback.x, y: c.from.fallback.y };
  const toApprox = c.to.kind === 'free'
    ? { x: c.to.x, y: c.to.y }
    : { x: c.to.fallback.x, y: c.to.fallback.y };

  const from = resolveOne(c.from, toApprox);
  const to = resolveOne(c.to, fromApprox);

  return { from, to };
}

/**
 * Bounding box of a line from `from` to `to`.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return {
    x,
    y,
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
