import * as Y from 'yjs';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  STICKY_SIZE_WORLD,
} from '@/shared/config';
import { LOCAL_ORIGIN, ensureMeta, readEndpoint, type ObjectSnapshot } from '@/shared/board-model';
// NOTE: registerKnownObjectType comes from the dependency-free module, NOT
// from board-model: board-model imports this module at its top, so reading a
// board-model export at module scope would hit a not-yet-assigned binding.
import { registerKnownObjectType } from '@/shared/known-object-types';
import type { Point, Rect } from '@/shared/geometry';
import { connectorBBox, nearestSide, resolveEndpoints, sideAnchor } from '@/shared/geometry/connector-geometry';

// The connector model marks its type known (sel.all_types). board-model
// imports THIS module (detachConnectorsTo) and this module imports
// board-model (LOCAL_ORIGIN, readEndpoint, ...) — the cycle is safe because
// both sides only touch each other inside function bodies and the shared
// state (KNOWN_OBJECT_TYPES) lives in the dependency-free
// known-object-types module. See the header there.
registerKnownObjectType('connector');

/**
 * A connector endpoint (story 10, conn.anchoring):
 * - `{ kind: 'free', x, y }` — a world point that moves with the arrow;
 * - `{ kind: 'attached', objectId, fallback }` — glued to an object's side
 *   anchor; `fallback` is the anchor captured at attach time, used only when
 *   the object has been deleted concurrently (orphaned rendering,
 *   connector.target_deleted).
 *
 * Re-exported from board-model (which holds the ObjectSnapshot.from/to
 * fields) to avoid a second definition.
 */
export type Endpoint =
  | { kind: 'free'; x: number; y: number }
  | { kind: 'attached'; objectId: string; fallback: Point };

/** A connector object snapshot (type guard: isConnectorSnap). */
export interface ConnectorSnap {
  id: string;
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  /** Derived bbox of the resolved endpoints (selection/marquee). */
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
}

export function isConnectorSnap(o: ObjectSnapshot): o is ConnectorSnap {
  return o.type === 'connector';
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function connectorObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objects(doc).get(id);
  if (!obj || obj.get('type') !== 'connector') return undefined;
  return obj;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function validEndpoint(e: Endpoint): boolean {
  if (e === null || typeof e !== 'object') return false;
  if (e.kind === 'free') return isFinitePoint(e);
  return (
    typeof e.objectId === 'string' &&
    e.objectId.length > 0 &&
    e.fallback !== null &&
    typeof e.fallback === 'object' &&
    isFinitePoint(e.fallback)
  );
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/** id -> world rect of every live non-connector object (sticky default size). */
function liveObjectRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  objects(doc).forEach((obj, id) => {
    const type = obj.get('type');
    if (type === 'connector' || typeof type !== 'string') return;
    const x = obj.get('x');
    const y = obj.get('y');
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const rawWidth = obj.get('width');
    const rawHeight = obj.get('height');
    const width =
      typeof rawWidth === 'number' && Number.isFinite(rawWidth) ? rawWidth : type === 'sticky' ? STICKY_SIZE_WORLD : 0;
    const height =
      typeof rawHeight === 'number' && Number.isFinite(rawHeight) ? rawHeight : type === 'sticky' ? STICKY_SIZE_WORLD : 0;
    rects.set(id, { x, y, width, height });
  });
  return rects;
}

/**
 * Normalizes an endpoint's fallback for storage: when the target object is
 * live, the fallback is the CURRENT side anchor (the point the arrow will
 * leave if the object is later deleted); when the target is already missing
 * (a concurrent-delete race), the caller's fallback is kept so the orphaned
 * arrow still renders somewhere sensible (connector.target_deleted).
 */
function withStoredFallback(ep: Endpoint, resolvedPoint: Point, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (ep.kind !== 'attached' || !rects.has(ep.objectId)) return ep;
  return { kind: 'attached', objectId: ep.objectId, fallback: { ...resolvedPoint } };
}

/**
 * Creates a connector between two endpoints and returns its id (conn.anchoring,
 * conn.min_length, conn.no_accidental, conn.style).
 *
 * Rejects (returns null, no transaction): malformed/non-finite endpoints;
 * both ends attached to the SAME object (no self-loops); resolved length
 * below CONNECTOR_MIN_LENGTH_WORLD. Exactly one LOCAL_ORIGIN transaction on
 * success.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!validEndpoint(from) || !validEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;
  const rects = liveObjectRects(doc);
  const resolved = resolveEndpoints({ from, to }, rects);
  const length = Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const id = crypto.randomUUID();
  const storedFrom = withStoredFallback(from, resolved.from, rects);
  const storedTo = withStoredFallback(to, resolved.to, rects);
  doc.transact(() => {
    ensureMeta(doc);
    const all = objects(doc);
    const obj = new Y.Map();
    obj.set('type', 'connector');
    obj.set('from', storedFrom);
    obj.set('to', storedTo);
    // x/y/width/height are derived (bbox) — stored zeroed here and
    // recomputed by objectSnapshot from the live endpoints.
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('z', maxZ(all) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    all.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Reads a connector object as a typed snapshot (endpoints read through
 * readEndpoint so both plain and Y.Map stored forms work). x/y/width/height
 * are the bbox of the endpoints resolved against CURRENT object positions.
 * Returns undefined for a stale/non-connector id or malformed endpoints.
 */
export function readConnector(doc: Y.Doc, id: string): ConnectorSnap | undefined {
  const obj = connectorObj(doc, id);
  if (!obj) return undefined;
  const from = readEndpoint(obj.get('from'));
  const to = readEndpoint(obj.get('to'));
  if (from === undefined || to === undefined) return undefined;
  const resolved = resolveEndpoints({ from, to }, liveObjectRects(doc));
  const bbox = connectorBBox(resolved.from, resolved.to);
  const z = obj.get('z');
  const createdAt = obj.get('createdAt');
  return {
    id,
    type: 'connector',
    from,
    to,
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height,
    z: typeof z === 'number' && Number.isFinite(z) ? z : 0,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/**
 * Sets one endpoint of an existing connector (endpoint drag, conn.anchoring).
 * The endpoint may be attached (a new target object) or free (dropped on
 * empty space). Returns false without a transaction when: the id is stale or
 * not a connector; the endpoint is malformed/non-finite; or the new attached
 * target is the object at the OTHER end (no self-loops). Exactly one
 * LOCAL_ORIGIN transaction on success.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const obj = connectorObj(doc, id);
  if (!obj) return false;
  if (!validEndpoint(e)) return false;
  const other = readEndpoint(end === 'from' ? obj.get('to') : obj.get('from'));
  if (other === undefined) return false;
  if (e.kind === 'attached' && other.kind === 'attached' && e.objectId === other.objectId) return false;
  const rects = liveObjectRects(doc);
  const newFrom = end === 'from' ? e : other;
  const newTo = end === 'from' ? other : e;
  const resolved = resolveEndpoints({ from: newFrom, to: newTo }, rects);
  const point = end === 'from' ? resolved.from : resolved.to;
  const stored = withStoredFallback(e, point, rects);
  doc.transact(() => {
    obj.set(end, stored);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detaches every connector end attached to one of the deleted objects,
 * turning it FREE at its current anchor (connector.target_deleted). Called
 * INSIDE the caller's open transaction (deleteObjects) so the detachment and
 * the deletion land in a single update on every client.
 *
 * No-op (no writes) when no connector is attached to the deleted ids.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const deleting = new Set(deletedIds);
  const all = objects(doc);
  // Computed BEFORE any write: the deleted objects are still in the map here,
  // so their side anchors resolve to real positions.
  const rects = liveObjectRects(doc);
  const toDetach: Array<{ obj: Y.Map<unknown>; end: 'from' | 'to' }> = [];
  all.forEach((obj) => {
    if (obj.get('type') !== 'connector') return;
    const from = readEndpoint(obj.get('from'));
    const to = readEndpoint(obj.get('to'));
    if (from === undefined || to === undefined) return;
    if (from.kind === 'attached' && deleting.has(from.objectId)) toDetach.push({ obj, end: 'from' });
    if (to.kind === 'attached' && deleting.has(to.objectId)) toDetach.push({ obj, end: 'to' });
  });
  for (const { obj, end } of toDetach) {
    const from = readEndpoint(obj.get('from'));
    const to = readEndpoint(obj.get('to'));
    if (from === undefined || to === undefined) continue;
    const resolved = resolveEndpoints({ from, to }, rects);
    const point = end === 'from' ? resolved.from : resolved.to;
    obj.set(end, { kind: 'free', x: point.x, y: point.y });
  }
}

/**
 * Side geometry re-exported for the client (hover dots, preview, handle
 * drag) so it uses the exact same rules as the models.
 */
export { nearestSide, sideAnchor };
export type { Side } from '@/shared/geometry/connector-geometry';
