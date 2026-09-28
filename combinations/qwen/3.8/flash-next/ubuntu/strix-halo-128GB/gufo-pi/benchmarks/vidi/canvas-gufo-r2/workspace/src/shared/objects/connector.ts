/**
 * Connector object model (story 10).
 *
 * Schema: type 'connector', x, y, width, height (all 0, derived in snapshot),
 *         z, createdAt, createdBy, from: Endpoint, to: Endpoint
 *
 * Endpoint = { kind: 'attached', objectId: string, fallback: { x, y } }
 *          | { kind: 'free', x: number, y: number }
 *
 * All mutations go through `doc.transact(fn, LOCAL_ORIGIN)`.
 */
import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import type { Point, Rect } from '../geometry';
import { nearestSide, sideAnchor } from '../geometry/connector-geometry';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

function getObjectRect(objects: Y.Map<Y.Map<unknown>>, id: string): Rect | null {
  const obj = objects.get(id);
  if (!obj) return null;
  const x = obj.get('x') as number;
  const y = obj.get('y') as number;
  const width = obj.get('width') as number | undefined;
  const height = obj.get('height') as number | undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, width: width ?? 200, height: height ?? 200 };
}

function endpointToPoint(
  ep: Endpoint,
  objects: Y.Map<Y.Map<unknown>>,
): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = getObjectRect(objects, ep.objectId);
  if (!rect) return { x: ep.fallback.x, y: ep.fallback.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Create a connector between two endpoints.
 * Returns null if both ends attach to the same object, or the resolved length
 * is below CONNECTOR_MIN_LENGTH_WORLD.
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

  // Compute length using current positions
  const objects = getObjects(doc);
  const fromPt = endpointToPoint(from, objects);
  const toPt = endpointToPoint(to, objects);
  const length = Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  // Validate finiteness of all endpoint data
  if (from.kind === 'free' && (!Number.isFinite(from.x) || !Number.isFinite(from.y))) return null;
  if (to.kind === 'free' && (!Number.isFinite(to.x) || !Number.isFinite(to.y))) return null;
  if (from.kind === 'attached' && (!Number.isFinite(from.fallback.x) || !Number.isFinite(from.fallback.y))) return null;
  if (to.kind === 'attached' && (!Number.isFinite(to.fallback.x) || !Number.isFinite(to.fallback.y))) return null;

  const id = crypto.randomUUID();
  const z = maxZ(objects) + 1;

  doc.transact(() => {
    if (objects.has(id)) return;
    const yMap = new Y.Map();
    objects.set(id, yMap);
    yMap.set('type', 'connector');
    yMap.set('x', 0);
    yMap.set('y', 0);
    yMap.set('width', 0);
    yMap.set('height', 0);
    yMap.set('z', z);
    yMap.set('createdAt', Date.now());
    yMap.set('createdBy', by);
    yMap.set('from', from);
    yMap.set('to', to);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Update a single endpoint of a connector.
 * Returns false for stale id, non-finite points, or attaching to the object
 * at the opposite end.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'connector') return false;

  // Validate finiteness
  if (e.kind === 'free' && (!Number.isFinite(e.x) || !Number.isFinite(e.y))) return false;
  if (e.kind === 'attached' && (!Number.isFinite(e.fallback.x) || !Number.isFinite(e.fallback.y))) return false;

  // Check attaching to the opposite end's object
  if (e.kind === 'attached') {
    const otherKey = end === 'from' ? 'to' : 'from';
    const otherEp = obj.get(otherKey) as Endpoint | undefined;
    if (otherEp && otherEp.kind === 'attached' && otherEp.objectId === e.objectId) {
      return false;
    }
  }

  doc.transact(() => {
    obj.set(end, e);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Inside an open transaction, detach all connector endpoints that are attached
 * to any of the given ids. Each attached endpoint becomes `free` at its current
 * anchor point.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  const objects = getObjects(doc);
  const deletedSet = new Set(deletedIds);

  // Collect rects for anchors before deletion happens
  const rects = new Map<string, Rect>();
  objects.forEach((obj, id) => {
    if (deletedSet.has(id)) {
      const x = obj.get('x') as number;
      const y = obj.get('y') as number;
      const width = (obj.get('width') as number) ?? 200;
      const height = (obj.get('height') as number) ?? 200;
      rects.set(id, { x, y, width, height });
    }
  });

  objects.forEach((obj) => {
    if (obj.get('type') !== 'connector') return;
    const changed = { v: false };
    const from = obj.get('from') as Endpoint | undefined;
    const to = obj.get('to') as Endpoint | undefined;

    if (from && from.kind === 'attached' && deletedSet.has(from.objectId)) {
      const rect = rects.get(from.objectId);
      if (rect) {
        // Compute the current anchor before detachment
        let otherPoint: Point;
        if (to && to.kind === 'attached') {
          const otherObj = objects.get(to.objectId);
          if (otherObj) {
            const ox = otherObj.get('x') as number;
            const oy = otherObj.get('y') as number;
            const ow = (otherObj.get('width') as number) ?? 200;
            const oh = (otherObj.get('height') as number) ?? 200;
            otherPoint = { x: ox + ow / 2, y: oy + oh / 2 };
          } else {
            otherPoint = to.fallback;
          }
        } else if (to && to.kind === 'free') {
          otherPoint = { x: to.x, y: to.y };
        } else {
          otherPoint = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
        const anchor = sideAnchor(rect, nearestSide(rect, otherPoint));
        obj.set('from', { kind: 'free', x: anchor.x, y: anchor.y });
        changed.v = true;
      } else {
        obj.set('from', { kind: 'free', x: from.fallback.x, y: from.fallback.y });
        changed.v = true;
      }
    }

    if (to && to.kind === 'attached' && deletedSet.has(to.objectId)) {
      const rect = rects.get(to.objectId);
      if (rect) {
        let otherPoint: Point;
        if (from && from.kind === 'attached') {
          const otherObj = objects.get(from.objectId);
          if (otherObj) {
            const ox = otherObj.get('x') as number;
            const oy = otherObj.get('y') as number;
            const ow = (otherObj.get('width') as number) ?? 200;
            const oh = (otherObj.get('height') as number) ?? 200;
            otherPoint = { x: ox + ow / 2, y: oy + oh / 2 };
          } else {
            otherPoint = from.fallback;
          }
        } else if (from && from.kind === 'free') {
          otherPoint = { x: from.x, y: from.y };
        } else {
          otherPoint = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
        const anchor = sideAnchor(rect, nearestSide(rect, otherPoint));
        obj.set('to', { kind: 'free', x: anchor.x, y: anchor.y });
        changed.v = true;
      } else {
        obj.set('to', { kind: 'free', x: to.fallback.x, y: to.fallback.y });
        changed.v = true;
      }
    }
  });
}

/** Serialise an endpoint for Y.Map storage. */
export function endpointToPlain(ep: Endpoint): Record<string, unknown> {
  if (ep.kind === 'free') return { kind: 'free', x: ep.x, y: ep.y };
  return { kind: 'attached', objectId: ep.objectId, fallback: { x: ep.fallback.x, y: ep.fallback.y } };
}

/** Deserialize an endpoint from Y.Map storage. */
export function endpointFromPlain(v: unknown): Endpoint | null {
  if (!v || typeof v !== 'object') return null;
  const obj = v as Record<string, unknown>;
  if (obj.kind === 'free') {
    return { kind: 'free', x: obj.x as number, y: obj.y as number };
  }
  if (obj.kind === 'attached') {
    const fb = obj.fallback as { x: number; y: number };
    return { kind: 'attached', objectId: obj.objectId as string, fallback: { x: fb.x, y: fb.y } };
  }
  return null;
}
