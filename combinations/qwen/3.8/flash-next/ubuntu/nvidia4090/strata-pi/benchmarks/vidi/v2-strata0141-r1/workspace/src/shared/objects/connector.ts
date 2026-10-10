import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  objectBounds,
  registerViewDeriver,
  registerSelectableType,
  registerSnapshotReader,
  type ObjectSnapshot,
} from '../board-model';
import {
  SIDES,
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type Side,
} from '../geometry/connector-geometry';
import type { Point, Rect } from '../geometry';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../config';

/**
 * The connector model (anchors `connector.endpoints`, `connector.follow`,
 * `connector.detach`).
 *
 * Schema (`objects/<id>`):
 *
 * ```
 * { type: 'connector', x: 0, y: 0, width: 0, height: 0, z, createdAt, createdBy,
 *   from: Endpoint, to: Endpoint }
 * ```
 *
 * A connector stores **endpoints** and never a resolved position (Key decision 1):
 * `x`/`y`/`width`/`height` are placeholders that the board model replaces with the
 * bounding box of the resolved endpoints when it builds the render model, and
 * story 7's move and resize refuse a connector because its box is derived, not
 * owned. That is why an arrow cannot drift out of sync with the object it is
 * attached to: there is no stored position to drift.
 *
 * An endpoint is either attached to an object - with the side it lands on and the
 * last anchor it had, for the case where that object is deleted - or free.
 * Nothing here throws for user-driven input: a stale id, an endpoint attached to
 * the object at the other end, a non-finite point or a no-op is refused before a
 * transaction opens, so no `update` event is emitted (TC-10, TC-29).
 */

export type ConnectorEnd = 'from' | 'to';

const ENDS: readonly ConnectorEnd[] = ['from', 'to'];

export interface AttachedEndpoint {
  readonly kind: 'attached';
  readonly objectId: string;
  /**
   * The anchor this end had at the object when it was attached, used only when the
   * object is gone from the snapshot (`connector.detach`, `connector.target_deleted`).
   * The side itself is **not** stored: it is recomputed from live rectangles on every
   * snapshot, which is what lets an arrow turn to face a moving object with no writes.
   */
  readonly fallback: Point;
}

export interface FreeEndpoint {
  readonly kind: 'free';
  readonly x: number;
  readonly y: number;
}

export type Endpoint = AttachedEndpoint | FreeEndpoint;

/**
 * What a caller may hand in: an object to attach to, or a point. The anchor is
 * filled in by the model from the live geometry, so a tool only has to say which
 * object the arrow touched - which side it lands on is the model's answer.
 */
export interface AttachedEndpointInput {
  readonly kind: 'attached';
  readonly objectId: string;
}

export type EndpointInput = AttachedEndpointInput | FreeEndpoint;

export interface ConnectorSnapshot extends ObjectSnapshot {
  readonly type: 'connector';
  readonly from: Endpoint;
  readonly to: Endpoint;
  /** The derived box: the bbox of the resolved endpoints (`connector.follow`). */
  readonly width: number;
  readonly height: number;
  /** The two ends as the board actually draws them, resolved against the objects. */
  readonly points: { readonly from: Point; readonly to: Point };
  readonly createdBy: string;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isPointValue = (value: unknown): value is Point =>
  typeof value === 'object' &&
  value !== null &&
  isFiniteNumber((value as Point).x) &&
  isFiniteNumber((value as Point).y);

const isSideValue = (value: unknown): value is Side =>
  typeof value === 'string' && (SIDES as readonly string[]).includes(value);

/** Is `value` a well-formed endpoint (`connector.endpoints`)? */
export function isEndpoint(value: unknown): value is Endpoint {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'free') {
    return isPointValue(value);
  }
  if (kind === 'attached') {
    const endpoint = value as Partial<AttachedEndpoint>;
    if (typeof endpoint.objectId !== 'string' || endpoint.objectId === '') {
      return false;
    }
    if (endpoint.fallback !== undefined && !isPointValue(endpoint.fallback)) {
      return false;
    }
    // A stored endpoint is not trusted when it carries a side this model does not
    // understand: attached ends store no side, and data that disagrees with that is
    // treated as malformed rather than guessed at.
    if ('side' in endpoint && !isSideValue(endpoint.side)) {
      return false;
    }
    return true;
  }
  return false;
}

const objectsOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>('objects');

const asObjectMap = (value: unknown): Y.Map<unknown> | undefined =>
  value instanceof Y.Map ? value : undefined;

/** The stored entry for `id`, when it is a connector. */
const connectorEntry = (doc: Y.Doc, id: string): Y.Map<unknown> | undefined => {
  if (typeof id !== 'string' || id === '') {
    return undefined;
  }
  const entry = asObjectMap(objectsOf(doc).get(id));
  if (!entry || entry.get('type') !== 'connector') {
    return undefined;
  }
  return entry;
};

/** UUIDs, so two people drawing at the same moment cannot collide (story 3). */
function randomId(): string {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  const bytes = new Uint8Array(16);
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/** Highest `z` in the document (0 when it holds nothing). */
function maxZ(objects: Y.Map<unknown>): number {
  let highest = 0;
  objects.forEach((value) => {
    const z = asObjectMap(value)?.get('z');
    if (isFiniteNumber(z) && z > highest) {
      highest = z;
    }
  });
  return highest;
}

/**
 * The rectangle of every object a connector can be attached to, in one pass.
 *
 * Connectors are left out: an arrow's box is derived from its own endpoints, and
 * feeding it back in would make one arrow depend on another.
 */
function attachableRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  objectsOf(doc).forEach((value, id) => {
    const entry = asObjectMap(value);
    if (!entry || entry.get('type') === 'connector') {
      return;
    }
    const type = entry.get('type');
    if (typeof type !== 'string') {
      return;
    }
    const x = entry.get('x');
    const y = entry.get('y');
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      return;
    }
    const width = entry.get('width');
    const height = entry.get('height');
    rects.set(id, {
      x,
      y,
      width: isFiniteNumber(width) && width > 0 ? width : STICKY_SIZE_WORLD,
      height: isFiniteNumber(height) && height > 0 ? height : STICKY_SIZE_WORLD,
    });
  });
  return rects;
}

/**
 * Read one stored object as a connector snapshot (`connector.model`).
 *
 * The endpoints are read as they are stored. The box is left as the placeholder
 * the model wrote, because `registerBoundsDeriver` below replaces it with the
 * bbox of the resolved endpoints for every render (`connector.follow`).
 */
export function connectorFrom(id: string, value: unknown): ConnectorSnapshot | undefined {
  const entry = asObjectMap(value);
  if (!entry || entry.get('type') !== 'connector') {
    return undefined;
  }
  const from = entry.get('from');
  const to = entry.get('to');
  if (!isEndpoint(from) || !isEndpoint(to)) {
    return undefined; // a half-written arrow is not renderable
  }
  const z = entry.get('z');
  if (!isFiniteNumber(z)) {
    return undefined;
  }
  const createdAt = entry.get('createdAt');
  const createdBy = entry.get('createdBy');
  const stored = {
    id,
    type: 'connector' as const,
    x: isFiniteNumber(entry.get('x')) ? (entry.get('x') as number) : 0,
    y: isFiniteNumber(entry.get('y')) ? (entry.get('y') as number) : 0,
    width: 0,
    height: 0,
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    from,
    to,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
  return Object.freeze({
    ...stored,
    // Read on its own this snapshot can only resolve an attached end to the
    // anchor it last had; `deriveConnectorView` below refines both points against
    // the objects that are really on the board (`connector.follow`).
    points: resolveEndpoints(stored, NO_RECTS),
  });
}

const NO_RECTS: ReadonlyMap<string, Rect> = new Map<string, Rect>();

/**
 * The connector's render model: its box and its two drawn points, derived from
 * its endpoints against the other objects in the same pass (`connector.follow`).
 *
 * Storing the resolved points next to the endpoints is what lets a hit test, an
 * attach dot and a re-attach handle all agree with what is on the screen, without
 * any of them opening the document.
 */
function deriveConnectorView(
  snapshot: ObjectSnapshot,
  rects: ReadonlyMap<string, Rect>,
): ConnectorSnapshot {
  const connector = snapshot as ConnectorSnapshot;
  const points = resolveEndpoints(connector, rects);
  const box = connectorBBox(points.from, points.to);
  return Object.freeze({
    ...connector,
    x: box.x,
    y: box.y,
    // A derived box is never exactly zero: `objectBounds` reads a stored 0 as "no
    // size stored" and substitutes a default, and an arrow can genuinely be zero
    // wide. Nothing measures a connector with `objectBounds`; TC-25 checks it.
    width: Math.max(box.width, MIN_EXTENT_WORLD),
    height: Math.max(box.height, MIN_EXTENT_WORLD),
    points,
  });
}

/** The smallest extent a derived box reports (see the note above). */
const MIN_EXTENT_WORLD = 1e-6;

registerSelectableType('connector');
registerSnapshotReader('connector', connectorFrom);
registerViewDeriver('connector', deriveConnectorView);

/** One stored connector, read as a snapshot - for rendering and for hit tests. */
export function readConnectorSnapshot(doc: Y.Doc, id: string): ConnectorSnapshot | undefined {
  const snapshot = connectorFrom(id, objectsOf(doc).get(id));
  if (!snapshot) {
    return undefined;
  }
  return withDerivedView(doc, snapshot);
}

/** The same snapshot the board renders: endpoints, their box and their points. */
function withDerivedView(doc: Y.Doc, snapshot: ConnectorSnapshot): ConnectorSnapshot {
  return deriveConnectorView(snapshot, attachableRects(doc));
}

/**
 * The box an arrow currently occupies (`connector.follow`), or `undefined` for a
 * stale id. This is the geometry the board's selection box is built from, and it
 * is the *exact* box: unlike the snapshot's, its width and height are not clamped
 * to a minimum (TC-25).
 */
export function connectorRect(doc: Y.Doc, id: string): Rect | undefined {
  const snapshot = connectorFrom(id, objectsOf(doc).get(id));
  if (!snapshot) {
    return undefined;
  }
  const points = resolveEndpoints(snapshot, attachableRects(doc));
  return connectorBBox(points.from, points.to);
}

/** The objects a connector's ends can be attached to, as id -> rectangle. */
export function connectorAnchorRects(doc: Y.Doc): Map<string, Rect> {
  return attachableRects(doc);
}

/**
 * The same rectangles from the render model instead of the document
 * (`connector.endpoints`).
 *
 * A tool decides what is under the pointer from what it is *showing*, and the
 * render model is exactly that - including the box a resized object has now. A
 * connector's own box is left out, as always: an arrow is not something to attach
 * to, and one arrow's box must never be the reason another is drawn.
 */
export function connectorAnchorRectsFrom(objects: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const obj of objects ?? []) {
    if (!obj || obj.type === 'connector') {
      continue;
    }
    rects.set(obj.id, objectBounds(obj));
  }
  return rects;
}

/**
 * Complete two endpoint inputs the way `createConnector` and
 * `setConnectorEndpoint` will (`connector.endpoints`).
 *
 * A tool previews an arrow while the person is still dragging it, and a preview
 * that disagrees with what gets stored is a lie: this is the same completion -
 * same sides, same anchors - run once against the rectangles the tool is drawing
 * on, so the arrow lands where it was shown to land.
 */
export function completeConnectorEndpoints(
  a: EndpointInput,
  b: EndpointInput,
  rects: ReadonlyMap<string, Rect>,
): { from: Endpoint; to: Endpoint } | null {
  return completeEndpoints(a, b, rects);
}

/** One input endpoint, completed with the anchor the model chooses. */
function completeEndpoint(
  input: EndpointInput,
  otherEnd: Point,
  rects: ReadonlyMap<string, Rect>,
): Endpoint | null {
  if (!isEndpoint(input)) {
    return null;
  }
  if (input.kind === 'free') {
    return { kind: 'free', x: input.x, y: input.y };
  }
  const rect = rects.get(input.objectId);
  if (!rect) {
    return null; // nothing to attach to: an arrow to nowhere is not an object
  }
  // The side is chosen here only to record the anchor it landed on; the side the
  // arrow is drawn from is recomputed from live rectangles whenever it is drawn.
  const anchor = sideAnchor(rect, nearestSide(rect, otherEnd));
  return { kind: 'attached', objectId: input.objectId, fallback: anchor };
}

/** A first estimate of where an end sits, for the other end to aim at. */
function preliminaryPoint(
  input: EndpointInput,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (input.kind === 'free') {
    return { x: input.x, y: input.y };
  }
  const rect = rects.get(input.objectId);
  if (!rect) {
    return { x: 0, y: 0 };
  }
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Both endpoints, completed. Each side is chosen facing the other end. */
function completeEndpoints(
  a: EndpointInput,
  b: EndpointInput,
  rects: ReadonlyMap<string, Rect>,
): { from: Endpoint; to: Endpoint } | null {
  const aPoint = preliminaryPoint(a, rects);
  const bPoint = preliminaryPoint(b, rects);
  const from = completeEndpoint(a, bPoint, rects);
  const to = completeEndpoint(b, aPoint, rects);
  if (!from || !to) {
    return null;
  }
  return { from, to };
}

const resolvedOf = (
  endpoints: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } => resolveEndpoints(endpoints, rects);

/**
 * Create a connector (`connector.create`).
 *
 * One transaction: `type:'connector'`, `from`, `to`, `z = maxZ + 1`, createdAt,
 * createdBy, and the placeholder `x`/`y`/`width`/`height` the model owns.
 *
 * Returns the new id, or `null` - with no transaction and nothing written - when
 * an endpoint is malformed, when an endpoint is attached to an object that is not
 * on the board, when both ends attach to the **same** object (TC-10), or when the
 * resolved ends are closer than CONNECTOR_MIN_LENGTH_WORLD (TC-09).
 */
export function createConnector(
  doc: Y.Doc,
  a: EndpointInput,
  b: EndpointInput,
  createdBy: string,
): string | null {
  if (!isEndpoint(a) || !isEndpoint(b)) {
    return null;
  }
  if (typeof createdBy !== 'string') {
    return null;
  }
  if (a.kind === 'attached' && b.kind === 'attached' && a.objectId === b.objectId) {
    return null; // an arrow between one object and itself is not a connector
  }
  const rects = attachableRects(doc);
  const endpoints = completeEndpoints(a, b, rects);
  if (!endpoints) {
    return null;
  }
  const resolved = resolvedOf(endpoints, rects);
  if (Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y) < CONNECTOR_MIN_LENGTH_WORLD) {
    return null;
  }
  const id = randomId();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const object = new Y.Map<unknown>();
    object.set('type', 'connector');
    // Placeholders only: the board model derives the real box from the endpoints.
    object.set('x', 0);
    object.set('y', 0);
    object.set('width', 0);
    object.set('height', 0);
    object.set('from', endpoints.from);
    object.set('to', endpoints.to);
    object.set('z', maxZ(objects) + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', createdBy);
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/** Are two stored endpoints the same, so a write would be pointless? */
function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'free' && b.kind === 'free') {
    return a.x === b.x && a.y === b.y;
  }
  if (a.kind === 'attached' && b.kind === 'attached') {
    return a.objectId === b.objectId;
  }
  return false;
}

/**
 * Move or re-attach one end (`connector.reconnect`).
 *
 * The other end is left exactly as it was. One transaction on success.
 *
 * `false`, with no transaction, when the connector id is stale (TC-29), when the
 * endpoint is malformed, when the end is attached to the object the **other** end
 * is attached to (the arrow would fold onto itself), or when the endpoint is
 * already this endpoint (`sel.transform` drops the same no-op).
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: ConnectorEnd,
  endpoint: EndpointInput,
): boolean {
  const entry = connectorEntry(doc, id);
  if (!entry) {
    return false;
  }
  if (end !== 'from' && end !== 'to') {
    return false;
  }
  if (!isEndpoint(endpoint)) {
    return false;
  }
  const current = connectorFrom(id, entry);
  if (!current) {
    return false;
  }
  const otherEnd: ConnectorEnd = end === 'from' ? 'to' : 'from';
  const other = current[otherEnd];
  if (endpoint.kind === 'attached' && other.kind === 'attached' && endpoint.objectId === other.objectId) {
    return false; // both ends on one object: there is nothing between them to draw
  }
  const rects = attachableRects(doc);
  const otherPoint = resolveEndpoints(current, rects)[otherEnd];
  const completed = completeEndpoint(endpoint, otherPoint, rects);
  if (!completed) {
    return false;
  }
  if (sameEndpoint(current[end], completed)) {
    return false; // no change: no transaction, no update event
  }
  doc.transact(() => {
    entry.set(end, completed);
  }, LOCAL_ORIGIN);
  return true;
}

/** The two ends of a connector, as the points they are drawn to. */
export function connectorEndpoints(
  doc: Y.Doc,
  id: string,
): { from: Point; to: Point } | undefined {
  const snapshot = connectorFrom(id, objectsOf(doc).get(id));
  if (!snapshot) {
    return undefined;
  }
  return resolveEndpoints(snapshot, attachableRects(doc));
}

/** The ends, in the order an arrow is drawn along: `from` then `to`. */
export function connectorPoints(doc: Y.Doc, id: string): readonly Point[] {
  const resolved = connectorEndpoints(doc, id);
  return resolved ? [resolved.from, resolved.to] : [];
}

/** The two ends of a connector, in the order a caller names them. */
export const CONNECTOR_ENDS: readonly ConnectorEnd[] = ENDS;

// `detachConnectorsTo` - the other half of `connector.detach` - lives with
// `deleteObjects` in the board model, so the delete and the detach are one
// transaction. It is re-exported here because this is the module that owns what
// a connector is.
export { detachConnectorsTo } from '../board-model';
