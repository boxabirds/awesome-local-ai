// Connectors (story 10): straight arrows between board objects or fixed board points.
// Framework-free.
//
// objects/<id>: Y.Map {
//   type: 'connector', x: 0, y: 0, width: 0, height: 0, z, createdAt, createdBy,
//   from: Endpoint, to: Endpoint
// }
//
// The stored box is 0; `objectsSnapshot` derives it from the resolved ends. An attached end
// stores no side (it is recomputed from the current rects on every read) and its `fallback` is
// the anchor at attach time, used only when the object has vanished (concurrent delete).
import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import {
  LOCAL_ORIGIN,
  type ObjectSnapshot,
  objectRects,
  objectsSnapshot,
} from '../board-model';
import type { Point, Rect } from '../geometry';
import { resolveEndpoints } from '../geometry/connector-geometry';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap extends ObjectSnapshot {
  readonly type: 'connector';
  readonly from: Endpoint;
  readonly to: Endpoint;
  /** Where the ends are drawn now (derived from the current object rects). */
  readonly ends: { readonly from: Point; readonly to: Point };
}

export function isConnector(obj: ObjectSnapshot): obj is ConnectorSnap {
  return obj.type === 'connector';
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** A valid endpoint (copied, so stored values never alias caller objects), or null. */
export function readEndpoint(v: unknown): Endpoint | null {
  if (typeof v !== 'object' || v === null) return null;
  const e = v as Record<string, unknown>;
  if (e.kind === 'free') return finite(e.x) && finite(e.y) ? { kind: 'free', x: e.x, y: e.y } : null;
  if (e.kind !== 'attached' || typeof e.objectId !== 'string' || e.objectId === '') return null;
  const fb = e.fallback as Record<string, unknown> | null | undefined;
  if (typeof fb !== 'object' || fb === null || !finite(fb.x) || !finite(fb.y)) return null;
  return { kind: 'attached', objectId: e.objectId, fallback: { x: fb.x, y: fb.y } };
}

/** The endpoint fields of a stored connector; a damaged end reads as a free end at the origin. */
export function readConnectorFields(obj: Y.Map<unknown>): Pick<ConnectorSnap, 'from' | 'to'> {
  const origin: Endpoint = { kind: 'free', x: 0, y: 0 };
  return { from: readEndpoint(obj.get('from')) ?? origin, to: readEndpoint(obj.get('to')) ?? origin };
}

/** Free ends a (possibly damaged) stored connector would be drawn at without any objects. */
export function unresolvedEnds(c: Pick<ConnectorSnap, 'from' | 'to'>): ConnectorSnap['ends'] {
  const at = (e: Endpoint) => (e.kind === 'free' ? { x: e.x, y: e.y } : e.fallback);
  return { from: at(c.from), to: at(c.to) };
}

function connectorObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = doc.getMap('objects').get(id);
  return obj instanceof Y.Map && obj.get('type') === 'connector' ? (obj as Y.Map<unknown>) : undefined;
}

/** Stored form of an end, with the fallback of an attached end set to its current anchor. */
function normalise(e: Endpoint, anchor: Point, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (e.kind === 'free') return e;
  // Orphaned (the object is gone): becomes a free end at its fallback point.
  if (!rects.has(e.objectId)) return { kind: 'free', x: e.fallback.x, y: e.fallback.y };
  return { kind: 'attached', objectId: e.objectId, fallback: { x: anchor.x, y: anchor.y } };
}

/**
 * Creates an arrow from `from` to `to` on top of every other object. An attached end whose object
 * is missing (deleted by someone else meanwhile) is still stored attached and drawn at its
 * fallback. Returns null, writing nothing, for invalid ends, both ends on the same object, an
 * end on a connector, or ends closer than CONNECTOR_MIN_LENGTH_WORLD.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  const a = readEndpoint(from);
  const b = readEndpoint(to);
  if (!a || !b) return null;
  if (a.kind === 'attached' && b.kind === 'attached' && a.objectId === b.objectId) return null;
  const objects = doc.getMap('objects');
  for (const e of [a, b]) {
    if (e.kind === 'attached' && objects.get(e.objectId) instanceof Y.Map) {
      if ((objects.get(e.objectId) as Y.Map<unknown>).get('type') === 'connector') return null;
    }
  }
  const rects = objectRects(doc);
  const ends = resolveEndpoints({ from: a, to: b }, rects);
  if (Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y) < CONNECTOR_MIN_LENGTH_WORLD) {
    return null;
  }
  const withFallback = (e: Endpoint, anchor: Point): Endpoint =>
    e.kind === 'attached' && rects.has(e.objectId) ? { ...e, fallback: { ...anchor } } : e;
  const id = crypto.randomUUID();
  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((o) => {
      const z = o instanceof Y.Map ? o.get('z') : undefined;
      if (typeof z === 'number' && Number.isFinite(z)) maxZ = Math.max(maxZ, z);
    });
    const obj = new Y.Map<unknown>();
    obj.set('type', 'connector');
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('z', maxZ + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('from', withFallback(a, ends.from));
    obj.set('to', withFallback(b, ends.to));
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  if (a.kind === 'free' && b.kind === 'free') return a.x === b.x && a.y === b.y;
  return a.kind === 'attached' && b.kind === 'attached' && a.objectId === b.objectId;
}

/**
 * Re-attaches (to an existing object) or frees (at a board point) one end. The other end is
 * normalised if its object has vanished. False, writing nothing, for a stale connector id, an
 * invalid end, the object at the other end, a missing object or a connector, or no change.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const obj = connectorObject(doc, id);
  const next = readEndpoint(e);
  if (!obj || !next) return false;
  const fields = readConnectorFields(obj);
  const otherEnd = end === 'from' ? 'to' : 'from';
  const other = fields[otherEnd];
  const rects = objectRects(doc);
  if (next.kind === 'attached') {
    if (next.objectId === id || !rects.has(next.objectId)) return false;
    if (other.kind === 'attached' && other.objectId === next.objectId) return false;
  }
  if (sameEndpoint(fields[end], next)) return false;
  const pair = end === 'from' ? { from: next, to: other } : { from: other, to: next };
  const ends = resolveEndpoints(pair, rects);
  const otherNormalised = normalise(other, ends[otherEnd], rects);
  doc.transact(() => {
    obj.set(end, normalise(next, ends[end], rects));
    if (!sameEndpoint(other, otherNormalised)) obj.set(otherEnd, otherNormalised);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Frees every arrow end attached to one of `deletedIds` at the point where it is attached now.
 * Writes directly: call it inside the caller's (deleting) transaction.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const deleted = new Set(deletedIds);
  const snapshot = objectsSnapshot(doc);
  const touched = snapshot.filter(
    (o): o is ConnectorSnap =>
      isConnector(o) &&
      !deleted.has(o.id) &&
      [o.from, o.to].some((e) => e.kind === 'attached' && deleted.has(e.objectId)),
  );
  if (touched.length === 0) return;
  const rects = objectRects(doc);
  const objects = doc.getMap('objects');
  for (const c of touched) {
    const ends = resolveEndpoints(c, rects);
    const obj = objects.get(c.id) as Y.Map<unknown>;
    for (const end of ['from', 'to'] as const) {
      const e = c[end];
      if (e.kind === 'attached' && deleted.has(e.objectId)) {
        obj.set(end, { kind: 'free', x: ends[end].x, y: ends[end].y });
      }
    }
  }
}

/**
 * Moves an arrow with a moved selection: its free ends become `start`'s free ends shifted by
 * (dx, dy); attached ends follow their objects anyway. Writes directly (the caller's
 * transaction, if any). False when nothing changed or the connector is gone.
 */
export function translateConnector(doc: Y.Doc, start: ConnectorSnap, dx: number, dy: number): boolean {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  const obj = connectorObject(doc, start.id);
  if (!obj) return false;
  let changed = false;
  doc.transact(() => {
    for (const end of ['from', 'to'] as const) {
      const e = start[end];
      if (e.kind !== 'free') continue;
      const current = readEndpoint(obj.get(end));
      const next: Endpoint = { kind: 'free', x: e.x + dx, y: e.y + dy };
      if (current && sameEndpoint(current, next)) continue;
      obj.set(end, next);
      changed = true;
    }
  }, LOCAL_ORIGIN);
  return changed;
}
