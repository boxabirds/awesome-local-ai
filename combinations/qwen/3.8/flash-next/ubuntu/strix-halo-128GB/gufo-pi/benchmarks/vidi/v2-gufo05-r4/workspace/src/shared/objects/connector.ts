/**
 * The connector object (schema: `connector.model`): an arrow between two things on the board.
 *
 * What a connector stores is *relationships*, not a line. Each end is either tied to an
 * object — "leave that shape through whichever side faces the other end" — or free, sitting at
 * a point on the board. The two points the arrow is drawn between are derived from that and
 * from where the shapes currently are (`connector.follow`), so moving an object needs no change
 * to the arrow at all: the next snapshot resolves the ends again and the arrow has followed.
 *
 * Each end also carries a `fallback`: the anchor it was last using on the object it is tied to.
 * It is the reason a delete can be kind. When the object goes, the end becomes free *at that
 * point*, and the arrow stays exactly where it was drawn instead of snapping to the middle of
 * the board or vanishing (`connector.detach`).
 *
 * Two rules the rest of the app depends on:
 *
 *  - the ends are written as a pair, in the transaction that creates the arrow, so a reader
 *    never sees half of one;
 *  - a delete that takes an object also rewrites the ends tied to it, inside the same
 *    transaction (`onObjectsDeleted` in `../board-model.ts`). Nobody, on any client, ever
 *    observes an arrow tied to an object that is gone.
 *
 * Its box — `x`, `y`, `width`, `height` — is stored as nothing and derived in the snapshot from
 * the resolved ends, because it is not data: it is a consequence of where two other objects
 * are. Sharing it with the box of every marquee, selection frame and toolbar means an arrow is
 * selectable and frameable without any of that code knowing an arrow exists.
 */

import * as Y from 'yjs';
import {
  createId,
  declareObjectType,
  LOCAL_ORIGIN,
  maxZ,
  objectMap,
  objectRects,
  onObjectsDeleted,
  type ObjectSnapshot,
  type SnapshotContext
} from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import {
  connectorBBox,
  resolveEndpoints,
  sideAnchor,
  nearestSide,
  type ConnectorPoints
} from '../geometry/connector-geometry';
import type { Point, Rect } from '../geometry';

/** The object type name this module owns. */
export const CONNECTOR_OBJECT_TYPE = 'connector';

/** Which end of the arrow: the tail, or the head the arrow points with. */
export type ConnectorEnd = 'from' | 'to';

const ENDS: readonly ConnectorEnd[] = ['from', 'to'];

/** One end of an arrow, as stored: tied to an object, or sitting on the board. */
export type ConnectorEndpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/**
 * One end of an arrow as a caller asks for it.
 *
 * A caller knows which shape the pointer was over, or where on the board the pointer came to
 * rest; working out the anchor and keeping it in step with the shape is this module's business,
 * so the anchor is not part of the request.
 */
export type ConnectorEndpointInput = { kind: 'attached'; objectId: string } | { kind: 'free'; x: number; y: number };

/** A connector, as the screen and the snapshot worker read it. */
export interface ConnectorSnap extends ObjectSnapshot {
  readonly type: 'connector';
  /** An arrow always carries a box in its snapshot: derived, but never missing. */
  readonly width: number;
  readonly height: number;
  readonly from: ConnectorEndpoint;
  readonly to: ConnectorEndpoint;
  /**
   * Where the two ends are, worked out from the objects the arrow is tied to.
   *
   * Derived in the snapshot, beside the bounding box that comes from the same two points, so
   * the line on the screen, the box that selects it and the distance a click is measured
   * against are all one answer to one question. An attached end with no object on the board
   * resolves to its stored fallback, which is why this is never missing.
   */
  readonly points: ConnectorPoints;
  readonly createdAt: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readPoint(value: unknown): Point | undefined {
  if (value instanceof Y.Map) {
    const x = value.get('x');
    const y = value.get('y');
    return isFiniteNumber(x) && isFiniteNumber(y) ? { x, y } : undefined;
  }
  return undefined;
}

/**
 * Decode one stored end, or `null` when what is stored is not an end at all — a value written
 * by something that has never read this file. An arrow with an unreadable end is left out of
 * the snapshot rather than drawn from a guess.
 */
function readEndpoint(value: unknown): ConnectorEndpoint | null {
  if (!(value instanceof Y.Map)) return null;
  const kind = value.get('kind');
  if (kind === 'attached') {
    const objectId = value.get('objectId');
    if (typeof objectId !== 'string' || objectId === '') return null;
    // The fallback is what the end falls back to when its object is gone; without it a
    // delete would have somewhere honest to put the end, so an attached end without one is
    // treated as the broken reference it is.
    const fallback = readPoint(value.get('fallback'));
    if (!fallback) return null;
    return { kind: 'attached', objectId, fallback };
  }
  if (kind === 'free') {
    const x = value.get('x');
    const y = value.get('y');
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
    return { kind: 'free', x, y };
  }
  return null;
}

function writeEndpoint(end: ConnectorEndpoint): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('kind', end.kind);
  if (end.kind === 'attached') {
    map.set('objectId', end.objectId);
    const fallback = new Y.Map<number>();
    fallback.set('x', end.fallback.x);
    fallback.set('y', end.fallback.y);
    map.set('fallback', fallback);
  } else {
    map.set('x', end.x);
    map.set('y', end.y);
  }
  return map;
}

/** The connector's own reader: see `declareObjectType` in `../board-model.ts`. */
function readConnectorObject(
  object: Y.Map<unknown>,
  common: ObjectSnapshot,
  context?: SnapshotContext
): ConnectorSnap | null {
  const from = readEndpoint(object.get('from'));
  const to = readEndpoint(object.get('to'));
  if (!from || !to) return null;
  const createdAt = object.get('createdAt');
  // Where the arrow actually is, given where the objects it is tied to are.
  const ends = resolveEndpoints({ from, to }, context?.rects);
  const box = connectorBBox(ends.from, ends.to);
  return {
    ...common,
    type: CONNECTOR_OBJECT_TYPE,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    from,
    to,
    points: ends,
    createdAt: isFiniteNumber(createdAt) ? (createdAt as number) : 0
  };
}

declareObjectType(CONNECTOR_OBJECT_TYPE, readConnectorObject);

/** Is `value` a well-formed end of the kind a caller may ask for? */
function isEndpointInput(value: unknown): value is ConnectorEndpointInput {
  if (!value || typeof value !== 'object') return false;
  const end = value as { kind?: unknown; objectId?: unknown; x?: unknown; y?: unknown };
  if (end.kind === 'attached') return typeof end.objectId === 'string' && end.objectId !== '';
  if (end.kind === 'free') return isFiniteNumber(end.x) && isFiniteNumber(end.y);
  return false;
}

function isEndName(value: unknown): value is ConnectorEnd {
  return value === 'from' || value === 'to';
}

/** A connector's `Y.Map`, or undefined when the id is not an arrow on this board. */
function connectorMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const object = objectMap(doc, id);
  return object && object.get('type') === CONNECTOR_OBJECT_TYPE ? object : undefined;
}

/** The two stored ends of a connector, or `null` when they cannot be read. */
function storedEnds(object: Y.Map<unknown>): { from: ConnectorEndpoint; to: ConnectorEndpoint } | null {
  const from = readEndpoint(object.get('from'));
  const to = readEndpoint(object.get('to'));
  return from && to ? { from, to } : null;
}

/** A stand-in for an attached end while its anchor is being worked out; never stored. */
function provisional(end: ConnectorEndpointInput): ConnectorEndpoint {
  return end.kind === 'attached'
    ? { kind: 'attached', objectId: end.objectId, fallback: { x: 0, y: 0 } }
    : { kind: 'free', x: end.x, y: end.y };
}

/** Is this end asking for an object that is not on the board? */
function isStale(end: ConnectorEndpointInput, rects: ReadonlyMap<string, Rect>): boolean {
  return end.kind === 'attached' && !rects.get(end.objectId);
}

/** How far apart two resolved ends are. */
function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Tie an arrow between two things (`connector.draw`) and return its id.
 *
 * Each end is tied to the object the pointer was over, or free at the point the pointer came
 * to rest; both anchors are worked out here, and both ends are written in one transaction, so
 * there is no moment in which the board holds half an arrow.
 *
 * Returns `null`, having written nothing, when the request is not an arrow: an end that is not
 * an end, an end tied to an object that is not on the board, both ends tied to the same object,
 * or an arrow too short to be one — including one whose ends land in the same place, which is
 * what an arrow from a shape to itself would be.
 */
export function createConnector(
  doc: Y.Doc,
  a: { from: ConnectorEndpointInput; to: ConnectorEndpointInput },
  by: string
): string | null {
  if (!a || !isEndpointInput(a.from) || !isEndpointInput(a.to)) return null;
  if (a.from.kind === 'attached' && a.to.kind === 'attached' && a.from.objectId === a.to.objectId) return null;

  const rects = objectRects(doc);
  if (isStale(a.from, rects) || isStale(a.to, rects)) return null;

  const ends = { from: provisional(a.from), to: provisional(a.to) };
  const points = resolveEndpoints(ends, rects);
  if (!(distance(points.from, points.to) >= CONNECTOR_MIN_LENGTH_WORLD)) return null;

  const stored = {
    from: tieEnd(a.from, points.from),
    to: tieEnd(a.to, points.to)
  };

  let created: string | null = null;
  doc.transact(() => {
    const id = createId();
    const object = new Y.Map<unknown>();
    object.set('id', id);
    object.set('type', CONNECTOR_OBJECT_TYPE);
    // Where an arrow is is a consequence of where its ends are, so the common box starts
    // empty and the snapshot derives it. Nothing reads these four numbers back.
    object.set('x', 0);
    object.set('y', 0);
    object.set('width', 0);
    object.set('height', 0);
    object.set('z', maxZ(doc) + 1);
    object.set('createdAt', Date.now());
    object.set('from', writeEndpoint(stored.from));
    object.set('to', writeEndpoint(stored.to));
    if (typeof by === 'string' && by !== '') object.set('createdBy', by);
    doc.getMap<Y.Map<unknown>>('objects').set(id, object);
    created = id;
  }, LOCAL_ORIGIN);
  return created;
}

/** Turn what a caller asked for into what gets stored, with the anchor it now holds. */
function tieEnd(end: ConnectorEndpointInput, anchor: Point): ConnectorEndpoint {
  return end.kind === 'attached'
    ? { kind: 'attached', objectId: end.objectId, fallback: anchor }
    : { kind: 'free', x: end.x, y: end.y };
}

/**
 * Move one end of an arrow: re-tie it to another object, or drop it on the board (`connector.redrag`).
 *
 * The anchor is resolved here, the same way creation resolves it, so an end dragged onto a
 * shape holds the side of that shape facing the rest of the arrow — and so the end keeps
 * following the shape afterwards, which is the difference between an arrow attached and an
 * arrow merely drawn near something.
 *
 * Refused, with nothing written: an id that is not an arrow, an end that is not an end, an end
 * that is not a request, an object that is not on the board, tying both ends to the same
 * object, an arrow too short to point anywhere, and an end that would stay exactly where it is.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: ConnectorEnd,
  target: ConnectorEndpointInput
): boolean {
  const object = connectorMap(doc, id);
  if (!object || !isEndName(end)) return false;
  if (!isEndpointInput(target)) return false;
  const ends = storedEnds(object);
  if (!ends) return false;

  const other = ends[end === 'from' ? 'to' : 'from'];
  if (target.kind === 'attached' && other.kind === 'attached' && target.objectId === other.objectId) return false;

  const rects = objectRects(doc);
  if (isStale(target, rects)) return false;

  const next = tieEnd(target, { x: 0, y: 0 });
  if (sameEnd(next, ends[end])) return false;

  const points = resolveEndpoints({ from: end === 'from' ? next : ends.from, to: end === 'to' ? next : ends.to }, rects);
  if (!(distance(points.from, points.to) >= CONNECTOR_MIN_LENGTH_WORLD)) return false;

  // The anchor is only meaningful once the rest of the arrow is known, so it is taken from
  // the resolution above rather than guessed at.
  const anchor = end === 'from' ? points.from : points.to;
  const written = tieEnd(target, anchor);

  doc.transact(() => {
    object.set(end, writeEndpoint(written));
  }, LOCAL_ORIGIN);
  return true;
}

/** Does this end say what the stored one already says? Then there is nothing to write. */
function sameEnd(next: ConnectorEndpoint, current: ConnectorEndpoint): boolean {
  if (next.kind !== current.kind) return false;
  if (next.kind === 'attached' && current.kind === 'attached') return next.objectId === current.objectId;
  if (next.kind === 'free' && current.kind === 'free') return next.x === current.x && next.y === current.y;
  return false;
}

/**
 * Free every arrow end tied to an object that is going away (`connector.detach`).
 *
 * Each end becomes free *at the anchor it was using*, because an arrow whose shape was deleted
 * should stay where the person looking at it last saw it, rather than jump. An end tied to an
 * object that survives is left alone, and an arrow already freed is not changed a second time,
 * so a repeated delete is silent.
 *
 * Called by `deleteObjects` inside its own transaction, while every object can still be
 * measured; returns how many ends it rewrote.
 */
export function detachConnectorsTo(doc: Y.Doc, ids: readonly string[]): number {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const gone = new Set(ids.filter((id) => typeof id === 'string' && id !== ''));
  if (gone.size === 0) return 0;

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  // Read the board while all of it is still there: this is the last chance to know where the
  // shape an end is tied to was.
  const rects = objectRects(doc);
  const rewrites: Array<{ object: Y.Map<unknown>; end: ConnectorEnd; point: Point }> = [];

  for (const [, object] of objects) {
    if (!(object instanceof Y.Map) || object.get('type') !== CONNECTOR_OBJECT_TYPE) continue;
    const ends = storedEnds(object);
    if (!ends) continue;
    const points = resolveEndpoints(ends, rects);
    for (const end of ENDS) {
      const stored = ends[end];
      if (stored.kind !== 'attached' || !gone.has(stored.objectId)) continue;
      // The point the arrow was being drawn from, not the centre of the object that is going.
      const point = end === 'from' ? points.from : points.to;
      rewrites.push({ object, end, point: isFinitePoint(point) ? point : stored.fallback });
    }
  }

  if (rewrites.length === 0) return 0;
  doc.transact(() => {
    for (const rewrite of rewrites) {
      rewrite.object.set(rewrite.end, writeEndpoint({ kind: 'free', x: rewrite.point.x, y: rewrite.point.y }));
    }
  }, LOCAL_ORIGIN);
  return rewrites.length;
}

function isFinitePoint(point: Point | undefined): point is Point {
  return !!point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

// An object that is deleted takes its arrows' ends with it, in the same transaction. Registering
// here rather than in the delete itself keeps this module the only place that knows how an end
// is freed, and keeps the shared model free of this type's details.
onObjectsDeleted(detachConnectorsTo);

/**
 * The anchor an end would hold for `rect` if it were tied to it, facing `other`.
 *
 * Exported for the screen that shows the four dots of a shape: the dot a pointer is nearest is
 * the side the arrow would leave from, and saying so once here means the highlight and the
 * arrow that gets created can never disagree.
 */
export function anchorForSide(rect: Rect, other: Point): Point {
  return sideAnchor(rect, nearestSide(rect, other));
}
