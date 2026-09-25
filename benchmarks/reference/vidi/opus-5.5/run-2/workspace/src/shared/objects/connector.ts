/**
 * Arrows between board objects (anchor: connector.model).
 *
 *   objects/<id>: Y.Map { type: 'connector', x: 0, y: 0, width: 0, height: 0, z, createdAt,
 *                         createdBy, from: Endpoint, to: Endpoint }
 *   Endpoint = { kind: 'attached', objectId, fallback: {x, y} } | { kind: 'free', x, y }
 *
 * Attached ends store no side: `resolveEndpoints` picks the facing side from the current
 * rects on every snapshot, so arrows follow anyone's moves without writes. `fallback` is the
 * anchor at attach time, drawn only when the object vanished concurrently (orphaned end).
 * The snapshot derives x/y/width/height from the resolved ends.
 *
 * Every successful mutation is one LOCAL_ORIGIN transaction; rejections write nothing.
 */
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  nextZ,
  objectRect,
  objectType,
  registerDeleteHook,
  registerSnapshotReader,
  registerSnapshotResolver,
  type ObjectSnapshot,
} from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Point, Rect } from '../geometry';
import { anchorToward, connectorBBox, rectCentre, resolveEndpoints } from '../geometry/connector-geometry';

export const CONNECTOR_TYPE = 'connector';

export type Endpoint = { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  /** Resolved ends (world units) for the rects at snapshot time. */
  fromPoint: Point;
  toPoint: Point;
}

export function isConnectorSnap(obj: ObjectSnapshot): obj is ConnectorSnap {
  return obj.type === CONNECTOR_TYPE;
}

function finite(...values: unknown[]): boolean {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function isPoint(v: unknown): v is Point {
  return typeof v === 'object' && v !== null && finite((v as Point).x, (v as Point).y);
}

/** A well-formed endpoint (finite numbers, non-empty object id), or null. */
export function parseEndpoint(v: unknown): Endpoint | null {
  if (typeof v !== 'object' || v === null) return null;
  const e = v as Record<string, unknown>;
  if (e.kind === 'free' && finite(e.x, e.y)) return { kind: 'free', x: e.x as number, y: e.y as number };
  if (e.kind === 'attached' && typeof e.objectId === 'string' && e.objectId !== '' && isPoint(e.fallback)) {
    return { kind: 'attached', objectId: e.objectId, fallback: { x: e.fallback.x, y: e.fallback.y } };
  }
  return null;
}

const UNREADABLE_END: Endpoint = { kind: 'free', x: 0, y: 0 };

registerSnapshotReader(CONNECTOR_TYPE, (base, obj): ConnectorSnap => {
  const from = parseEndpoint(obj.get('from')) ?? UNREADABLE_END;
  const to = parseEndpoint(obj.get('to')) ?? UNREADABLE_END;
  return { ...base, type: CONNECTOR_TYPE, from, to, fromPoint: { x: 0, y: 0 }, toPoint: { x: 0, y: 0 } };
});

registerSnapshotResolver(CONNECTOR_TYPE, (snap, rects) => {
  if (!isConnectorSnap(snap)) return snap;
  const ends = resolveEndpoints(snap, rects);
  return { ...snap, ...connectorBBox(ends.from, ends.to), fromPoint: ends.from, toPoint: ends.to };
});

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function connectorMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  return obj instanceof Y.Map && obj.get('type') === CONNECTOR_TYPE ? obj : undefined;
}

/** Current rects of the objects the ends are attached to (missing ones are absent). */
function rectsOf(doc: Y.Doc, ...ends: Endpoint[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const e of ends) {
    if (e.kind !== 'attached') continue;
    const r = objectRect(doc, e.objectId);
    if (r !== undefined) rects.set(e.objectId, r);
  }
  return rects;
}

function otherReference(other: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (other.kind === 'free') return { x: other.x, y: other.y };
  const r = rects.get(other.objectId);
  return r === undefined ? other.fallback : rectCentre(r);
}

/** The attached end with its fallback set to its current anchor (unchanged when its object is missing). */
function withFallback(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (e.kind !== 'attached') return e;
  const r = rects.get(e.objectId);
  if (r === undefined) return e;
  return { ...e, fallback: anchorToward(r, otherReference(other, rects)) };
}

/** An end can attach to any existing object except a connector (arrows join objects, not arrows). */
function attachable(doc: Y.Doc, e: Endpoint): boolean {
  if (e.kind !== 'attached') return true;
  return objectType(doc, e.objectId) !== CONNECTOR_TYPE;
}

function length(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Creates an arrow above every other object (connector.create_attached, connector.create_free).
 * Null, with nothing written, when both ends attach to the same object, an end is malformed
 * or attaches to a connector, or the resolved arrow is shorter than CONNECTOR_MIN_LENGTH_WORLD
 * (connector.no_accidental). An end attached to an object that is already gone is kept with
 * the given fallback (connector.target_deleted race).
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  const f = parseEndpoint(from);
  const t = parseEndpoint(to);
  if (f === null || t === null) return null;
  if (f.kind === 'attached' && t.kind === 'attached' && f.objectId === t.objectId) return null;
  if (!attachable(doc, f) || !attachable(doc, t)) return null;
  const rects = rectsOf(doc, f, t);
  const ends = resolveEndpoints({ from: f, to: t }, rects);
  if (length(ends.from, ends.to) < CONNECTOR_MIN_LENGTH_WORLD) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', CONNECTOR_TYPE);
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('from', withFallback(f, t, rects));
    obj.set('to', withFallback(t, f, rects));
    obj.set('z', nextZ(doc));
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** An attached end whose object is gone becomes free at its fallback (orphaned → free). */
function normalised(e: Endpoint, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (e.kind === 'attached' && !rects.has(e.objectId)) return { kind: 'free', x: e.fallback.x, y: e.fallback.y };
  return e;
}

/**
 * Re-attaches or detaches one end (connector.reattach). False, with nothing written, for a
 * stale connector id, a malformed end, attaching to the object at the opposite end (or to
 * a connector), or no change. An orphaned opposite end is normalised to free in the same write.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const obj = connectorMap(doc, id);
  const next = parseEndpoint(e);
  if (obj === undefined || next === null) return false;
  const otherKey = end === 'from' ? 'to' : 'from';
  const otherStored = parseEndpoint(obj.get(otherKey)) ?? UNREADABLE_END;
  if (next.kind === 'attached') {
    if (next.objectId === id || !attachable(doc, next)) return false;
    if (otherStored.kind === 'attached' && otherStored.objectId === next.objectId) return false;
  }
  const rects = rectsOf(doc, next, otherStored);
  const other = normalised(otherStored, rects);
  const value = withFallback(next, other, rects);
  const current = parseEndpoint(obj.get(end));
  const otherChanged = !sameEndpoint(other, otherStored);
  if (current !== null && sameEndpoint(current, value) && !otherChanged) return false;
  doc.transact(() => {
    obj.set(end, value);
    if (otherChanged) obj.set(otherKey, other);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Converts every end attached to one of `deletedIds` into a free end at its current anchor
 * (connector.target_deleted). Must run inside the caller's open transaction, before the
 * objects are removed. Connectors that are themselves being deleted are left alone.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const deleted = new Set(deletedIds);
  objectsMap(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map) || obj.get('type') !== CONNECTOR_TYPE || deleted.has(id)) return;
    const from = parseEndpoint(obj.get('from'));
    const to = parseEndpoint(obj.get('to'));
    if (from === null || to === null) return;
    const hit = (e: Endpoint) => e.kind === 'attached' && deleted.has(e.objectId);
    if (!hit(from) && !hit(to)) return;
    const ends = resolveEndpoints({ from, to }, rectsOf(doc, from, to));
    if (hit(from)) obj.set('from', { kind: 'free', x: ends.from.x, y: ends.from.y });
    if (hit(to)) obj.set('to', { kind: 'free', x: ends.to.x, y: ends.to.y });
  });
}

registerDeleteHook(detachConnectorsTo);

/**
 * Moves an arrow by `d` from its state `start` (story 7 move and nudge): free ends move,
 * attached ends stay with their objects. Absolute from `start`, so repeated frames converge.
 */
export function moveConnector(doc: Y.Doc, start: ConnectorSnap, d: Point): boolean {
  const obj = connectorMap(doc, start.id);
  if (obj === undefined || !finite(d.x, d.y)) return false;
  const shift = (e: Endpoint): Endpoint | null => (e.kind === 'free' ? { kind: 'free', x: e.x + d.x, y: e.y + d.y } : null);
  const from = shift(start.from);
  const to = shift(start.to);
  const changes: ['from' | 'to', Endpoint][] = [];
  if (from !== null && !sameEndpoint(from, parseEndpoint(obj.get('from')) ?? UNREADABLE_END)) changes.push(['from', from]);
  if (to !== null && !sameEndpoint(to, parseEndpoint(obj.get('to')) ?? UNREADABLE_END)) changes.push(['to', to]);
  if (changes.length === 0) return false;
  doc.transact(() => {
    for (const [key, value] of changes) obj.set(key, value);
  }, LOCAL_ORIGIN);
  return true;
}
