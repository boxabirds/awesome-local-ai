/**
 * The connector object: an arrow between two board objects, or between an object and empty
 * space (`connector.model`).
 *
 * A connector stores almost nothing of its own. It has the common fields, but its
 * `x, y, width, height` are always written as `0` and *derived* in the snapshot from the
 * two endpoints — because an attached end follows its object, so the arrow's box changes
 * every time an object moves and can never be stored as a fact.
 *
 * The endpoints are the whole of it (`Endpoint`, in `connector-geometry`): an attached end
 * names the object it follows and stores a `fallback` point, a free end is a point. The
 * side an attached end leaves from is recomputed from live rectangles on every snapshot
 * (`connector.follow`), so moves — this person's or anybody else's — redraw the arrow with
 * no write, and an arrow whose target has gone is drawn at its `fallback`
 * (`connector.target_deleted`).
 *
 * As elsewhere, an error is a value: a self-connection, a too-short drag, a stale id, a
 * colour of nonsense or a non-finite point returns `null`/`false` with no transaction.
 */
import * as Y from 'yjs';

import {
  CONNECTOR_MIN_LENGTH_WORLD,
} from '../config';
import {
  highestZ,
  LOCAL_ORIGIN,
  OBJECTS_KEY,
  objectBounds,
  objectSnapshots,
  type ObjectSnapshot,
} from '../board-model';
import {
  connectorBBox,
  type Endpoint,
  resolveEndpoints,
} from '../geometry/connector-geometry';
import type { Point, Rect } from '../geometry';
import { isFiniteNumber } from '../util';

/** The string this object writes to `type`. */
export const CONNECTOR_TYPE = 'connector';

export type { Endpoint };

/** An immutable view of one connector, as React renders it. */
export interface ConnectorSnapshot extends ObjectSnapshot {
  readonly type: 'connector';
  /** The stored endpoints, used when a handle re-attaches an end. */
  readonly from: Endpoint;
  readonly to: Endpoint;
  /** The two points the arrow is drawn between, resolved against the current rectangles. */
  readonly start: Point;
  readonly end: Point;
  readonly createdBy: string;
}

/** Is this endpoint a real place — finite numbers, and an attached end naming an object? */
function isFiniteEndpoint(end: Endpoint): boolean {
  if (end.kind === 'free') return isFiniteNumber(end.x) && isFiniteNumber(end.y);
  return (
    typeof end.objectId === 'string' &&
    end.objectId !== '' &&
    isFiniteNumber(end.fallback?.x) &&
    isFiniteNumber(end.fallback?.y)
  );
}

/** Every non-connector object's rectangle, for resolving attached ends and anchors. */
function objectRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of objectSnapshots(doc)) {
    if (object.type === CONNECTOR_TYPE) continue;
    rects.set(object.id, objectBounds(object));
  }
  return rects;
}

/** The `Y.Map` of a connector, or `undefined` for a stale or foreign id. */
function connectorMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const map = (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).get(id);
  if (!map || map.get('type') !== CONNECTOR_TYPE) return undefined;
  return map;
}

/** The object an attached endpoint is bound to, or `null` for a free end. */
function attachedObject(end: Endpoint): string | null {
  return end.kind === 'attached' ? end.objectId : null;
}

/**
 * Turn each attached endpoint's `fallback` into the anchor it currently sits at, facing the
 * other end. A free end is returned unchanged.
 */
function withAnchoredFallbacks(
  from: Endpoint,
  to: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): { from: Endpoint; to: Endpoint } {
  const resolved = resolveEndpoints({ from, to }, rects);
  return {
    from: from.kind === 'attached' ? { ...from, fallback: resolved.from } : from,
    to: to.kind === 'attached' ? { ...to, fallback: resolved.to } : to,
  };
}

/** Write one endpoint into an object map, in the JSON form Yjs stores. */
function writeEndpoint(map: Y.Map<unknown>, key: 'from' | 'to', end: Endpoint): void {
  if (end.kind === 'attached') {
    map.set(key, { kind: 'attached', objectId: end.objectId, fallback: { x: end.fallback.x, y: end.fallback.y } });
  } else {
    map.set(key, { kind: 'free', x: end.x, y: end.y });
  }
}

/** Read one endpoint out of an object map, or `null` when it is unreadable. */
function readEndpoint(value: unknown): Endpoint | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.kind === 'free') {
    const x = record.x;
    const y = record.y;
    if (isFiniteNumber(x) && isFiniteNumber(y)) return { kind: 'free', x, y };
    return null;
  }
  if (record.kind === 'attached') {
    const objectId = record.objectId;
    const fallback = record.fallback as Record<string, unknown> | undefined;
    if (typeof objectId === 'string' && fallback) {
      const fx = fallback.x;
      const fy = fallback.y;
      if (isFiniteNumber(fx) && isFiniteNumber(fy)) {
        return { kind: 'attached', objectId, fallback: { x: fx, y: fy } };
      }
    }
  }
  return null;
}

/**
 * Draw an arrow between two endpoints (`connector.create_attached`, `connector.create_free`).
 *
 * An attached end records the object it follows and the anchor point it currently sits at
 * as its `fallback`; a free end keeps its point. Before writing, the arrow is rejected if
 * both ends attach to the *same* object, or if the resolved length is under
 * `CONNECTOR_MIN_LENGTH_WORLD` — a drag that went nowhere is not an arrow
 * (`connector.no_accidental`, TC-08, TC-09). A target that has already vanished is still
 * accepted: its end is drawn at the fallback it was given (the concurrent-delete case).
 *
 * The stored `x, y, width, height` are `0`; the snapshot derives the box.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!isFiniteEndpoint(from) || !isFiniteEndpoint(to)) return null;
  // An arrow from an object to itself is a dot, not a connector.
  const fromId = attachedObject(from);
  const toId = attachedObject(to);
  if (fromId !== null && fromId === toId) return null;

  const rects = objectRects(doc);
  const anchored = withAnchoredFallbacks(from, to, rects);
  const resolved = resolveEndpoints(anchored, rects);
  const length = Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y);
  if (!(length >= CONNECTOR_MIN_LENGTH_WORLD)) return null;

  const id = crypto.randomUUID();
  const z = highestZ(doc) + 1;
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', CONNECTOR_TYPE);
    // The box is derived; store zeros so the common fields exist and are finite.
    map.set('x', 0);
    map.set('y', 0);
    map.set('width', 0);
    map.set('height', 0);
    writeEndpoint(map, 'from', anchored.from);
    writeEndpoint(map, 'to', anchored.to);
    map.set('z', z);
    map.set('createdAt', Date.now());
    map.set('createdBy', by);
    (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move one end of an existing arrow (`connector.reattach`).
 *
 * `false` — and no write — for a stale id, a non-finite point, or attaching an end to the
 * object that is already at the *other* end (an arrow would be a self-loop, TC-12). An
 * attached end's fallback is re-anchored from the current rectangles; a free end keeps its
 * point.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const map = connectorMap(doc, id);
  if (!map) return false;
  if (!isFiniteEndpoint(e)) return false;

  const otherKey = end === 'from' ? 'to' : 'from';
  const other = readEndpoint(map.get(otherKey));
  if (!other) return false; // a connector we cannot read is not one we should rewrite
  const objectId = attachedObject(e);
  if (objectId !== null && objectId === attachedObject(other)) return false;

  const nextEndpoints =
    end === 'from'
      ? resolveEndpoints({ from: e, to: other }, objectRects(doc))
      : resolveEndpoints({ from: other, to: e }, objectRects(doc));
  const anchored: Endpoint =
    e.kind === 'attached'
      ? { ...e, fallback: end === 'from' ? nextEndpoints.from : nextEndpoints.to }
      : e;

  doc.transact(() => {
    writeEndpoint(map, end, anchored);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Turn every arrow end attached to a deleted object into a free end, in the caller's open
 * transaction (`connector.target_deleted`).
 *
 * Called by `deleteObjects` while the objects still exist, so the end is freed at the exact
 * anchor it was drawn from; if a target is already gone the stored fallback is used. It
 * writes no transaction of its own — the delete and the detach are one update and one undo
 * step.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) return;
  const deleted = new Set(deletedIds);
  const objects = objectsMap(doc);
  const rects = objectRects(doc);

  for (const map of objects.values()) {
    if (map.get('type') !== CONNECTOR_TYPE) continue;
    const from = readEndpoint(map.get('from'));
    const to = readEndpoint(map.get('to'));
    if (!from || !to) continue;

    const fromNeedsDetach = from.kind === 'attached' && deleted.has(from.objectId);
    const toNeedsDetach = to.kind === 'attached' && deleted.has(to.objectId);
    if (!fromNeedsDetach && !toNeedsDetach) continue;

    // The anchor each end currently draws at (present objects), or its fallback (gone).
    // Only the ends bound to a deleted object are freed; the other stays attached.
    const resolved = resolveEndpoints({ from, to }, rects);
    if (fromNeedsDetach) writeEndpoint(map, 'from', freeAt(from, resolved.from));
    if (toNeedsDetach) writeEndpoint(map, 'to', freeAt(to, resolved.to));
  }
}

/** Turn an attached end into a free one at `anchor`; a free end is unchanged. */
function freeAt(end: Endpoint, anchor: Point): Endpoint {
  if (end.kind === 'free') return end;
  return { kind: 'free', x: anchor.x, y: anchor.y };
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>;
}

/**
 * Read one `objects` entry as a `ConnectorSnapshot`.
 *
 * The box here is derived from the endpoints' own reference points (fallback or point) and
 * so is a placeholder; `objectSnapshots` re-derives `start`, `end` and the box against the
 * live rectangles in its own pass. It is separated this way so reading one connector never
 * has to look at the rest of the board. Assumes the entry says `type: 'connector'`.
 */
export function connectorSnapshotFrom(id: string, map: Y.Map<unknown>): ConnectorSnapshot | null {
  const from = readEndpoint(map.get('from'));
  const to = readEndpoint(map.get('to'));
  if (!from || !to) return null;
  const z = map.get('z');
  if (typeof z !== 'number') return null;
  const createdAt = map.get('createdAt');
  const start = referencePoint(from);
  const end = referencePoint(to);
  return {
    id,
    type: CONNECTOR_TYPE,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    z,
    from,
    to,
    start,
    end,
    createdBy: String(map.get('createdBy') ?? ''),
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}

/** The point an endpoint stands for without consulting any object's rectangle. */
function referencePoint(end: Endpoint): Point {
  return end.kind === 'free' ? { x: end.x, y: end.y } : end.fallback;
}

/**
 * Re-derive a connector's resolved endpoints and box against the current rectangles.
 * `objectSnapshots` calls this for every connector after it has read the rest of the board.
 */
export function resolveConnector(
  connector: ConnectorSnapshot,
  rects: ReadonlyMap<string, Rect>,
): ConnectorSnapshot {
  const { from, to } = resolveEndpoints(connector, rects);
  const box = connectorBBox(from, to);
  return { ...connector, x: box.x, y: box.y, width: box.width, height: box.height, start: from, end: to };
}
