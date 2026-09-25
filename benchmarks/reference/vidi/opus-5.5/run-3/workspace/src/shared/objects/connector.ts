// Connectors (story 10): straight arrows between two ends, each attached to an object or free on the board.
//
// objects/<id>: Y.Map { type: 'connector', x: 0, y: 0, width: 0, height: 0, z, createdAt, createdBy,
//                       from: Endpoint, to: Endpoint }
// Endpoint = { kind: 'attached', objectId, fallback: { x, y } } | { kind: 'free', x, y }   (plain JSON values)
//
// Attached ends store no side: `objectSnapshot` resolves both ends from the objects' current rects every time
// (resolveEndpoints), so an arrow follows local and remote moves without any write and switches sides as objects
// pass each other. The stored box is 0; the snapshot's x, y, width, height are the resolved ends' bounding box.
// `fallback` is the anchor when the end was attached; it is drawn only if the object vanished concurrently.
//
// Every successful mutation is one LOCAL_ORIGIN transaction; rejected calls return null/false without one.
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  maxZ,
  objectSnapshot,
  registerDeleteHook,
  registerPositionPlanner,
  registerSnapshotFinisher,
  registerSnapshotReader,
  type ObjectSnapshot,
} from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Point, Rect } from '../geometry';
import { connectorBBox, nearestSide, resolveEndpoints, sideAnchor } from '../geometry/connector-geometry';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  /** Both ends resolved against the board this snapshot was taken from. */
  ends: readonly [Point, Point];
}

export function isConnector(obj: ObjectSnapshot): obj is ConnectorSnap {
  return obj.type === 'connector';
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPoint(p: unknown): p is Point {
  return typeof p === 'object' && p !== null && isFiniteNumber((p as Point).x) && isFiniteNumber((p as Point).y);
}

/** A well-formed endpoint (copied, so stored values never alias caller objects), or null. */
export function parseEndpoint(v: unknown): Endpoint | null {
  if (typeof v !== 'object' || v === null) return null;
  const e = v as Record<string, unknown>;
  if (e.kind === 'free' && isFiniteNumber(e.x) && isFiniteNumber(e.y)) return { kind: 'free', x: e.x, y: e.y };
  if (e.kind === 'attached' && typeof e.objectId === 'string' && e.objectId !== '' && isPoint(e.fallback)) {
    return { kind: 'attached', objectId: e.objectId, fallback: { x: e.fallback.x, y: e.fallback.y } };
  }
  return null;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function getConnectorMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map && obj.get('type') === 'connector' ? obj : undefined;
}

/** World rects of every object an end can attach to (everything but connectors), by id. */
export function attachableRects(objects: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const o of objects) {
    if (o.type !== 'connector') rects.set(o.id, { x: o.x, y: o.y, width: o.width, height: o.height });
  }
  return rects;
}

function currentRects(doc: Y.Doc): Map<string, Rect> {
  return attachableRects(objectSnapshot(doc));
}

/** `e` with an attached end's fallback set to its anchor on the board now (kept when the object is gone). */
function withFallback(e: Endpoint, other: Point, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (e.kind === 'free') return e;
  const r = rects.get(e.objectId);
  return r ? { ...e, fallback: sideAnchor(r, nearestSide(r, other)) } : e;
}

function withFallbacks(from: Endpoint, to: Endpoint, rects: ReadonlyMap<string, Rect>): [Endpoint, Endpoint] {
  const ends = resolveEndpoints({ from, to }, rects);
  return [withFallback(from, ends.to, rects), withFallback(to, ends.from, rects)];
}

registerSnapshotReader('connector', (_id, obj, base) => {
  const from = parseEndpoint(obj.get('from'));
  const to = parseEndpoint(obj.get('to'));
  if (!from || !to) return null;
  // The ends and box are filled in by the finisher below, once every object's rect is known.
  return { ...base, type: 'connector', from, to, ends: [base, base], x: 0, y: 0, width: 0, height: 0 } satisfies ConnectorSnap;
});

registerSnapshotFinisher((objects) => {
  if (!objects.some(isConnector)) return [...objects];
  const rects = attachableRects(objects);
  return objects.map((o) => {
    if (!isConnector(o)) return o;
    const { from, to } = resolveEndpoints(o, rects);
    return Object.freeze({ ...o, ...connectorBBox(from, to), ends: [from, to] as const });
  });
});

// Moving a connector (on its own or with a group) moves its free ends; attached ends stay with their objects.
registerPositionPlanner('connector', (obj, current, to) => {
  const dx = to.x - current.x;
  const dy = to.y - current.y;
  if (dx === 0 && dy === 0) return null;
  const shift = (v: unknown): Endpoint | null => {
    const e = parseEndpoint(v);
    return e && e.kind === 'free' ? { kind: 'free', x: e.x + dx, y: e.y + dy } : null;
  };
  const from = shift(obj.get('from'));
  const toEnd = shift(obj.get('to'));
  if (!from && !toEnd) return null;
  return () => {
    if (from) obj.set('from', from);
    if (toEnd) obj.set('to', toEnd);
  };
});

/** Resolved length of a would-be connector on the current board. */
function resolvedLength(from: Endpoint, to: Endpoint, rects: ReadonlyMap<string, Rect>): number {
  const ends = resolveEndpoints({ from, to }, rects);
  return Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y);
}

/**
 * Adds an arrow from `from` to `to` above all other objects. Attached ends get their fallback from the board now
 * (the caller's fallback is kept if the object has just been deleted by someone else). Returns null, writing
 * nothing, for malformed ends, both ends on the same object, or a length below CONNECTOR_MIN_LENGTH_WORLD.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  const f = parseEndpoint(from);
  const t = parseEndpoint(to);
  if (!f || !t) return null;
  if (f.kind === 'attached' && t.kind === 'attached' && f.objectId === t.objectId) return null;
  const rects = currentRects(doc);
  if (resolvedLength(f, t, rects) < CONNECTOR_MIN_LENGTH_WORLD) return null;
  const [fromEnd, toEnd] = withFallbacks(f, t, rects);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'connector');
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('from', fromEnd);
    obj.set('to', toEnd);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objectsOf(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Re-attaches (attached) or detaches (free) one end. False, writing nothing, for a stale connector id, a malformed
 * end, or attaching to the object the other end is attached to. An other end whose object has vanished is made
 * free at its fallback in the same write.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const next = parseEndpoint(e);
  if (!next) return false;
  const obj = getConnectorMap(doc, id);
  if (!obj) return false;
  const otherKey = end === 'from' ? 'to' : 'from';
  let other = parseEndpoint(obj.get(otherKey));
  if (!other) return false;
  if (next.kind === 'attached' && other.kind === 'attached' && other.objectId === next.objectId) return false;
  const rects = currentRects(doc);
  if (other.kind === 'attached' && !rects.has(other.objectId)) {
    other = { kind: 'free', x: other.fallback.x, y: other.fallback.y };
  }
  const [a, b] = end === 'from' ? withFallbacks(next, other, rects) : withFallbacks(other, next, rects);
  const [mine, theirs] = end === 'from' ? [a, b] : [b, a];
  const same = (x: unknown, y: Endpoint) => JSON.stringify(parseEndpoint(x)) === JSON.stringify(y);
  if (same(obj.get(end), mine) && same(obj.get(otherKey), theirs)) return false;
  doc.transact(() => {
    obj.set(end, mine);
    if (!same(obj.get(otherKey), theirs)) obj.set(otherKey, theirs);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Makes every end attached to one of `deletedIds` free at the point it is drawn at now. Writes directly: call it
 * inside the deleting transaction, before the objects are removed (board-model's deleteObjects does, through its
 * delete hook).
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const gone = new Set(deletedIds);
  const affected: Array<[Y.Map<unknown>, Endpoint, Endpoint]> = [];
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map) || obj.get('type') !== 'connector' || gone.has(id)) return;
    const from = parseEndpoint(obj.get('from'));
    const to = parseEndpoint(obj.get('to'));
    if (!from || !to) return;
    const hit = (e: Endpoint) => e.kind === 'attached' && gone.has(e.objectId);
    if (hit(from) || hit(to)) affected.push([obj, from, to]);
  });
  if (affected.length === 0) return;
  const rects = currentRects(doc);
  for (const [obj, from, to] of affected) {
    const ends = resolveEndpoints({ from, to }, rects);
    if (from.kind === 'attached' && gone.has(from.objectId)) obj.set('from', { kind: 'free', ...ends.from });
    if (to.kind === 'attached' && gone.has(to.objectId)) obj.set('to', { kind: 'free', ...ends.to });
  }
}

registerDeleteHook(detachConnectorsTo);
