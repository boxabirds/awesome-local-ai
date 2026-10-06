import * as Y from "yjs";
import { CONNECTOR_MIN_LENGTH_WORLD } from "../config";
import {
  LOCAL_ORIGIN,
  objectBounds,
  snapshot,
  type Endpoint,
  type ObjectSnapshot,
} from "../board-model";
import { connectorBBox, nearestSide, resolveEndpoints, sideAnchor } from "../geometry/connector-geometry";
import type { Point, Rect } from "../geometry";

/**
 * Connector objects (`connector.model`) — story 10.
 *
 * A connector is a board object in the same `objects` map as everything else, so
 * selecting it, deleting it and undoing it are the shared story 7 / story 8 code.
 * What it stores is its two **ends**, each either attached to an object (by id,
 * plus the point it was attached to) or fixed to a board point. It does **not**
 * store the line: where the line starts and ends is resolved from the objects'
 * current rectangles at read time (`connector.geometry`), which is why an arrow
 * follows a move by anybody — a move writes only the moved object, and the arrow
 * is re-derived on every render.
 *
 * `x/y/width/height` are stored as 0 and `snapshot` fills them with the line's
 * bounding box, so the marquee, the selection and the handles all work on the
 * shared geometry code.
 */

const CONNECTOR_TYPE = "connector";

export interface ConnectorSnap extends ObjectSnapshot {
  readonly type: "connector";
  readonly from: Endpoint;
  readonly to: Endpoint;
}

export type { Endpoint };

/**
 * What a caller hands in. The stored endpoint (`Endpoint`) always carries the
 * point it is attached to; here it may be left out and the model works it out
 * from the objects as they are now, which is what lets a client say simply
 * "from this shape to that shape".
 */
export type EndpointInput =
  | { readonly kind: "attached"; readonly objectId: string; readonly fallback?: Point }
  | { readonly kind: "free"; readonly x: number; readonly y: number };

/**
 * `createConnector(doc, from, to, by) -> id | null`
 *
 * Refuses, without opening a transaction:
 * - an end naming an object that is not there (`connector.stale_end`);
 * - the same object at both ends (`connector.no_self`);
 * - an end on another connector (`connector.no_chain`) — both ends attach to
 *   objects that have a rectangle;
 * - a second connector between the same pair (`connector.one_per_pair`, in either
 *   direction);
 * - a line shorter than `CONNECTOR_MIN_LENGTH_WORLD`, which is what a stray
 *   click-drag produces (`connector.no_accidental`).
 */
export function createConnector(doc: Y.Doc, from: EndpointInput, to: EndpointInput, by?: string): string | null {
  if (!isEndpointInput(from) || !isEndpointInput(to)) return null;

  const fromId = from.kind === "attached" ? from.objectId : null;
  const toId = to.kind === "attached" ? to.objectId : null;
  if (fromId !== null && toId !== null && fromId === toId) return null;

  const objects = snapshot(doc);
  if (fromId !== null && !isAttachable(objects.find((object) => object.id === fromId))) return null;
  if (toId !== null && !isAttachable(objects.find((object) => object.id === toId))) return null;

  if (fromId !== null && toId !== null) {
    for (const object of objects) {
      if (!isConnectorSnap(object)) continue;
      if (directlyBetween(object, fromId, toId)) return null;
    }
  }

  const rects = rectsOf(objects);
  const ends = storedPair(from, to, rects);
  if (ends === null) return null;
  const resolved = resolveEndpoints(ends, rects);
  if (Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y) < CONNECTOR_MIN_LENGTH_WORLD) {
    return null;
  }

  const map = doc.getMap<Y.Map<unknown>>("objects");
  const id = newId();
  const z = maxZ(map) + 1;
  const createdAt = Date.now();

  doc.transact(() => {
    const connector = new Y.Map<unknown>();
    connector.set("type", CONNECTOR_TYPE);
    // The stored box is 0: `snapshot` derives the line's bounding box from the
    // ends, so no screen ever has to keep a copy of the ends in sync.
    connector.set("x", 0);
    connector.set("y", 0);
    connector.set("width", 0);
    connector.set("height", 0);
    connector.set("from", endpointMap(ends.from));
    connector.set("to", endpointMap(ends.to));
    connector.set("z", z);
    connector.set("createdAt", createdAt);
    if (typeof by === "string" && by.length > 0) connector.set("createdBy", by);
    map.set(id, connector);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * `setConnectorEndpoint(doc, id, end, e) -> applied`
 *
 * Replaces one end and nothing else: the other end's stored value is not read
 * and not written (`connector.reattach`), and the size, stacking, labels and
 * colours of either attached object are untouched because a connector stores no
 * line to re-fit.
 *
 * An attached end stores the object id and the point it is attached to *now*
 * (`endpoint.attached`); from then on the side is re-derived, so moving that
 * object needs no connector write at all.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: "from" | "to", e: EndpointInput): boolean {
  const connector = connectorEntry(doc, id);
  if (!connector) return false;
  if (end !== "from" && end !== "to") return false;
  if (!isEndpointInput(e)) return false;
  if (e.kind === "attached" && !isAttachable(snapshot(doc).find((object) => object.id === e.objectId))) return false;

  // `connector.no_self`: this end may not be moved onto the object the other end
  // is attached to — an arrow from an object to itself has no direction.
  const other = readStoredEndpoint(connector.get(end === "from" ? "to" : "from"));
  if (
    e.kind === "attached" &&
    other !== undefined &&
    other.kind === "attached" &&
    other.objectId === e.objectId
  ) {
    return false;
  }

  // The point this end hangs on, worked out from the end that stays where it is.
  const rects = rectsOf(snapshot(doc));
  const toward = pointOfStored(other, rects);
  if (toward === null) return false;
  const stored = storedEndpoint(e, toward, rects);
  if (stored === null) return false;
  if (sameEndpoint(connector.get(end), stored)) return false;

  doc.transact(() => {
    connector.set(end, endpointMap(stored));
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Turns every end attached to one of `deletedIds` into a free point at the place
 * it was attached to, so a connector is never orphaned (`connector.target_deleted`).
 *
 * Called from `deleteObjects` inside the same transaction: the delete and the
 * detach reach every screen as one change, and this client's undo history holds
 * one step that undoes both.
 *
 * The side is `nearestSide(object's rect, the other end's resolved point)` — the
 * arrow is detached from the side it was drawn from.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (!Array.isArray(deletedIds) || deletedIds.length === 0) return;
  const gone = new Set(deletedIds.filter((id) => typeof id === "string" && id.length > 0));
  if (gone.size === 0) return;

  const map = doc.getMap<Y.Map<unknown>>("objects");
  const objects = snapshot(doc);
  const rects = rectsOf(objects);
  const connectors = objects.filter(isConnectorSnap).filter(
    (connector) => attachedId(connector.from, gone) !== null || attachedId(connector.to, gone) !== null,
  );
  if (connectors.length === 0) return;

  doc.transact(() => {
    for (const connector of connectors) {
      const entry = map.get(connector.id);
      if (!(entry instanceof Y.Map)) continue;

      // Where the arrow is drawn right now: the end being **kept** decides which
      // side of the dying object the arrow is detached from.
      const line = resolveEndpoints(connector, rects);

      const detach = (end: "from" | "to"): void => {
        const objectId = attachedId(connector[end], gone);
        if (objectId === null) return;
        const rect = rects.get(objectId);
        if (rect === undefined) return;
        const otherPoint = end === "from" ? line.to : line.from;
        const anchor = sideAnchor(rect, nearestSide(rect, otherPoint));
        entry.set(end, endpointMap({ kind: "free", x: anchor.x, y: anchor.y }));
      };

      detach("from");
      detach("to");
    }
  }, LOCAL_ORIGIN);
}

/** The board's connectors, z-ordered. */
export function connectorSnapshot(doc: Y.Doc): readonly ConnectorSnap[] {
  return snapshot(doc).filter(isConnectorSnap);
}

/** A connector's line, resolved against the board as it is now. */
export function connectorLine(connector: ConnectorSnap, objects: readonly ObjectSnapshot[]): { from: Point; to: Point } {
  return resolveEndpoints(connector, rectsOf(objects));
}

/** The arrow's bounding box, resolved against the board as it is now. */
export function connectorBounds(connector: ConnectorSnap, objects: readonly ObjectSnapshot[]): Rect {
  const line = connectorLine(connector, objects);
  return connectorBBox(line.from, line.to);
}

// ---- internals ------------------------------------------------------------

/** Only objects with a rectangle can hold an end: never another arrow. */
function isAttachable(object: ObjectSnapshot | undefined): object is ObjectSnapshot {
  if (!object) return false;
  if (typeof object.id !== "string" || object.id.length === 0) return false;
  return object.type !== CONNECTOR_TYPE;
}

export function isConnectorSnap(object: ObjectSnapshot): object is ConnectorSnap {
  return object.type === CONNECTOR_TYPE && object.from !== undefined && object.to !== undefined;
}

/** A connector whose two ends are attached to exactly this pair, either way. */
function directlyBetween(connector: ConnectorSnap, fromId: string, toId: string): boolean {
  const ends = [connector.from, connector.to];
  const attached = ends.map((end) => (end.kind === "attached" ? end.objectId : ""));
  return (
    (attached[0] === fromId && attached[1] === toId) ||
    (attached[0] === toId && attached[1] === fromId)
  );
}

/**
 * Both ends of a new connector: each attached end stores **the point on the side
 * that faces the other end** (`connector.geometry`) as its fallback. That is the
 * point the arrow is drawn from today, and the point it will be drawn from if the
 * object it hangs on is deleted.
 *
 * Returns null when an attached end names a object with no rectangle, which only
 * happens if the board changed between the check and here.
 */
function storedPair(from: EndpointInput, to: EndpointInput, rects: Map<string, Rect>): { from: Endpoint; to: Endpoint } | null {
  const toward = (end: EndpointInput): Point | null =>
    end.kind === "free" ? { x: end.x, y: end.y } : rectCenterOrNull(rects.get(end.objectId));
  const towardFrom = toward(from);
  const towardTo = toward(to);
  if (towardFrom === null || towardTo === null) return null;
  const storedFrom = storedEndpoint(from, towardTo, rects);
  const storedTo = storedEndpoint(to, towardFrom, rects);
  if (storedFrom === null || storedTo === null) return null;
  return { from: storedFrom, to: storedTo };
}

/**
 * The stored form of an input endpoint: an attached end gets its anchor when the
 * caller did not give one — the midpoint of the side facing the other end.
 */
function storedEndpoint(end: EndpointInput, toward: Point, rects: Map<string, Rect>): Endpoint | null {
  if (end.kind === "free") return { kind: "free", x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  if (rect === undefined) return null;
  const given = end.fallback;
  if (given !== undefined && isFiniteNumber(given.x) && isFiniteNumber(given.y)) {
    return { kind: "attached", objectId: end.objectId, fallback: { x: given.x, y: given.y } };
  }
  return { kind: "attached", objectId: end.objectId, fallback: sideAnchor(rect, nearestSide(rect, toward)) };
}

/** Where a stored endpoint is drawn, for the side lookup of the end opposite it. */
function pointOfStored(end: Endpoint | null | undefined, rects: Map<string, Rect>): Point | null {
  if (end === null || end === undefined) return null;
  if (end.kind === "free") return { x: end.x, y: end.y };
  return rectCenterOrNull(rects.get(end.objectId)) ?? end.fallback;
}

function rectCenterOrNull(rect: Rect | undefined): Point | null {
  if (rect === undefined) return null;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function isEndpointInput(end: EndpointInput | null | undefined): end is EndpointInput {
  if (!end || (end.kind !== "attached" && end.kind !== "free")) return false;
  if (end.kind === "free") return isFiniteNumber(end.x) && isFiniteNumber(end.y);
  if (typeof end.objectId !== "string" || end.objectId.length === 0) return false;
  return end.fallback === undefined || (isFiniteNumber(end.fallback.x) && isFiniteNumber(end.fallback.y));
}

function endpointMap(end: Endpoint): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set("kind", end.kind);
  if (end.kind === "attached") {
    map.set("objectId", end.objectId);
    map.set("fallback", { x: end.fallback.x, y: end.fallback.y });
  } else {
    map.set("x", end.x);
    map.set("y", end.y);
  }
  return map;
}

function sameEndpoint(stored: unknown, e: Endpoint): boolean {
  if (!(stored instanceof Y.Map)) return false;
  if (stored.get("kind") !== e.kind) return false;
  if (e.kind === "free") return stored.get("x") === e.x && stored.get("y") === e.y;
  const fallback = stored.get("fallback") as { x?: number; y?: number } | undefined;
  return stored.get("objectId") === e.objectId && fallback?.x === e.fallback.x && fallback?.y === e.fallback.y;
}

/** The other end, as stored, read the way `snapshot` reads it. */
function readStoredEndpoint(value: unknown): Endpoint | undefined {
  if (!(value instanceof Y.Map)) return undefined;
  const kind = value.get("kind");
  if (kind === "attached") {
    const objectId = value.get("objectId");
    const fallback = value.get("fallback") as { x?: number; y?: number } | undefined;
    if (typeof objectId !== "string" || objectId.length === 0) return undefined;
    if (!isFiniteNumber(fallback?.x) || !isFiniteNumber(fallback?.y)) return undefined;
    return { kind: "attached", objectId, fallback: { x: fallback.x, y: fallback.y } };
  }
  if (kind === "free") {
    const x = value.get("x");
    const y = value.get("y");
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;
    return { kind: "free", x, y };
  }
  return undefined;
}

function attachedId(end: Endpoint | undefined, ids: Set<string>): string | null {
  if (end === undefined || end.kind !== "attached") return null;
  return ids.has(end.objectId) ? end.objectId : null;
}

/** id -> current rectangle, for the geometry. Arrows are not rectangles here. */
function rectsOf(objects: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of objects) {
    if (object.type === CONNECTOR_TYPE) continue;
    rects.set(object.id, objectBounds(object));
  }
  return rects;
}

function connectorEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== "string" || id.length === 0) return undefined;
  const entry = doc.getMap<Y.Map<unknown>>("objects").get(id);
  if (!(entry instanceof Y.Map)) return undefined;
  return entry.get("type") === CONNECTOR_TYPE ? entry : undefined;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const value of objects.values()) {
    if (!(value instanceof Y.Map)) continue;
    const z = value.get("z");
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function newId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `connector-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
