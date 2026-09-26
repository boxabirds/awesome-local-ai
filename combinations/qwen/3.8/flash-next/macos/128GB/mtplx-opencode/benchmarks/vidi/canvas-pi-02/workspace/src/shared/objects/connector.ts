/**
 * Connector object model (story 10).
 *
 * Schema:
 * ```
 * objects/<id>: Y.Map {
 *   type: 'connector'
 *   x, y, width, height: number (derived from resolveEndpoints in snapshot)
 *   z: number
 *   createdAt: number
 *   createdBy: string
 *   from: Endpoint (serialized as JSON-friendly object)
 *   to: Endpoint
 * }
 * ```
 *
 * Endpoint: { kind: 'attached', objectId: string, fallback: { x, y } }
 *         | { kind: 'free', x: number, y: number }
 */
import * as Y from 'yjs';
import type { Point, Rect } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import {
  type Endpoint,
  type ConnectorSnap,
  sideAnchor,
  nearestSide,
  connectorBBox,
} from '../geometry/connector-geometry';

export type { Endpoint, ConnectorSnap };

function finite(...values: unknown[]): boolean {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Create a connector. Returns the new id, or null on:
 * - self-connection (from.objectId === to.objectId)
 * - resolved length < CONNECTOR_MIN_LENGTH_WORLD
 * - non-finite points
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  // Self-connection check.
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Compute resolved endpoints for length check.
  const fromPt = endpointToPoint(from);
  const toPt = endpointToPoint(to);
  if (!fromPt || !toPt) return null;
  if (!finite(fromPt.x, fromPt.y, toPt.x, toPt.y)) return null;

  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `conn-${Math.random().toString(36).slice(2)}`;

  // Compute z.
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let maxZ = 0;
  objects.forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > maxZ) maxZ = z;
  });
  const z = maxZ + 1;

  // Compute bbox for the initial rect.
  const bbox = connectorBBox(fromPt, toPt);

  doc.transact(() => {
    const conn = new Y.Map<unknown>();
    conn.set('type', 'connector');
    conn.set('x', bbox.x);
    conn.set('y', bbox.y);
    conn.set('width', bbox.width);
    conn.set('height', bbox.height);
    conn.set('z', z);
    conn.set('createdAt', Date.now());
    conn.set('createdBy', by);
    conn.set('from', serializeEndpoint(from));
    conn.set('to', serializeEndpoint(to));
    objects.set(id, conn);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set one endpoint of a connector.
 *
 * Returns false for: stale id, non-finite points, attaching to the object at
 * the opposite end, or if the connector's type is wrong.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const conn = objects.get(id);
  if (!(conn instanceof Y.Map) || conn.get('type') !== 'connector') return false;

  // Non-finite check.
  if (e.kind === 'free') {
    if (!finite(e.x, e.y)) return false;
  } else {
    if (!finite(e.fallback.x, e.fallback.y)) return false;
    if (!e.objectId) return false;
  }

  // Check: don't attach to the object at the other end.
  const otherEndKey = end === 'from' ? 'to' : 'from';
  const otherRaw = conn.get(otherEndKey);
  if (otherRaw && e.kind === 'attached') {
    const otherObjId = getEndpointObjectId(otherRaw);
    if (otherObjId === e.objectId) return false;
  }

  doc.transact(() => {
    conn.set(end, serializeEndpoint(e));
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detach all connector endpoints that reference any of `deletedIds`.
 * Converts them to `free` at the current anchor point.
 *
 * Call inside an open transaction (e.g. inside deleteObjects).
 */
export function detachConnectorsTo(
  doc: Y.Doc,
  deletedIds: string[],
): void {
  if (deletedIds.length === 0) return;
  const deletedSet = new Set(deletedIds);
  const objects = doc.getMap<Y.Map<unknown>>('objects');

  // Collect all updates first, then apply to avoid iterating while mutating.
  const updates: Array<{ conn: Y.Map<unknown>; end: 'from' | 'to'; pt: Point }> = [];

  objects.forEach((value) => {
    if (!(value instanceof Y.Map) || value.get('type') !== 'connector') return;

    const fromRaw = value.get('from');
    const toRaw = value.get('to');
    if (!fromRaw || !toRaw) return;

    const fromObjId = getEndpointObjectId(fromRaw);
    const toObjId = getEndpointObjectId(toRaw);

    const fromEndpoint = deserializeEndpoint(fromRaw);
    const toEndpoint = deserializeEndpoint(toRaw);
    if (!fromEndpoint || !toEndpoint) return;

    // Detach 'from' if it references a deleted id.
    if (fromObjId && deletedSet.has(fromObjId)) {
      const toPt = endpointToPoint(toEndpoint);
      if (toPt) {
        const fromRect = getRectForObject(doc, fromObjId);
        if (fromRect) {
          const side = nearestSide(fromRect, toPt);
          const anchor = sideAnchor(fromRect, side);
          updates.push({ conn: value, end: 'from', pt: anchor });
        } else {
          // Object already gone: use fallback.
          if (fromEndpoint.kind === 'attached') {
            updates.push({ conn: value, end: 'from', pt: fromEndpoint.fallback });
          }
        }
      }
    }

    // Detach 'to' if it references a deleted id.
    if (toObjId && deletedSet.has(toObjId)) {
      const fromPt = endpointToPoint(fromEndpoint);
      if (fromPt) {
        const toRect = getRectForObject(doc, toObjId);
        if (toRect) {
          const side = nearestSide(toRect, fromPt);
          const anchor = sideAnchor(toRect, side);
          updates.push({ conn: value, end: 'to', pt: anchor });
        } else {
          // Object already gone: use fallback.
          if (toEndpoint.kind === 'attached') {
            updates.push({ conn: value, end: 'to', pt: toEndpoint.fallback });
          }
        }
      }
    }
  });

  if (updates.length === 0) return;

  // Apply all endpoint changes and recompute bboxes.
  for (const { conn, end, pt } of updates) {
    conn.set(end, { kind: 'free', x: pt.x, y: pt.y });
  }
  // Recompute bbox per connector (may have multiple updates per connector).
  const seen = new Set<Y.Map<unknown>>();
  for (const { conn } of updates) {
    if (seen.has(conn)) continue;
    seen.add(conn);
    const fromRaw = conn.get('from');
    const toRaw = conn.get('to');
    if (!fromRaw || !toRaw) continue;
    const fromEp = deserializeEndpoint(fromRaw);
    const toEp = deserializeEndpoint(toRaw);
    if (!fromEp || !toEp) continue;
    const fromPt = endpointToPoint(fromEp);
    const toPt = endpointToPoint(toEp);
    if (!fromPt || !toPt) continue;
    const bbox = connectorBBox(fromPt, toPt);
    conn.set('x', bbox.x);
    conn.set('y', bbox.y);
    conn.set('width', bbox.width);
    conn.set('height', bbox.height);
  }
}

/* ---- Internal helpers ---- */

function endpointToPoint(e: Endpoint): Point | null {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  return e.fallback;
}

function getRectForObject(doc: Y.Doc, id: string): Rect | undefined {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!(obj instanceof Y.Map)) return undefined;
  const x = obj.get('x');
  const y = obj.get('y');
  const w = obj.get('width');
  const h = obj.get('height');
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  const width = typeof w === 'number' ? w : 200;
  const height = typeof h === 'number' ? h : 200;
  return { x, y, width, height };
}

function serializeEndpoint(e: Endpoint): Record<string, unknown> {
  if (e.kind === 'free') return { kind: 'free', x: e.x, y: e.y };
  return { kind: 'attached', objectId: e.objectId, fallback: { x: e.fallback.x, y: e.fallback.y } };
}

function deserializeEndpoint(raw: unknown): Endpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'free') {
    const x = obj.x;
    const y = obj.y;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    return { kind: 'free', x, y };
  }
  if (obj.kind === 'attached') {
    const objectId = obj.objectId;
    const fb = obj.fallback as Record<string, unknown> | undefined;
    if (typeof objectId !== 'string') return null;
    if (!fb || typeof fb.x !== 'number' || typeof fb.y !== 'number') return null;
    return { kind: 'attached', objectId, fallback: { x: fb.x, y: fb.y } };
  }
  return null;
}

function getEndpointObjectId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'attached' && typeof obj.objectId === 'string') return obj.objectId;
  return undefined;
}

/** Check if a value is a connector Y.Map. */
export function isConnector(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map && value.get('type') === 'connector';
}
