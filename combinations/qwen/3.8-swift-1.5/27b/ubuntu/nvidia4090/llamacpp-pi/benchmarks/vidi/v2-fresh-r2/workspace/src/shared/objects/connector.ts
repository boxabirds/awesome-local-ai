/**
 * Connector (arrow) object model (story 10, connector.model).
 *
 * ```
 * objects/<id>: Y.Map {
 *   type: 'connector',
 *   x, y, width, height,   // stored 0; derived in the snapshot
 *   z, createdAt, createdBy,
 *   from: Endpoint,        // Y.Map
 *   to: Endpoint           // Y.Map
 * }
 *
 * Endpoint = { kind: 'attached', objectId, fallback: { x, y } }
 *          | { kind: 'free', x, y }
 * ```
 *
 * Attached endpoints store no side: the side is recomputed from the current
 * object rectangles on every render (`resolveEndpoints`), so arrows follow
 * moves by anyone with no extra writes. `fallback` is the anchor point at
 * attach time, used only if the target vanished concurrently.
 *
 * Selection, move and delete are the generic story 7/8 operations;
 * `deleteObjects` detaches ends attached to deleted ids in the same
 * transaction (connector.target_deleted).
 */

import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import { LOCAL_ORIGIN, objectBounds, objects, type ObjectSnapshot } from '../board-model';
import {
  endpointAnchor,
  endpointReference,
} from '../geometry/connector-geometry';
import type { Point, Rect } from '../geometry';

/** One end of a connector: attached to an object, or free at a board point. */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** Immutable snapshot of a connector object. */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getObjects(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects');
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function finitePoint(p: Point): boolean {
  return isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

/** Read an endpoint from its Y.Map storage form. */
function readEndpoint(m: unknown): Endpoint | undefined {
  if (!(m instanceof Y.Map)) return undefined;
  const kind = m.get('kind') as string;
  if (kind === 'attached') {
    const objectId = m.get('objectId');
    const fx = m.get('fx') as number;
    const fy = m.get('fy') as number;
    if (typeof objectId !== 'string' || !isFiniteNumber(fx) || !isFiniteNumber(fy)) return undefined;
    return { kind: 'attached', objectId, fallback: { x: fx, y: fy } };
  }
  if (kind === 'free') {
    const x = m.get('x') as number;
    const y = m.get('y') as number;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;
    return { kind: 'free', x, y };
  }
  return undefined;
}

/** Write an endpoint to a fresh Y.Map in storage form. */
function writeEndpoint(e: Endpoint): Y.Map<unknown> {
  const m = new Y.Map();
  if (e.kind === 'attached') {
    m.set('kind', 'attached');
    m.set('objectId', e.objectId);
    m.set('fx', e.fallback.x);
    m.set('fy', e.fallback.y);
  } else {
    m.set('kind', 'free');
    m.set('x', e.x);
    m.set('y', e.y);
  }
  return m;
}

/** The current world bounds of every object (for endpoint resolution). */
function currentRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const o of objects(doc)) rects.set(o.id, objectBounds(o));
  return rects;
}

/**
 * Create a connector (connector.create_attached / connector.create_free).
 *
 * Rejected before any write (null, no transaction) when both ends attach to
 * the same object, the resolved length is below CONNECTOR_MIN_LENGTH_WORLD,
 * or any point is non-finite. For attached ends whose target still exists,
 * the stored fallback is the freshly computed side anchor; a missing target
 * keeps the caller's fallback (concurrent-delete race).
 *
 * One LOCAL_ORIGIN transaction per success. Returns the new id.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  // Self-connection and non-finite points are rejected before any write.
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;
  if (from.kind === 'free' && !finitePoint(from)) return null;
  if (to.kind === 'free' && !finitePoint(to)) return null;
  if (from.kind === 'attached' && !finitePoint(from.fallback)) return null;
  if (to.kind === 'attached' && !finitePoint(to.fallback)) return null;

  const rects = currentRects(doc);

  // Resolved drawn points (fallback when a target is already gone).
  const fromReference = endpointReference(from, rects);
  const toReference = endpointReference(to, rects);
  const fromPoint = endpointAnchor(from, rects, toReference);
  const toPoint = endpointAnchor(to, rects, fromReference);
  if (!finitePoint(fromPoint) || !finitePoint(toPoint)) return null;

  const length = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  // Stored fallback: the freshly computed side anchor when the target
  // exists; the caller's fallback when it was deleted concurrently.
  const storedFrom: Endpoint =
    from.kind === 'attached' && rects.has(from.objectId)
      ? { ...from, fallback: fromPoint }
      : from;
  const storedTo: Endpoint =
    to.kind === 'attached' && rects.has(to.objectId)
      ? { ...to, fallback: toPoint }
      : to;

  const id = crypto.randomUUID();
  const objectsMap = getObjects(doc);

  let maxZ = 0;
  objectsMap.forEach((obj) => {
    const z = obj.get('z') as number;
    if (isFiniteNumber(z) && z > maxZ) maxZ = z;
  });

  const obj = new Y.Map();
  obj.set('type', 'connector');
  // x/y/width/height are derived in the snapshot; stored 0.
  obj.set('x', 0);
  obj.set('y', 0);
  obj.set('width', 0);
  obj.set('height', 0);
  obj.set('z', maxZ + 1);
  obj.set('createdAt', Date.now());
  obj.set('createdBy', by);
  obj.set('from', writeEndpoint(storedFrom));
  obj.set('to', writeEndpoint(storedTo));

  doc.transact(() => {
    objectsMap.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Re-attach or detach one end of a connector (connector.reattach).
 *
 * Stale id, non-finite points, or attaching to the object at the opposite
 * end → false, no transaction. One LOCAL_ORIGIN transaction per success.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const obj = getObjects(doc).get(id);
  if (!obj) return false;
  if (e.kind === 'free' && !finitePoint(e)) return false;
  if (e.kind === 'attached' && !finitePoint(e.fallback)) return false;

  // Attaching to the object at the opposite end is rejected.
  const other = readEndpoint(obj.get(end === 'from' ? 'to' : 'from'));
  if (!other) return false;
  if (e.kind === 'attached' && other.kind === 'attached' && e.objectId === other.objectId) return false;

  doc.transact(() => {
    obj.set(end, writeEndpoint(e));
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Detach every connector end attached to a deleted object, fixing it at the
 * current anchor (connector.target_deleted). MUST be called inside an open
 * transaction that also removes the deleted objects (one update, one undo
 * step).
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const deleted = new Set(deletedIds);
  const objectsMap = getObjects(doc);
  // Current rects INCLUDING the objects about to be deleted (the caller's
  // transaction removes them after this runs).
  const rects = currentRects(doc);

  const updates: Array<{ obj: Y.Map<unknown>; end: 'from' | 'to'; point: Point }> = [];
  objectsMap.forEach((obj, _id) => {
    if (obj.get('type') !== 'connector') return;
    const from = readEndpoint(obj.get('from'));
    const to = readEndpoint(obj.get('to'));
    if (!from || !to) return;
    const fromReference = endpointReference(from, rects);
    const toReference = endpointReference(to, rects);
    if (from.kind === 'attached' && deleted.has(from.objectId)) {
      updates.push({ obj, end: 'from', point: endpointAnchor(from, rects, toReference) });
    }
    if (to.kind === 'attached' && deleted.has(to.objectId)) {
      updates.push({ obj, end: 'to', point: endpointAnchor(to, rects, fromReference) });
    }
  });

  for (const u of updates) {
    u.obj.set(u.end, writeEndpoint({ kind: 'free', x: u.point.x, y: u.point.y }));
  }
}

/**
 * The Y.Map storage of a connector's endpoints (test/diagnostic helper).
 */
export function getConnectorEndpoints(doc: Y.Doc, id: string): { from: Endpoint; to: Endpoint } | undefined {
  const obj = getObjects(doc).get(id);
  if (!obj) return undefined;
  const from = readEndpoint(obj.get('from'));
  const to = readEndpoint(obj.get('to'));
  if (!from || !to) return undefined;
  return { from, to };
}
