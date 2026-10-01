// src/shared/objects/connector.ts
// Connector (arrow) object schema helpers: create, set endpoint, detach on delete.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Point } from '../geometry';
import { sideAnchor, nearestSide, type Endpoint } from '../geometry/connector-geometry';
import type { Rect } from '../geometry';

export type { Endpoint };

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });
  return maxZ;
}

function isFiniteCoord(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function resolveEndpointPoint(ep: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = rects.get(ep.objectId);
  if (!rect) return { x: ep.fallback.x, y: ep.fallback.y };
  // For length calculation, use the centre of the target
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Creates a connector between two endpoints.
 * Returns null if:
 * - both ends attach to the same object
 * - the resolved length is less than CONNECTOR_MIN_LENGTH_WORLD
 * - any coordinate is non-finite
 *
 * Fallbacks are computed from the current rects at creation time.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  // Validate: both endpoints must have finite coordinates
  if (from.kind === 'free' && !isFiniteCoord(from.x, from.y)) return null;
  if (to.kind === 'free' && !isFiniteCoord(to.x, to.y)) return null;

  // Self-connection check
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Build a rects map from the doc for fallback calculation and length check
  const objects = getObjects(doc);
  const rects = new Map<string, Rect>();
  objects.forEach((obj, id) => {
    const x = (obj.get('x') as number) ?? 0;
    const y = (obj.get('y') as number) ?? 0;
    const w = (obj.get('width') as number) ?? 0;
    const h = (obj.get('height') as number) ?? 0;
    rects.set(id, { x, y, width: w, height: h });
  });

  // Compute resolved points for length check
  const fromPoint = resolveEndpointPoint(from, rects);
  const toPoint = resolveEndpointPoint(to, rects);
  const length = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);

  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  // Compute fallbacks for attached endpoints
  const fromWithFallback = computeFallback(from, to, rects);
  const toWithFallback = computeFallback(to, from, rects);

  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;

  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'connector');
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('from', { ...fromWithFallback });
    obj.set('to', { ...toWithFallback });
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

function computeFallback(ep: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (ep.kind === 'free') return ep;

  const targetRect = rects.get(ep.objectId);
  if (!targetRect) return ep;

  // Determine the other endpoint's point for direction
  const otherPoint = resolveEndpointPoint(other, rects);
  const side = nearestSide(targetRect, otherPoint);
  const fallback = sideAnchor(targetRect, side);

  return { kind: 'attached', objectId: ep.objectId, fallback };
}

/**
 * Sets one endpoint of a connector.
 * Returns false for:
 * - stale connector id
 * - attaching to the object at the opposite end
 * - non-finite free points
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  // Validate free endpoint coordinates
  if (e.kind === 'free' && !isFiniteCoord(e.x, e.y)) return false;

  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'connector') return false;

  // Check: cannot attach to the object at the opposite end
  const oppositeEnd = (end === 'from' ? 'to' : 'from') as 'from' | 'to';
  const opposite = obj.get(oppositeEnd) as Endpoint;
  if (e.kind === 'attached' && opposite.kind === 'attached' && e.objectId === opposite.objectId) {
    return false;
  }

  // Compute fallback
  const rects = new Map<string, Rect>();
  objects.forEach((o, oid) => {
    const x = (o.get('x') as number) ?? 0;
    const y = (o.get('y') as number) ?? 0;
    const w = (o.get('width') as number) ?? 0;
    const h = (o.get('height') as number) ?? 0;
    rects.set(oid, { x, y, width: w, height: h });
  });

  const newEp = computeFallback(e, opposite, rects);

  doc.transact(() => {
    obj.set(end, { ...newEp });
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Detaches all connector endpoints that reference the given deleted object ids.
 * Each attached endpoint becomes a free endpoint at its current anchor point.
 * Must be called inside an open transaction (the caller's transaction).
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const deletedSet = new Set(deletedIds);

  const objects = getObjects(doc);

  objects.forEach((obj) => {
    if (obj.get('type') !== 'connector') return;

    for (const end of ['from', 'to'] as const) {
      const ep = obj.get(end) as Endpoint;
      if (ep.kind === 'attached' && deletedSet.has(ep.objectId)) {
        // Convert to free at the fallback point
        obj.set(end, { kind: 'free', x: ep.fallback.x, y: ep.fallback.y });
      }
    }
  });
}
