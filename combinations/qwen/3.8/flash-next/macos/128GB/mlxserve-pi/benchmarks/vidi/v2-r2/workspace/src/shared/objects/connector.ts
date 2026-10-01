// The connector object: a straight arrow between two ends, each of them either
// joined to a board object or pinned to a board point.
//
// The rule the whole file is built around (design.md): *an arrow stores which
// objects its ends are attached to, never where its ends are.* The position is
// derived from the objects' current rects every time a snapshot is read, which is
// what makes `connector.follow` true for every person on the board at once - there
// is nothing to rewrite when a box moves, because the arrow never held a place to
// be redrawn from.
//
// The stored x/y/width/height are always 0 and are never read: the snapshot carries
// the box around the two resolved ends, so story 7's selection, marquee, delete and
// undo treat an arrow like every other object without ever being told about it.

import * as Y from 'yjs';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  CONNECTOR_STROKE_WIDTH_WORLD,
  MAX_OBJECT_SIZE_WORLD,
  TYPE_CONNECTOR,
  TYPE_SHAPE,
  TYPE_STICKY,
  TYPE_TEXT,
} from '../config.js';
import { LOCAL_ORIGIN } from '../board-model.js';
import type { ObjectSnapshot } from '../board-model.js';
import { objectBounds, type Point, type Rect } from '../geometry.js';
import {
  anchorOf,
  centre,
  connectorBBox,
  endpointPoint,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type Endpoint,
  type Endpoints,
} from '../geometry/connector-geometry.js';

export type { Endpoint, Endpoints };
export { anchorOf, centre, connectorBBox, endpointPoint, nearestSide, resolveEndpoints, sideAnchor };

export interface ConnectorSnapshot extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  /** The two ends as points, resolved against where their objects are now. */
  ends: { from: Point; to: Point };
  width: number;
  height: number;
  createdAt: number;
  createdBy: string | null;
}

/** The design's name for the same snapshot. */
export type ConnectorSnap = ConnectorSnapshot;

/** Which end of an arrow a handle drags. */
export type ConnectorEnd = 'from' | 'to';

export const CONNECTOR_STROKE_WIDTH = CONNECTOR_STROKE_WIDTH_WORLD;
export const CONNECTOR_ARROWHEAD_SIZE = CONNECTOR_ARROWHEAD_SIZE_WORLD;
export const CONNECTOR_HIT_TOLERANCE = CONNECTOR_HIT_TOLERANCE_PX;
/** The shortest drag that draws an arrow at all, in world units. */
export const CONNECTOR_MIN_LENGTH = CONNECTOR_MIN_LENGTH_WORLD;

const TYPES_THAT_TAKE_AN_ARROW = [TYPE_STICKY, TYPE_TEXT, TYPE_SHAPE];

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isPointValue(value: unknown): value is Point {
  return (
    typeof value === 'object'
    && value !== null
    && Number.isFinite((value as Point).x)
    && Number.isFinite((value as Point).y)
  );
}

/** Is this a well-formed end? Anything else is damage or a newer client's idea. */
export function isEndpoint(value: unknown): value is Endpoint {
  if (typeof value !== 'object' || value === null) return false;
  const end = value as { kind?: unknown };
  if (end.kind === 'free') return isPointValue(value);
  if (end.kind === 'attached') {
    const attached = value as { objectId?: unknown; fallback?: unknown };
    return typeof attached.objectId === 'string' && attached.objectId !== '';
  }
  return false;
}

/** Do two ends mean the same thing? Used so releasing a handle where it already
 * was writes nothing, the way painting a shape the colour it already wears does. */
export function endpointsEqual(a: Endpoint, b: Endpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'free' && b.kind === 'free') return a.x === b.x && a.y === b.y;
  if (a.kind === 'attached' && b.kind === 'attached') {
    return a.objectId === b.objectId && endpointPoint(a).x === endpointPoint(b).x
      && endpointPoint(a).y === endpointPoint(b).y;
  }
  return false;
}

function connectorEntry(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  if (typeof id !== 'string' || id === '') return null;
  const value = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!(value instanceof Y.Map) || value.get('type') !== TYPE_CONNECTOR) return null;
  return value;
}

/** The largest z on the board, over every type. */
function topZ(objects: Y.Map<unknown>): number {
  let max = 0;
  objects.forEach((value) => {
    if (value instanceof Y.Map) {
      const z = (value as Y.Map<unknown>).get('z');
      if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
    }
  });
  return max;
}

/** One end as stored, with a missing or damaged fallback made into a place. */
function storedEnd(end: Endpoint): Endpoint {
  if (end.kind === 'free') return { kind: 'free', x: end.x, y: end.y };
  const fallback = isPointValue(end.fallback) ? end.fallback : { x: 0, y: 0 };
  return { kind: 'attached', objectId: end.objectId, fallback: { x: fallback.x, y: fallback.y } };
}

/**
 * Draw an arrow between two ends. Both ends are validated outside any transaction,
 * so a malformed call cannot write half an arrow - and a peer cannot receive one.
 * An end may name an object that is not on the board: that is not rejected, because
 * the other person may delete it at this very moment, and the arrow is drawn from
 * its fallback point until it turns up (PRD `connector.target_deleted`).
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  // An arrow between one object and itself has no line to draw: the same rule
  // `setConnectorEndpoint` holds, so no way of making an arrow gets past it.
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }
  const objects = doc.getMap<unknown>('objects');
  const id = (doc.clientID >>> 0).toString(16) + Math.random().toString(16).slice(2, 10);

  doc.transact(() => {
    const connector = new Y.Map<unknown>();
    connector.set('type', TYPE_CONNECTOR);
    connector.set('x', 0);
    connector.set('y', 0);
    connector.set('width', 0);
    connector.set('height', 0);
    connector.set('z', topZ(objects) + 1);
    connector.set('createdAt', Date.now());
    if (typeof by === 'string') connector.set('createdBy', by);
    connector.set('from', storedEnd(from));
    connector.set('to', storedEnd(to));
    objects.set(id, connector);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move one end of an arrow: onto `e.objectId`, or onto the board point `e.point`.
 * The change is one undo step, and an end dropped back where it already was writes
 * nothing at all.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: ConnectorEnd,
  value: Endpoint,
): boolean {
  const connector = connectorEntry(doc, id);
  if (connector === null) return false;
  if (end !== 'from' && end !== 'to') return false;
  if (!isEndpoint(value)) return false;

  const previous = connector.get(end);
  const next = storedEnd(value);

  // An arrow between one object and itself points at nothing: both ends would land on
  // the same box and there would be no line to draw. The rule belongs to the model and
  // not to the tool, so an undo, a paste and a dragged handle are all held to it.
  if (next.kind === 'attached') {
    const mate: ConnectorEnd = end === 'from' ? 'to' : 'from';
    const other = connector.get(mate);
    if (
      isEndpoint(other) &&
      other.kind === 'attached' &&
      other.objectId === next.objectId
    ) {
      return false;
    }
  }

  if (isEndpoint(previous) && endpointsEqual(previous as Endpoint, next)) return true;

  doc.transact(() => {
    connector.set(end, next);
    // A drag of the whole arrow writes nothing to x/y/width/height: they stay 0,
    // because where the arrow is is a question about its objects, not about it.
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The objects an arrow can be attached to: everything the board can draw that has a
 * place of its own. Arrows are not attachable to arrows - an arrow's place is
 * borrowed, so attaching an arrow to one would borrow it twice.
 */
export function canAttachEnd(type: unknown): boolean {
  return TYPES_THAT_TAKE_AN_ARROW.includes(type as string);
}

/** An object an arrow end can be dropped onto, with where it is and how high. */
export interface Attachable {
  id: string;
  type: string;
  rect: Rect;
  z: number;
}

/** Every object that takes an arrow end, in no particular order. */
function attachableObjects(doc: Y.Doc): Attachable[] {
  const found: Attachable[] = [];
  doc.getMap<Y.Map<unknown>>('objects').forEach((object, id) => {
    if (!(object instanceof Y.Map)) return;
    const type = object.get('type');
    if (!canAttachEnd(type)) return;
    const x = finite(object.get('x'));
    const y = finite(object.get('y'));
    if (x === null || y === null) return;
    const width = finite(object.get('width'));
    const height = finite(object.get('height'));
    const z = finite(object.get('z'));
    found.push({
      id,
      type: type as string,
      // the same defaults the board draws with, so a dot lands where the box is
      rect: objectBounds({
        id,
        type: type as string,
        x,
        y,
        width: width === null ? undefined : width,
        height: height === null ? undefined : height,
      }),
      z: z ?? 0,
    });
  });
  return found;
}

/** Every object's rect by id, the board as the arrows see it. */
export function connectorRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of attachableObjects(doc)) rects.set(object.id, object.rect);
  return rects;
}

/**
 * The object an arrow end dropped at this point would attach to: the topmost one
 * whose box holds the point, by the board's own half-open edge rule (the pixel that
 * begins the next object belongs to that one, never to both). Given a point with
 * nothing under it - board, grid, or an arrow, which takes no end - it gives null.
 */
export function attachTarget(doc: Y.Doc, point: Point): Attachable | null {
  let top: Attachable | null = null;
  for (const object of attachableObjects(doc)) {
    const r = object.rect;
    if (
      !(point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height)
    ) {
      continue;
    }
    // a tie in stacking is broken by id, so the answer does not depend on the order
    // the document happened to iterate the objects in
    if (top === null || object.z > top.z || (object.z === top.z && object.id < top.id)) top = object;
  }
  return top;
}


/**
 * The end an arrow drop makes. Dropped on nothing, the end is fixed at that board
 * point; dropped on an object, it is attached to that object and stores the point
 * of the object's side that faces what the arrow is drawn to - the same anchor
 * `resolveEndpoints` will draw it at, so releasing a handle writes the end to the
 * place the arrow already is and nothing flickers.
 *
 * `aim` is where the OTHER end is: an end is attached to an object by aiming past
 * it at whatever the arrow points to.
 */
export function endpointAtDrop(
  target: { id: string; rect: Rect } | null,
  point: Point,
  aim: Point,
): Endpoint {
  if (target === null) return { kind: 'free', x: point.x, y: point.y };
  return {
    kind: 'attached',
    objectId: target.id,
    fallback: sideAnchor(target.rect, nearestSide(target.rect, aim)),
  };
}

/**
 * An end dropped at `point`, judged against the end already at the other side of the
 * arrow: the object under the pointer, anchored to the side that faces what the
 * arrow is drawn to, or a point on the board - or `null` when the drop is one the
 * model will not have, which is a single case: the object the other end is already
 * attached to, because an arrow between one object and itself points at nothing.
 *
 * Both the tool that draws an arrow and the handle that re-drags one ask this, so the
 * same drop always makes the same end; and a handle whose drop is refused goes back
 * to where it was instead of somewhere new.
 */
export function dropEndpointOn(
  doc: Y.Doc,
  ends: Endpoints,
  end: ConnectorEnd,
  point: Point,
): Endpoint | null {
  const other: ConnectorEnd = end === 'from' ? 'to' : 'from';
  const target = attachTarget(doc, point);
  const mate = ends[other];
  if (target !== null && mate.kind === 'attached' && mate.objectId === target.id) return null;
  return endpointAtDrop(target, point, aimOfEnd(mate, connectorRects(doc)));
}

/**
 * Free the ends that were attached to objects that are going away, leaving each one
 * at the point on the deleted object's nearest side where it was drawn. An arrow
 * keeps its line and its undo, and the board keeps every arrow that pointed at a
 * shape: the shape goes, the arrow stays.
 *
 * `rects` is the board as it looked before the objects went - deleteObjects reads it
 * first and hands it over, because after the delete there is nothing left to measure
 * the side from. Called without it, this reads the board as it stands.
 */
export function detachConnectorsTo(
  doc: Y.Doc,
  deletedIds: readonly string[],
  rects: ReadonlyMap<string, Rect> = connectorRects(doc),
): void {
  if (!Array.isArray(deletedIds) || deletedIds.length === 0) return;
  const gone = new Set(deletedIds.filter((id) => typeof id === 'string' && id !== ''));
  if (gone.size === 0) return;

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const waiting: { connector: Y.Map<unknown>; end: ConnectorEnd; point: Point }[] = [];

  objects.forEach((object) => {
    if (!(object instanceof Y.Map) || object.get('type') !== TYPE_CONNECTOR) return;
    for (const end of ['from', 'to'] as const) {
      const value = object.get(end);
      if (!isEndpoint(value) || value.kind !== 'attached') continue;
      if (!gone.has(value.objectId)) continue;
      // where the end was drawn, worked out while its object was still there
      const other = end === 'from' ? 'to' : 'from';
      const otherEnd = object.get(other);
      const aim = isEndpoint(otherEnd) ? aimOfEnd(otherEnd, rects) : endpointPoint(value);
      waiting.push({ connector: object, end, point: anchorOf(value, aim, rects) });
    }
  });

  if (waiting.length === 0) return;
  // The board's own origin, so this is a step undo knows about: undone with the delete
  // that caused it when it happens inside that transaction, and on its own when a
  // caller asks for a detach by itself.
  doc.transact(() => {
    for (const { connector, end, point } of waiting) {
      connector.set(end, { kind: 'free', x: point.x, y: point.y });
    }
  }, LOCAL_ORIGIN);
}

/** The point one end aims at: its object's centre while the object is there. */
function aimOfEnd(end: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return endpointPoint(end);
  const rect = rects.get(end.objectId);
  if (rect === undefined) return endpointPoint(end);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function readEnd(value: unknown): Endpoint | null {
  if (!isEndpoint(value)) return null;
  if ((value as Endpoint).kind === 'free') {
    const end = value as { x?: unknown; y?: unknown };
    return { kind: 'free', x: Number(end.x), y: Number(end.y) };
  }
  const attached = value as { objectId: string; fallback?: unknown };
  return { kind: 'attached', objectId: attached.objectId, fallback: endpointPoint(attached as Endpoint) };
}

/**
 * Read one object entry as an arrow. Both ends must be readable: an arrow that lost
 * an end is not an arrow, and drawing half of one would put a line on the board that
 * no one drew. Where the ends *are* is a question about the objects they point at,
 * so the box is read from the board as it is right now.
 */
export function readConnector(id: string, object: Y.Map<unknown>): ConnectorSnapshot | null {
  const doc = object.doc;
  return readConnectorWith(id, object, doc === null ? new Map() : connectorRects(doc));
}

/** Every arrow on the board, in creation order. */
export function connectorSnapshots(doc: Y.Doc): readonly ConnectorSnapshot[] {
  const connectors: ConnectorSnapshot[] = [];
  const rects = connectorRects(doc);
  doc.getMap<Y.Map<unknown>>('objects').forEach((object, id) => {
    if (!(object instanceof Y.Map) || object.get('type') !== TYPE_CONNECTOR) return;
    const snap = readConnectorWith(id, object, rects);
    if (snap !== null) connectors.push(snap);
  });
  return connectors;
}

/** One arrow by id, or null when it is gone or unreadable. */
export function connectorSnapshot(doc: Y.Doc, id: string): ConnectorSnapshot | null {
  if (typeof id !== 'string' || id === '') return null;
  const object = doc.getMap<Y.Map<unknown>>('objects').get(id);
  return object instanceof Y.Map ? readConnectorWith(id, object, connectorRects(doc)) : null;
}

/** The same read, against a rect map built once for the whole board. */
function readConnectorWith(
  id: string,
  object: Y.Map<unknown>,
  rects: ReadonlyMap<string, Rect>,
): ConnectorSnapshot | null {
  if (object.get('type') !== TYPE_CONNECTOR) return null;
  const from = readEnd(object.get('from'));
  const to = readEnd(object.get('to'));
  const z = finite(object.get('z'));
  if (from === null || to === null || z === null) return null;
  const ends = resolveEndpoints({ from, to }, rects);
  const box = connectorBBox(ends.from, ends.to);
  const createdAt = finite(object.get('createdAt'));
  const createdBy = object.get('createdBy');
  return {
    id,
    type: TYPE_CONNECTOR,
    from,
    to,
    ends,
    x: box.x,
    y: box.y,
    width: Math.min(box.width, MAX_OBJECT_SIZE_WORLD),
    height: Math.min(box.height, MAX_OBJECT_SIZE_WORLD),
    z,
    createdAt: createdAt ?? 0,
    createdBy: typeof createdBy === 'string' ? createdBy : null,
  };
}
