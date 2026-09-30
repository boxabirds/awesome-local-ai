// Connectors (story 10): straight arrows between board objects or board points.
//
// objects/<id>: Y.Map {
//   type: 'connector', x: 0, y: 0, width: 0, height: 0, z, createdAt, createdBy,
//   from: Endpoint, to: Endpoint
// }
// Attached ends store no side: it is recomputed from the current rects on every
// snapshot, so arrows follow (and switch sides) when anyone moves an object.
// `fallback` is the anchor at attach time, drawn only if the object vanished
// concurrently. The box is derived in `objectsSnapshot`.
import * as Y from 'yjs';
import { type ObjectSnapshot, LOCAL_ORIGIN, getObject, maxZ, objectRects, objectsMap } from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Point, Rect } from '../geometry';
import {
  type Endpoint,
  nearestSide,
  reference,
  resolveEndpoints,
  sideAnchor,
} from '../geometry/connector-geometry';

export type { Endpoint } from '../geometry/connector-geometry';

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  /** Resolved end points at snapshot time (world units). */
  ends: { from: Point; to: Point };
}

export function isConnector(obj: ObjectSnapshot): obj is ConnectorSnap {
  return obj.type === 'connector';
}

function isFinitePoint(p: unknown): p is Point {
  if (typeof p !== 'object' || p === null) return false;
  const { x, y } = p as { x?: unknown; y?: unknown };
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y);
}

/** Validates a stored or requested endpoint. */
export function isEndpoint(value: unknown): value is Endpoint {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  if (e.kind === 'free') return isFinitePoint(e);
  if (e.kind === 'attached') return typeof e.objectId === 'string' && e.objectId !== '' && isFinitePoint(e.fallback);
  return false;
}

/** A plain copy (what is stored in the document). */
function plain(e: Endpoint): Endpoint {
  return e.kind === 'free'
    ? { kind: 'free', x: e.x, y: e.y }
    : { kind: 'attached', objectId: e.objectId, fallback: { x: e.fallback.x, y: e.fallback.y } };
}

function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  return JSON.stringify(plain(a)) === JSON.stringify(plain(b));
}

/** Where the arrow's end would attach on `r` given the other end. */
export function anchorToward(r: Rect, other: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  return sideAnchor(r, nearestSide(r, reference(other, rects)));
}

/**
 * Stores the current anchor as the fallback of attached ends whose object exists;
 * an end whose object is missing keeps the caller's fallback (drawn there).
 */
function withFallbacks(from: Endpoint, to: Endpoint, rects: ReadonlyMap<string, Rect>): [Endpoint, Endpoint] {
  const ends = resolveEndpoints({ from, to }, rects);
  const fix = (e: Endpoint, p: Point): Endpoint =>
    e.kind === 'attached' && rects.has(e.objectId) ? { kind: 'attached', objectId: e.objectId, fallback: p } : plain(e);
  return [fix(from, ends.from), fix(to, ends.to)];
}

/**
 * Creates an arrow from `from` to `to`, above every other object. Null, and
 * nothing written, when both ends attach to the same object, an end attaches to
 * another connector, an endpoint is invalid, or the arrow would be shorter than
 * CONNECTOR_MIN_LENGTH_WORLD. An end attached to an object that is already gone
 * (deleted concurrently) is kept and drawn at its fallback.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;
  const rects = objectRects(doc);
  for (const e of [from, to]) {
    // Present but not attachable (a connector or an unknown type).
    if (e.kind === 'attached' && objectsMap(doc).has(e.objectId) && !rects.has(e.objectId)) return null;
  }
  const [f, t] = withFallbacks(from, to, rects);
  const ends = resolveEndpoints({ from: f, to: t }, rects);
  if (Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y) < CONNECTOR_MIN_LENGTH_WORLD) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'connector');
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('from', f);
    obj.set('to', t);
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

function getConnectorObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = getObject(doc, id);
  return obj && obj.get('type') === 'connector' ? obj : undefined;
}

/**
 * Re-attaches (or frees) one end of an arrow. False, and nothing written, for a
 * stale connector id, an invalid endpoint, an object that cannot be attached
 * (missing, a connector, the arrow itself) or the object at the other end.
 * An orphaned other end (its object is gone) is normalised to a free end at its fallback.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  if (!isEndpoint(e)) return false;
  const obj = getConnectorObject(doc, id);
  if (!obj) return false;
  const otherKey = end === 'from' ? 'to' : 'from';
  const stored = obj.get(otherKey);
  if (!isEndpoint(stored)) return false;
  let other: Endpoint = stored;
  const rects = objectRects(doc);
  if (e.kind === 'attached') {
    if (e.objectId === id || !rects.has(e.objectId)) return false;
    if (other.kind === 'attached' && other.objectId === e.objectId) return false;
  }
  if (other.kind === 'attached' && !rects.has(other.objectId)) {
    other = { kind: 'free', x: other.fallback.x, y: other.fallback.y };
  }
  const [next, otherNext] = end === 'from' ? withFallbacks(e, other, rects) : withFallbacks(other, e, rects).reverse();
  const current = obj.get(end);
  const otherCurrent = obj.get(otherKey);
  const changed = !isEndpoint(current) || !sameEndpoint(current, next!);
  const otherChanged = !isEndpoint(otherCurrent) || !sameEndpoint(otherCurrent, otherNext!);
  if (!changed && !otherChanged) return false;
  doc.transact(() => {
    if (changed) obj.set(end, next);
    if (otherChanged) obj.set(otherKey, otherNext);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Frees every arrow end attached to one of `deletedIds` at the point where it is
 * attached now, so the arrows stay. Writes directly: call inside the caller's
 * open transaction (story 7's `deleteObjects`), before removing the objects.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  const deleted = new Set(deletedIds);
  if (deleted.size === 0) return;
  const rects = objectRects(doc);
  for (const [id, obj] of objectsMap(doc)) {
    if (deleted.has(id) || !(obj instanceof Y.Map) || obj.get('type') !== 'connector') continue;
    const from = obj.get('from');
    const to = obj.get('to');
    if (!isEndpoint(from) || !isEndpoint(to)) continue;
    const hit = (e: Endpoint) => e.kind === 'attached' && deleted.has(e.objectId);
    if (!hit(from) && !hit(to)) continue;
    const ends = resolveEndpoints({ from, to }, rects);
    if (hit(from)) obj.set('from', { kind: 'free', x: ends.from.x, y: ends.from.y });
    if (hit(to)) obj.set('to', { kind: 'free', x: ends.to.x, y: ends.to.y });
  }
}

/**
 * Moves an arrow by `delta` from its state `start` (a snapshot): its free ends
 * move, attached ends stay with their objects. Writes directly: call inside a transaction.
 */
export function translateConnector(obj: Y.Map<unknown>, start: { from: Endpoint; to: Endpoint }, delta: Point): boolean {
  let changed = false;
  for (const key of ['from', 'to'] as const) {
    const s = start[key];
    const current = obj.get(key);
    // Only an end that is still free (not re-attached meanwhile) moves.
    if (s.kind !== 'free' || !isEndpoint(current) || current.kind !== 'free') continue;
    const x = s.x + delta.x;
    const y = s.y + delta.y;
    if (current.x === x && current.y === y) continue;
    obj.set(key, { kind: 'free', x, y });
    changed = true;
  }
  return changed;
}

/** Stored endpoints of a connector (invalid data → undefined). */
export function connectorEnds(obj: Y.Map<unknown>): { from: Endpoint; to: Endpoint } | undefined {
  const from = obj.get('from');
  const to = obj.get('to');
  return isEndpoint(from) && isEndpoint(to) ? { from, to } : undefined;
}

/**
 * Group resize: maps the arrow's free ends from its box in `start` (a snapshot
 * taken when the resize began) into `to`; attached ends stay with their objects.
 * One LOCAL_ORIGIN transaction; false when nothing changes.
 */
export function scaleConnector(doc: Y.Doc, start: ObjectSnapshot, to: Rect): boolean {
  const obj = getConnectorObject(doc, start.id);
  if (!obj || !start.from || !start.to) return false;
  const sx = start.width > 0 ? to.width / start.width : 1;
  const sy = start.height > 0 ? to.height / start.height : 1;
  const map = (e: Endpoint): Endpoint =>
    e.kind === 'free' ? { kind: 'free', x: to.x + (e.x - start.x) * sx, y: to.y + (e.y - start.y) * sy } : e;
  const next = { from: map(start.from), to: map(start.to) };
  if (![next.from, next.to].every(isEndpoint)) return false;
  let changed = false;
  doc.transact(() => {
    for (const key of ['from', 'to'] as const) {
      const current = obj.get(key);
      const n = next[key];
      // Only an end that is still free (not re-attached meanwhile) moves.
      if (n.kind !== 'free' || !isEndpoint(current) || current.kind !== 'free' || sameEndpoint(current, n)) continue;
      obj.set(key, n);
      changed = true;
    }
  }, LOCAL_ORIGIN);
  return changed;
}
