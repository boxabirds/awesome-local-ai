import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Rect, Point } from '../geometry';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import { nearestSide, sideAnchor } from '../geometry/connector-geometry';

/**
 * Connector object model: schema helpers for creating and managing connectors (arrows).
 *
 * Schema per connector:
 *   objects/<id>: Y.Map {
 *     type: 'connector', x: 0, y: 0, width: 0, height: 0, z, createdAt, createdBy,
 *     from: Y.Map { kind, objectId?, fallback?, x?, y? },
 *     to: Y.Map { kind, objectId?, fallback?, x?, y? }
 *   }
 *
 * x/y/width/height are stored as 0 and derived at snapshot time from resolveEndpoints.
 */

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

/** Largest `z` currently in use across all objects (0 for an empty board). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const value of objectsMap(doc).values()) {
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > top) top = z;
  }
  return top;
}

/** Get a rect from an object's Y.Map (for computing anchors). */
function getRect(map: Y.Map<unknown>): Rect | null {
  const x = map.get('x');
  const y = map.get('y');
  const width = map.get('width');
  const height = map.get('height');
  if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(width) && isFiniteNumber(height)) {
    return { x, y, width, height };
  }
  // Stickies may not have explicit width/height; use a default 200x200
  if (isFiniteNumber(x) && isFiniteNumber(y)) {
    return { x, y, width: 200, height: 200 };
  }
  return null;
}

/**
 * Create a connector between two endpoints.
 * Returns null (no transaction) when:
 * - Both ends attach to the same object
 * - Resolved length < CONNECTOR_MIN_LENGTH_WORLD
 * - Endpoints have non-finite coordinates
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  // Same-object check
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Validate finite coordinates
  if (from.kind === 'free' && (!isFiniteNumber(from.x) || !isFiniteNumber(from.y))) return null;
  if (to.kind === 'free' && (!isFiniteNumber(to.x) || !isFiniteNumber(to.y))) return null;
  if (from.kind === 'attached' && (!isFiniteNumber(from.fallback.x) || !isFiniteNumber(from.fallback.y))) return null;
  if (to.kind === 'attached' && (!isFiniteNumber(to.fallback.x) || !isFiniteNumber(to.fallback.y))) return null;

  // Compute the resolved length
  const fromPoint = resolveForLength(from, to, doc);
  const toPoint = resolveForLength(to, from, doc);
  const dx = toPoint.x - fromPoint.x;
  const dy = toPoint.y - fromPoint.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;

  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', 'connector');
    map.set('x', 0);
    map.set('y', 0);
    map.set('width', 0);
    map.set('height', 0);
    map.set('z', z);
    map.set('createdAt', Date.now());
    map.set('createdBy', by);
    map.set('from', endpointToYMap(from));
    map.set('to', endpointToYMap(to));
    objectsMap(doc).set(id, map);
  }, LOCAL_ORIGIN);

  return id;
}

/** Resolve endpoint point for length calculation (using the other endpoint to pick the nearest side). */
function resolveForLength(ep: Endpoint, otherEp: Endpoint, doc: Y.Doc): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const map = objectsMap(doc).get(ep.objectId);
  if (!map) return { x: ep.fallback.x, y: ep.fallback.y };
  const rect = getRect(map);
  if (!rect) return { x: ep.fallback.x, y: ep.fallback.y };
  // Get the other endpoint's centre/point
  const otherPoint = otherEp.kind === 'free'
    ? { x: otherEp.x, y: otherEp.y }
    : (() => {
        const om = objectsMap(doc).get(otherEp.objectId);
        if (!om) return { x: otherEp.fallback.x, y: otherEp.fallback.y };
        const or_ = getRect(om);
        return or_ ? { x: or_.x + or_.width / 2, y: or_.y + or_.height / 2 } : { x: otherEp.fallback.x, y: otherEp.fallback.y };
      })();
  const side = nearestSide(rect, otherPoint);
  return sideAnchor(rect, side);
}

/** Convert an Endpoint to a plain object for storing in Y.Map. */
function endpointToYMap(ep: Endpoint): Record<string, unknown> {
  if (ep.kind === 'free') {
    return { kind: 'free', x: ep.x, y: ep.y };
  }
  return { kind: 'attached', objectId: ep.objectId, fallback: { x: ep.fallback.x, y: ep.fallback.y } };
}

/** Read an Endpoint from a Y.Map or plain object. */
function endpointFromMap(raw: unknown): Endpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  // Could be Y.Map or plain object (if stored as JSON-like)
  let kind: unknown, objectId: unknown, fallback: unknown, x: unknown, y: unknown;
  if (raw instanceof Y.Map) {
    kind = raw.get('kind');
    objectId = raw.get('objectId');
    fallback = raw.get('fallback');
    x = raw.get('x');
    y = raw.get('y');
  } else {
    const obj = raw as Record<string, unknown>;
    kind = obj.kind;
    objectId = obj.objectId;
    fallback = obj.fallback;
    x = obj.x;
    y = obj.y;
  }
  if (kind === 'free') {
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
    return { kind: 'free', x, y };
  }
  if (kind === 'attached') {
    if (typeof objectId !== 'string') return null;
    let fb: Point = { x: 0, y: 0 };
    if (fallback && typeof fallback === 'object') {
      const fbObj = fallback instanceof Y.Map ? fallback : fallback as Record<string, unknown>;
      const fx = fbObj instanceof Y.Map ? fbObj.get('x') : (fallback as Record<string, unknown>).x;
      const fy = fbObj instanceof Y.Map ? fbObj.get('y') : (fallback as Record<string, unknown>).y;
      if (isFiniteNumber(fx) && isFiniteNumber(fy)) fb = { x: fx, y: fy };
    }
    return { kind: 'attached', objectId, fallback: fb };
  }
  return null;
}

/**
 * Set one end of a connector. Returns false for:
 * - Stale connector id
 * - Attaching to the object at the opposite end
 * - Non-finite coordinates in free endpoints
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  // Validate new endpoint
  if (e.kind === 'free' && (!isFiniteNumber(e.x) || !isFiniteNumber(e.y))) return false;
  if (e.kind === 'attached' && (!isFiniteNumber(e.fallback.x) || !isFiniteNumber(e.fallback.y))) return false;

  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'connector') return false;

  // Check: attaching to the object at the opposite end
  if (e.kind === 'attached') {
    const otherKey = end === 'from' ? 'to' : 'from';
    const otherRaw = map.get(otherKey);
    const other = endpointFromMap(otherRaw);
    if (other && other.kind === 'attached' && other.objectId === e.objectId) {
      return false;
    }
  }

  doc.transact(() => {
    const epMap = new Y.Map<unknown>();
    if (e.kind === 'free') {
      epMap.set('kind', 'free');
      epMap.set('x', e.x);
      epMap.set('y', e.y);
    } else {
      epMap.set('kind', 'attached');
      epMap.set('objectId', e.objectId);
      const fbMap = new Y.Map<unknown>();
      fbMap.set('x', e.fallback.x);
      fbMap.set('y', e.fallback.y);
      epMap.set('fallback', fbMap);
    }
    map.set(end, epMap);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detach all connector ends attached to any of the `deletedIds`.
 * Must be called inside an already-open transaction (caller's LOCAL_ORIGIN transaction).
 * Each attached end becomes free at its current anchor point.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const idSet = new Set(deletedIds);

  for (const [, map] of objectsMap(doc)) {
    if (map.get('type') !== 'connector') continue;

    for (const endKey of ['from', 'to'] as const) {
      const raw = map.get(endKey);
      const ep = endpointFromMap(raw);
      if (!ep || ep.kind !== 'attached') continue;
      if (!idSet.has(ep.objectId)) continue;

      // Resolve the current anchor point for this endpoint before the object is deleted
      const targetMap = objectsMap(doc).get(ep.objectId);
      let anchorPoint: Point;
      if (targetMap) {
        const rect = getRect(targetMap);
        if (rect) {
          // Find the other end's point to compute the nearest side
          const otherKey = endKey === 'from' ? 'to' : 'from';
          const otherRaw = map.get(otherKey);
          const other = endpointFromMap(otherRaw);
          const otherPoint = other
            ? (other.kind === 'free'
                ? { x: other.x, y: other.y }
                : (() => {
                    const om = objectsMap(doc).get(other.objectId);
                    if (!om) return { x: other.fallback.x, y: other.fallback.y };
                    const or_ = getRect(om);
                    return or_ ? { x: or_.x + or_.width / 2, y: or_.y + or_.height / 2 } : { x: other.fallback.x, y: other.fallback.y };
                  })())
            : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          const side = nearestSide(rect, otherPoint);
          anchorPoint = sideAnchor(rect, side);
        } else {
          anchorPoint = { x: ep.fallback.x, y: ep.fallback.y };
        }
      } else {
        anchorPoint = { x: ep.fallback.x, y: ep.fallback.y };
      }

      // Replace with free endpoint at anchor
      const freeMap = new Y.Map<unknown>();
      freeMap.set('kind', 'free');
      freeMap.set('x', anchorPoint.x);
      freeMap.set('y', anchorPoint.y);
      map.set(endKey, freeMap);
    }
  }
}

/** Read a connector snapshot from the doc for a given id. */
export function readConnectorSnapshot(doc: Y.Doc, id: string): ConnectorSnap | undefined {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'connector') return undefined;
  const from = endpointFromMap(map.get('from'));
  const to = endpointFromMap(map.get('to'));
  if (!from || !to) return undefined;
  return {
    id,
    type: 'connector',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    z: typeof map.get('z') === 'number' ? (map.get('z') as number) : 0,
    from,
    to,
  };
}
