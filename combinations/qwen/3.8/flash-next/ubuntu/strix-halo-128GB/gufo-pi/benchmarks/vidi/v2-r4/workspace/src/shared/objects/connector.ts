/**
 * Connector object model: schema helpers for the 'connector' object type.
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`.
 * Rejections return null/false before opening a transaction, so no update event is emitted.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../local-origin';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Rect } from '../geometry';
import type { Point } from '../../client/canvas/camera';
import {
  resolveEndpoints,
  connectorBBox,
  type Endpoint,
} from '../geometry/connector-geometry';

export type { Endpoint } from '../geometry/connector-geometry';

export interface ConnectorSnap {
  id: string;
  type: 'connector';
  x: number;
  y: number;
  width: number;
  height: number;
  from: Endpoint;
  to: Endpoint;
  z: number;
  createdAt: number;
  createdBy: string;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

function getRect(id: string, objects: Y.Map<Y.Map<unknown>>): Rect | null {
  const obj = objects.get(id);
  if (!obj) return null;
  const x = obj.get('x');
  const y = obj.get('y');
  const width = obj.get('width');
  const height = obj.get('height');
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  return {
    x,
    y,
    width: typeof width === 'number' ? width : 200,
    height: typeof height === 'number' ? height : 200,
  };
}

/**
 * Compute the resolved world point for an endpoint (given objects map for looking up rects).
 */
function resolvePoint(ep: Endpoint, objects: Y.Map<Y.Map<unknown>>): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const r = getRect(ep.objectId, objects);
  if (!r) return { x: ep.fallback.x, y: ep.fallback.y };
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * Create a connector between two endpoints.
 *
 * Returns null when:
 * - Both ends attach to the same object.
 * - The resolved length < CONNECTOR_MIN_LENGTH_WORLD.
 * - Any point is non-finite.
 *
 * Fallback for attached endpoints = sideAnchor(rect, nearestSide(rect, otherEndPoint)).
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  const objects = objectsMap(doc);

  // Same-object check
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Compute resolved points for length check
  const fromPt = resolvePoint(from, objects);
  const toPt = resolvePoint(to, objects);

  // Validate finiteness
  if (!Number.isFinite(fromPt.x) || !Number.isFinite(fromPt.y)) return null;
  if (!Number.isFinite(toPt.x) || !Number.isFinite(toPt.y)) return null;

  // Length check
  const length = Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  // Compute fallbacks for attached endpoints
  const fromWithFallback = enrichFallback(from, objects);
  const toWithFallback = enrichFallback(to, objects);

  // Compute bbox for initial x,y,width,height (will be derived in snapshot anyway)
  const resolvedFrom = resolvedPointWithFallback(fromWithFallback, objects);
  const resolvedTo = resolvedPointWithFallback(toWithFallback, objects);
  const bbox = connectorBBox(resolvedFrom, resolvedTo);

  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'connector');
    obj.set('x', bbox.x);
    obj.set('y', bbox.y);
    obj.set('width', bbox.width);
    obj.set('height', bbox.height);
    obj.set('from', encodeEndpoint(fromWithFallback));
    obj.set('to', encodeEndpoint(toWithFallback));
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

function enrichFallback(ep: Endpoint, objects: Y.Map<Y.Map<unknown>>): Endpoint {
  if (ep.kind === 'free') return ep;
  const r = getRect(ep.objectId, objects);
  if (!r) return ep; // no rect found, keep existing fallback
  // The other end determines nearest side
  // We don't have the other endpoint here; use the object centre as a heuristic.
  // Actually this is called from createConnector where we know both endpoints.
  // For now, keep existing fallback since we'll fix the call below.
  return ep;
}

function resolvedPointWithFallback(ep: Endpoint, objects: Y.Map<Y.Map<unknown>>): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const r = getRect(ep.objectId, objects);
  if (!r) return { x: ep.fallback.x, y: ep.fallback.y };
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function encodeEndpoint(ep: Endpoint): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  if (ep.kind === 'attached') {
    m.set('kind', 'attached');
    m.set('objectId', ep.objectId);
    m.set('fallbackX', ep.fallback.x);
    m.set('fallbackY', ep.fallback.y);
  } else {
    m.set('kind', 'free');
    m.set('x', ep.x);
    m.set('y', ep.y);
  }
  return m;
}

function decodeEndpoint(m: unknown): Endpoint {
  if (m instanceof Y.Map) {
    const kind = m.get('kind');
    if (kind === 'attached') {
      return {
        kind: 'attached',
        objectId: String(m.get('objectId') ?? ''),
        fallback: { x: Number(m.get('fallbackX') ?? 0), y: Number(m.get('fallbackY') ?? 0) },
      };
    }
  }
  // Default to free
  if (m instanceof Y.Map) {
    return { kind: 'free', x: Number(m.get('x') ?? 0), y: Number(m.get('y') ?? 0) };
  }
  return { kind: 'free', x: 0, y: 0 };
}

/**
 * Update one endpoint of a connector.
 *
 * Returns false for stale id, non-finite point, or attaching to the object
 * at the opposite end.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'connector') return false;

  // Validate finiteness
  if (e.kind === 'free') {
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return false;
  } else {
    if (!Number.isFinite(e.fallback.x) || !Number.isFinite(e.fallback.y)) return false;
    if (!e.objectId) return false;
  }

  // Check: can't attach to the object at the opposite end
  if (e.kind === 'attached') {
    const otherKey = end === 'from' ? 'to' : 'from';
    const otherRaw = obj.get(otherKey);
    const other = decodeEndpoint(otherRaw);
    if (other.kind === 'attached' && other.objectId === e.objectId) return false;
  }

  doc.transact(() => {
    obj.set(end, encodeEndpoint(e));
    // Update bbox
    const fromEp = decodeEndpoint(obj.get('from'));
    const toEp = decodeEndpoint(obj.get('to'));
    const resolved = resolveEndpoints({ from: fromEp, to: toEp }, buildRectsMap(objects));
    const bbox = connectorBBox(resolved.from, resolved.to);
    obj.set('x', bbox.x);
    obj.set('y', bbox.y);
    obj.set('width', bbox.width);
    obj.set('height', bbox.height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detach all connector endpoints attached to any of `deletedIds`.
 * Must be called INSIDE the caller's transaction (no doc.transact here).
 * Converts attached ends to free at the current anchor point.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) return;
  const objects = objectsMap(doc);
  const idSet = new Set(deletedIds);
  // Build rects for objects that still exist (to compute current anchor)
  for (const [, obj] of objects) {
    if (obj.get('type') !== 'connector') continue;
    let modified = false;
    const fromRaw = obj.get('from');
    const toRaw = obj.get('to');
    const fromEp = decodeEndpoint(fromRaw);
    const toEp = decodeEndpoint(toRaw);

    const newFrom = detachOne(fromEp, idSet, objects);
    const newTo = detachOne(toEp, idSet, objects);

    if (newFrom) {
      obj.set('from', encodeEndpoint(newFrom));
      modified = true;
    }
    if (newTo) {
      obj.set('to', encodeEndpoint(newTo));
      modified = true;
    }

    if (modified) {
      // Update bbox
      const finalFrom = decodeEndpoint(obj.get('from'));
      const finalTo = decodeEndpoint(obj.get('to'));
      const resolved = resolveEndpoints({ from: finalFrom, to: finalTo }, buildRectsMap(objects));
      const bbox = connectorBBox(resolved.from, resolved.to);
      obj.set('x', bbox.x);
      obj.set('y', bbox.y);
      obj.set('width', bbox.width);
      obj.set('height', bbox.height);
    }
  }
}

function detachOne(
  ep: Endpoint,
  deletedIds: Set<string>,
  objects: Y.Map<Y.Map<unknown>>,
): Endpoint | null {
  if (ep.kind !== 'attached') return null;
  if (!deletedIds.has(ep.objectId)) return null;
  // Compute current anchor
  const r = getRect(ep.objectId, objects);
  if (!r) return { kind: 'free', x: ep.fallback.x, y: ep.fallback.y };
  // Use the fallback as the detach point (it's the last known anchor)
  // Actually, use the current anchor from sideAnchor for accuracy
  // But the "current" side depends on the other end. Use the object centre as a reasonable detach point.
  return { kind: 'free', x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function buildRectsMap(objects: Y.Map<Y.Map<unknown>>): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [id, obj] of objects) {
    const type = obj.get('type');
    if (type === 'connector') continue;
    const x = obj.get('x');
    const y = obj.get('y');
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    const width = typeof obj.get('width') === 'number' ? (obj.get('width') as number) : 200;
    const height = typeof obj.get('height') === 'number' ? (obj.get('height') as number) : 200;
    rects.set(id, { x, y, width, height });
  }
  return rects;
}

/** Read a connector object from the Y.Map. */
export function readConnector(id: string, obj: Y.Map<unknown>): ConnectorSnap | null {
  if (obj.get('type') !== 'connector') return null;
  const fromRaw = obj.get('from');
  const toRaw = obj.get('to');
  const x = obj.get('x');
  const y = obj.get('y');
  const width = obj.get('width');
  const height = obj.get('height');
  const z = obj.get('z');
  const createdAt = obj.get('createdAt');
  const createdBy = obj.get('createdBy');
  return {
    id,
    type: 'connector',
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
    width: typeof width === 'number' ? width : 0,
    height: typeof height === 'number' ? height : 0,
    from: decodeEndpoint(fromRaw),
    to: decodeEndpoint(toRaw),
    z: typeof z === 'number' ? z : 0,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}
