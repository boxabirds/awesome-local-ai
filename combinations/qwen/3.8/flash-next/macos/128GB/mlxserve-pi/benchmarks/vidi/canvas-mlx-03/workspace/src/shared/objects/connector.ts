// The connector (arrow) object model (story 10 `connector.model`): the Yjs schema
// for an arrow between two board objects and every mutation of its ends.
//
// Schema (one entry in the shared `objects` map):
//   objects/<id>: Y.Map {
//     type: 'connector', x, y, width, height, z, createdAt, createdBy,
//     from: Endpoint, to: Endpoint
//   }
//   Endpoint = { kind: 'attached', objectId: string, fallback: Point }
//            | { kind: 'free', x: number, y: number }
//
// The stored x/y/width/height stay 0: a connector's box is *derived* from its two
// ends in `objectSnapshots`, so a shape moved by anyone — and never written by me —
// moves the arrow on every screen. An attached end stores no side either; the side is
// recomputed from the live rectangles on every render (connector.follow). `fallback`
// is the anchor point at attach time, used only if the target is gone.
//
// Like story 9's text model this file owns only what the generic board-model cannot
// infer; selection, move, delete and undo come from stories 7 and 8 for free.

import * as Y from 'yjs';
import { LOCAL_ORIGIN, objectBounds, objectSnapshots, type ObjectSnapshot } from '../board-model.ts';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config.ts';
import type { Point, Rect } from '../geometry.ts';
import {
  connectorBBox,
  connectorLength,
  resolveEndpoints,
  sideAnchorToward,
} from '../geometry/connector-geometry.ts';

const CONNECTOR_TYPE = 'connector';

/** One end of an arrow: welded to an object, or pinned to a board point. */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** Which end of an arrow an edit addresses. */
export type ConnectorEnd = 'from' | 'to';

/** A connector as the client renders it. */
export interface ConnectorSnapshot extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  createdBy: string;
  width: number;
  height: number;
}

/**
 * A derived box is never exactly flat, because the generic size reader treats a
 * missing or zero size as "render at the default size" — an exactly horizontal arrow
 * would otherwise gain a sticky-note-sized bounding box.
 */
export const MIN_DERIVED_EXTENT = 1e-3;

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function pointOf(x: unknown, y: unknown): Point | null {
  return finite(x) && finite(y) ? { x, y } : null;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** The highest z across every object, or 0 when none. */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let m = 0;
  for (const o of objects.values()) {
    const z = o.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > m) m = z;
  }
  return m;
}

function getConnector(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  const o = objects.get(id);
  if (o && o.get('type') === CONNECTOR_TYPE) return o;
  return undefined;
}

/** An attached end keeps the anchor it was welded to; a free end stays itself. */
function withFallback(e: Endpoint, anchor: Point): Endpoint {
  return e.kind === 'attached' ? { kind: 'attached', objectId: e.objectId, fallback: anchor } : e;
}

/** The two ends in argument order, so one call resolves both anchors. */
function pairOf(
  end: ConnectorEnd,
  next: Endpoint,
  other: Endpoint,
): { from: Endpoint; to: Endpoint } {
  return end === 'from' ? { from: next, to: other } : { from: other, to: next };
}

/**
 * The rejection rules (connector.no_accidental), checked before anything is written:
 * both ends welded to the same object, or an arrow shorter than the minimum. A free
 * end's own point is used when its object is gone, which is what lets an arrow that
 * raced with a delete still be created.
 */
function rejected(f: Endpoint, t: Endpoint, rects: ReadonlyMap<string, Rect>): boolean {
  if (f.kind === 'attached' && t.kind === 'attached' && f.objectId === t.objectId) return true;
  const ends = resolveEndpoints({ from: f, to: t }, rects);
  return connectorLength(ends.from, ends.to) < CONNECTOR_MIN_LENGTH_WORLD;
}

/**
 * Read a stored endpoint, or null when it is missing or malformed. An attached end
 * whose `fallback` is unusable keeps the origin rather than being dropped: the object
 * it points at normally decides the point anyway.
 */
export function decodeEndpoint(value: unknown): Endpoint | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as {
    kind?: unknown;
    objectId?: unknown;
    x?: unknown;
    y?: unknown;
    fallback?: unknown;
  };
  if (v.kind === 'free') {
    const p = pointOf(v.x, v.y);
    return p ? { kind: 'free', x: p.x, y: p.y } : null;
  }
  if (v.kind === 'attached' && typeof v.objectId === 'string') {
    const fb = v.fallback as Point | undefined;
    const p = pointOf(fb?.x, fb?.y);
    return { kind: 'attached', objectId: v.objectId, fallback: p ?? { x: 0, y: 0 } };
  }
  return null;
}

/** The plain object stored in the Y.Map for one end (never a nested Y.Map). */
export function encodeEndpoint(e: Endpoint): { [k: string]: unknown } {
  return e.kind === 'free'
    ? { kind: 'free', x: e.x, y: e.y }
    : { kind: 'attached', objectId: e.objectId, fallback: { x: e.fallback.x, y: e.fallback.y } };
}

/** True when a value is a usable endpoint (what a write accepts). */
export function isEndpoint(value: unknown): value is Endpoint {
  return decodeEndpoint(value) !== null;
}

/**
 * The current rectangle of every non-connector object, keyed by id — the map an
 * arrow resolves its attached ends against. Sizes come from the generic
 * `objectBounds`, so an object that has never been resized keeps the size it draws
 * at. Built from a snapshot list so the board computes it once per render and hands
 * the same map to every arrow.
 */
export function objectRectsOf(objects: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const o of objects) {
    if (o.type === CONNECTOR_TYPE) continue;
    rects.set(o.id, objectBounds(o));
  }
  return rects;
}

/** The point an end draws at, given the live rectangles and the other end. */
export function endpointAnchor(
  e: Endpoint,
  rects: ReadonlyMap<string, Rect>,
  toward: Point,
): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const rect = rects.get(e.objectId);
  return rect ? sideAnchorToward(rect, toward) : e.fallback;
}

/** The two points an arrow draws between, from a snapshot list and live rects. */
export function connectorEnds(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return resolveEndpoints(c, rects);
}

/** The length of the arrow in board units, as it currently draws. */
export function connectorLengthOf(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): number {
  const e = resolveEndpoints(c, rects);
  return connectorLength(e.from, e.to);
}

/** One derived connector: the generic fields plus its ends and derived box. */
function derived(
  o: ObjectSnapshot,
  from: Endpoint,
  to: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): ConnectorSnapshot {
  const ends = resolveEndpoints({ from, to }, rects);
  const box = connectorBBox(ends.from, ends.to);
  return {
    ...o,
    type: 'connector',
    from,
    to,
    createdBy: o.createdBy ?? '',
    x: box.x,
    y: box.y,
    width: Math.max(box.width, MIN_DERIVED_EXTENT),
    height: Math.max(box.height, MIN_DERIVED_EXTENT),
  };
}

/**
 * Create an arrow between two ends and return its id, or null — writing nothing —
 * when either end is malformed, both ends are welded to the *same* object, or the
 * arrow is shorter than `CONNECTOR_MIN_LENGTH_WORLD` (connector.no_accidental).
 *
 * An attached end is stored with the `fallback` anchor it attaches to: the point on
 * its object's boundary that faces the other end. That is where the arrow's end stays
 * if the object is deleted, and where an end that raced with a delete draws itself.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  const f = decodeEndpoint(from);
  const t = decodeEndpoint(to);
  if (!f || !t) return null;
  const objects = objectsMap(doc);
  const rects = objectRectsOf(objectSnapshots(doc));
  if (rejected(f, t, rects)) return null;
  // Weld each end to the anchor it faces, so it stays there if its object goes.
  const ends = resolveEndpoints({ from: f, to: t }, rects);
  const id = crypto.randomUUID();
  const z = maxZ(objects) + 1;
  const o = new Y.Map<unknown>();
  doc.transact(() => {
    o.set('type', CONNECTOR_TYPE);
    // The box is derived in the snapshot; the stored numbers stay at 0.
    o.set('x', 0);
    o.set('y', 0);
    o.set('width', 0);
    o.set('height', 0);
    o.set('from', encodeEndpoint(withFallback(f, ends.from)));
    o.set('to', encodeEndpoint(withFallback(t, ends.to)));
    o.set('z', z);
    o.set('createdAt', Date.now());
    o.set('createdBy', typeof by === 'string' ? by : '');
    objects.set(id, o);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move one end of an arrow (connector.reattach): onto another object, or off the
 * object it is welded to and onto a board point. Returns false — writing nothing —
 * for a stale id, a malformed end, a non-finite point, or welding an end to the
 * object at the *other* end, which would be a zero-length arrow.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: ConnectorEnd,
  e: Endpoint,
): boolean {
  if (end !== 'from' && end !== 'to') return false;
  const next = decodeEndpoint(e);
  if (!next) return false;
  const objects = objectsMap(doc);
  const o = getConnector(objects, id);
  if (!o) return false; // TC-29: deleted meanwhile, so the interaction simply ends
  const curFrom = decodeEndpoint(o.get('from'));
  const curTo = decodeEndpoint(o.get('to'));
  if (!curFrom || !curTo) return false;
  const other = end === 'from' ? curTo : curFrom;
  // Welding an end onto the object at the other end would be a zero-length arrow.
  if (next.kind === 'attached' && other.kind === 'attached' && next.objectId === other.objectId) {
    return false;
  }
  const rects = objectRectsOf(objectSnapshots(doc));
  const ends = resolveEndpoints(pairOf(end, next, other), rects);
  const anchor = end === 'from' ? ends.from : ends.to;
  doc.transact(() => {
    o.set(end, encodeEndpoint(withFallback(next, anchor)));
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detach every arrow end welded to one of `deletedIds`, turning each into a free end
 * pinned at the anchor it was attached to (connector.target_deleted).
 *
 * **Runs inside the caller's open transaction** — story 7's `deleteObjects` calls it
 * there, so the detach and the delete are one update and one undo step. It must never
 * open a transaction of its own.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (!deletedIds || deletedIds.length === 0) return;
  const gone = new Set(deletedIds);
  const objects = objectsMap(doc);
  // The rectangles are read while the deleted objects are still in the document,
  // which is the whole point of calling this before the removal: the anchor an end
  // keeps is the one it had at the moment its object disappeared.
  const rects = objectRectsOf(objectSnapshots(doc));
  for (const o of objects.values()) {
    if (o.get('type') !== CONNECTOR_TYPE) continue;
    const from = decodeEndpoint(o.get('from'));
    const to = decodeEndpoint(o.get('to'));
    if (!from || !to) continue;
    const detachFrom = from.kind === 'attached' && gone.has(from.objectId);
    const detachTo = to.kind === 'attached' && gone.has(to.objectId);
    if (!detachFrom && !detachTo) continue;
    const ends = resolveEndpoints({ from, to }, rects);
    if (detachFrom) o.set('from', encodeEndpoint({ kind: 'free', x: ends.from.x, y: ends.from.y }));
    if (detachTo) o.set('to', encodeEndpoint({ kind: 'free', x: ends.to.x, y: ends.to.y }));
  }
}

/**
 * One connector's full snapshot, or undefined for a stale id, a non-connector id or a
 * connector whose ends are unreadable. Rectangles are read from the document; pass
 * `rects` (as the board does per render) to avoid the extra pass.
 */
export function connectorSnapshot(
  doc: Y.Doc,
  id: string,
  rects?: ReadonlyMap<string, Rect>,
): ConnectorSnapshot | undefined {
  const objects = objectSnapshots(doc);
  const found = objects.find((o) => o.id === id && o.type === CONNECTOR_TYPE);
  if (!found) return undefined;
  const from = decodeEndpoint(found.from);
  const to = decodeEndpoint(found.to);
  if (!from || !to) return undefined;
  return derived(found, from, to, rects ?? objectRectsOf(objects));
}

/** Every connector in the document, in stacking order, with derived boxes. */
export function connectorSnapshots(doc: Y.Doc): readonly ConnectorSnapshot[] {
  return connectorsOf(objectSnapshots(doc));
}

/**
 * The connectors in a snapshot list, in the same (stacking) order, with boxes derived
 * from `rects` — the live rectangles of every other object type, which the board
 * builds once per render with `objectRectsOf`.
 */
export function connectorsOf(
  objects: readonly ObjectSnapshot[],
  rects: ReadonlyMap<string, Rect> = objectRectsOf(objects),
): ConnectorSnapshot[] {
  const out: ConnectorSnapshot[] = [];
  for (const o of objects) {
    if (o.type !== CONNECTOR_TYPE) continue;
    const from = decodeEndpoint(o.from);
    const to = decodeEndpoint(o.to);
    if (!from || !to) continue;
    out.push(derived(o, from, to, rects));
  }
  return out;
}
