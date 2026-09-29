// The connector object (story 10, design section "Connector model and
// geometry"): an arrow between two board objects. Only the ATTACHMENT is stored;
// the geometry is recomputed from live rectangles at read time (see
// connector-geometry.ts), which is what makes an arrow follow the shapes it is
// attached to whenever anyone moves them.
//
// One LOCAL_ORIGIN transaction per success, and every rejection is decided
// BEFORE a transaction is opened, so a refused write emits zero update events.
import * as Y from 'yjs';
import type { Point, Rect } from '../geometry.ts';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config.ts';
import { LOCAL_ORIGIN, objectsMapOf, objectsSnapshot, objectBounds } from '../board-model.ts';
import type { ObjectSnapshot } from '../board-model.ts';
import {
  isEndpoint,
  nearestSide,
  rectOfEnd,
  referencePoint,
  resolveEndpoints,
  sideAnchor,
  type ConnectorEnds,
  type Endpoint,
} from '../geometry/connector-geometry.ts';

export type { Endpoint } from '../geometry/connector-geometry.ts';

/** The one type string this object is stored under. */
export const CONNECTOR_TYPE = 'connector';

// A connector's box is DERIVED from its endpoints, so what is persisted is 0/0
// with no size; the snapshot reader replaces it with the box around the resolved
// points, and story 7's marquee / selection / z-order machinery sees a rect.
export interface ConnectorSnapshot extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  createdBy: string;
}

function connectorMapOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsMapOf(doc).get(id);
  if (!m || m.get('type') !== CONNECTOR_TYPE) return undefined;
  return m;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMapOf(doc).forEach((m) => {
    const z = Number(m.get('z'));
    if (Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/** Every readable object's current rectangle, keyed by id. */
export function rectsById(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const obj of objectsSnapshot(doc)) {
    const r = objectBounds(obj);
    if (r.width > 0 && r.height > 0) rects.set(obj.id, r);
  }
  return rects;
}

/**
 * An attached end's stored `fallback`: the anchor on the side of its object that
 * faces the other end, computed from the object's CURRENT rect. When the object
 * is not there (deleted concurrently, or never existed) the point the person
 * gave is kept, so the arrow is created attached and renders at its fallback -
 * an end exactly where the object was.
 */
function anchoredEnd(e: Endpoint, rects: ReadonlyMap<string, Rect>, toward: Point): Endpoint {
  if (e.kind !== 'attached') return e;
  const rect = rectOfEnd(e, rects);
  if (!rect) return e;
  return { kind: 'attached', objectId: e.objectId, fallback: sideAnchor(rect, nearestSide(rect, toward)) };
}

// Both ends anchored, as they are about to be stored.
function anchorBoth(from: Endpoint, to: Endpoint, rects: ReadonlyMap<string, Rect>): ConnectorEnds {
  return {
    from: anchoredEnd(from, rects, referencePoint(to, rects)),
    to: anchoredEnd(to, rects, referencePoint(from, rects)),
  };
}

/**
 * Create a connector inside one LOCAL_ORIGIN transaction and return its id.
 *
 * Both ends are stored with `fallback` set to the side anchor they resolve to
 * right now, so an arrow that loses its target keeps its end exactly where that
 * object's edge was.
 *
 * Refused with null and NO transaction: an endpoint that is not a valid endpoint
 * (bad kind, empty id, non-finite point), both ends attached to the SAME object,
 * or a resolved arrow shorter than `CONNECTOR_MIN_LENGTH_WORLD` - the two rules
 * that stop a stray drag from landing an arrow (connector.no_accidental).
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;

  const before = rectsById(doc);
  const ends = anchorBoth(from, to, before);
  const resolved = resolveEndpoints(ends, before);
  if (Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y) < CONNECTOR_MIN_LENGTH_WORLD) {
    return null;
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', CONNECTOR_TYPE);
    m.set('x', 0);
    m.set('y', 0);
    m.set('width', 0);
    m.set('height', 0);
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', now);
    m.set('createdBy', by);
    m.set('from', ends.from);
    m.set('to', ends.to);
    objectsMapOf(doc).set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move one end of a connector (connector.reattach): attach it to an object, or
 * let it go free at a point. Inside one LOCAL_ORIGIN transaction.
 *
 * Refused with false and NO transaction: a stale id (or an id that is not a
 * connector), a malformed endpoint, an end that would not move, or an end aimed
 * at the object the OTHER end is attached to - an arrow between one shape and
 * itself is never a thing, and the handle that was dropped there snaps back.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const m = connectorMapOf(doc, id);
  if (!m) return false;
  if (end !== 'from' && end !== 'to') return false;
  if (!isEndpoint(e)) return false;

  const current = readEnds(m);
  if (!current) return false;
  const other = end === 'from' ? 'to' : 'from';
  const otherEnd = current[other];
  if (e.kind === 'attached' && otherEnd.kind === 'attached' && otherEnd.objectId === e.objectId) {
    return false;
  }

  const rects = rectsById(doc);
  const next = anchoredEnd(e, rects, referencePoint(otherEnd, rects));
  if (sameEnd(current[end], next)) return false; // nothing moves, nothing is written

  doc.transact(() => {
    m.set(end, next);
  }, LOCAL_ORIGIN);
  return true;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function sameEnd(a: Endpoint, b: Endpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'attached' && b.kind === 'attached') {
    return a.objectId === b.objectId && samePoint(a.fallback, b.fallback);
  }
  return a.kind === 'free' && b.kind === 'free' && samePoint(a, b);
}

// Read both stored ends of a connector map; null when either is malformed.
export function readEnds(m: Y.Map<unknown>): ConnectorEnds | null {
  const from = m.get('from');
  const to = m.get('to');
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  return { from, to };
}

/**
 * Turn every attached end of every connector that points at `deletedIds` into a
 * FREE end at the anchor it currently draws at (connector.target_deleted).
 *
 * Story 7's `deleteObjects` calls it INSIDE its own transaction and BEFORE the
 * objects are removed, so the anchors are still computable and the whole
 * operation is one update event: the objects and their arrows' rewritten ends
 * arrive together. A connector whose ends are already free is not written at all.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const ids = new Set(deletedIds);
  if (ids.size === 0) return;
  const objects = objectsMapOf(doc);
  const rects = rectsById(doc);
  const updates: Array<[Y.Map<unknown>, 'from' | 'to', Endpoint]> = [];

  objects.forEach((m) => {
    if (m.get('type') !== CONNECTOR_TYPE) return;
    const ends = readEnds(m);
    if (!ends) return;
    for (const end of ['from', 'to'] as const) {
      const e = ends[end];
      if (e.kind !== 'attached' || !ids.has(e.objectId)) continue;
      const rect = rects.get(e.objectId);
      const fallback = rect
        ? sideAnchor(rect, nearestSide(rect, referencePoint(end === 'from' ? ends.to : ends.from, rects)))
        : e.fallback;
      updates.push([m, end, { kind: 'free', x: fallback.x, y: fallback.y }]);
    }
  });

  if (updates.length === 0) return;
  // The writes land in the caller's transaction when there is one - deleteObjects
  // always calls this from inside its own - and Yjs ignores this origin then. The
  // wrapper only stands in for a caller that forgot to open one.
  doc.transact(() => {
    for (const [m, end, e] of updates) m.set(end, e);
  }, LOCAL_ORIGIN);
}

/** The connector's two stored ends, or null when the id is not a connector. */
export function getConnectorEnds(doc: Y.Doc, id: string): ConnectorEnds | null {
  const m = connectorMapOf(doc, id);
  if (!m) return null;
  return readEnds(m);
}

/** Is this snapshot a connector? Narrows the generic snapshot. */
export function isConnectorSnapshot(obj: ObjectSnapshot): obj is ConnectorSnapshot {
  return obj.type === CONNECTOR_TYPE;
}
