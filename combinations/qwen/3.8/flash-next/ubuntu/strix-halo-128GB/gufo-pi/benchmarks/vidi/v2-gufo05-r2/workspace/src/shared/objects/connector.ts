/**
 * Story 10: the connector object — an arrow between two objects.
 *
 * A connector stores its two ends and nothing else about its geometry. Each end is
 * either attached to an object, with a board position to fall back on, or free in
 * space. Everything else — the line, its box, which side of an object it leaves from
 * — is derived at read time from the current boxes of the objects involved (see
 * `connector-geometry`), which is what lets an arrow follow a shape across the board
 * without a single extra write, and lets every client agree on where the arrow is
 * without ever agreeing on a path.
 *
 * Deleting an object detaches the ends that pointed at it and leaves them where the
 * object was (PRD connector.detach). That is a write to the arrow, not a rewrite of
 * history: the arrow keeps its shape, and dragging its end onto another object
 * re-attaches it.
 */

import * as Y from 'yjs';

import {
  LOCAL_ORIGIN,
  objectBounds,
  objectSnapshots,
  type ObjectSnapshot,
} from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Point, Rect } from '../geometry';
import {
  connectorBBox,
  endpointPosition,
  pointOf,
  resolveEndpoints,
  sideAnchor,
  nearestSide,
} from '../geometry/connector-geometry';
import { distanceToPolyline } from '../geometry/polyline';

/** One end of an arrow: tied to an object, or loose on the board. */
export type ConnectorEndpoint =
  | { kind: 'attached'; objectId: string; fallbackX: number; fallbackY: number }
  | { kind: 'free'; x: number; y: number };

/** What a connector stores on top of the common fields. */
export interface ConnectorSnapshot extends ObjectSnapshot {
  type: 'connector';
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** An end as stored, or null when the stored value cannot be an end at all. */
function readEndpoint(value: unknown): ConnectorEndpoint | null {
  if (!(value instanceof Y.Map)) return null;
  const kind = value.get('kind');
  if (kind === 'attached') {
    const objectId = value.get('objectId');
    if (typeof objectId !== 'string' || objectId === '') return null;
    return {
      kind: 'attached',
      objectId,
      fallbackX: num(value.get('fallbackX')),
      fallbackY: num(value.get('fallbackY')),
    };
  }
  if (kind === 'free') {
    const x = value.get('x');
    const y = value.get('y');
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { kind: 'free', x, y };
  }
  return null;
}

function writeEndpoint(end: ConnectorEndpoint): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  if (end.kind === 'free') {
    map.set('kind', 'free');
    map.set('x', end.x);
    map.set('y', end.y);
    return map;
  }
  map.set('kind', 'attached');
  map.set('objectId', end.objectId);
  map.set('fallbackX', end.fallbackX);
  map.set('fallbackY', end.fallbackY);
  return map;
}

/** An end has to be a place on the board before an arrow may start or stop there. */
function isUsableEndpoint(end: ConnectorEndpoint): boolean {
  if (end.kind === 'free') return Number.isFinite(end.x) && Number.isFinite(end.y);
  return (
    typeof end.objectId === 'string' &&
    end.objectId !== '' &&
    Number.isFinite(end.fallbackX) &&
    Number.isFinite(end.fallbackY)
  );
}

function endpointEquals(a: ConnectorEndpoint, b: ConnectorEndpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'free' && b.kind === 'free') return a.x === b.x && a.y === b.y;
  if (a.kind === 'attached' && b.kind === 'attached') {
    return (
      a.objectId === b.objectId && a.fallbackX === b.fallbackX && a.fallbackY === b.fallbackY
    );
  }
  return false;
}

/** The connector with this id, or null when it is gone or is something else. */
export function readConnector(doc: Y.Doc, id: string): ConnectorSnapshot | null {
  const entry = objectsMap(doc).get(id);
  if (!entry || entry.get('type') !== 'connector') return null;
  return connectorSnapshotOf(id, entry);
}

/** Every arrow on the board. */
export function readConnectors(doc: Y.Doc): ConnectorSnapshot[] {
  const out: ConnectorSnapshot[] = [];
  for (const [id, entry] of objectsMap(doc)) {
    if (entry.get('type') === 'connector') out.push(connectorSnapshotOf(id, entry));
  }
  return out;
}

/** The connector fields of a stored entry. Ends that a broken client wrote are
 * read as free ends at the origin rather than as nothing at all, so the arrow stays
 * selectable and draggable. */
export function connectorSnapshotOf(id: string, entry: Y.Map<unknown>): ConnectorSnapshot {
  const from = readEndpoint(entry.get('from')) ?? { kind: 'free', x: 0, y: 0 };
  const to = readEndpoint(entry.get('to')) ?? { kind: 'free', x: 0, y: 0 };
  const box = connectorBBox(pointOf(from), pointOf(to));
  return {
    id,
    type: 'connector',
    // x, y, width and height are placeholders here: the real box comes from the
    // resolved ends, which needs the other objects too (see `deriveConnectorBox`).
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    z: num(entry.get('z')),
    createdBy: typeof entry.get('createdBy') === 'string' ? (entry.get('createdBy') as string) : undefined,
    createdAt: num(entry.get('createdAt')),
    from,
    to,
  };
}

/**
 * Fill in the box of a connector from the boxes of everything else on the board.
 *
 * Called by the model when it builds snapshots: an arrow's box is wherever its two
 * objects currently are, so it is derived on read instead of stored, and a move of
 * either object moves the box with it.
 */
export function deriveConnectorBox(
  connector: ConnectorSnapshot,
  rects: ReadonlyMap<string, Rect>,
): ConnectorSnapshot {
  const ends = resolveEndpoints(connector, rects);
  return { ...connector, ...connectorBBox(ends.from, ends.to) };
}

/** The two points an arrow is drawn through, given the board it is on. */
export function connectorPoints(
  connector: ConnectorSnapshot,
  rects: ReadonlyMap<string, Rect>,
): Point[] {
  const ends = resolveEndpoints(connector, rects);
  return [ends.from, ends.to];
}

/** How far a board point is from this arrow's line, in board units. */
export function connectorDistance(
  connector: ConnectorSnapshot,
  rects: ReadonlyMap<string, Rect>,
  point: Point,
): number {
  return distanceToPolyline(connectorPoints(connector, rects), point);
}

/**
 * Draw an arrow between two ends.
 *
 * An end given as attached to an object that is not on the board is refused: the tool
 * that drags an arrow onto a shape hit-tests first, and an arrow that names an object
 * nobody has would be a dangling reference every other client has to explain. The
 * other rejections are the ones from the PRD — both ends on the same object, and an
 * arrow too short to be anything but a stray click — and in every case the document
 * is left untouched.
 *
 * The fallback of an attached end is the anchor its object faces right now, so an
 * arrow whose object is deleted later ends exactly where it hung.
 */
export function createConnector(
  doc: Y.Doc,
  from: ConnectorEndpoint,
  to: ConnectorEndpoint,
  by: string,
  now = Date.now(),
): string | null {
  if (!isUsableEndpoint(from) || !isUsableEndpoint(to)) return null;
  // At least one end belongs to something. An arrow loose at both ends is a line, and a
  // line is a different tool: a drag that started and finished over empty board drew no
  // arrow and is refused here as well as in the tool, so it cannot arrive from elsewhere
  // either.
  if (from.kind === 'free' && to.kind === 'free') return null;
  const rects = boardRects(doc);
  if (from.kind === 'attached' && !rects.has(from.objectId)) return null;
  if (to.kind === 'attached' && !rects.has(to.objectId)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }
  const ends = resolveEndpoints({ from, to }, rects);
  if (Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y) < CONNECTOR_MIN_LENGTH_WORLD) {
    return null;
  }
  const id = crypto.randomUUID();
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', 'connector');
    // The box is derived on read; what is stored is only the ends.
    entry.set('x', 0);
    entry.set('y', 0);
    entry.set('width', 0);
    entry.set('height', 0);
    entry.set('z', maxZ(objectsMap(doc)) + 1);
    entry.set('createdAt', now);
    entry.set('createdBy', by);
    entry.set('from', writeEndpoint(withFallback(from, ends.to, rects)));
    entry.set('to', writeEndpoint(withFallback(to, ends.from, rects)));
    objectsMap(doc).set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move one end of an arrow.
 *
 * False when the arrow is gone, when the new end is not a place, or when it would
 * attach the arrow to the object its other end already sits on (PRD connector.self).
 * Dragging an end off everything is how an attached end becomes free, and dragging it
 * onto an object is how a free end becomes attached again — the same call either way.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  next: ConnectorEndpoint,
): boolean {
  if (end !== 'from' && end !== 'to') return false;
  const entry = objectsMap(doc).get(id);
  if (!entry || entry.get('type') !== 'connector') return false;
  const current = readConnector(doc, id);
  if (!current) return false;
  if (next.kind === 'free') {
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return false;
  } else {
    if (next.objectId === '') return false;
    if (!Number.isFinite(next.fallbackX) || !Number.isFinite(next.fallbackY)) return false;
  }
  const opposite = end === 'from' ? current.to : current.from;
  if (next.kind === 'attached' && opposite.kind === 'attached' && next.objectId === opposite.objectId) {
    return false;
  }
  doc.transact(() => {
    const rects = boardRects(doc);
    entry.set(end, writeEndpoint(withFallback(next, pointOf(opposite), rects)));
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Turn the ends that pointed at any of `deletedIds` into free ends, where they hang.
 *
 * This runs inside the transaction that deletes the objects, so the arrow and the
 * object it pointed at disappear in one step that everyone sees the same way. Only
 * the ends that actually pointed at a deleted object are written; an arrow that
 * pointed nowhere keeps its record untouched.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: ReadonlySet<string>): void {
  if (deletedIds.size === 0) return;
  // The boxes are read before the delete, because the anchor an end falls back to is
  // the side it faced while its object was still there.
  const rects = boardRects(doc);
  const objects = objectsMap(doc);
  for (const [, entry] of objects) {
    if (entry.get('type') !== 'connector') continue;
    const from = readEndpoint(entry.get('from'));
    const to = readEndpoint(entry.get('to'));
    if (!from || !to) continue;
    const nextFrom = detachEnd(from, to, deletedIds, rects);
    const nextTo = detachEnd(to, from, deletedIds, rects);
    if (nextFrom) entry.set('from', writeEndpoint(nextFrom));
    if (nextTo) entry.set('to', writeEndpoint(nextTo));
  }
}

/** The free end that replaces an attached one, or null when it stays as it is. */
function detachEnd(
  end: ConnectorEndpoint,
  opposite: ConnectorEndpoint,
  deletedIds: ReadonlySet<string>,
  rects: ReadonlyMap<string, Rect>,
): ConnectorEndpoint | null {
  if (end.kind !== 'attached' || !deletedIds.has(end.objectId)) return null;
  const position = endpointPosition(end, pointOf(opposite), rects);
  return { kind: 'free', x: position.x, y: position.y };
}

/**
 * The box of every object on the board, by id.
 *
 * Built from the same snapshots everything else reads, so an arrow's side is decided
 * by the box its owner sees — including the story 9 rule that a text box's height is
 * whatever that client measured.
 */
export function boardRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of objectSnapshots(doc)) {
    if (object.type === 'connector') continue;
    rects.set(object.id, objectBounds(object));
  }
  return rects;
}

/** An attached end gains the fallback of the side it faces; a free end is unchanged. */
function withFallback(
  end: ConnectorEndpoint,
  facing: Point,
  rects: ReadonlyMap<string, Rect>,
): ConnectorEndpoint {
  if (end.kind === 'free') return end;
  const rect = rects.get(end.objectId);
  if (!rect) return end;
  const anchor = sideAnchor(rect, nearestSide(rect, facing));
  return { ...end, fallbackX: anchor.x, fallbackY: anchor.y };
}

/** True when two stored ends mean the same thing. Used by the tool to decide
 * whether a drag changed anything worth writing. */
export function endpointsEqual(a: ConnectorEndpoint, b: ConnectorEndpoint): boolean {
  return endpointEquals(a, b);
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const entry of objects.values()) {
    const z = entry.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/** Narrow a snapshot read from the board back to an arrow. */
export function isConnectorSnapshot(obj: ObjectSnapshot): obj is ConnectorSnapshot {
  return obj.type === 'connector';
}
