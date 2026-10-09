import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../config';
import {
  LOCAL_ORIGIN,
  newObjectId,
  topZ,
  type ObjectSnapshotBase,
} from '../board-model';
import type { Point, Rect } from '../geometry';
import type { Side } from '../geometry/connector-geometry';
import {
  connectorBBox,
  connectorLength,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../geometry/connector-geometry';

/**
 * The `connector` object type (story 10): a straight arrow between two board objects.
 *
 * Schema — the same entry of `objects` every other type has, plus:
 *
 *     from: Endpoint, to: Endpoint, createdBy, createdAt
 *
 * An `Endpoint` is either `attached` (the id of the object it is glued to, plus the point
 * to draw it at when that object is not there any more) or `free` (a plain board point).
 *
 * A connector stores no line: it stores which objects its ends are on, and the line is
 * computed from where those objects are on this snapshot (design key decision: an arrow
 * follows a move without anybody writing a new update). `x`, `y`, `width` and `height` are
 * stored as 0 and read back as the box around the two ends, so story 7's selection,
 * marquee and delete code works on an arrow without knowing arrows exist.
 *
 * A stale id never throws: the setters return false and `createConnector` returns null,
 * and neither opens a transaction.
 */

/** The object type this module owns. */
export const CONNECTOR_TYPE = 'connector';

/** Which end of the arrow an interaction is talking about. */
export type ConnectorEnd = 'from' | 'to';

/** Glued to an object, or standing on its own in the middle of the board. */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** The two stored ends of an arrow, which is all `resolveEndpoints` needs. */
export interface ConnectorEnds {
  from: Endpoint;
  to: Endpoint;
}

/**
 * An end as a caller describes it: an attached end does not have to know its fallback,
 * because this module works it out from where the object is right now (and if the object
 * is gone, the caller's fallback is what the arrow will be drawn at).
 */
export type EndpointInput =
  | { kind: 'attached'; objectId: string; fallback?: Point }
  | { kind: 'free'; x: number; y: number };

/** A connector read out of the document, with the ends as this document puts them. */
export interface ConnectorSnapshot extends ObjectSnapshotBase, ConnectorEnds {
  type: 'connector';
  /** Where the two ends are, in board units, as this document's objects currently have them. */
  ends: { from: Point; to: Point };
  /** True for an end attached to an object this document no longer holds (TC-11, TC-27). */
  orphaned: { from: boolean; to: boolean };
  /** The side each end sits on (`null` for a free end, or one whose object has gone). */
  sides: { from: Side | null; to: Side | null };
  createdBy: string;
  createdAt: number;
  known: true;
}

export function isConnectorSnapshot(
  object: { type: string } | undefined,
): object is ConnectorSnapshot {
  return object?.type === CONNECTOR_TYPE;
}

type YObject = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>('objects');
}

function objectOf(doc: Y.Doc, id: string): YObject | undefined {
  if (!id) return undefined;
  const item = objectsOf(doc).get(id);
  return item instanceof Y.Map ? item : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePoint(point: { x: number; y: number } | undefined): point is {
  x: number;
  y: number;
} {
  return !!point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function numberOf(item: YObject, key: string, fallback: number): number {
  return isFiniteNumber(item.get(key)) ? (item.get(key) as number) : fallback;
}

/**
 * The box of any object in this document, with the same size fallbacks `board-model`
 * uses. An arrow is not a box of its own (its box is its ends), so it is left out — an
 * arrow joining two arrows would otherwise move the anchors it is meant to read.
 */
function rectOfItem(item: YObject): Rect | undefined {
  const x = item.get('x');
  const y = item.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;
  const width = item.get('width');
  const height = item.get('height');
  return {
    x,
    y,
    width: isFiniteNumber(width) ? width : STICKY_SIZE_WORLD,
    height: isFiniteNumber(height) ? height : STICKY_SIZE_WORLD,
  };
}

/** Every object's box except the arrows', which is what `resolveEndpoints` needs. */
function rectsOfObjects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  objectsOf(doc).forEach((item, id) => {
    if (!(item instanceof Y.Map)) return;
    if (item.get('type') === CONNECTOR_TYPE) return;
    const rect = rectOfItem(item);
    if (rect) rects.set(id, rect);
  });
  return rects;
}

/**
 * An end as the document holds it. Anything else — a string where a point should be, an
 * empty object id, an end that is neither attached nor free — means the object is not a
 * connector this build can draw, and the caller skips it.
 */
function readEndpoint(value: unknown): Endpoint | undefined {
  if (!(value instanceof Object)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.kind === 'free') {
    const x = record.x;
    const y = record.y;
    return isFiniteNumber(x) && isFiniteNumber(y) ? { kind: 'free', x, y } : undefined;
  }
  if (record.kind === 'attached') {
    const objectId = record.objectId;
    const fallback = (record as Record<string, unknown>).fallback as Record<string, unknown>;
    if (typeof objectId !== 'string' || objectId.length === 0) return undefined;
    if (!fallback || !isFiniteNumber(fallback.x) || !isFiniteNumber(fallback.y)) return undefined;
    return {
      kind: 'attached',
      objectId,
      fallback: { x: fallback.x as number, y: fallback.y as number },
    };
  }
  return undefined;
}

function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'free' && b.kind === 'free') return a.x === b.x && a.y === b.y;
  if (a.kind === 'attached' && b.kind === 'attached') return a.objectId === b.objectId;
  return false;
}

function otherEnd(end: ConnectorEnd): ConnectorEnd {
  return end === 'from' ? 'to' : 'from';
}

/**
 * A connector read out of the document — its own reading, with the rectangles of the rest
 * of the document read fresh for the call. Undefined for a stale id or another type.
 */
export function readConnector(doc: Y.Doc, id: string): ConnectorSnapshot | undefined {
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== CONNECTOR_TYPE) return undefined;
  return connectorSnapshotOf(id, item, rectsOfObjects(doc));
}

/**
 * The shared reading `board-model` uses when it walks the whole objects map: the same
 * reading, but with the rectangles it already gathered, so a board full of arrows costs
 * one pass over the objects rather than one pass per arrow.
 */
export function readConnectorObject(
  id: string,
  item: YObject,
  rects: ReadonlyMap<string, Rect>,
): ConnectorSnapshot | undefined {
  if (item.get('type') !== CONNECTOR_TYPE) return undefined;
  return connectorSnapshotOf(id, item, rects);
}

function connectorSnapshotOf(
  id: string,
  item: YObject,
  rects: ReadonlyMap<string, Rect>,
): ConnectorSnapshot | undefined {
  const from = readEndpoint(item.get('from'));
  const to = readEndpoint(item.get('to'));
  if (!from || !to) return undefined;
  const ends = resolveEndpoints({ from, to }, rects);
  const box = connectorBBox(ends.from, ends.to);
  const createdBy = item.get('createdBy');
  const orphan = (endpoint: Endpoint): boolean =>
    endpoint.kind === 'attached' && !rects.has(endpoint.objectId);
  const sideOf = (endpoint: Endpoint, toward: Point) => {
    if (endpoint.kind === 'free') return null;
    const rect = rects.get(endpoint.objectId);
    return rect ? nearestSide(rect, toward) : null;
  };
  return {
    id,
    type: CONNECTOR_TYPE,
    // A connector has no box of its own: it is where its ends are (design: x/y/width/height
    // are stored as 0 and derived here), which is what lets story 7 draw and select it.
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    z: numberOf(item, 'z', 0),
    known: true,
    from,
    to,
    ends,
    orphaned: { from: orphan(from), to: orphan(to) },
    sides: { from: sideOf(from, ends.to), to: sideOf(to, ends.from) },
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    createdAt: numberOf(item, 'createdAt', 0),
  };
}

/**
 * The end as it will be stored: an attached end gets its fallback from where its object
 * is right now, so an arrow drawn to a moving object still knows where to draw itself if
 * that object disappears later (TC-27). Undefined for an end that cannot be placed.
 */
function storedEndpoint(
  input: EndpointInput,
  other: Point,
  rects: ReadonlyMap<string, Rect>,
): Endpoint | undefined {
  if (!input || typeof input !== 'object') return undefined;
  if (input.kind === 'free') {
    return isFinitePoint(input) ? { kind: 'free', x: input.x, y: input.y } : undefined;
  }
  if (input.kind !== 'attached' || typeof input.objectId !== 'string' || input.objectId.length === 0) {
    return undefined;
  }
  const rect = rects.get(input.objectId);
  if (rect) return { kind: 'attached', objectId: input.objectId, fallback: sideAnchor(rect, nearestSide(rect, other)) };
  // The object is already gone: the caller saw it there a moment ago and says where.
  return isFinitePoint(input.fallback)
    ? { kind: 'attached', objectId: input.objectId, fallback: { ...input.fallback } }
    : undefined;
}

/**
 * Creates an arrow between two ends. Returns its id, or null when the ends are not
 * placeable, both ends attach to the same object, or the arrow is shorter than
 * `CONNECTOR_MIN_LENGTH_WORLD` — and in every one of those cases the document is not
 * touched (`connector.no_accidental`).
 *
 * An attached end is stored with the point on its object where it lands (the middle of
 * the side facing the other end), which is also the point it will be drawn at if that
 * object is deleted, by whom or by what (TC-13, TC-27).
 */
export function createConnector(
  doc: Y.Doc,
  from: EndpointInput,
  to: EndpointInput,
  createdBy: string,
): string | null {
  const rects = rectsOfObjects(doc);
  // A first pass to find out where each end points, so each end's side can be chosen
  // against the other end's object rather than against nothing.
  const provisionalFrom = provisionalPoint(from, rects);
  const provisionalTo = provisionalPoint(to, rects);
  if (!provisionalFrom || !provisionalTo) return null;
  const storedFrom = storedEndpoint(from, provisionalTo, rects);
  const storedTo = storedEndpoint(to, provisionalFrom, rects);
  if (!storedFrom || !storedTo) return null;
  if (storedFrom.kind === 'attached' && storedTo.kind === 'attached' && storedFrom.objectId === storedTo.objectId) {
    return null;
  }
  const ends = resolveEndpoints({ from: storedFrom, to: storedTo }, rects);
  if (!isFinitePoint(ends.from) || !isFinitePoint(ends.to)) return null;
  if (connectorLength(ends.from, ends.to) < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const id = newObjectId();
  doc.transact(() => {
    const item = new Y.Map<unknown>();
    item.set('type', CONNECTOR_TYPE);
    // The box is derived from the ends on every read; it is stored as 0 so that a stale
    // client does not mistake a leftover box for one.
    item.set('x', 0);
    item.set('y', 0);
    item.set('width', 0);
    item.set('height', 0);
    item.set('from', storedFrom);
    item.set('to', storedTo);
    item.set('z', topZ(doc) + 1);
    item.set('createdAt', Date.now());
    item.set('createdBy', typeof createdBy === 'string' ? createdBy : '');
    objectsOf(doc).set(id, item);
  }, LOCAL_ORIGIN);
  return id;
}

/** Where an end is, before its side is known: its point, or the middle of its object. */
function provisionalPoint(input: EndpointInput, rects: ReadonlyMap<string, Rect>): Point | undefined {
  if (!input || typeof input !== 'object') return undefined;
  if (input.kind === 'free') return isFinitePoint(input) ? { x: input.x, y: input.y } : undefined;
  if (input.kind !== 'attached') return undefined;
  const rect = rects.get(input.objectId);
  if (rect) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  return isFinitePoint(input.fallback) ? { ...input.fallback } : undefined;
}

/**
 * Moves one end of an arrow (design: connector.reattach). False, and nothing written, for
 * a stale id, an arrow that is not an arrow, an end that is not `from` or `to`, an end
 * that cannot be placed, an end already exactly where it is asked to be, or — the rule
 * that keeps an arrow from folding onto one object — an end asked to attach to the object
 * at the other end of the same arrow.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: ConnectorEnd,
  endpoint: EndpointInput,
): boolean {
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== CONNECTOR_TYPE) return false;
  if (end !== 'from' && end !== 'to') return false;
  const current = readEndpoint(item.get(end));
  const other = readEndpoint(item.get(otherEnd(end)));
  if (!current || !other) return false;
  const rects = rectsOfObjects(doc);
  const otherPoint = provisionalPoint(other, rects);
  if (!otherPoint) return false;
  const next = storedEndpoint(endpoint, otherPoint, rects);
  if (!next) return false;
  if (next.kind === 'attached' && other.kind === 'attached' && next.objectId === other.objectId) {
    return false;
  }
  if (sameEndpoint(current, next)) return false;
  doc.transact(() => {
    item.set(end, next);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Loose every arrow end attached to one of `deletedIds`, leaving it free at the point it
 * was attached at, so deleting a shape leaves the arrows that joined it where they were
 * (`connector.target_deleted`, TC-13).
 *
 * Called inside the caller's transaction — story 7's `deleteObjects` calls it there — so
 * the arrows coming loose and the objects going away are one update and one undo step.
 * It writes nothing for an arrow that does not touch those ids.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) return;
  const gone = new Set(deletedIds);
  const rects = rectsOfObjects(doc);
  objectsOf(doc).forEach((item) => {
    if (!(item instanceof Y.Map)) return;
    if (item.get('type') !== CONNECTOR_TYPE) return;
    const from = readEndpoint(item.get('from'));
    const to = readEndpoint(item.get('to'));
    if (!from || !to) return;
    const looseFrom = from.kind === 'attached' && gone.has(from.objectId);
    const looseTo = to.kind === 'attached' && gone.has(to.objectId);
    if (!looseFrom && !looseTo) return;
    // The anchors while everything is still there: this runs before the objects are
    // removed, which is what makes "free at the point it was attached at" computable.
    const ends = resolveEndpoints({ from, to }, rects);
    if (looseFrom && isFinitePoint(ends.from)) item.set('from', { kind: 'free', x: ends.from.x, y: ends.from.y });
    if (looseTo && isFinitePoint(ends.to)) item.set('to', { kind: 'free', x: ends.to.x, y: ends.to.y });
  });
}
