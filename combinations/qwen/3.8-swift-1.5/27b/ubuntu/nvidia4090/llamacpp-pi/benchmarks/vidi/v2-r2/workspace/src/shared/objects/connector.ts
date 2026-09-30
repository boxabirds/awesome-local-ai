/**
 * Connector object model (story 10, connector.model).
 *
 * Schema:
 *   objects/<id>: Y.Map {
 *     type: 'connector', x: 0, y: 0, width: 0, height: 0, z, createdAt, createdBy,
 *     from: Endpoint,
 *     to: Endpoint
 *   }
 *
 * Endpoint = { kind: 'attached', objectId: string, fallback: { x, y } }
 *          | { kind: 'free', x: number, y: number }
 *
 * x/y/width/height are stored as 0 and derived in snapshot() via
 * connectorBBox(resolveEndpoints(...)).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
} from '../config';
import type { Point, Rect } from '../geometry';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints as resolveEndpointsGeo,
  type ConnectorEndpointSnap,
} from '../geometry/connector-geometry';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: ConnectorEndpointSnap;
  to: ConnectorEndpointSnap;
}

type ObjectMap = Y.Map<unknown>;

function objects(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap('objects') as Y.Map<ObjectMap>;
}

function isConnector(obj: ObjectMap | undefined): obj is ObjectMap {
  return !!obj && obj.get('type') === 'connector';
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Reads an endpoint from a Y.Map. Returns null if malformed.
 */
function readEndpoint(map: ObjectMap, key: 'from' | 'to'): Endpoint | null {
  const ep = map.get(key);
  if (!ep || typeof ep !== 'object') return null;
  const e = ep as Record<string, unknown>;
  if (e.kind === 'attached') {
    if (typeof e.objectId !== 'string') return null;
    const fb = e.fallback as Point | undefined;
    return { kind: 'attached', objectId: e.objectId, fallback: fb ?? { x: 0, y: 0 } };
  }
  if (e.kind === 'free') {
    if (typeof e.x !== 'number' || typeof e.y !== 'number') return null;
    return { kind: 'free', x: e.x, y: e.y };
  }
  return null;
}

/**
 * Gets the current rect of an object from the doc (for computing fallbacks).
 * Returns null if the object doesn't exist or has no valid bounds.
 */
function getRect(doc: Y.Doc, id: string): Rect | null {
  const obj = objects(doc).get(id);
  if (!obj) return null;
  const x = obj.get('x');
  const y = obj.get('y');
  const w = obj.get('width');
  const h = obj.get('height');
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  // For stickies without explicit width/height, use default
  const width = typeof w === 'number' && Number.isFinite(w) ? w : 200;
  const height = typeof h === 'number' && Number.isFinite(h) ? h : 200;
  return { x, y, width, height };
}

/**
 * Computes the fallback anchor point for an attached endpoint: the midpoint
 * of the side of `targetRect` nearest to `otherPoint`.
 */
function computeFallback(targetRect: Rect, otherPoint: Point): Point {
  const side = nearestSide(targetRect, otherPoint);
  return sideAnchor(targetRect, side);
}

/**
 * Creates a connector between two endpoints.
 *
 * Returns null when:
 * - both ends attach to the same object
 * - the resolved length is < CONNECTOR_MIN_LENGTH_WORLD
 *
 * One LOCAL_ORIGIN transaction on success.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  // Validate: both ends attached to the same object → reject
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Compute resolved points for length check
  const fromPoint = from.kind === 'free'
    ? { x: from.x, y: from.y }
    : computeFallbackFromDoc(doc, from);
  const toPoint = to.kind === 'free'
    ? { x: to.x, y: to.y }
    : computeFallbackFromDoc(doc, to);

  if (!fromPoint || !toPoint) return null;

  const length = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  // Compute proper fallbacks using the other endpoint's position
  const fromFallback = from.kind === 'attached'
    ? computeFallbackBetween(doc, from.objectId, toPoint)
    : null;
  const toFallback = to.kind === 'attached'
    ? computeFallbackBetween(doc, to.objectId, fromPoint)
    : null;

  const finalFrom: Endpoint = from.kind === 'attached'
    ? { kind: 'attached', objectId: from.objectId, fallback: fromFallback! }
    : from;
  const finalTo: Endpoint = to.kind === 'attached'
    ? { kind: 'attached', objectId: to.objectId, fallback: toFallback! }
    : to;

  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'connector');
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    if (finalFrom.kind === 'attached') {
      obj.set('from', { kind: 'attached', objectId: finalFrom.objectId, fallback: finalFrom.fallback });
    } else {
      obj.set('from', { kind: 'free', x: finalFrom.x, y: finalFrom.y });
    }
    if (finalTo.kind === 'attached') {
      obj.set('to', { kind: 'attached', objectId: finalTo.objectId, fallback: finalTo.fallback });
    } else {
      obj.set('to', { kind: 'free', x: finalTo.x, y: finalTo.y });
    }
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

function computeFallbackFromDoc(doc: Y.Doc, ep: Endpoint): Point | null {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = getRect(doc, ep.objectId);
  if (!rect) return null;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { x: cx, y: cy };
}

function computeFallbackBetween(doc: Y.Doc, objectId: string, otherPoint: Point): Point {
  const rect = getRect(doc, objectId);
  if (!rect) return { ...otherPoint };
  return computeFallback(rect, otherPoint);
}

/**
 * Sets one endpoint of a connector.
 *
 * Returns false for:
 * - stale id (connector doesn't exist)
 * - attaching to the object at the opposite end
 * - non-finite free points
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const obj = objects(doc).get(id);
  if (!isConnector(obj)) return false;

  // Validate free endpoint
  if (e.kind === 'free' && (!Number.isFinite(e.x) || !Number.isFinite(e.y))) return false;

  // Get the opposite endpoint to check for self-connection
  const oppositeKey = end === 'from' ? 'to' : 'from';
  const opposite = readEndpoint(obj, oppositeKey);
  if (opposite && e.kind === 'attached' && opposite.kind === 'attached' && opposite.objectId === e.objectId) {
    return false;
  }

  // Compute fallback
  let finalEndpoint: Endpoint;
  if (e.kind === 'attached') {
    const targetRect = getRect(doc, e.objectId);
    const otherPoint = opposite
      ? (opposite.kind === 'free'
          ? { x: opposite.x, y: opposite.y }
          : (() => { const r = getRect(doc, opposite.objectId); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { x: 0, y: 0 }; })())
      : { x: 0, y: 0 };
    const fallback = targetRect ? computeFallback(targetRect, otherPoint) : { x: 0, y: 0 };
    finalEndpoint = { kind: 'attached', objectId: e.objectId, fallback };
  } else {
    finalEndpoint = e;
  }

  doc.transact(() => {
    if (finalEndpoint.kind === 'attached') {
      obj.set(end, { kind: 'attached', objectId: finalEndpoint.objectId, fallback: finalEndpoint.fallback });
    } else {
      obj.set(end, { kind: 'free', x: finalEndpoint.x, y: finalEndpoint.y });
    }
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detaches all connector endpoints attached to any of the deleted object ids.
 * Must be called inside an open transaction (the caller's transaction).
 * Each affected endpoint becomes `free` at its current anchor point.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const deletedSet = new Set(deletedIds);
  const objs = objects(doc);
  const toUpdate: { id: string; obj: ObjectMap; from?: Endpoint; to?: Endpoint }[] = [];

  objs.forEach((obj, id) => {
    if (!isConnector(obj)) return;
    const from = readEndpoint(obj, 'from');
    const to = readEndpoint(obj, 'to');
    if (!from || !to) return;

    let newFrom: Endpoint | undefined;
    let newTo: Endpoint | undefined;

    if (from.kind === 'attached' && deletedSet.has(from.objectId)) {
      const rect = getRect(doc, from.objectId);
      const anchor = rect
        ? sideAnchor(rect, nearestSide(rect, to.kind === 'free' ? { x: to.x, y: to.y } : getCenter(doc, to.objectId)))
        : from.fallback;
      newFrom = { kind: 'free', x: anchor.x, y: anchor.y };
    }
    if (to.kind === 'attached' && deletedSet.has(to.objectId)) {
      const rect = getRect(doc, to.objectId);
      const anchor = rect
        ? sideAnchor(rect, nearestSide(rect, from.kind === 'free' ? { x: from.x, y: from.y } : getCenter(doc, from.objectId)))
        : to.fallback;
      newTo = { kind: 'free', x: anchor.x, y: anchor.y };
    }

    if (newFrom || newTo) {
      toUpdate.push({ id, obj, from: newFrom, to: newTo });
    }
  });

  for (const update of toUpdate) {
    if (update.from) {
      const f = update.from as { kind: 'free'; x: number; y: number };
      update.obj.set('from', { kind: 'free', x: f.x, y: f.y });
    }
    if (update.to) {
      const t = update.to as { kind: 'free'; x: number; y: number };
      update.obj.set('to', { kind: 'free', x: t.x, y: t.y });
    }
  }
}

function getCenter(doc: Y.Doc, id: string): Point {
  const rect = getRect(doc, id);
  if (!rect) return { x: 0, y: 0 };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Resolves a connector's endpoints to world-space points given a map of
 * object rectangles. Used by the client for rendering.
 */
export function resolveConnectorEndpoints(
  from: ConnectorEndpointSnap,
  to: ConnectorEndpointSnap,
  rects: ReadonlyMap<string, Rect>
): { from: Point; to: Point } {
  return resolveEndpointsGeo({ from, to }, rects);
}
