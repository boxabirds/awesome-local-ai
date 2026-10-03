// Connector object model (story 10): create, re-attach, detach-on-delete.
// Shared by the client now; framework-free.

import * as Y from 'yjs';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
} from '../config';
import { LOCAL_ORIGIN, getObjects, getMaxZ } from '../board-model';
import {
  type Endpoint,
  sideAnchor,
  nearestSide,
} from '../geometry/connector-geometry';
import type { Point, Rect } from '../geometry';

export type { Endpoint };

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isFinitePoint(p: Point): boolean {
  return isFiniteNum(p.x) && isFiniteNum(p.y);
}

function isFiniteRect(r: Rect): boolean {
  return isFiniteNum(r.x) && isFiniteNum(r.y) && isFiniteNum(r.width) && isFiniteNum(r.height);
}

/**
 * Get the rect of an object from the doc (for fallback computation).
 */
function getObjRect(doc: Y.Doc, id: string): Rect | null {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return null;
  const x = obj.get('x');
  const y = obj.get('y');
  const w = obj.get('width');
  const h = obj.get('height');
  if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(w) || !isFiniteNum(h)) return null;
  return { x, y, width: w, height: h };
}

/**
 * Resolve an endpoint to a world point for length computation.
 */
function resolveEndpointPoint(ep: Endpoint, doc: Y.Doc, otherEp?: Endpoint): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = getObjRect(doc, ep.objectId);
  if (!rect) return { x: ep.fallback.x, y: ep.fallback.y };
  // Aim toward the other endpoint
  const aim = otherEp
    ? (otherEp.kind === 'free' ? { x: otherEp.x, y: otherEp.y } : otherEp.fallback)
    : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const side = nearestSide(rect, aim);
  return sideAnchor(rect, side);
}

/**
 * Create a new connector between two endpoints.
 * Returns the new id, or null if:
 * - both ends attach to the same object
 * - the resolved length is below CONNECTOR_MIN_LENGTH_WORLD
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  // Reject self-connection
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Validate finiteness
  if (from.kind === 'free' && !isFinitePoint(from)) return null;
  if (to.kind === 'free' && !isFinitePoint(to)) return null;

  // Compute resolved length
  const fp = resolveEndpointPoint(from, doc, to);
  const tp = resolveEndpointPoint(to, doc, from);
  const len = Math.hypot(tp.x - fp.x, tp.y - fp.y);
  if (len < CONNECTOR_MIN_LENGTH_WORLD) return null;

  // Compute fallbacks
  let fromFallback: Point;
  let toFallback: Point;

  if (from.kind === 'attached') {
    const rect = getObjRect(doc, from.objectId);
    if (rect) {
      const aim = to.kind === 'free' ? to : to.fallback;
      fromFallback = sideAnchor(rect, nearestSide(rect, aim));
    } else {
      fromFallback = from.fallback;
    }
  } else {
    fromFallback = { x: from.x, y: from.y };
  }

  if (to.kind === 'attached') {
    const rect = getObjRect(doc, to.objectId);
    if (rect) {
      const aim = from.kind === 'free' ? from : from.fallback;
      toFallback = sideAnchor(rect, nearestSide(rect, aim));
    } else {
      toFallback = to.fallback;
    }
  } else {
    toFallback = { x: to.x, y: to.y };
  }

  // Store with computed fallbacks
  const fromStorable: Endpoint = from.kind === 'attached'
    ? { kind: 'attached', objectId: from.objectId, fallback: fromFallback }
    : from;
  const toStorable: Endpoint = to.kind === 'attached'
    ? { kind: 'attached', objectId: to.objectId, fallback: toFallback }
    : to;

  const id = crypto.randomUUID();

  doc.transact(() => {
    const objects = getObjects(doc);
    const conn = new Y.Map();
    conn.set('type', 'connector');
    conn.set('x', 0);
    conn.set('y', 0);
    conn.set('width', 0);
    conn.set('height', 0);
    conn.set('from', new Y.Map(Object.entries({
      kind: fromStorable.kind,
      ...(fromStorable.kind === 'attached'
        ? { objectId: fromStorable.objectId, fallback: new Y.Map(Object.entries(fromStorable.fallback)) }
        : { x: fromStorable.x, y: fromStorable.y }),
    })));
    conn.set('to', new Y.Map(Object.entries({
      kind: toStorable.kind,
      ...(toStorable.kind === 'attached'
        ? { objectId: toStorable.objectId, fallback: new Y.Map(Object.entries(toStorable.fallback)) }
        : { x: toStorable.x, y: toStorable.y }),
    })));
    conn.set('z', getMaxZ(doc) + 1);
    conn.set('createdAt', Date.now());
    conn.set('createdBy', by);
    objects.set(id, conn);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set one endpoint of a connector.
 * Returns true if applied, false if:
 * - the connector id is stale
 * - the new endpoint attaches to the object at the opposite end
 * - the point is non-finite
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  // Validate finiteness
  if (e.kind === 'free' && !isFinitePoint(e)) return false;

  // Check opposite end
  const oppositeKey = end === 'from' ? 'to' : 'from';
  const opposite = obj.get(oppositeKey) as Y.Map<unknown> | undefined;
  if (opposite && e.kind === 'attached') {
    const oppObjId = opposite.get('objectId');
    if (oppObjId === e.objectId) return false; // same object at both ends
  }

  // Compute fallback
  let fallback: Point;
  if (e.kind === 'attached') {
    const rect = getObjRect(doc, e.objectId);
    if (rect) {
      const aim = opposite
        ? (opposite.get('kind') === 'free'
          ? { x: opposite.get('x') as number, y: opposite.get('y') as number }
          : { x: (opposite.get('fallback') as Y.Map<unknown>).get('x') as number, y: (opposite.get('fallback') as Y.Map<unknown>).get('y') as number })
        : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      fallback = sideAnchor(rect, nearestSide(rect, aim));
    } else {
      fallback = e.fallback;
    }
  } else {
    fallback = { x: e.x, y: e.y };
  }

  const storable: Endpoint = e.kind === 'attached'
    ? { kind: 'attached', objectId: e.objectId, fallback }
    : e;

  doc.transact(() => {
    const endpointMap = new Y.Map();
    if (storable.kind === 'attached') {
      endpointMap.set('kind', 'attached');
      endpointMap.set('objectId', storable.objectId);
      const fb = new Y.Map();
      fb.set('x', storable.fallback.x);
      fb.set('y', storable.fallback.y);
      endpointMap.set('fallback', fb);
    } else {
      endpointMap.set('kind', 'free');
      endpointMap.set('x', storable.x);
      endpointMap.set('y', storable.y);
    }
    obj.set(end, endpointMap);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Detach all connector endpoints that are attached to any of `deletedIds`.
 * Each attached end becomes a free end at its current anchor point.
 * Must be called inside an open transaction (the caller's transaction).
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const deletedSet = new Set(deletedIds);
  const objects = getObjects(doc);

  objects.forEach((obj, id) => {
    if (obj.get('type') !== 'connector') return;

    for (const end of ['from', 'to'] as const) {
      const ep = obj.get(end) as Y.Map<unknown> | undefined;
      if (!ep) continue;
      if (ep.get('kind') !== 'attached') continue;
      const targetId = ep.get('objectId') as string;
      if (!deletedSet.has(targetId)) continue;

      // Get the current anchor (fallback)
      const fallback = ep.get('fallback') as Y.Map<unknown> | undefined;
      const fx = fallback ? (fallback.get('x') as number) : 0;
      const fy = fallback ? (fallback.get('y') as number) : 0;

      // Convert to free endpoint
      const newEp = new Y.Map();
      newEp.set('kind', 'free');
      newEp.set('x', fx);
      newEp.set('y', fy);
      obj.set(end, newEp);
    }
  });
}
