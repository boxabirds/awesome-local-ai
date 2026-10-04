/**
 * Connector (arrow) object model (story 10): schema helpers for
 * `type: 'connector'` objects.
 *
 * Schema (Y.Map per object under the `objects` map):
 *   type: 'connector', x: 0, y: 0, width: 0, height: 0 (schema padding),
 *   z, createdAt, createdBy,
 *   from: Endpoint, to: Endpoint
 *
 * `Endpoint` is either `{ kind: 'attached', objectId, fallback }` (stays
 * attached to a board object; `fallback` is the last resolved anchor point,
 * used when the target is deleted) or `{ kind: 'free', x, y }` (pinned to a
 * world point).
 *
 * All setters reject stale ids and non-finite numbers without a transaction.
 * All writes use LOCAL_ORIGIN so story 8's undo captures them.
 */
import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../config';
import type { Point, Rect } from '../geometry';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import { nearestSide, rectCentre, sideAnchor } from '../geometry/connector-geometry';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** Connector object snapshot (story 10). */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function isFinitePair(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function validEndpoint(e: Endpoint): boolean {
  if (e.kind === 'free') return isFinitePair(e.x, e.y);
  return typeof e.objectId === 'string' && e.objectId.length > 0 && isFinitePair(e.fallback.x, e.fallback.y);
}

/**
 * The live rect of an object (the connector target's current bounds), or null
 * when the id is unknown.
 */
function rawRect(objects: Y.Map<Y.Map<unknown>>, id: string): Rect | null {
  const obj = objects.get(id);
  if (!obj) return null;
  const x = (obj.get('x') as number | undefined) ?? 0;
  const y = (obj.get('y') as number | undefined) ?? 0;
  const width = (obj.get('width') as number | undefined) ?? STICKY_SIZE_WORLD;
  const height = (obj.get('height') as number | undefined) ?? STICKY_SIZE_WORLD;
  return { x, y, width, height };
}

/**
 * The reference point of an endpoint for "which side faces me" calculations:
 * the centre of its attached target, the free point, or the stored fallback
 * when the target is gone.
 */
function refPoint(e: Endpoint, objects: Y.Map<Y.Map<unknown>>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rawRect(objects, e.objectId);
  return r ? rectCentre(r) : { ...e.fallback };
}

/**
 * Resolve an endpoint to its concrete anchor point: for attached ends the
 * midpoint of the target's side facing the other end; for free ends the point
 * itself; a missing target resolves to the stored fallback.
 */
function anchorOf(e: Endpoint, other: Endpoint, objects: Y.Map<Y.Map<unknown>>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rawRect(objects, e.objectId);
  if (!r) return { ...e.fallback };
  return sideAnchor(r, nearestSide(r, refPoint(other, objects)));
}

/** Rebuild an Endpoint with a freshly resolved fallback anchor. */
function withResolvedAnchor(e: Endpoint, other: Endpoint, objects: Y.Map<Y.Map<unknown>>): Endpoint {
  if (e.kind === 'free') return { kind: 'free', x: e.x, y: e.y };
  const anchor = anchorOf(e, other, objects);
  return { kind: 'attached', objectId: e.objectId, fallback: anchor };
}

function sameObjectOnBothEnds(a: Endpoint, b: Endpoint): boolean {
  return a.kind === 'attached' && b.kind === 'attached' && a.objectId === b.objectId;
}

function endpointLength(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * Create a connector between two endpoints. Attached endpoints resolve their
 * anchor to the target's side facing the other end (storing it as `fallback`);
 * a target that does not exist uses the passed fallback point. Returns the new
 * id, or null for the same object on both ends, a length below the minimum,
 * or non-finite input (no transaction). One LOCAL_ORIGIN transaction on
 * success.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!validEndpoint(from) || !validEndpoint(to)) return null;
  if (sameObjectOnBothEnds(from, to)) return null;

  const objects = getObjects(doc);
  const fromAnchor = anchorOf(from, to, objects);
  const toAnchor = anchorOf(to, from, objects);
  if (endpointLength(fromAnchor, toAnchor) < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const resolvedFrom = withResolvedAnchor(from, to, objects);
  const resolvedTo = withResolvedAnchor(to, from, objects);

  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  const id = crypto.randomUUID();
  const conn = new Y.Map<unknown>();
  conn.set('type', 'connector');
  // Bounding box is derived from the endpoints at snapshot time; x/y/width/
  // height stay 0 as schema padding so old clients treat it as an unknown
  // type (it snapshots as unknown, which is safe).
  conn.set('x', 0);
  conn.set('y', 0);
  conn.set('width', 0);
  conn.set('height', 0);
  conn.set('from', resolvedFrom);
  conn.set('to', resolvedTo);
  conn.set('z', maxZ + 1);
  conn.set('createdAt', Date.now());
  conn.set('createdBy', by);

  doc.transact(() => {
    objects.set(id, conn);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Re-attach one end of an existing connector, or drag it to a free point.
 * Returns true if applied, false for a stale id, the same object as the other
 * end, or non-finite input (no transaction). One LOCAL_ORIGIN transaction on
 * success.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  if (!validEndpoint(e)) return false;

  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'connector') return false;

  const otherKey = end === 'from' ? 'to' : 'from';
  const other = obj.get(otherKey) as Endpoint | undefined;
  if (!other) return false;
  if (sameObjectOnBothEnds(e, other)) return false;

  const next = withResolvedAnchor(e, other, objects);
  doc.transact(() => {
    obj.set(end, next);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Convert every attached end pointing at a deleted object into a free end at
 * the target's last known anchor (the side facing the other end, or the
 * stored fallback when the geometry is unknown). Call inside the delete
 * transaction — no transaction of its own.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) return;
  const ids = new Set(deletedIds);
  const objects = getObjects(doc);
  objects.forEach((obj) => {
    if (obj.get('type') !== 'connector') return;
    (['from', 'to'] as const).forEach((key) => {
      const e = obj.get(key) as Endpoint | undefined;
      if (!e || e.kind !== 'attached' || !ids.has(e.objectId)) return;
      const other = obj.get(key === 'from' ? 'to' : 'from') as Endpoint | undefined;
      const r = rawRect(objects, e.objectId);
      const anchor: Point =
        r && other
          ? sideAnchor(r, nearestSide(r, refPoint(other, objects)))
          : { ...e.fallback };
      obj.set(key, { kind: 'free', x: anchor.x, y: anchor.y });
    });
  });
}
