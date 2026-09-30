// Connectors (story 10, connector.model): straight arrows whose ends are
// either attached to a board object or fixed at a board point.
//
// objects/<id>: Y.Map {
//   type: 'connector', x: 0, y: 0, width: 0, height: 0, z, createdAt, createdBy,
//   from: Endpoint, to: Endpoint
// }
//
// Attached ends store no side: `resolveEndpoints` picks the side nearest the
// other end from the current rects every time, so arrows follow moves and
// resizes by anyone without writes. `fallback` is the anchor at attach time,
// drawn when the target is missing (deleted concurrently). x/y/width/height
// are derived in `objectsSnapshot` from the resolved ends.
import * as Y from 'yjs';
import {
  getObject,
  getObjectsMap,
  isFiniteNumber,
  LOCAL_ORIGIN,
  maxZ,
  objectsSnapshot,
  registerDeleteHook,
  registerModelType,
  storedRects,
  type ObjectSnapshot,
} from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Point, Rect } from '../geometry';
import { anchorToward, connectorBBox, rectCentre, resolveEndpointPair } from '../geometry/connector-geometry';

export const CONNECTOR_TYPE = 'connector';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  /** Both ends resolved against the current rects (what is drawn). */
  ends: { from: Point; to: Point };
  createdBy: string;
}

export function isConnector(obj: ObjectSnapshot): obj is ConnectorSnap {
  return obj.type === CONNECTOR_TYPE;
}

function isFinitePoint(p: unknown): p is Point {
  return typeof p === 'object' && p !== null && isFiniteNumber((p as Point).x) && isFiniteNumber((p as Point).y);
}

/** A validated copy of a stored or supplied endpoint; null when malformed or non-finite. */
export function parseEndpoint(e: unknown): Endpoint | null {
  if (typeof e !== 'object' || e === null) return null;
  const v = e as Record<string, unknown>;
  if (v.kind === 'free') {
    return isFiniteNumber(v.x) && isFiniteNumber(v.y) ? { kind: 'free', x: v.x, y: v.y } : null;
  }
  if (v.kind === 'attached') {
    if (typeof v.objectId !== 'string' || v.objectId === '' || !isFinitePoint(v.fallback)) return null;
    return { kind: 'attached', objectId: v.objectId, fallback: { x: v.fallback.x, y: v.fallback.y } };
  }
  return null;
}

const ORIGIN_END: Endpoint = { kind: 'free', x: 0, y: 0 };

function readConnector(base: ObjectSnapshot, obj: Y.Map<unknown>): ConnectorSnap {
  const from = parseEndpoint(obj.get('from')) ?? ORIGIN_END;
  const to = parseEndpoint(obj.get('to')) ?? ORIGIN_END;
  const createdBy = obj.get('createdBy');
  return {
    ...base,
    type: 'connector',
    from,
    to,
    ends: { from: pointOf(from), to: pointOf(to) },
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}

function pointOf(e: Endpoint): Point {
  return e.kind === 'free' ? { x: e.x, y: e.y } : e.fallback;
}

/** Snapshot geometry follows the attached objects' current rects (connector.follow). */
function deriveConnector(snap: ObjectSnapshot, rects: ReadonlyMap<string, Rect>): ConnectorSnap {
  const c = snap as ConnectorSnap;
  const ends = resolveEndpointPair(c.from, c.to, rects);
  return { ...c, ...connectorBBox(ends.from, ends.to), ends };
}

registerModelType(CONNECTOR_TYPE, readConnector, deriveConnector);
registerDeleteHook((doc, ids) => detachConnectorsTo(doc, ids));

function getConnectorObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = getObject(doc, id);
  return obj?.get('type') === CONNECTOR_TYPE ? obj : undefined;
}

/** Current rects of every attachable (non-connector) object. */
function currentRects(doc: Y.Doc): Map<string, Rect> {
  return storedRects(objectsSnapshot(doc));
}

/**
 * Attached ends get their fallback recomputed from the target's current rect
 * (the anchor facing the other end); a missing target keeps the supplied one.
 */
function normalise(from: Endpoint, to: Endpoint, rects: ReadonlyMap<string, Rect>): { from: Endpoint; to: Endpoint } {
  const ends = resolveEndpointPair(from, to, rects);
  const fix = (e: Endpoint, p: Point): Endpoint =>
    e.kind === 'attached' && rects.has(e.objectId) ? { ...e, fallback: { x: p.x, y: p.y } } : e;
  return { from: fix(from, ends.from), to: fix(to, ends.to) };
}

function length(from: Endpoint, to: Endpoint, rects: ReadonlyMap<string, Rect>): number {
  const ends = resolveEndpointPair(from, to, rects);
  return Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y);
}

/**
 * Creates an arrow on top of every object. Null (nothing written) for a
 * malformed end, both ends on the same object, or a resolved length below
 * CONNECTOR_MIN_LENGTH_WORLD (connector.no_accidental).
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  const f = parseEndpoint(from);
  const t = parseEndpoint(to);
  if (!f || !t) return null;
  if (f.kind === 'attached' && t.kind === 'attached' && f.objectId === t.objectId) return null;
  const rects = currentRects(doc);
  if (!(length(f, t, rects) >= CONNECTOR_MIN_LENGTH_WORLD)) return null;
  const ends = normalise(f, t, rects);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', CONNECTOR_TYPE);
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('from', ends.from);
    obj.set('to', ends.to);
    getObjectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Both stored ends of a connector, or null for a stale id. */
export function getConnectorEnds(doc: Y.Doc, id: string): { from: Endpoint; to: Endpoint } | null {
  const obj = getConnectorObject(doc, id);
  if (!obj) return null;
  return { from: parseEndpoint(obj.get('from')) ?? ORIGIN_END, to: parseEndpoint(obj.get('to')) ?? ORIGIN_END };
}

/**
 * Re-attaches or detaches one end (connector.reattach). False, with nothing
 * written, for a stale id, a malformed/non-finite endpoint, or attaching to
 * the object at the opposite end.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const next = parseEndpoint(e);
  const obj = getConnectorObject(doc, id);
  const current = getConnectorEnds(doc, id);
  if (!next || !obj || !current) return false;
  const other = end === 'from' ? current.to : current.from;
  if (next.kind === 'attached' && other.kind === 'attached' && other.objectId === next.objectId) return false;
  const rects = currentRects(doc);
  const pair = end === 'from' ? normalise(next, other, rects) : normalise(other, next, rects);
  doc.transact(() => {
    obj.set(end, end === 'from' ? pair.from : pair.to);
    // The orphaned other end (target gone) is normalised to its fallback point.
    if (other.kind === 'attached' && !rects.has(other.objectId)) {
      obj.set(end === 'from' ? 'to' : 'from', { kind: 'free', x: other.fallback.x, y: other.fallback.y });
    }
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detaches every arrow end attached to one of `deletedIds`, fixing it where
 * it is drawn now (connector.target_deleted). Call inside the deleting
 * transaction (board-model's deleteObjects does), before removing the objects.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  const deleted = new Set(deletedIds);
  let rects: Map<string, Rect> | null = null;
  getObjectsMap(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map) || obj.get('type') !== CONNECTOR_TYPE || deleted.has(id)) return;
    const from = parseEndpoint(obj.get('from'));
    const to = parseEndpoint(obj.get('to'));
    if (!from || !to) return;
    const hit = (e: Endpoint) => e.kind === 'attached' && deleted.has(e.objectId);
    if (!hit(from) && !hit(to)) return;
    rects ??= currentRects(doc);
    const ends = resolveEndpointPair(from, to, rects);
    if (hit(from)) obj.set('from', { kind: 'free', x: ends.from.x, y: ends.from.y });
    if (hit(to)) obj.set('to', { kind: 'free', x: ends.to.x, y: ends.to.y });
  });
}

/**
 * Moves an arrow with its selection (story 7 move, resize and nudge): free ends
 * are mapped from where they were at `start`; attached ends stay attached and
 * follow their objects. Writes inside the caller's transaction when there is one.
 */
export function transformConnector(
  doc: Y.Doc,
  id: string,
  start: { from: Endpoint; to: Endpoint },
  map: (p: Point) => Point,
): void {
  const obj = getConnectorObject(doc, id);
  if (!obj) return;
  const moved = (e: Endpoint): Endpoint | null => {
    if (e.kind !== 'free') return null;
    const p = map({ x: e.x, y: e.y });
    return isFinitePoint(p) ? { kind: 'free', x: p.x, y: p.y } : null;
  };
  const from = moved(start.from);
  const to = moved(start.to);
  if (!from && !to) return;
  doc.transact(() => {
    if (from) obj.set('from', from);
    if (to) obj.set('to', to);
  }, LOCAL_ORIGIN);
}

/** The anchor an end attached to `r` would use with the other end at `toward` (for fallbacks). */
export function attachedEndpoint(objectId: string, r: Rect, toward: Point): Endpoint {
  return { kind: 'attached', objectId, fallback: anchorToward(r, toward) };
}

export { rectCentre };
