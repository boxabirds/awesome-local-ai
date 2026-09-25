/**
 * Connector (arrow) object model (story 10, connector.model).
 *
 * A connector is a Y.Map under the board's `objects` map with:
 *   type: 'connector'
 *   x, y, width, height: stored as 0 (derived in snapshot via connectorBBox)
 *   from: Endpoint
 *   to: Endpoint
 *   z, createdAt, createdBy: standard fields
 *
 * Endpoint =
 *   { kind: 'attached', objectId: string, fallback: Point }
 * | { kind: 'free', x: number, y: number }
 *
 * Attached endpoints store no side. The side is recomputed from current
 * rectangles every render (nearestSide), which makes arrows switch sides
 * as objects move and follow remote moves without writes.
 */

import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import { getSessionId } from './text';
import type { Point } from '../../client/canvas/camera';
import { sideAnchor, nearestSide } from '../geometry/connector-geometry';
import type { Rect } from '../geometry';

// --- Types -----------------------------------------------------------------------

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

// --- Y.Map keys -------------------------------------------------------------------

const TYPE_KEY = 'type';
const X_KEY = 'x';
const Y_KEY = 'y';
const WIDTH_KEY = 'width';
const HEIGHT_KEY = 'height';
const FROM_KEY = 'from';
const TO_KEY = 'to';
const Z_KEY = 'z';
const CREATED_AT_KEY = 'createdAt';
const CREATED_BY_KEY = 'createdBy';
const OBJECTS_KEY = 'objects';
const CONNECTOR_TYPE = 'connector';

function objects(doc: Y.Doc): Y.Map<Y.Map<any>> {
  return doc.getMap(OBJECTS_KEY);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get(Z_KEY);
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

function getConnectorMap(doc: Y.Doc, id: string): Y.Map<any> | undefined {
  const obj = objects(doc).get(id);
  if (!obj || obj.get(TYPE_KEY) !== CONNECTOR_TYPE) return undefined;
  return obj;
}

// --- Helpers ----------------------------------------------------------------------

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Read an endpoint from a Y.Map value (stored as a plain embedded object). */
function readEndpoint(value: unknown): Endpoint | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.kind === 'free' && typeof v.x === 'number' && typeof v.y === 'number') {
    return { kind: 'free', x: v.x, y: v.y };
  }
  if (v.kind === 'attached' && typeof v.objectId === 'string') {
    const fb = v.fallback as Point | undefined;
    if (fb && typeof fb.x === 'number' && typeof fb.y === 'number') {
      return { kind: 'attached', objectId: v.objectId, fallback: fb };
    }
    return null;
  }
  return null;
}

/**
 * Resolve the current anchor point for an endpoint, given the live rects map.
 * Used by detachConnectorsTo to fix the endpoint at the current position.
 */
function currentAnchor(
  ep: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = rects.get(ep.objectId);
  if (rect === undefined) return { x: ep.fallback.x, y: ep.fallback.y };
  // We need the other end's point to determine the side; for detach we use
  // the rect's centre as a reasonable "toward" point.
  const centre: Point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  // Use the fallback as the "toward" point for side selection.
  const side = nearestSide(rect, ep.fallback);
  return sideAnchor(rect, side);
}

// --- Mutations --------------------------------------------------------------------

/**
 * Create a connector between two endpoints.
 *
 * Rejections (return null, no transaction):
 *  - both ends attached to the same object
 *  - resolved length < CONNECTOR_MIN_LENGTH_WORLD
 *  - non-finite free points
 *
 * On success: one LOCAL_ORIGIN transaction. The stored `fallback` for each
 * attached end is `sideAnchor(rect, nearestSide(rect, otherCentre))`.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
): string | null {
  // Validate free points.
  if (from.kind === 'free' && !isFinitePoint(from)) return null;
  if (to.kind === 'free' && !isFinitePoint(to)) return null;

  // Self-connection rejection.
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Compute the resolved endpoints for length check.
  // We need the rects of the attached objects to compute anchors.
  const rects = new Map<string, Rect>();
  const allIds = new Set<string>();
  if (from.kind === 'attached') allIds.add(from.objectId);
  if (to.kind === 'attached') allIds.add(to.objectId);

  const objMap = objects(doc);
  for (const id of allIds) {
    const obj = objMap.get(id);
    if (obj) {
      const x = obj.get(X_KEY);
      const y = obj.get(Y_KEY);
      const w = obj.get(WIDTH_KEY);
      const h = obj.get(HEIGHT_KEY);
      if (typeof x === 'number' && typeof y === 'number' && typeof w === 'number' && typeof h === 'number') {
        rects.set(id, { x, y, width: w, height: h });
      }
    }
  }

  // Resolve the from and to points.
  const fromPoint = resolveEndpointForLength(from, to, rects);
  const toPoint = resolveEndpointForLength(to, from, rects);

  const length = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  // Compute fallbacks.
  const fromFallback = computeFallback(from, to, rects, doc);
  const toFallback = computeFallback(to, from, rects, doc);

  const finalFrom: Endpoint = from.kind === 'attached'
    ? { kind: 'attached', objectId: from.objectId, fallback: fromFallback }
    : from;
  const finalTo: Endpoint = to.kind === 'attached'
    ? { kind: 'attached', objectId: to.objectId, fallback: toFallback }
    : to;

  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set(TYPE_KEY, CONNECTOR_TYPE);
  obj.set(X_KEY, 0);
  obj.set(Y_KEY, 0);
  obj.set(WIDTH_KEY, 0);
  obj.set(HEIGHT_KEY, 0);
  obj.set(FROM_KEY, finalFrom);
  obj.set(TO_KEY, finalTo);
  obj.set(Z_KEY, maxZ(doc) + 1);
  obj.set(CREATED_AT_KEY, Date.now());
  obj.set(CREATED_BY_KEY, getSessionId());

  doc.transact(() => {
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/** Resolve an endpoint to a point for length checking. */
function resolveEndpointForLength(
  ep: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = rects.get(ep.objectId);
  if (rect === undefined) {
    // Object not found: use the fallback (or centre as last resort).
    return { x: ep.fallback.x, y: ep.fallback.y };
  }
  // Determine the side based on the other endpoint.
  const otherPoint: Point = other.kind === 'free'
    ? { x: other.x, y: other.y }
    : (() => {
        const otherRect = rects.get(other.objectId);
        if (otherRect === undefined) return { x: other.fallback.x, y: other.fallback.y };
        return { x: otherRect.x + otherRect.width / 2, y: otherRect.y + otherRect.height / 2 };
      })();
  const side = nearestSide(rect, otherPoint);
  return sideAnchor(rect, side);
}

/** Compute the fallback anchor for an attached endpoint. */
function computeFallback(
  ep: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
  _doc: Y.Doc,
): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = rects.get(ep.objectId);
  if (rect === undefined) {
    return { x: ep.fallback.x, y: ep.fallback.y };
  }
  const otherPoint: Point = other.kind === 'free'
    ? { x: other.x, y: other.y }
    : (() => {
        const otherRect = rects.get(other.objectId);
        if (otherRect === undefined) return { x: other.fallback.x, y: other.fallback.y };
        return { x: otherRect.x + otherRect.width / 2, y: otherRect.y + otherRect.height / 2 };
      })();
  const side = nearestSide(rect, otherPoint);
  return sideAnchor(rect, side);
}

/**
 * Set one end of a connector to a new endpoint.
 *
 * Returns false (no transaction) when:
 *  - the connector id is stale
 *  - the new endpoint has non-finite free coordinates
 *  - attaching to the object at the opposite end
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const obj = getConnectorMap(doc, id);
  if (!obj) return false;

  if (e.kind === 'free' && !isFinitePoint(e)) return false;

  // Check we're not attaching to the object at the opposite end.
  if (e.kind === 'attached') {
    const otherEnd = end === 'from' ? 'to' : 'from';
    const otherKey = otherEnd === 'from' ? FROM_KEY : TO_KEY;
    const otherEp = readEndpoint(obj.get(otherKey));
    if (otherEp !== null && otherEp.kind === 'attached' && otherEp.objectId === e.objectId) {
      return false;
    }
  }

  const key = end === 'from' ? FROM_KEY : TO_KEY;
  doc.transact(() => {
    obj.set(key, e);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detach all connector ends attached to any of the deleted ids.
 * Must be called inside an open transaction (by deleteObjects).
 *
 * Each attached end is converted to a free endpoint at the current anchor
 * point (the side midpoint on the object's boundary).
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) return;
  const deletedSet = new Set(deletedIds);
  const objMap = objects(doc);

  // Collect the rects of the deleted objects BEFORE they are removed.
  // (This function is called inside the same transaction as the removal,
  // so the objects are still in the map.)
  const deletedRects = new Map<string, Rect>();
  for (const id of deletedIds) {
    const obj = objMap.get(id);
    if (obj) {
      const x = obj.get(X_KEY);
      const y = obj.get(Y_KEY);
      const w = obj.get(WIDTH_KEY);
      const h = obj.get(HEIGHT_KEY);
      if (typeof x === 'number' && typeof y === 'number' && typeof w === 'number' && typeof h === 'number') {
        deletedRects.set(id, { x, y, width: w, height: h });
      }
    }
  }

  // Find all connectors and detach ends that reference deleted ids.
  objMap.forEach((obj, id) => {
    if (obj.get(TYPE_KEY) !== CONNECTOR_TYPE) return;

    for (const [epKey, end] of [[FROM_KEY, 'from'], [TO_KEY, 'to']] as const) {
      const ep = readEndpoint(obj.get(epKey));
      if (ep === null || ep.kind !== 'attached') continue;
      if (!deletedSet.has(ep.objectId)) continue;

      // Compute the current anchor at the deleted object's side.
      const rect = deletedRects.get(ep.objectId);
      const anchor: Point = rect
        ? sideAnchor(rect, nearestSide(rect, ep.fallback))
        : { x: ep.fallback.x, y: ep.fallback.y };

      // Convert to a free endpoint at the current anchor.
      obj.set(epKey, { kind: 'free' as const, x: anchor.x, y: anchor.y });
    }
  });
}
