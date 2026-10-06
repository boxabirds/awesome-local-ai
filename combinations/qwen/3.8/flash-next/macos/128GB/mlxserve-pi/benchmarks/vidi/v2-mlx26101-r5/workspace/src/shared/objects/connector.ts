/**
 * The connector object: an arrow between two board objects, its schema and its mutations (story 10).
 *
 * A connector is an entry in the same `objects` map as everything else, with two fields of its own:
 * `from` and `to`. Each is one of two things:
 *
 * - `attached`: the id of the object this end is on, plus a `fallback` point. **No side, no position.**
 *   Where the end is drawn is asked of the object's rectangle every time the board is read (see
 *   `geometry/connector-geometry.ts`), which is what lets an arrow follow an object that somebody else
 *   moved without a single write about the arrow, and what makes an arrow switch sides as one shape
 *   passes another. Storing a position here instead would mean a write per frame of a drag, per arrow,
 *   per person — and an arrow that arrives at the answer late.
 * - `free`: a point of its own, which is where it stays until somebody picks it up again. This is what
 *   an arrow to nowhere is, and what an arrow becomes when the object it was on is deleted.
 *
 * The `fallback` is the anchor as it was the last time the object was known to be there. It has exactly
 * one job: the object was deleted between the release and the write, or by a client that never heard of
 * arrows, and the arrow has to be drawn *somewhere*. It is written as the object's own side at attach
 * time, so a fallback is never a guess — it is the last true position.
 *
 * The four numbers every object has for a box are written as zeros and derived on every read. An arrow
 * between two shapes has no size of its own: it is as big as the distance between its ends, and a stored
 * size would be a lie the instant either object moved. Story 7's select-all, marquee and stacking all
 * read the derived box and never notice that it was not in the document.
 *
 * As with every other mutation here, one success is one `doc.transact(fn, LOCAL_ORIGIN)` and a rejected
 * write returns before a transaction is opened, so it makes no update and no undo step.
 */

import * as Y from 'yjs';

import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import { LOCAL_ORIGIN, OBJECTS_MAP, objectBounds, snapshot, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';
import { resolveEndpoints } from '../geometry/connector-geometry';

/** The registry key of an arrow. Spelled in `board-model.ts` as `CONNECTOR_TYPE`, which names it there. */
export const CONNECTOR_OBJECT_TYPE = 'connector';

/**
 * One end of an arrow: either on an object, or at a point.
 *
 * `fallback` is only on an attached end, and only ever holds a point that was really on that object. A
 * free end needs nothing of the kind: it is its own point.
 */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** One arrow on the board, as the snapshot reads it. */
export interface ConnectorSnapshot extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

/** The two ends of an arrow, which is also the shape the interface drags. */
export interface Ends {
  from: Point;
  to: Point;
}

export type { Side } from '../geometry/connector-geometry';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => {
  // The same map the board model reads; the cast is the one every object type here makes, because a
  // Y.Map cannot be told at construction time what its values will be.
  return doc.getMap(OBJECTS_MAP) as Y.Map<Y.Map<unknown>>;
};

/** The highest stacking number on the board, so that a new arrow is drawn above what is already there. */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  objectsOf(doc).forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > top) top = z;
  });
  return top;
}

/** Every object's box, keyed by id, which is what an attached end is drawn from. */
const rectsOf = (doc: Y.Doc): Map<string, Rect> =>
  // Read from the snapshot rather than from the raw maps, for two reasons that are both worth the one
  // extra pass: an object that never recorded a size is as big as its type's default and not as big as
  // nothing, and an arrow's own box is the one its two ends make — so an arrow can be joined to another
  // arrow from here, which is what the board's own rects map says it is. The client that draws an arrow
  // has this same map in hand already, so the two of them cannot disagree about where a shape is.
  new Map(snapshot(doc).map((object) => [object.id, objectBounds(object)]));

/** Is this a well-formed end? Anything else is a hole in a document and is not written to one. */
export function isEndpoint(value: unknown): value is Endpoint {
  if (value === null || typeof value !== 'object') return false;
  const end = value as { kind?: unknown; objectId?: unknown; fallback?: unknown; x?: unknown; y?: unknown };
  if (end.kind === 'free') return finite(end.x) && finite(end.y);
  if (end.kind === 'attached') return typeof end.objectId === 'string' && end.objectId.length > 0 && isPoint(end.fallback);
  return false;
}

/** A place, or false. */
function isPoint(value: unknown): value is Point {
  if (value === null || typeof value !== 'object') return false;
  const point = value as { x?: unknown; y?: unknown };
  return finite(point.x) && finite(point.y);
}

/** Both ends on the same object, which is an arrow of no length and a thing the PRD refuses outright. */
const sameObject = (from: Endpoint, to: Endpoint): boolean =>
  from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId;

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * The end as it goes into the document.
 *
 * An attached end keeps its object and gets the anchor it is being drawn at as its fallback: the release
 * point the interface saw is thrown away on purpose, because the release point is a guess about where
 * the pointer was and the anchor is a fact about where the object is. A day from now, when the object is
 * gone and the fallback is all that is left, the arrow will be drawn where it really was rather than
 * where somebody's cursor happened to be.
 */
const stored = (end: Endpoint, at: Point): Endpoint => (end.kind === 'attached' ? { kind: 'attached', objectId: end.objectId, fallback: at } : { kind: 'free', x: end.x, y: end.y });

/** Reads an end back out of a document, tolerating whatever a newer client may have written into it. */
export function readEndpoint(value: unknown): Endpoint {
  if (!isEndpoint(value)) return { kind: 'free', x: 0, y: 0 };
  if (value.kind === 'free') {
    const point = value as unknown as Point;
    return { kind: 'free', x: point.x, y: point.y };
  }
  const end = value as { objectId: string; fallback: Point };
  return { kind: 'attached', objectId: end.objectId, fallback: { x: end.fallback.x, y: end.fallback.y } };
}

/**
 * Draws an arrow between two objects.
 *
 * `from` and `to` are the ends as the interface understood them at the moment the pointer came up: an
 * end over an object is `attached`, with the release point as its fallback; an end over nothing is
 * `free` at the release point. What goes into the document is the same pair with the guesses replaced by
 * anchors, which is the only reason an arrow and the dots it was drawn between agree with each other.
 *
 * Refuses, with no write at all, in the two cases the PRD names — both ends on the same object (TC-08),
 * and an arrow shorter than `CONNECTOR_MIN_LENGTH_WORLD` once drawn (TC-09). The length is measured
 * between the ends *as they would be drawn*, which matters for the case that a size measured between
 * two object centres would get wrong: two shapes nearly touching would be joined by an arrowhead of
 * nothing.
 *
 * An object that vanished between the release and this call does not stop the arrow: the end is kept
 * attached, at the release point, so what appears on the board is the arrow that was dragged.
 *
 * Returns the id, or null when nothing was written.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by = ''): string | null {
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  if (sameObject(from, to)) return null;

  const rects = rectsOf(doc);
  const ends = resolveEndpoints({ from, to }, rects);
  if (distance(ends.from, ends.to) < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const objects = objectsOf(doc);
  const id = crypto.randomUUID();
  const map = new Y.Map<unknown>();
  const createdAt = Date.now();
  const author = typeof by === 'string' ? by : '';

  doc.transact(() => {
    map.set('type', CONNECTOR_OBJECT_TYPE);
    // The box of an arrow is the box of its two ends, and those are two objects' boxes. The four numbers
    // are zeros because there is no honest number to put here; the snapshot derives them every read.
    map.set('x', 0);
    map.set('y', 0);
    map.set('width', 0);
    map.set('height', 0);
    map.set('z', maxZ(doc) + 1);
    map.set('createdAt', createdAt);
    map.set('createdBy', author);
    map.set('from', stored(from, ends.from));
    map.set('to', stored(to, ends.to));
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Moves one end of an arrow — the thing a person does by dragging an end handle.
 *
 * The end goes where they released it: over an object, it is attached to that object and drawn on the
 * side of it that faces whatever the other end is now; over nothing, it is a point, fixed at the place
 * they let go. Both are one write, one step of the history.
 *
 * Refuses, and writes nothing, when the arrow is gone (TC-29), when the end is not an end, and — the one
 * the PRD asks for by name (TC-12) — when the end is being attached to the object the *other* end is
 * already on. That last refusal is not fussiness: an arrow with both ends on one object is a dot, and a
 * handle that was dragged onto the shape underneath it and produced a dot would read as a bug in the
 * arrow rather than as the rule that keeps arrows arrows. The interface says so out loud instead, by
 * snapping the handle back to where it came from.
 *
 * One piece of housekeeping comes along for free: if the end that is *not* being moved is attached to an
 * object that is no longer on the board, it is turned into the point it has been drawing at all along.
 * That state is the arrow admitting to something it is not, and the moment this function is called is
 * the moment the board is already rewriting the arrow anyway.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', next: Endpoint): boolean {
  if (end !== 'from' && end !== 'to') return false;
  if (!isEndpoint(next)) return false;

  const value: unknown = objectsOf(doc).get(id);
  if (!(value instanceof Y.Map) || value.get('type') !== CONNECTOR_OBJECT_TYPE) return false;

  const current = readEndpoint(value.get(end));
  const otherEnd = end === 'from' ? 'to' : 'from';
  const other = readEndpoint(value.get(otherEnd));
  if (sameObject(next, other)) return false;

  const rects = rectsOf(doc);
  const moved = stored(next, drawOne(next, other, rects));

  // Already exactly that end, on the same object, on the same side, in the same place. A handle that is
  // picked up and put back down is not a thing that happened, and an undo step that undoes nothing is
  // worse than no undo step.
  if (samePlace(current, moved)) return false;

  const detached = normalizeOrphan(other, rects);

  doc.transact(() => {
    value.set(end, moved);
    if (detached !== null) value.set(otherEnd, detached);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Where one end is drawn, on a board, aiming at the end it is joined to.
 *
 * The end being written is put in the first seat of a two-ended arrow and the answer read back out of
 * the same seat: `resolveEndpoints` decides both ends from each other's positions, so one end and its
 * partner in the two seats is the same question in either order.
 */
function drawOne(end: Endpoint, toward: Endpoint, rects: Map<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  return resolveEndpoints({ from: end, to: toward }, rects).from;
}

/** Two ends that are the same end in every field that gets written. */
const samePlace = (a: Endpoint, b: Endpoint): boolean => {
  if (a.kind === 'free' && b.kind === 'free') return a.x === b.x && a.y === b.y;
  if (a.kind === 'attached' && b.kind === 'attached') {
    return a.objectId === b.objectId && a.fallback.x === b.fallback.x && a.fallback.y === b.fallback.y;
  }
  return false;
};

/**
 * An end attached to an object that is gone, turned into the point it has been drawing at.
 *
 * Returns null when there was nothing to normalize, which is nearly always: both ends of a healthy arrow
 * point at objects that exist, and this function's whole job is to notice the one case where they do not.
 */
function normalizeOrphan(end: Endpoint, rects: Map<string, Rect>): Endpoint | null {
  if (end.kind !== 'attached') return null;
  if (rects.has(end.objectId)) return null;
  return { kind: 'free', x: end.fallback.x, y: end.fallback.y };
}

/**
 * Lets go of every arrow that is holding a deleted object (TC-13).
 *
 * Story 7's `deleteObjects` calls this *inside* the transaction it already had open, before it removes
 * the objects — which is the only way the arrow can be detached using the positions the objects still
 * have. Once they are gone there is nothing left to ask "where were you?", and the arrow would have to be
 * drawn from a guess. One transaction means one update event, so a person on the far end of the network
 * never sees a board with an arrow attached to nothing, not even for the instant between two writes.
 *
 * The end becomes `free` at the anchor it was drawn at: the object is gone, but the arrow is not. That is
 * the PRD's decision, and it is the one that keeps a person's diagram intact when they delete a box,
 * rather than quietly taking half of the diagram's meaning away with it. The arrow can then be re-attached
 * somewhere else by its handle, or deleted, or left where it is as a record of a shape that used to be.
 *
 * An end already attached to an object that is missing is left strictly alone: it is already drawing at
 * its fallback, which is the same place this function would put it, and a write that changes nothing on
 * the screen is an undo step that undoes nothing.
 *
 * Safe to call with no transaction open, and with a list of ids that are none of an arrow's business.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (!Array.isArray(deletedIds) || deletedIds.length === 0) return;
  const gone = new Set(deletedIds.filter((id) => typeof id === 'string'));
  if (gone.size === 0) return;

  // The rectangles are read before anything is removed, which is the entire point of this function being
  // called where it is: the anchors are computed from the objects as they still are.
  const rects = rectsOf(doc);
  const writes: { map: Y.Map<unknown>; end: 'from' | 'to'; point: Point }[] = [];

  objectsOf(doc).forEach((value) => {
    if (!(value instanceof Y.Map) || value.get('type') !== CONNECTOR_OBJECT_TYPE) return;
    const from = readEndpoint(value.get('from'));
    const to = readEndpoint(value.get('to'));
    const ends = resolveEndpoints({ from, to }, rects);
    // `rects.has` is the second half of the test, and the whole of the difference between letting go of
    // an arrow and rewriting one for nothing: an end whose object is still on the board has an anchor to
    // be moved to, and an end whose object went missing earlier is already drawn at its fallback, which
    // is the same point. It stays as it is, and the board does not get a write that shows nothing.
    if (from.kind === 'attached' && gone.has(from.objectId) && rects.has(from.objectId)) writes.push({ map: value, end: 'from', point: ends.from });
    if (to.kind === 'attached' && gone.has(to.objectId) && rects.has(to.objectId)) writes.push({ map: value, end: 'to', point: ends.to });
  });

  if (writes.length === 0) return;

  // Inside the caller's transaction when there is one, and on its own when this was called directly.
  // Yjs closes a nested transaction without emitting, so both cases are one update and not two.
  doc.transact(() => {
    for (const write of writes) write.map.set(write.end, { kind: 'free', x: write.point.x, y: write.point.y });
  }, LOCAL_ORIGIN);
}

/**
 * The two points an arrow is drawn between, read straight from the document.
 *
 * The component could call `resolveEndpoints` itself, and does; this is for the callers that are not
 * drawing and still need the answer — the hit test that decides whether a click landed on the line, and
 * the interface that has to know where the end it is dragging currently is.
 */
export function connectorEnds(doc: Y.Doc, id: string): Ends | null {
  const value: unknown = objectsOf(doc).get(id);
  if (!(value instanceof Y.Map) || value.get('type') !== CONNECTOR_OBJECT_TYPE) return null;
  return resolveEndpoints({ from: readEndpoint(value.get('from')), to: readEndpoint(value.get('to')) }, rectsOf(doc));
}
