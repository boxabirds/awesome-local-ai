import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../config';
import {
  connectorBBox,
  endpointPoint,
  endpointReference,
  nearestSide,
  sideAnchor,
} from '../geometry/connector-geometry';
import type { Point, Rect } from '../geometry';

/**
 * Connector (arrow) object model (story 10).
 *
 * An endpoint is either `attached` to another board object — the arrow then
 * draws at the midpoint of the side of that object nearest the other end, which
 * is why it follows the object and switches sides as it moves, with no write of
 * its own — or `free`, pinned to a board point.
 *
 * An attached endpoint stores the anchor point it was made at (`fallback`). It
 * is used only when the target object is gone: the object was deleted, either
 * before this arrow arrived or while it was being drawn, and the arrow then
 * draws where it was attached instead of failing.
 *
 * Schema (Y.Map in `objects`): type, x, y, width, height (all 0: an arrow's box
 * is derived from its ends in `objectSnapshots`), z, createdAt, createdBy,
 * from, to.
 */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnapshot extends ObjectSnapshot {
  type: 'connector';
  /**
   * Box derived from the ends at snapshot time (the stored x / y / width /
   * height are 0 — an arrow has no box of its own). Selection, the marquee and
   * the overlay all read bounds through `objectBounds`, so they follow the arrow.
   */
  x: number;
  y: number;
  width: number;
  height: number;
  from: Endpoint;
  to: Endpoint;
  /** Resolved drawing points: attached ends sit on their object's side. */
  fromPoint: Point;
  toPoint: Point;
  createdBy: string;
  createdAt: number;
}

export type ConnectorEnd = 'from' | 'to';

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

/** The Y.Map for `id` when it is a connector; null for anything else. */
function getConnectorMap(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const obj = getObjects(doc).get(id);
  if (!obj || obj.get('type') !== 'connector') return null;
  return obj;
}

function isFinitePoint(p: unknown): p is Point {
  if (typeof p !== 'object' || p === null) return false;
  const point = p as Partial<Point>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Parse a stored endpoint, tolerating anything this build did not write. */
export function parseEndpoint(value: unknown): Endpoint | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { kind?: unknown; objectId?: unknown; x?: unknown; y?: unknown; fallback?: unknown };
  if (raw.kind === 'free') {
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
    return { kind: 'free', x: raw.x as number, y: raw.y as number };
  }
  if (raw.kind === 'attached') {
    if (typeof raw.objectId !== 'string' || raw.objectId.length === 0) return null;
    if (!isFinitePoint(raw.fallback)) return null;
    return { kind: 'attached', objectId: raw.objectId, fallback: { x: raw.fallback.x, y: raw.fallback.y } };
  }
  return null;
}

export function isEndpoint(value: unknown): value is Endpoint {
  return parseEndpoint(value) !== null;
}

/**
 * The rectangle of a stored object as an arrow sees it. Objects without a
 * persisted size (pre-story-7 stickies) use STICKY_SIZE_WORLD; connectors have
 * no area of their own, so nothing attaches to them.
 */
function objectRect(map: Y.Map<unknown>): Rect | null {
  if (map.get('type') === 'connector') return null;
  const x = map.get('x');
  const y = map.get('y');
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const width = map.get('width');
  const height = map.get('height');
  return {
    x: x as number,
    y: y as number,
    width: Number.isFinite(width) ? (width as number) : STICKY_SIZE_WORLD,
    height: Number.isFinite(height) ? (height as number) : STICKY_SIZE_WORLD,
  };
}

/** Every object rectangle by id — the map `resolveEndpoints` needs. */
export function objectRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  getObjects(doc).forEach((obj, id) => {
    const rect = objectRect(obj);
    if (rect !== null) rects.set(id, rect);
  });
  return rects;
}

/** The anchor an attached end should store: the side nearest the other end. */
function fallbackFor(
  end: Endpoint,
  otherEnd: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (end.kind !== 'attached') return { x: 0, y: 0 };
  const rect = rects.get(end.objectId);
  if (rect === undefined) return { x: end.fallback.x, y: end.fallback.y };
  return sideAnchor(rect, nearestSide(rect, endpointReference(otherEnd, rects)));
}

/**
 * Create an arrow between two endpoints (both already resolved by the tool that
 * owns the gesture: an end released over an object attaches, one released over
 * empty space stays free).
 *
 * Returns null, and writes nothing, when both ends attach to the same object or
 * the resolved arrow is shorter than CONNECTOR_MIN_LENGTH_WORLD — the two rules
 * behind "no accidental arrows". An attached target that no longer exists (the
 * other person deleted it a moment ago) is kept as an attached end: the arrow
 * renders at its fallback point.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  const start = parseEndpoint(from);
  const end = parseEndpoint(to);
  if (start === null || end === null) return null;
  if (start.kind === 'attached' && end.kind === 'attached' && start.objectId === end.objectId) {
    return null;
  }

  const rects = objectRects(doc);
  const fromPoint = endpointPoint(start, rects, end);
  const toPoint = endpointPoint(end, rects, start);
  if (!Number.isFinite(fromPoint.x) || !Number.isFinite(fromPoint.y)) return null;
  if (!Number.isFinite(toPoint.x) || !Number.isFinite(toPoint.y)) return null;
  if (Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y) < CONNECTOR_MIN_LENGTH_WORLD) {
    return null;
  }

  const storedFrom: Endpoint =
    start.kind === 'attached'
      ? { kind: 'attached', objectId: start.objectId, fallback: fallbackFor(start, end, rects) }
      : start;
  const storedTo: Endpoint =
    end.kind === 'attached'
      ? { kind: 'attached', objectId: end.objectId, fallback: fallbackFor(end, start, rects) }
      : end;

  const objects = getObjects(doc);
  const id = crypto.randomUUID();
  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((obj) => {
      const z = obj.get('z');
      if (typeof z === 'number' && z > maxZ) maxZ = z;
    });
    const map = new Y.Map<unknown>();
    map.set('type', 'connector');
    // The box is derived from the ends in `objectSnapshots`; a stored 0 keeps
    // "no box of its own" explicit and makes a malformed object harmless.
    map.set('x', 0);
    map.set('y', 0);
    map.set('width', 0);
    map.set('height', 0);
    map.set('z', maxZ + 1);
    map.set('createdAt', Date.now());
    map.set('createdBy', by);
    map.set('from', storedFrom);
    map.set('to', storedTo);
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move one end of an existing arrow (a dragged end handle): onto an object to
 * attach it, onto empty space to detach it.
 *
 * Returns false — and writes nothing — for a stale id, a non-finite point or an
 * object that the arrow's other end is already attached to (a zero-length arrow
 * is never created; the handle simply snaps back).
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: ConnectorEnd,
  next: Endpoint,
): boolean {
  const map = getConnectorMap(doc, id);
  if (map === null) return false;

  const parsed = parseEndpoint(next);
  if (parsed === null) return false;

  const otherKey = end === 'from' ? 'to' : 'from';
  const other = parseEndpoint(map.get(otherKey));
  if (other === null) return false;
  if (
    parsed.kind === 'attached' &&
    other.kind === 'attached' &&
    parsed.objectId === other.objectId
  ) {
    return false;
  }

  const rects = objectRects(doc);
  const stored: Endpoint =
    parsed.kind === 'attached'
      ? { kind: 'attached', objectId: parsed.objectId, fallback: fallbackFor(parsed, other, rects) }
      : parsed;

  if (JSON.stringify(map.get(end)) === JSON.stringify(stored)) return true;

  doc.transact(() => {
    map.set(end, stored);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Parse a connector map into a snapshot, resolving both ends against `rects` so
 * the arrow draws on the sides of its objects and carries a box that covers it.
 * Malformed endpoints or non-finite coordinates yield null (the object is skipped).
 */
export function connectorSnapshotFrom(
  id: string,
  z: number,
  map: Y.Map<unknown>,
  rects: ReadonlyMap<string, Rect>,
): ConnectorSnapshot | null {
  const x = map.get('x');
  const y = map.get('y');
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const start = parseEndpoint(map.get('from'));
  const end = parseEndpoint(map.get('to'));
  if (start === null || end === null) return null;
  const fromPoint = endpointPoint(start, rects, end);
  const toPoint = endpointPoint(end, rects, start);
  const box = connectorBBox(fromPoint, toPoint);
  const createdBy = map.get('createdBy');
  const createdAt = map.get('createdAt');
  return {
    id,
    type: 'connector',
    // Derived, not stored: an arrow's box is the box around its ends, so the
    // generic selection code (bounds, marquee, overlay) follows objects.
    x: box.x,
    y: box.y,
    z,
    width: box.width,
    height: box.height,
    from: start,
    to: end,
    fromPoint,
    toPoint,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    createdAt: Number.isFinite(createdAt) ? (createdAt as number) : 0,
  };
}

/**
 * Turn every arrow end attached to a deleted object into a free end pinned
 * where it was attached, so deleting a shape keeps its arrows (PRD
 * connector.target_deleted).
 *
 * Writes directly, inside the caller's transaction — story 7's `deleteObjects`
 * calls this before it removes the objects, so the anchor is still resolvable
 * and the whole delete is one update and one undo step.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) return;
  const deleted = new Set(deletedIds);
  const rects = objectRects(doc);
  const objects = getObjects(doc);

  objects.forEach((obj) => {
    if (obj.get('type') !== 'connector') return;
    for (const key of ['from', 'to'] as const) {
      const end = parseEndpoint(obj.get(key));
      if (end === null || end.kind !== 'attached' || !deleted.has(end.objectId)) continue;
      const otherKey = key === 'from' ? 'to' : 'from';
      const other = parseEndpoint(obj.get(otherKey)) ?? end;
      const point = endpointPoint(end, rects, other);
      obj.set(key, { kind: 'free', x: point.x, y: point.y } satisfies Endpoint);
    }
  });
}
