/**
 * Story 10 (connector.model): the connector (arrow) object schema helpers.
 *
 * A connector is a board object of type 'connector' with two endpoints. An
 * endpoint is attached to a board object or free at a world point. Attached
 * endpoints carry a fallback point (where the end renders if the target
 * object is absent), set at attach time and used for the orphaned end
 * after a concurrent delete.
 *
 * Document schema:
 *   objects/<id>: Y.Map {
 *     type: 'connector', x: 0, y: 0, width: 0, height: 0,
 *     z, createdAt, createdBy, from: Endpoint, to: Endpoint
 *   }
 *
 * x/y/width/height are stored as 0; the snapshot derives them from the
 * live endpoints. Every mutation is one LOCAL_ORIGIN transaction; invalid
 * input is rejected without a transaction (null / false).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, snapshot, type ObjectSnapshot } from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Rect } from '../geometry';
import { nearestSide, resolveEndpoints, sideAnchor } from '../geometry/connector-geometry';

/** A connector endpoint: attached to an object, or free at a world point. */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: { x: number; y: number } }
  | { kind: 'free'; x: number; y: number };

/** A connector snapshot (the type-specific view of ObjectSnapshot). */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

/**
 * Create a connector. Rejects (null, no transaction) an endpoint attached to
 * the same object as the other, or an effective length below
 * CONNECTOR_MIN_LENGTH_WORLD. For an attached endpoint whose target exists,
 * the stored fallback is the side anchor at attach time (sideAnchor of the
 * side nearest the other end); for an already-missing target the given
 * fallback is kept (concurrent delete race). One LOCAL_ORIGIN transaction.
 */
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validEndpoint(e: Endpoint): boolean {
  if (e.kind === 'free') return fin(e.x) && fin(e.y);
  return e.objectId.length > 0 && fin(e.fallback.x) && fin(e.fallback.y);
}

/** The current id → world Rect map of every board object with finite bounds. */
function currentRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const o of snapshot(doc)) {
    if (fin(o.x) && fin(o.y) && fin(o.width) && fin(o.height)) {
      rects.set(o.id, { x: o.x, y: o.y, width: o.width, height: o.height });
    }
  }
  return rects;
}

/**
 * The endpoint to store: for an attached endpoint whose target exists, the
 * fallback is the side anchor at attach time (the side nearest the other
 * end); for an already-missing target the given fallback is kept.
 */
function settle(
  e: Endpoint,
  otherInterest: { x: number; y: number },
  rects: ReadonlyMap<string, Rect>,
): Endpoint {
  if (e.kind === 'free') return e;
  const r = rects.get(e.objectId);
  if (!r) return e;
  return { kind: 'attached', objectId: e.objectId, fallback: sideAnchor(r, nearestSide(r, otherInterest)) };
}

/** The point an endpoint aims at (rect centre, stored point, or fallback). */
function interestOf(e: Endpoint, rects: ReadonlyMap<string, Rect>): { x: number; y: number } {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return e.fallback;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  if (!validEndpoint(from) || !validEndpoint(to)) return null;
  const same =
    from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId;
  if (same) return null;
  const rects = currentRects(doc);
  const settledFrom = settle(from, interestOf(to, rects), rects);
  const settledTo = settle(to, interestOf(from, rects), rects);
  const { from: fp, to: tp } = resolveEndpoints({ from: settledFrom, to: settledTo }, rects);
  if (Math.hypot(tp.x - fp.x, tp.y - fp.y) < CONNECTOR_MIN_LENGTH_WORLD) return null;
  const obj = doc.getMap('objects');
  let max = 0;
  obj.forEach((item) => {
    if (!(item instanceof Y.Map)) return;
    const z = item.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  const id = crypto.randomUUID();
  doc.transact(() => {
    const item = new Y.Map();
    item.set('type', 'connector');
    item.set('x', 0);
    item.set('y', 0);
    item.set('width', 0);
    item.set('height', 0);
    item.set('from', settledFrom);
    item.set('to', settledTo);
    item.set('z', max + 1);
    item.set('createdAt', Date.now());
    item.set('createdBy', by);
    obj.set(id, item);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Set one endpoint (attached or free). Stale id, invalid endpoint, or an
 * attached endpoint equal to the object at the opposite end: false without
 * a transaction. One LOCAL_ORIGIN transaction.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  if (!validEndpoint(e)) return false;
  const item = doc.getMap('objects').get(id);
  if (!(item instanceof Y.Map) || item.get('type') !== 'connector') return false;
  const other = end === 'from' ? item.get('to') : item.get('from');
  if (e.kind === 'attached' && other && other.kind === 'attached' && other.objectId === e.objectId) {
    return false;
  }
  const rects = currentRects(doc);
  const settled = settle(e, interestOf(other ?? e, rects), rects);
  doc.transact(() => {
    item.set(end, settled);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Convert every attached endpoint on the deleted ids to a free endpoint at
 * the current side anchor (the fallback is already there). Writes only —
 * the caller runs it inside the delete transaction.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const gone = new Set(deletedIds);
  if (gone.size === 0) return;
  const rects = currentRects(doc); // before the caller removes the ids
  const objects = doc.getMap('objects');
  objects.forEach((item, id) => {
    if (!(item instanceof Y.Map) || item.get('type') !== 'connector') return;
    for (const end of ['from', 'to'] as const) {
      const e = item.get(end);
      if (!e || e.kind !== 'attached' || !gone.has(e.objectId)) continue;
      // the current side anchor (the target rect is still present here)
      const other = end === 'from' ? item.get('to') : item.get('from');
      const aim = other ? interestOf(other, rects) : e.fallback;
      const r = rects.get(e.objectId);
      const anchor = r ? sideAnchor(r, nearestSide(r, aim)) : e.fallback;
      item.set(end, { kind: 'free', x: anchor.x, y: anchor.y });
    }
  });
}
