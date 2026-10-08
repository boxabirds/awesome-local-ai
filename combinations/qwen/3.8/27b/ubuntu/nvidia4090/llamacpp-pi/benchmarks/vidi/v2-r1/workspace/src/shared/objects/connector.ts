// Connector objects (story 10, connector.model contract): document schema and
// model operations for arrows between objects.
//
//   objects.<id> : {
//     type:      'connector'
//     x, y:      0        // derived fields; the snapshot computes the bbox
//     z:         number
//     createdAt: number
//     createdBy: string
//     from:      Y.Map  { kind: 'free', x, y }
//                   | Y.Map  { kind: 'attached', objectId, fallback: { x, y } }
//     to:        same shape as `from`
//   }
//
// Attached endpoints store the point where the object was attached (the
// fallback) and re-resolve their side live against the target's current
// bounds (see connector-geometry.ts), so an arrow follows its target.

import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import {
  LOCAL_ORIGIN,
  newObjectId,
  nextZAboveAll,
  objectRectsMap,
  objects,
} from '../board-model';
import {
  nearestSide,
  sideAnchor,
  type Side,
} from '../geometry/connector-geometry';
import type { Point, Rect } from '../geometry';

/** A connector endpoint: a free point, or an attachment to another object
 *  with a stored fallback point (used when the target is gone). */
export type Endpoint =
  | { kind: 'free'; x: number; y: number }
  | { kind: 'attached'; objectId: string; fallback: { x: number; y: number } };

const CONNECTOR_TYPE = 'connector';

function isFiniteXY(x: unknown, y: unknown): boolean {
  return typeof x === 'number' && Number.isFinite(x) &&
         typeof y === 'number' && Number.isFinite(y);
}

/** Validate a plain Endpoint value (API boundary). */
export function isEndpoint(v: unknown): v is Endpoint {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  if (e.kind === 'free') return isFiniteXY(e.x, e.y);
  if (e.kind === 'attached') {
    const fb = e.fallback as Record<string, unknown> | undefined;
    return (
      typeof e.objectId === 'string' &&
      e.objectId.length > 0 &&
      typeof fb === 'object' &&
      fb !== null &&
      isFiniteXY(fb.x, fb.y)
    );
  }
  return false;
}

/** Parse a stored endpoint (a Y.Map) into a plain Endpoint, or null. */
export function parseEndpoint(raw: unknown): Endpoint | null {
  let kind: unknown;
  let x: unknown;
  let y: unknown;
  let objectId: unknown;
  let fallback: { x: unknown; y: unknown } | null = null;
  if (raw instanceof Y.Map) {
    kind = raw.get('kind');
    if (kind === 'free') {
      x = raw.get('x');
      y = raw.get('y');
    } else if (kind === 'attached') {
      objectId = raw.get('objectId');
      const fb = raw.get('fallback');
      if (fb instanceof Y.Map) fallback = { x: fb.get('x'), y: fb.get('y') };
    }
  } else if (typeof raw === 'object' && raw !== null) {
    // Plain objects are accepted too (tests, migrations).
    const r = raw as Record<string, unknown>;
    kind = r.kind;
    if (kind === 'free') {
      x = r.x;
      y = r.y;
    } else if (kind === 'attached') {
      objectId = r.objectId;
      const fb = r.fallback as Record<string, unknown> | undefined;
      if (typeof fb === 'object' && fb !== null) {
        fallback = { x: fb.x, y: fb.y };
      }
    }
  } else {
    return null;
  }
  if (kind === 'free') {
    return isFiniteXY(x, y) ? { kind: 'free', x: x as number, y: y as number } : null;
  }
  if (kind === 'attached') {
    if (typeof objectId !== 'string' || objectId.length === 0 || fallback === null) {
      return null;
    }
    return isFiniteXY(fallback.x, fallback.y)
      ? { kind: 'attached', objectId, fallback: { x: fallback.x as number, y: fallback.y as number } }
      : null;
  }
  return null;
}

/** Serialize a plain Endpoint into the stored Y.Map form (the fallback is a
 *  nested Y.Map so Yjs syncs it like any other document content). */
export function endpointToMap(e: Endpoint): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  if (e.kind === 'free') {
    m.set('kind', 'free');
    m.set('x', e.x);
    m.set('y', e.y);
  } else {
    m.set('kind', 'attached');
    m.set('objectId', e.objectId);
    const fb = new Y.Map<unknown>();
    fb.set('x', e.fallback.x);
    fb.set('y', e.fallback.y);
    m.set('fallback', fb);
  }
  return m;
}

/** Structural equality of two endpoints. */
export function endpointsEqual(a: Endpoint, b: Endpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'free' && b.kind === 'free') return a.x === b.x && a.y === b.y;
  if (a.kind === 'attached' && b.kind === 'attached') {
    return (
      a.objectId === b.objectId &&
      a.fallback.x === b.fallback.x &&
      a.fallback.y === b.fallback.y
    );
  }
  return false;
}

/**
 * The point an endpoint resolves to right now: free points are themselves;
 * attached endpoints use the side midpoint of the target's current bounds
 * (nearest side to `other`'s position), or the stored fallback when the
 * target is gone.
 */
export function endpointAnchor(
  e: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  const pos = (ep: Endpoint): Point => {
    if (ep.kind === 'free') return { x: ep.x, y: ep.y };
    const r = rects.get(ep.objectId);
    if (r === undefined) return { x: ep.fallback.x, y: ep.fallback.y };
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (r === undefined) return { x: e.fallback.x, y: e.fallback.y };
  return sideAnchor(r, nearestSide(r, pos(other)));
}

/**
 * Create a connector between two endpoints. The stored fallback of an
 * attached endpoint is the current resolved anchor. Returns the new id, or
 * null (no transaction) when:
 *  - an endpoint is malformed (non-finite),
 *  - both endpoints attach to the same object,
 *  - the resolved length is below CONNECTOR_MIN_LENGTH_WORLD.
 * One LOCAL_ORIGIN transaction per success; z = maxZ + 1.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }
  const rects = objectRectsMap(doc);
  const a = endpointAnchor(from, to, rects);
  const b = endpointAnchor(to, from, rects);
  if (Math.hypot(b.x - a.x, b.y - a.y) < CONNECTOR_MIN_LENGTH_WORLD) return null;
  const id = newObjectId();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', CONNECTOR_TYPE);
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('z', nextZAboveAll(doc));
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('from', endpointToMap(from));
    obj.set('to', endpointToMap(to));
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Set one endpoint of an existing connector (connector.follow: a drag
 * released on an object re-attaches; released in empty space frees the end).
 * Returns false without a transaction when the endpoint is malformed, the
 * object is missing, or the new endpoint equals the current one. One
 * LOCAL_ORIGIN transaction per success.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  endpoint: Endpoint,
): boolean {
  if (!isEndpoint(endpoint)) return false;
  const obj = objects(doc).get(id);
  if (!obj || obj.get('type') !== CONNECTOR_TYPE) return false;
  const other = parseEndpoint(obj.get(end === 'from' ? 'to' : 'from'));
  if (
    endpoint.kind === 'attached' &&
    other !== null &&
    other.kind === 'attached' &&
    other.objectId === endpoint.objectId
  ) {
    return false; // both ends on one object: never
  }
  const current = parseEndpoint(obj.get(end));
  if (current !== null && endpointsEqual(current, endpoint)) return false;
  doc.transact(() => {
    obj.set(end, endpointToMap(endpoint));
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Re-home the endpoints of every connector that points at one of `deletedIds`
 * (called from deleteObjects, inside the SAME transaction as the deletion):
 * the endpoint becomes a free point at the object's CURRENT anchor
 * (endpointAnchor), so arrows neither dangle in the air nor vanish.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) return;
  const map = objects(doc);
  const deleted = new Set<string>();
  for (const id of deletedIds) {
    if (map.has(id)) deleted.add(id);
  }
  if (deleted.size === 0) return;
  const rects = objectRectsMap(doc);
  for (const [cid, c] of map) {
    if (c.get('type') !== CONNECTOR_TYPE) continue;
    const from = parseEndpoint(c.get('from'));
    const to = parseEndpoint(c.get('to'));
    if (!from || !to) continue;
    let changed = false;
    let nf = from;
    let nt = to;
    if (from.kind === 'attached' && deleted.has(from.objectId)) {
      nf = { kind: 'free', ...endpointAnchor(from, to, rects) };
      changed = true;
    }
    if (to.kind === 'attached' && deleted.has(to.objectId)) {
      nt = { kind: 'free', ...endpointAnchor(to, from, rects) };
      changed = true;
    }
    if (changed) {
      c.set('from', endpointToMap(nf));
      c.set('to', endpointToMap(nt));
    }
  }
}

export type { Side };
