/**
 * The `connector` object type: an arrow between two things on the board
 * (design anchor `connector.model`).
 *
 * A connector is an ordinary board object - the same `objects` map, the same
 * `z`/`createdAt` fields - whose *geometry is not its own*: `x`/`y`/`width`/
 * `height` are stored as 0 and derived in the snapshot from the two ends, so the
 * box the selection draws is always the box the arrow is actually drawn in. What
 * it carries instead are two endpoints:
 *
 *   Endpoint = { kind: 'attached', objectId: string, fallback: Point }
 *            | { kind: 'free',     x: number, y: number }
 *
 * An attached end stores no side. Its side - and therefore its position - is
 * recomputed from the live rectangles every render ({@link resolveEndpoints}),
 * which is what makes an arrow follow a box that anybody moves or resizes without
 * a single write (`connector.follow`). `fallback` is the anchor point as it was
 * when the end was attached; it is used only when the target has vanished (a
 * concurrent delete), so an arrow is never missing from the board.
 *
 * Endpoints are stored as plain JSON objects rather than nested `Y.Map`s: an end
 * is only ever moved as a whole - there is no sensible merge between two people
 * attaching the same end to two different objects, and last-write-wins on one key
 * is the honest answer.
 *
 * Like every model function here, each mutation is exactly one
 * `doc.transact(fn, LOCAL_ORIGIN)` and every rejection (both ends on the same
 * object, an arrow too short to be an arrow, attaching to an object that is not
 * there or is another arrow, attaching an end to the object at its other end, a
 * point that is not a point, a stale id) returns `null`/`false` *before* a
 * transaction is opened. The one exception is {@link detachConnectorsTo}, which is
 * called from inside the transaction story 7's `deleteObjects` has already opened,
 * so a delete and the detaching of the arrows that pointed at it are one update
 * and one undo step (`connector.target_deleted`).
 */

import * as Y from 'yjs';

import { LOCAL_ORIGIN, OBJECT_FIELDS, objectBounds, type ObjectSnapshot } from '../board-model.js';
// The registration functions come from the registry module itself, not from
// board-model: board-model imports *this* module (so that deleting an object can
// detach the arrows that pointed at it), so calling a re-export of board-model's
// while this module is still loading would reach a binding board-model has not
// filled in yet.
import {
  registerBoardObjectType,
  registerDefaultObjectSize,
  registerObjectSnapshotReader,
} from '../object-registry.js';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config.js';
import {
  connectorBBox,
  endpointPoint,
  nearestSide,
  rectCentre,
  resolveEndpoints,
  sideAnchor,
  type ConnectorEnd,
  type Endpoint,
} from '../geometry/connector-geometry.js';
import type { Point, Rect } from '../geometry.js';

/** The object type name, as stored in `objects.<id>.type`. */
export const CONNECTOR_TYPE = 'connector';

export type { ConnectorEnd, Endpoint } from '../geometry/connector-geometry.js';

/** The two field names an arrow's ends live under. */
const END_FIELDS: Record<ConnectorEnd, string> = { from: 'from', to: 'to' };

/** An immutable view of one arrow, as rendered by the client. */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  /** The tail. The arrowhead is drawn at {@link to}. */
  from: Endpoint;
  /** The head. */
  to: Endpoint;
  /** Who made it; absent for an object created by a client that had no name. */
  createdBy?: string;
}

registerBoardObjectType(CONNECTOR_TYPE);
registerObjectSnapshotReader(CONNECTOR_TYPE, readConnectorSnapshot);
// An arrow has no size of its own: the zeros it is stored with must not be read as
// "no size stored" and padded out to the size of a sticky note, because a vertical
// arrow would then be selectable in a wide empty box beside the line.
registerDefaultObjectSize(CONNECTOR_TYPE, 0);

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isFinitePoint = (value: unknown): value is Point => {
  const point = value as Point | null | undefined;
  return point !== null && point !== undefined && isFiniteNumber(point.x) && isFiniteNumber(point.y);
};

/** A unique object id; the same helper the other object types use. */
function nextId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/* ------------------------------------------------------------------- endpoints */

/**
 * Read a stored or caller-supplied endpoint into a fresh, validated endpoint, or
 * `undefined` when it is not one. An attached end whose fallback point cannot be
 * read keeps `(0, 0)`: the fallback is only ever a last resort for a target that
 * has gone, and an arrow drawn to the origin is better than no arrow.
 */
function readEndpoint(value: unknown): Endpoint | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const end = value as { kind?: unknown; objectId?: unknown; x?: unknown; y?: unknown; fallback?: unknown };
  if (end.kind === 'free') {
    return isFiniteNumber(end.x) && isFiniteNumber(end.y)
      ? { kind: 'free', x: end.x as number, y: end.y as number }
      : undefined;
  }
  if (end.kind === 'attached') {
    if (typeof end.objectId !== 'string' || end.objectId.length === 0) return undefined;
    const fallback = end.fallback;
    return {
      kind: 'attached',
      objectId: end.objectId,
      fallback: isFinitePoint(fallback) ? { x: fallback.x, y: fallback.y } : { x: 0, y: 0 },
    };
  }
  return undefined;
}

const sameEndpoint = (a: Endpoint, b: Endpoint): boolean =>
  a.kind === b.kind &&
  (a.kind === 'free'
    ? b.kind === 'free' && a.x === b.x && a.y === b.y
    : b.kind === 'attached' && a.objectId === b.objectId);

const isAttachedTo = (e: Endpoint | undefined, objectId: string): boolean =>
  e !== undefined && e.kind === 'attached' && e.objectId === objectId;

/** The point an attached end faces: the other object's centre, or the other point. */
const facingPoint = (e: Endpoint, rects: ReadonlyMap<string, Rect>): Point =>
  e.kind === 'free'
    ? { x: e.x, y: e.y }
    : (rects.get(e.objectId) === undefined ? e.fallback : rectCentre(rects.get(e.objectId)!));

/**
 * The endpoint as it is stored: an attached end carries the anchor point of the
 * side it currently faces as its fallback, so a target that vanishes later leaves
 * the arrow where it was drawn rather than pointing at nothing.
 */
function withFallback(
  e: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Endpoint {
  if (e.kind !== 'attached') return e;
  const rect = rects.get(e.objectId);
  if (rect === undefined) return e;
  const anchor = sideAnchor(rect, nearestSide(rect, facingPoint(other, rects)));
  return { kind: 'attached', objectId: e.objectId, fallback: anchor };
}

/* ------------------------------------------------------------------- rectangles */

/**
 * The rectangles an arrow can be attached to, read straight out of the document.
 *
 * It goes to the maps rather than to `objectSnapshot`, because this function is
 * called *by* a snapshot reader and asking for the snapshot from inside it would
 * ask for itself forever. Arrows are excluded: an end is attached to a thing with
 * a body - a note, a shape - and never to another arrow. `objectBounds` does the
 * "no stored size means the type's default" part, which is the same decision the
 * renderer makes, so an arrow and the box it points at cannot disagree.
 */
function rectsOf(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  objectsOf(doc).forEach((map, id) => {
    if (!(map instanceof Y.Map)) return;
    const type = map.get(OBJECT_FIELDS.type);
    if (typeof type !== 'string' || type === CONNECTOR_TYPE) return;
    const x = map.get(OBJECT_FIELDS.x);
    const y = map.get(OBJECT_FIELDS.y);
    const z = map.get(OBJECT_FIELDS.z);
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return;
    const width = map.get(OBJECT_FIELDS.width);
    const height = map.get(OBJECT_FIELDS.height);
    const createdAt = map.get(OBJECT_FIELDS.createdAt);
    const object: ObjectSnapshot = {
      id,
      type,
      x,
      y,
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      ...(isFiniteNumber(width) ? { width } : {}),
      ...(isFiniteNumber(height) ? { height } : {}),
    };
    rects.set(id, objectBounds(object));
  });
  return rects;
}

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Both ends attached to objects that exist and are not arrows; else the reason not. */
function targetsExist(objects: Y.Map<Y.Map<unknown>>, ends: readonly Endpoint[]): boolean {
  for (const e of ends) {
    if (e.kind !== 'attached') continue;
    const target = objects.get(e.objectId);
    if (!(target instanceof Y.Map)) return false;
    if (target.get(OBJECT_FIELDS.type) === CONNECTOR_TYPE) return false;
  }
  return true;
}

/* ------------------------------------------------------------------- snapshot */

/** Read one object map into a {@link ConnectorSnap}, or skip it. */
function readConnectorSnapshot(id: string, map: Y.Map<unknown>): ConnectorSnap | undefined {
  if (map.get(OBJECT_FIELDS.type) !== CONNECTOR_TYPE) return undefined;

  const z = map.get(OBJECT_FIELDS.z);
  if (!isFiniteNumber(z)) return undefined;
  const from = readEndpoint(map.get(END_FIELDS.from));
  const to = readEndpoint(map.get(END_FIELDS.to));
  if (from === undefined || to === undefined) return undefined;

  const createdAt = map.get(OBJECT_FIELDS.createdAt);
  const createdBy = map.get('createdBy');
  const doc = map.doc;
  const rects = doc === null ? new Map<string, Rect>() : rectsOf(doc as Y.Doc);
  const ends = resolveEndpoints({ from, to }, rects);
  const box = connectorBBox(ends.from, ends.to);

  const snapshot: ConnectorSnap = {
    id,
    type: 'connector',
    // The arrow's box is its two ends, not the zeros it was stored with.
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    from,
    to,
  };
  if (typeof createdBy === 'string' && createdBy.length > 0) snapshot.createdBy = createdBy;
  return snapshot;
}

/* ------------------------------------------------------------------- create */

/**
 * Draw an arrow (`connector.create_drag`).
 *
 * `from` is where the pointer came down and `to` is where it was released: the
 * arrowhead points at the object the person was aiming for. An end released over
 * an object is attached to that object; one released over empty board space is
 * fixed at that point forever.
 *
 * Returns `null`, having written nothing, when an endpoint is not a point or not
 * an object, when either end is aimed at an object that is not on the board or at
 * another arrow, when both ends are aimed at the *same* object (an arrow from a
 * thing to itself has no length and no meaning), or when the two ends resolve
 * closer together than `CONNECTOR_MIN_LENGTH_WORLD` - which is the check that
 * stops a stray click from leaving an arrow the size of a dot.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  const tail = readEndpoint(from);
  const head = readEndpoint(to);
  if (tail === undefined || head === undefined) return null;
  const objects = objectsOf(doc);
  if (!targetsExist(objects, [tail, head])) return null;
  if (isAttachedTo(tail, head.kind === 'attached' ? head.objectId : '')) return null;

  const rects = rectsOf(doc);
  const ends = resolveEndpoints({ from: tail, to: head }, rects);
  if (distance(ends.from, ends.to) < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const storedFrom = withFallback(tail, head, rects);
  const storedTo = withFallback(head, tail, rects);

  let z = 0;
  objects.forEach((map) => {
    if (!(map instanceof Y.Map)) return;
    const value = map.get(OBJECT_FIELDS.z);
    if (isFiniteNumber(value) && value > z) z = value;
  });
  const id = nextId();
  const creator = typeof by === 'string' && by.trim().length > 0 ? by : null;

  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set(OBJECT_FIELDS.type, CONNECTOR_TYPE);
    // The box is derived; these are placeholders so the object has the fields
    // every object has, and no code has to special-case an arrow when it reads them.
    map.set(OBJECT_FIELDS.x, 0);
    map.set(OBJECT_FIELDS.y, 0);
    map.set(OBJECT_FIELDS.width, 0);
    map.set(OBJECT_FIELDS.height, 0);
    map.set(OBJECT_FIELDS.z, z + 1);
    map.set(OBJECT_FIELDS.createdAt, Date.now());
    map.set(END_FIELDS.from, storedFrom);
    map.set(END_FIELDS.to, storedTo);
    if (creator !== null) map.set('createdBy', creator);
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/* ------------------------------------------------------------------- re-attach */

/**
 * Move one end of an arrow (`connector.reattach`): the handle at the end of a
 * selected arrow is dragged to another object (attached), or dropped on empty
 * board space (fixed at that point).
 *
 * `false` and no write when the arrow is not there, when the new end is not a
 * point or not an object, when it is aimed at an object that is not on the board
 * or at another arrow, when it is aimed at the object the *other* end is attached
 * to (that is the arrow of no length again), or when the end is already there.
 * A minimum length is *not* enforced here: dragging an end onto the object next to
 * it is a deliberate thing to do, and an arrow that gets short because its objects
 * are close is still the arrow that was asked for.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: ConnectorEnd,
  e: Endpoint,
): boolean {
  const objects = objectsOf(doc);
  const map = objects.get(id);
  if (!(map instanceof Y.Map) || map.get(OBJECT_FIELDS.type) !== CONNECTOR_TYPE) return false;
  const next = readEndpoint(e);
  if (next === undefined) return false;

  const otherEnd: ConnectorEnd = end === 'from' ? 'to' : 'from';
  const other = readEndpoint(map.get(END_FIELDS[otherEnd]));
  if (other === undefined) return false;
  if (!targetsExist(objects, [next])) return false;
  if (isAttachedTo(next, other.kind === 'attached' ? other.objectId : '')) return false;

  const current = readEndpoint(map.get(END_FIELDS[end]));
  if (current === undefined) return false;

  const rects = rectsOf(doc);
  const stored = withFallback(next, other, rects);
  if (sameEndpoint(current, stored)) return false;

  doc.transact(() => {
    map.set(END_FIELDS[end], stored);
  }, LOCAL_ORIGIN);
  return true;
}

/* ------------------------------------------------------------------- detach */

/**
 * Free every arrow end attached to one of `deletedIds`, fixing it at the point it
 * was attached to (`connector.target_deleted`).
 *
 * Called by `deleteObjects` **inside the transaction it has already opened**, and
 * before the objects go, which is the only moment at which "where it was attached"
 * can still be worked out from the object's own rectangle. Everything it changes
 * therefore travels as the one update the delete was already going to be, and
 * story 8 undoes the pair in one step. Arrows that point at nothing in particular
 * cost no transaction at all.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (!Array.isArray(deletedIds) || deletedIds.length === 0) return;
  const objects = objectsOf(doc);
  const gone = new Set(deletedIds);
  let rects: Map<string, Rect> | undefined;

  const changes: { map: Y.Map<unknown>; end: ConnectorEnd; point: Point }[] = [];
  objects.forEach((map) => {
    if (!(map instanceof Y.Map) || map.get(OBJECT_FIELDS.type) !== CONNECTOR_TYPE) return;
    for (const end of ['from', 'to'] as const) {
      const e = readEndpoint(map.get(END_FIELDS[end]));
      if (e === undefined || e.kind !== 'attached' || !gone.has(e.objectId)) continue;
      const live = rects ?? rectsOf(doc);
      rects = live;
      const otherEnd: ConnectorEnd = end === 'from' ? 'to' : 'from';
      const other = readEndpoint(map.get(END_FIELDS[otherEnd]));
      const point = other === undefined ? e.fallback : endpointPoint(e, other, live);
      changes.push({ map, end, point });
    }
  });
  if (changes.length === 0) return;

  doc.transact(() => {
    // An end that has lost its object keeps its position: the arrow is drawn from
    // the same point it was drawn from a moment ago, and nobody has to know that
    // the object it was attached to is gone.
    for (const change of changes) {
      change.map.set(END_FIELDS[change.end], { kind: 'free', x: change.point.x, y: change.point.y });
    }
  }, LOCAL_ORIGIN);
}
