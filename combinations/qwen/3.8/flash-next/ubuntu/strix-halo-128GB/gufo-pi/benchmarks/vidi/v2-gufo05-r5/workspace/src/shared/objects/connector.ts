/**
 * The connector object: schema and every mutation of it (story 10).
 *
 * ```
 * objects/<id>: Y.Map {
 *   type: 'connector', z, createdAt, createdBy,
 *   from: Endpoint, to: Endpoint
 * }
 *
 * Endpoint = { kind: 'attached', objectId, fallback: {x,y} }   // attached to an object
 *            | { kind: 'free', x, y }                          // one end in empty space
 * ```
 *
 * An attached end stores no side and no absolute point. Where the arrow is drawn is resolved from
 * the object's live rectangle every frame (`connector-geometry`), which is what makes it follow
 * the shape wherever it goes; `fallback` is the last place that end was drawn, used when the object
 * it names has gone. The connector's own `x`, `y`, `width` and `height` are derived the same way,
 * so selection, marquee and sharing all agree on one box without any of them storing it.
 *
 * Every accepted change is exactly one `LOCAL_ORIGIN` transaction; every rejection - the same
 * object at both ends, an arrow shorter than `CONNECTOR_MIN_LENGTH_WORLD`, a stale id, a
 * non-finite point, re-attaching an end to the object at its other end - is decided before a
 * transaction is opened, so a refusal produces no update for anybody to receive.
 */
import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../config';
import type { Point, Rect } from '../geometry';
import {
  connectorBBox,
  resolveEndpoints,
  type ConnectorEnds,
} from '../geometry/connector-geometry';
import { LOCAL_ORIGIN } from '../y-origin';

const OBJECTS_KEY = 'objects';

/** One end of an arrow: attached to an object, or free in empty space. */
export type Endpoint =
  | { readonly kind: 'attached'; readonly objectId: string; readonly fallback: Point }
  | { readonly kind: 'free'; readonly x: number; readonly y: number };

/**
 * One connector, as rendered by React.
 *
 * Spelled out rather than `extends ObjectSnapshot`, because `ObjectSnapshot` is the union of every
 * object type and an interface cannot extend a union.
 */
export interface ConnectorSnapshot {
  readonly id: string;
  readonly type: 'connector';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  readonly createdAt: number;
  readonly createdBy: string;
  readonly from: Endpoint;
  readonly to: Endpoint;
  /** The two endpoints resolved against the rectangles this snapshot was taken with. */
  readonly ends: { readonly from: Point; readonly to: Point };
}

/** The short name the design uses for the same snapshot. */
export type ConnectorSnap = ConnectorSnapshot;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/** The highest z on the board, or 0 when it holds nothing. */
function topZ(objects: Y.Map<Y.Map<unknown>>): number {
  let top = 0;
  for (const raw of objects.values()) {
    const z = raw.get('z');
    if (finite(z) && z > top) top = z;
  }
  return top;
}

/**
 * The rectangle of every object an arrow can attach to, as the document holds them now.
 *
 * A connector is not in its own map: an arrow resolves against shapes and notes, not against other
 * arrows. The size defaults are the ones `objectBounds` uses, so the two agree.
 */
export function attachedRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [id, raw] of objectsOf(doc)) {
    if (!(raw instanceof Y.Map)) continue;
    if (raw.get('type') === 'connector') continue;
    const x = raw.get('x');
    const y = raw.get('y');
    if (!finite(x) || !finite(y)) continue;
    const width = raw.get('width');
    const height = raw.get('height');
    rects.set(id, {
      x,
      y,
      width: finite(width) ? width : STICKY_SIZE_WORLD,
      height: finite(height) ? height : STICKY_SIZE_WORLD,
    });
  }
  return rects;
}

/** The `Y.Map` of a connector, or undefined for a stale id or another object type. */
export function getConnectorRecord(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const raw = objectsOf(doc).get(id);
  if (!(raw instanceof Y.Map)) return undefined;
  return raw.get('type') === 'connector' ? raw : undefined;
}

/**
 * An endpoint read out of the document, or `undefined` when it is not one.
 *
 * A copy is returned rather than the stored value: the snapshot hands these objects to React, and a
 * frozen object inside the document would stop the next change being written.
 */
export function readEndpoint(value: unknown): Endpoint | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'free') {
    if (!finite(raw.x) || !finite(raw.y)) return undefined;
    return { kind: 'free', x: raw.x, y: raw.y };
  }
  if (raw.kind === 'attached') {
    if (typeof raw.objectId !== 'string' || raw.objectId === '') return undefined;
    const fallback = raw.fallback as Record<string, unknown> | undefined;
    const fx = fallback?.x;
    const fy = fallback?.y;
    if (!finite(fx) || !finite(fy)) return undefined;
    return { kind: 'attached', objectId: raw.objectId, fallback: { x: fx, y: fy } };
  }
  return undefined;
}

/** True when two endpoints say the same thing. */
function sameEndpoint(a: Endpoint | undefined, b: Endpoint): boolean {
  if (!a) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'free' && b.kind === 'free') return a.x === b.x && a.y === b.y;
  return a.kind === 'attached' && b.kind === 'attached' && a.objectId === b.objectId;
}

/**
 * Reads one `Y.Map` into a `ConnectorSnapshot`, or `undefined` when it cannot be drawn.
 * `rects` holds the live rectangle of every other object; the endpoints, and so the box, resolve
 * against it.
 */
export function readConnectorObject(
  id: string,
  raw: Y.Map<unknown>,
  rects: ReadonlyMap<string, Rect>,
): ConnectorSnapshot | undefined {
  const from = readEndpoint(raw.get('from'));
  const to = readEndpoint(raw.get('to'));
  if (!from || !to) return undefined;
  const z = raw.get('z');
  const createdAt = raw.get('createdAt');
  const createdBy = raw.get('createdBy');
  const ends = resolveEndpoints({ from, to } satisfies ConnectorEnds, rects);
  const box = connectorBBox(ends.from, ends.to);
  return Object.freeze({
    id,
    type: 'connector' as const,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    z: finite(z) ? z : 0,
    createdAt: finite(createdAt) ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    from: Object.freeze(from),
    to: Object.freeze(to),
    ends: Object.freeze({ from: ends.from, to: ends.to }),
  });
}

/** The endpoint to store: an attached end keeps as its fallback the place it is drawn now. */
function storedEndpoint(end: Endpoint, drawn: Point, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (end.kind === 'free') return end;
  // An object that is not on the board keeps the caller's point: it is the only place this end has.
  if (!rects.has(end.objectId)) return end;
  return { kind: 'attached', objectId: end.objectId, fallback: drawn };
}

/**
 * Creates an arrow between two endpoints and returns its id, or `null` when it is refused.
 *
 * Both endpoints are validated first. Both ends on the same object would be an arrow of no length
 * pointing nowhere, and a line shorter than `CONNECTOR_MIN_LENGTH_WORLD` - which is what a stray
 * click comes to - is not something anybody meant to draw. An end released over nothing stays
 * exactly where it was released.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  const start = readEndpoint(from);
  const finish = readEndpoint(to);
  if (!start || !finish) return null;
  if (start.kind === 'attached' && finish.kind === 'attached' && start.objectId === finish.objectId) {
    return null;
  }

  const rects = attachedRects(doc);
  const ends = resolveEndpoints({ from: start, to: finish } satisfies ConnectorEnds, rects);
  const length = Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y);
  if (!(length >= CONNECTOR_MIN_LENGTH_WORLD)) return null;

  const storedFrom = storedEndpoint(start, ends.from, rects);
  const storedTo = storedEndpoint(finish, ends.to, rects);
  const id = crypto.randomUUID();
  const who = typeof by === 'string' ? by : '';
  doc.transact(() => {
    const objects = objectsOf(doc);
    const connector = new Y.Map<unknown>();
    connector.set('type', 'connector');
    connector.set('from', storedFrom);
    connector.set('to', storedTo);
    connector.set('z', topZ(objects) + 1);
    connector.set('createdAt', Date.now());
    connector.set('createdBy', who);
    objects.set(id, connector);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Moves one end of an arrow: onto another object, or off into empty space.
 * False for a stale id, an object that is not an arrow, an endpoint that is not valid, the object
 * the other end is already on, and an end that is already where it is being put.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  next: Endpoint,
): boolean {
  if (end !== 'from' && end !== 'to') return false;
  const connector = getConnectorRecord(doc, id);
  if (!connector) return false;
  const current = readEndpoint(connector.get(end));
  const other = readEndpoint(connector.get(end === 'from' ? 'to' : 'from'));
  if (!current || !other) return false; // an arrow this build cannot read is left as it is
  const wanted = readEndpoint(next);
  if (!wanted) return false;
  if (wanted.kind === 'attached' && other.kind === 'attached' && wanted.objectId === other.objectId) {
    return false;
  }
  // An end that is already where it is being put writes nothing: no update, no undo step. For an
  // attached end that means the same object, whatever its stored fallback says - the fallback is
  // derived, and readers recompute where the arrow is drawn anyway.
  if (sameEndpoint(current, wanted)) return false;

  const rects = attachedRects(doc);
  const pair: ConnectorEnds =
    end === 'from' ? { from: wanted, to: other } : { from: other, to: wanted };
  const ends = resolveEndpoints(pair, rects);
  const drawn = end === 'from' ? ends.from : ends.to;
  const stored = storedEndpoint(wanted, drawn, rects);

  doc.transact(() => {
    connector.set(end, stored);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Frees every arrow end attached to one of `deletedIds`, leaving it where it was drawn.
 *
 * This runs inside the caller's transaction, so deleting an object and detaching its arrows is one
 * update to sync and one undo step. It has to be called while the objects are still there, because
 * the point an end is left at is the anchor it was being drawn at - which is the last place
 * anybody saw the arrow's end, and the one that keeps the picture unchanged.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const gone = new Set(deletedIds);
  if (gone.size === 0) return;

  const rects = attachedRects(doc);
  const frees: { connector: Y.Map<unknown>; end: 'from' | 'to'; point: Point }[] = [];
  for (const raw of objectsOf(doc).values()) {
    if (!(raw instanceof Y.Map)) continue;
    if (raw.get('type') !== 'connector') continue;
    const from = readEndpoint(raw.get('from'));
    const to = readEndpoint(raw.get('to'));
    if (!from || !to) continue;
    const ends = resolveEndpoints({ from, to } satisfies ConnectorEnds, rects);
    if (from.kind === 'attached' && gone.has(from.objectId)) {
      frees.push({ connector: raw, end: 'from', point: ends.from });
    }
    if (to.kind === 'attached' && gone.has(to.objectId)) {
      frees.push({ connector: raw, end: 'to', point: ends.to });
    }
  }
  if (frees.length === 0) return; // nothing attached to what went: not one byte is written

  for (const free of frees) {
    free.connector.set(free.end, { kind: 'free', x: free.point.x, y: free.point.y });
  }
}
