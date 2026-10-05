/**
 * Connector (arrow) object model (story 10).
 *
 * Schema:
 *   objects/<id>: Y.Map {
 *     type: 'connector', z, createdAt, createdBy,
 *     from: Y.Map { kind: 'free', x, y }
 *             | { kind: 'attached', objectId, fallbackX, fallbackY },
 *     to:   Y.Map (same shape)
 *   }
 *
 * A stored connector holds no position and no side of its own: which side of an
 * object an end sits on is recomputed from the current rectangles every time the
 * board is read (`shared/geometry/connector-geometry.ts`). That is what lets an
 * arrow follow a shape across the board — and switch to facing side when the
 * shape passes it — without a single write, on every screen.
 *
 * `fallback` is where the end was drawn when it was attached. It is used only
 * when the object on the other end is gone, which is the state a screen lands in
 * when somebody else deletes that object at the moment the arrow is created.
 *
 * Cycles: this module imports from `board-model.ts`, which calls back into
 * `detachConnectorsTo` here. Nothing runs at module scope on either side, so the
 * import order does not matter; the *type* imports `board-model.ts` takes from
 * this file are erased at compile time.
 */
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  isKnownObjectType,
  objectBounds,
  type ConnectorObjectSnapshot,
} from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import {
  ENDS,
  connectorBBox,
  isResolvable,
  resolveEndpoints,
} from '../geometry/connector-geometry';
import { pointInRect, type Point, type Rect } from '../geometry';

/**
 * One end of a connector: glued to a board object, or loose on the board.
 *
 * An attached end names an object, not a point — plus the `fallback` point it was
 * drawn at, for the case where that object is gone.
 */
export type Endpoint =
  | { kind: 'free'; x: number; y: number }
  | { kind: 'attached'; objectId: string; fallback: Point };

/** What the renderer reads for one connector. */
export type ConnectorSnap = ConnectorObjectSnapshot;

/** A stored connector, decoded into plain data (no position: it has none). */
export interface StoredConnector {
  id: string;
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  z: number;
  createdAt: number;
  createdBy?: string;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Is this a usable end? An attached end must name an object and a fallback point. */
export function isEndpoint(value: unknown): value is Endpoint {
  if (typeof value !== 'object' || value === null) return false;
  const endpoint = value as {
    kind?: unknown;
    x?: unknown;
    y?: unknown;
    objectId?: unknown;
    fallback?: unknown;
  };
  if (endpoint.kind === 'free') return finite(endpoint.x) && finite(endpoint.y);
  if (endpoint.kind === 'attached') {
    if (typeof endpoint.objectId !== 'string' || endpoint.objectId === '') return false;
    const fallback = endpoint.fallback;
    return (
      typeof fallback === 'object' &&
      fallback !== null &&
      finite((fallback as Point).x) &&
      finite((fallback as Point).y)
    );
  }
  return false;
}

/** A new nested `Y.Map` holding one end. The old keys go with the old map. */
function encodeEndpoint(endpoint: Endpoint): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('kind', endpoint.kind);
  if (endpoint.kind === 'free') {
    map.set('x', endpoint.x);
    map.set('y', endpoint.y);
  } else {
    map.set('objectId', endpoint.objectId);
    map.set('fallbackX', endpoint.fallback.x);
    map.set('fallbackY', endpoint.fallback.y);
  }
  return map;
}

/** Read one end back. `null` when the record is unreadable. */
function decodeEndpoint(value: unknown): Endpoint | null {
  if (!(value instanceof Y.Map)) return null;
  const kind = value.get('kind');
  if (kind === 'free') {
    const x = value.get('x');
    const y = value.get('y');
    return finite(x) && finite(y) ? { kind: 'free', x, y } : null;
  }
  if (kind === 'attached') {
    const objectId = value.get('objectId');
    if (typeof objectId !== 'string' || objectId === '') return null;
    // A fallback that never got written is the object's own position, not a
    // point at the corner of the board.
    const fallback = {
      x: finite(value.get('fallbackX')) ? (value.get('fallbackX') as number) : 0,
      y: finite(value.get('fallbackY')) ? (value.get('fallbackY') as number) : 0,
    };
    return { kind: 'attached', objectId, fallback };
  }
  return null;
}

/**
 * Decode a stored connector. Returns `null` when the record is not a connector
 * or either end is unreadable, so a broken object drops out of the snapshot
 * instead of throwing in the renderer.
 */
export function readConnector(id: string, raw: Y.Map<unknown>): StoredConnector | null {
  if (raw.get('type') !== 'connector') return null;
  const from = decodeEndpoint(raw.get('from'));
  const to = decodeEndpoint(raw.get('to'));
  if (!from || !to) return null;
  const createdBy = raw.get('createdBy');
  return {
    id,
    type: 'connector',
    from,
    to,
    z: finite(raw.get('z')) ? (raw.get('z') as number) : 0,
    createdAt: finite(raw.get('createdAt')) ? (raw.get('createdAt') as number) : 0,
    ...(typeof createdBy === 'string' ? { createdBy } : {}),
  };
}

/** The live rectangle of every object in the document, by id. */
function liveRects(objects: Y.Map<Y.Map<unknown>>): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [id, raw] of objects) {
    const type = raw.get('type');
    if (type === 'connector') continue; // an arrow is not something to draw an end onto
    const x = raw.get('x');
    const y = raw.get('y');
    if (!finite(x) || !finite(y)) continue;
    const width = finite(raw.get('width')) ? (raw.get('width') as number) : undefined;
    const height = finite(raw.get('height')) ? (raw.get('height') as number) : undefined;
    // `objectBounds` owns the "no stored size means my type's default" rule.
    rects.set(
      id,
      objectBounds({
        id,
        type: typeof type === 'string' ? type : '',
        x,
        y,
        z: 0,
        createdAt: 0,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      }),
    );
  }
  return rects;
}

/**
 * Add a connector between two ends.
 *
 * Refused — with `null` and no transaction — when an end is unusable, when both
 * ends attach to the *same* object (an arrow from a thing to itself is a mistake,
 * not a drawing), or when two free ends are closer than
 * `CONNECTOR_MIN_LENGTH_WORLD` (an arrow needs a direction to draw its head).
 *
 * An end naming an object that is not in the document is *not* refused: that is
 * exactly the state an arrow is in when somebody else deletes what it points at,
 * and the arrow must still be drawn (at its `fallback`).
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }
  // The length of an arrow whose ends are both loose is known without the board.
  // For an attached end the tool already refused a drag shorter than the minimum,
  // and two objects that touch may legitimately be an arrow's whole length.
  if (from.kind === 'free' && to.kind === 'free') {
    if (Math.hypot(to.x - from.x, to.y - from.y) < CONNECTOR_MIN_LENGTH_WORLD) return null;
  }

  let id: string | null = null;
  doc.transact(() => {
    const objects = objectsMap(doc);
    id = crypto.randomUUID();
    const connector = new Y.Map<unknown>();
    connector.set('type', 'connector');
    // Position is derived, but the common fields exist and say "nothing here": a
    // reader that forgets an arrow is special gets an empty box, not `undefined`.
    connector.set('x', 0);
    connector.set('y', 0);
    connector.set('width', 0);
    connector.set('height', 0);
    connector.set('from', encodeEndpoint(from));
    connector.set('to', encodeEndpoint(to));
    let max = 0;
    for (const raw of objects.values()) {
      const z = raw.get('z');
      if (finite(z) && z > max) max = z;
    }
    connector.set('z', max + 1);
    connector.set('createdAt', Date.now());
    connector.set('createdBy', by);
    objects.set(id, connector);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move one end of a connector — the write behind re-attaching an arrow to a
 * different object, and behind dragging a loose end about.
 *
 * Only that end is written: the other one, the z order and the authorship stay as
 * they were.
 *
 * Returns `false`, having written nothing, for a stale id (the arrow was deleted
 * while the handle was in the air), an unusable endpoint, an endpoint the end
 * already has, and an end attached to the object the *other* end is attached to
 * (which would draw an arrow that goes nowhere).
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  which: 'from' | 'to',
  endpoint: Endpoint,
): boolean {
  if (!ENDS.includes(which)) return false;
  if (!isEndpoint(endpoint)) return false;
  const connector = objectsMap(doc).get(id);
  const stored = connector ? readConnector(id, connector) : null;
  if (!stored) return false;
  const other = stored[which === 'from' ? 'to' : 'from'];
  if (
    endpoint.kind === 'attached' &&
    other.kind === 'attached' &&
    endpoint.objectId === other.objectId
  ) {
    return false;
  }
  if (sameEndpoint(stored[which], endpoint)) return false;
  doc.transact(() => {
    connector!.set(which, encodeEndpoint(endpoint));
  }, LOCAL_ORIGIN);
  return true;
}

/** Are two ends the same thing? */
function sameEndpoint(current: Endpoint, next: Endpoint): boolean {
  if (current.kind !== next.kind) return false;
  if (current.kind === 'free' && next.kind === 'free') {
    return current.x === next.x && current.y === next.y;
  }
  if (current.kind === 'attached' && next.kind === 'attached') {
    return current.objectId === next.objectId && current.fallback.x === next.fallback.x && current.fallback.y === next.fallback.y;
  }
  return false;
}

/**
 * The box an arrow is drawn in right now, or `null` when it has no usable
 * geometry. This is what a gesture compares a drag target against, because the
 * stored record keeps no position to compare with.
 */
export function connectorBoxOf(doc: Y.Doc, id: string): Rect | null {
  const objects = objectsMap(doc);
  const raw = objects.get(id);
  const stored = raw ? readConnector(id, raw) : null;
  if (!stored) return null;
  const ends = resolveEndpoints(stored, liveRects(objects));
  return isResolvable(ends) ? connectorBBox(ends.from, ends.to) : null;
}

/**
 * Move every free end of a connector by `(dx, dy)` — the write behind dragging an
 * arrow about. Attached ends are left where their objects put them, so dragging a
 * fully attached arrow writes nothing at all.
 *
 * Returns whether anything was written.
 */
export function translateConnector(doc: Y.Doc, id: string, dx: number, dy: number): boolean {
  if (!finite(dx) || !finite(dy) || (dx === 0 && dy === 0)) return false;
  const raw = objectsMap(doc).get(id);
  const stored = raw ? readConnector(id, raw) : null;
  if (!stored || !raw) return false;
  const ends = ENDS.filter((which) => stored[which].kind === 'free');
  if (ends.length === 0) return false;
  doc.transact(() => {
    for (const which of ends) {
      const endpoint = stored[which];
      if (endpoint.kind !== 'free') continue;
      raw.set(which, encodeEndpoint({ kind: 'free', x: endpoint.x + dx, y: endpoint.y + dy }));
    }
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Free every connector end that points at one of `ids`, leaving it exactly where
 * it was drawn (PRD `conn.behaviour`: the arrow stays visible with its end at the
 * last known side point).
 *
 * Call it inside the delete transaction (`board-model.ts` does, before the
 * objects are removed) so the detach and the delete are one update: no screen can
 * observe a connector pointing at a missing object, and undo brings the object
 * and its re-attached end back together.
 *
 * An end already free writes nothing, so a second pass is a no-op.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (!Array.isArray(deletedIds) || deletedIds.length === 0) return;
  const removed = new Set(deletedIds);
  const objects = objectsMap(doc);
  const rects = liveRects(objects);

  const writes: [Y.Map<unknown>, 'from' | 'to', Endpoint][] = [];
  for (const [id, raw] of objects) {
    const stored = readConnector(id, raw);
    if (!stored) continue;
    // Where both ends are right now: the end being freed keeps that point, and
    // the point is the middle of the side it was drawn on.
    const ends = resolveEndpoints(stored, rects);
    for (const which of ENDS) {
      const endpoint = stored[which];
      if (endpoint.kind !== 'attached' || !removed.has(endpoint.objectId)) continue;
      const point = ends[which];
      writes.push([
        raw,
        which,
        { kind: 'free', x: point.x, y: point.y },
      ]);
    }
  }
  if (writes.length === 0) return;
  doc.transact(() => {
    for (const [raw, which, endpoint] of writes) raw.set(which, encodeEndpoint(endpoint));
  }, LOCAL_ORIGIN);
}

/** An object an arrow end can be attached to, with its live box. */
export interface AttachTarget {
  id: string;
  rect: Rect;
  z: number;
}

/**
 * Every object on the board an arrow end may be attached to.
 *
 * Arrows themselves are excluded (an end points at a thing, not at another arrow),
 * and so are types this build cannot draw: attaching to something you cannot see is
 * how an arrow ends up pointing at nothing.
 */
export function attachTargets(doc: Y.Doc): AttachTarget[] {
  const targets: AttachTarget[] = [];
  for (const [id, raw] of objectsMap(doc)) {
    const type = raw.get('type');
    if (typeof type !== 'string' || type === 'connector' || !isKnownObjectType(type)) continue;
    const rect = rawRect(raw);
    if (!rect) continue;
    targets.push({ id, rect, z: finite(raw.get('z')) ? (raw.get('z') as number) : 0 });
  }
  return targets;
}

/** The object at `at` that a released arrow end should attach to: the topmost one. */
export function attachTargetAt(doc: Y.Doc, at: Point, excludeId?: string): string | null {
  if (!finite(at?.x) || !finite(at?.y)) return null;
  let best: string | null = null;
  let bestZ = Number.NEGATIVE_INFINITY;
  for (const target of attachTargets(doc)) {
    if (target.id === excludeId) continue;
    if (!pointInRect(at, target.rect)) continue;
    if (target.z >= bestZ) {
      bestZ = target.z;
      best = target.id;
    }
  }
  return best;
}

/** The live box of one stored record, or `null` when it has no readable position. */
function rawRect(raw: Y.Map<unknown>): Rect | null {
  const x = raw.get('x');
  const y = raw.get('y');
  if (!finite(x) || !finite(y)) return null;
  const width = finite(raw.get('width')) ? (raw.get('width') as number) : undefined;
  const height = finite(raw.get('height')) ? (raw.get('height') as number) : undefined;
  const type = raw.get('type');
  // `objectBounds` owns the "no stored size means my type's default" rule.
  return objectBounds({
    id: '',
    type: typeof type === 'string' ? type : '',
    x,
    y,
    z: 0,
    createdAt: 0,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  });
}
