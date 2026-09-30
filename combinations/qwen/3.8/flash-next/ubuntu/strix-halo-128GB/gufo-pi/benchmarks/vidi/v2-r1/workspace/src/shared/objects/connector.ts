/**
 * Connector object model: schema helpers for creating and mutating connector (arrow) objects
 * stored in the Y.Doc objects map.
 *
 * Schema:
 * ```
 * objects/<id>: Y.Map {
 *   type: 'connector', x: 0, y: 0, width: 0, height: 0, z, createdAt, createdBy,
 *   from: Endpoint,
 *   to: Endpoint
 * }
 * ```
 *
 * Endpoint = { kind: 'attached', objectId: string, fallback: { x, y } }
 *           | { kind: 'free', x: number, y: number }
 *
 * x/y/width/height are stored as 0 and derived at snapshot time from connectorBBox(resolveEndpoints(...)).
 */

import * as Y from 'yjs';

import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot, type Point } from '../board-model';
import type { Rect } from '../geometry';
import { nearestSide, sideAnchor } from '../geometry/connector-geometry';

const OBJECTS_MAP = 'objects';

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown> | undefined> {
  return doc.getMap(OBJECTS_MAP) as unknown as Y.Map<Y.Map<unknown> | undefined>;
}

function entryOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string') return undefined;
  const entry = objectsOf(doc).get(id);
  return entry instanceof Y.Map ? entry : undefined;
}

function isConnectorEntry(entry: Y.Map<unknown> | undefined): entry is Y.Map<unknown> {
  return entry !== undefined && entry.get('type') === 'connector';
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Highest `z` currently in the document (over every object type). */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsOf(doc).values()) {
    const z = entry instanceof Y.Map ? entry.get('z') : undefined;
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** Connector snapshot for rendering. */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

/**
 * Validate an endpoint. Returns false if non-finite.
 */
function isValidEndpoint(ep: Endpoint): boolean {
  if (ep.kind === 'free') {
    return isFiniteNum(ep.x) && isFiniteNum(ep.y);
  }
  // attached: validate fallback
  return isFiniteNum(ep.fallback.x) && isFiniteNum(ep.fallback.y);
}

/**
 * Resolve an endpoint to a world point for computing length.
 * For attached endpoints, we approximate using the fallback.
 */
function endpointPoint(ep: Endpoint): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  return { x: ep.fallback.x, y: ep.fallback.y };
}

/**
 * Create a connector (arrow) between two endpoints.
 * Returns the new id, or null if:
 * - both ends attach to the same object
 * - resolved length < CONNECTOR_MIN_LENGTH_WORLD
 * - any endpoint is invalid (non-finite)
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  // Validate endpoints
  if (!isValidEndpoint(from) || !isValidEndpoint(to)) return null;

  // Reject same-object attachment
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Compute length from fallback/point positions
  const p1 = endpointPoint(from);
  const p2 = endpointPoint(to);
  const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const id = crypto.randomUUID();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const obj = new Y.Map<unknown>();
    obj.set('type', 'connector');
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('from', endpointToMap(from));
    obj.set('to', endpointToMap(to));
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Convert an Endpoint to a plain object for storing in Y.Map. */
function endpointToMap(ep: Endpoint): Record<string, unknown> {
  if (ep.kind === 'free') {
    return { kind: 'free', x: ep.x, y: ep.y };
  }
  return { kind: 'attached', objectId: ep.objectId, fallback: { x: ep.fallback.x, y: ep.fallback.y } };
}

/** Read an Endpoint from a stored Y.Map value. */
function endpointFromStored(raw: unknown): Endpoint | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'free') {
    if (!isFiniteNum(obj.x) || !isFiniteNum(obj.y)) return null;
    return { kind: 'free', x: obj.x, y: obj.y };
  }
  if (obj.kind === 'attached') {
    const objectId = obj.objectId;
    if (typeof objectId !== 'string') return null;
    const fb = obj.fallback as Record<string, unknown> | undefined;
    if (!fb || !isFiniteNum(fb.x) || !isFiniteNum(fb.y)) return null;
    return { kind: 'attached', objectId, fallback: { x: fb.x as number, y: fb.y as number } };
  }
  return null;
}

/**
 * Set a connector endpoint (for re-attaching or detaching handles).
 * Returns false for stale id, attaching to the object at the opposite end, or non-finite points.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  if (!isValidEndpoint(e)) return false;

  const entry = entryOf(doc, id);
  if (!isConnectorEntry(entry)) return false;

  // Check if attaching to the opposite end's object
  if (e.kind === 'attached') {
    const otherKey = end === 'from' ? 'to' : 'from';
    const otherRaw = entry.get(otherKey);
    const other = endpointFromStored(otherRaw);
    if (other && other.kind === 'attached' && other.objectId === e.objectId) {
      return false;
    }
  }

  doc.transact(() => {
    entry.set(end, endpointToMap(e));
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detach all connector endpoints that are attached to any of the deleted ids.
 * Must be called inside an already-open transaction (i.e., called from deleteObjects).
 * Each attached endpoint on a deleted object becomes free at its current anchor point.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) return;

  const deletedSet = new Set(deletedIds);
  const objects = objectsOf(doc);

  // Build a rects map for computing current anchor positions (before deletion)
  const rects = new Map<string, Rect>();
  for (const [objId, ent] of objects) {
    if (deletedSet.has(objId)) continue;
    if (!(ent instanceof Y.Map)) continue;
    const x = ent.get('x');
    const y = ent.get('y');
    const width = ent.get('width');
    const height = ent.get('height');
    if (isFiniteNum(x) && isFiniteNum(y)) {
      rects.set(objId, {
        x,
        y,
        width: isFiniteNum(width) ? width : 100,
        height: isFiniteNum(height) ? height : 100,
      });
    }
  }

  // Also include the deleted objects' rects so we can compute anchors for them
  for (const [objId, ent] of objects) {
    if (!deletedSet.has(objId)) continue;
    if (!(ent instanceof Y.Map)) continue;
    const x = ent.get('x');
    const y = ent.get('y');
    const width = ent.get('width');
    const height = ent.get('height');
    if (isFiniteNum(x) && isFiniteNum(y)) {
      rects.set(objId, {
        x,
        y,
        width: isFiniteNum(width) ? width : 100,
        height: isFiniteNum(height) ? height : 100,
      });
    }
  }

  for (const [, ent] of objects) {
    if (!(ent instanceof Y.Map)) continue;
    if (ent.get('type') !== 'connector') continue;

    const fromRaw = ent.get('from');
    const toRaw = ent.get('to');
    const fromEp = endpointFromStored(fromRaw);
    const toEp = endpointFromStored(toRaw);

    if (fromEp && fromEp.kind === 'attached' && deletedSet.has(fromEp.objectId)) {
      // Compute current anchor
      const anchor = computeAnchor(rects, fromEp, toEp);
      ent.set('from', { kind: 'free', x: anchor.x, y: anchor.y });
    }

    if (toEp && toEp.kind === 'attached' && deletedSet.has(toEp.objectId)) {
      // Compute current anchor
      const anchor = computeAnchor(rects, toEp, fromEp);
      ent.set('to', { kind: 'free', x: anchor.x, y: anchor.y });
    }
  }
}

/** Compute the anchor point of an endpoint given rects and the other endpoint. */
function computeAnchor(
  rects: Map<string, Rect>,
  ep: { kind: 'attached'; objectId: string; fallback: Point },
  otherEp: Endpoint | null,
): Point {
  const rect = rects.get(ep.objectId);
  if (!rect) {
    return { x: ep.fallback.x, y: ep.fallback.y };
  }
  // Compute toward point from the other endpoint
  let toward: Point;
  if (otherEp) {
    toward = endpointPoint(otherEp);
  } else {
    toward = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }
  const side = nearestSide(rect, toward);
  return sideAnchor(rect, side);
}

/** Read a full ConnectorSnapshot from a Y.Doc entry. */
export function readConnectorSnapshot(id: string, entry: Y.Map<unknown>): ConnectorSnap | null {
  const z = entry.get('z');
  const fromRaw = entry.get('from');
  const toRaw = entry.get('to');
  const fromEp = endpointFromStored(fromRaw);
  const toEp = endpointFromStored(toRaw);

  if (!fromEp || !toEp) return null;

  return {
    id,
    type: 'connector',
    x: 0,
    y: 0,
    z: isFiniteNum(z) ? z : 0,
    width: undefined,
    height: undefined,
    from: fromEp,
    to: toEp,
  };
}
