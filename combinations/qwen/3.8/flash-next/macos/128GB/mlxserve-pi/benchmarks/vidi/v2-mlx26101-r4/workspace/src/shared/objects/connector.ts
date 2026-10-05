/**
 * Connector objects: the schema and every mutation of an arrow.
 *
 * An arrow is the fourth object type on the board and the first whose **box is not its own**. Everything
 * else on the board stores where it is; an arrow stores which two things it joins, and where it is comes out
 * of where they are. That single difference is what the rest of this file is built around: the stored
 * `x`/`y`/`width`/`height` are zeros, the box anybody asks about is computed in `snapshot()` from the two
 * ends, and no code path exists that writes a place into an arrow — which is how "the arrow follows the
 * shape" is true for five people at once without a line of code that says *follow*.
 *
 * **An arrow that survives the death of what it pointed at.** Deleting a shape keeps its arrows (see
 * `detachConnectorsTo`): the end becomes free at the point it was drawn at, so a board does not lose its
 * structure because one box in it was removed. The same rule handles the race the PRD calls out — a colleague
 * deletes the shape in the moment before this person's arrow lands on it — because the arrow that gets
 * created points at an object that is no longer there, and `resolveEndpoints` draws that end at its stored
 * fallback. There is no error to show, because from the point of view of the person drawing, the arrow is
 * exactly where they put it.
 *
 * **An arrow is not a position, so it is not movable by position.** Dragging an arrow's body writes nothing:
 * its two ends are its position, and moving them is the `setConnectorEndpoint` job behind the handles. This
 * is why the type registers itself to the board model as a type whose box is derived (see
 * `registerDerivedBoxType`), which keeps the marquee, the drag and the undo history from treating a derived
 * number as somebody's edit.
 */
import * as Y from 'yjs';

import {
  LOCAL_ORIGIN,
  objectBounds,
  registerDeleteListener,
  registerKnownObjectType,
  registerObjectReader,
  snapshot,
} from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
} from '../config';
import type { Point, Rect } from '../geometry';
import {
  attachedEndpoint,
  connectorBBox,
  freeEndpoint,
  isEndpoint,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../geometry/connector-geometry';
import type { ConnectorEnds, Endpoint, Side } from '../geometry/connector-geometry';

/** Object discriminator stored on every arrow. */
export const CONNECTOR_OBJECT_TYPE = 'connector';

/** Which end of an arrow a write is about. */
export type ConnectorEnd = 'from' | 'to';

const OBJECTS_KEY = 'objects';

/** An arrow, as the document holds it. */
export interface ConnectorSnap extends ObjectSnapshot, ConnectorEnds {
  type: 'connector';
  /** Who made it. Anonymised in this build, like everything else that carries an author. */
  createdBy: string;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/**
 * Whether this snapshot carries the fields only an arrow has, so they can be read off it.
 *
 * Structural rather than a comparison of `type`, for the same reason as the other two types: the generic
 * snapshot and `readConnector` both say `type: 'connector'` and only one of them has ends. A guard that
 * asked only about `type` would promise a `from` that is `undefined`, and an arrow drawn from `undefined` is
 * a line to nowhere.
 */
export function isConnectorSnapshot(object: ObjectSnapshot | undefined | null): object is ConnectorSnap {
  if (object === undefined || object === null || object.type !== CONNECTOR_OBJECT_TYPE) return false;
  const withEnds = object as Partial<ConnectorSnap>;
  return isEndpoint(withEnds.from) && isEndpoint(withEnds.to);
}

function objectOf(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const object = objects.get(id);
  if (!(object instanceof Y.Map) || typeof object.get('type') !== 'string') return undefined;
  return object;
}

/** An arrow by id, or undefined when there is no object of that id or it is some other type. */
function connectorOf(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  const object = objectOf(objects, id);
  return object?.get('type') === CONNECTOR_OBJECT_TYPE ? object : undefined;
}

/** Highest `z` of any object on the board (0 when there are none). */
function highestZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const object of objects.values()) {
    if (!(object instanceof Y.Map)) continue;
    const z = object.get('z');
    if (finite(z) && z > max) max = z;
  }
  return max;
}

/**
 * The objects an arrow can be attached to, as id and box.
 *
 * Arrows are left out: an arrow pointing at an arrow is a thing nobody draws (the Connector tool hit-tests
 * against this map, and so do the end handles), and reading the board's own derived boxes in order to answer
 * a question about arrows would be a recursion that only stops by accident. Sticky notes, text, shapes and
 * anything a later story adds are all in it, which is what "arrows connect shapes, sticky notes, and any
 * other board object" costs to support: nothing, as long as the question is asked of the board and not of one
 * type.
 */
export function attachableRects(objects: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of objects) {
    if (object?.type === CONNECTOR_OBJECT_TYPE) continue;
    if (!finite(object.x) || !finite(object.y)) continue;
    rects.set(object.id, objectBounds(object));
  }
  return rects;
}

/** The boxes of everything the arrows can point at, read from the document. */
function rectsOf(doc: Y.Doc): Map<string, Rect> {
  return attachableRects(snapshot(doc));
}

/** The two ends of an arrow as the document stores them, or `null` when either one is unreadable. */
function endsOf(object: Y.Map<unknown>): ConnectorEnds | null {
  const from = endpointOf(object, 'from');
  const to = endpointOf(object, 'to');
  return from === null || to === null ? null : { from, to };
}

function endpointOf(object: Y.Map<unknown>, key: 'from' | 'to'): Endpoint | null {
  const stored = object.get(key);
  if (!isEndpoint(stored)) return null;
  // Copied rather than handed back, and frozen: a stored endpoint is a plain value inside the document, and
  // a caller that wrote to it would be editing the document through the back door — invisible to Yjs and to
  // everybody else on the board.
  return Object.freeze(
    stored.kind === 'free'
      ? { kind: 'free' as const, x: stored.x, y: stored.y }
      : {
          kind: 'attached' as const,
          objectId: stored.objectId,
          fallback: Object.freeze({ x: stored.fallback.x, y: stored.fallback.y }),
        },
  );
}

/**
 * One arrow, read straight from the document, with the box its ends describe.
 *
 * `rects` is what the box is derived from and it is a parameter rather than a lookup, because the board's
 * `snapshot` has already read every object on the board to get here: an arrow that read the document again
 * for its own box would be reading the whole board once per arrow, and the point of deriving a box is that it
 * costs a subtraction, not a query.
 */
export function readConnectorObject(
  id: string,
  object: Y.Map<unknown>,
  rects: ReadonlyMap<string, Rect>,
): ConnectorSnap | null {
  if (object.get('type') !== CONNECTOR_OBJECT_TYPE) return null;
  const z = object.get('z');
  if (!finite(z)) return null;
  const ends = endsOf(object);
  if (ends === null) return null;

  const resolved = resolveEndpoints(ends, rects);
  const box = connectorBBox(resolved.from, resolved.to);
  const createdAt = object.get('createdAt');
  const createdBy = object.get('createdBy');

  return Object.freeze({
    id,
    type: 'connector' as const,
    // The box an arrow occupies is where its two ends are, not what it stores: a board that stored both would
    // have two answers to "where is this arrow" and would eventually show the wrong one.
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    from: ends.from,
    to: ends.to,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  });
}

/** One arrow by id, with its derived box, or null when there is no such arrow. */
export function readConnector(doc: Y.Doc, id: string): ConnectorSnap | null {
  const object = connectorOf(objectsOf(doc), id);
  return object === undefined ? null : readConnectorObject(id, object, rectsOf(doc));
}

/** Every arrow on the board, in stacking order. */
export function connectorSnapshots(doc: Y.Doc): readonly ConnectorSnap[] {
  const objects = objectsOf(doc);
  const rects = rectsOf(doc);
  const arrows: ConnectorSnap[] = [];
  for (const [id, object] of objects) {
    if (!(object instanceof Y.Map)) continue;
    const read = readConnectorObject(id, object, rects);
    if (read !== null) arrows.push(read);
  }
  arrows.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(arrows);
}

/**
 * How far apart two ends are, once the objects they point at have had their say.
 *
 * This is the distance the minimum length is judged on, which is not the distance the pointer travelled: an
 * arrow drawn from one end of a big shape to the other is a short drag and a long arrow, and the arrow is
 * what anybody reading the board will see.
 */
function endsLength(from: Endpoint, to: Endpoint, rects: ReadonlyMap<string, Rect>): number {
  const ends = resolveEndpoints({ from, to }, rects);
  return Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y);
}

/**
 * An end as it is stored: attached ends are pinned to the anchor of the side they will be drawn at.
 *
 * The caller — the tool, which knows where the pointer was — hands over an end whose fallback is the point it
 * released on. The anchor is written instead, because the fallback's job is to be "the point where the
 * object's side was" if that object is deleted a moment later, and the side is a fact about the two objects
 * that this function can look up better than the pointer can.
 */
/**
 * An end as it was handed in, or `null` when the caller handed in something that cannot mean an end.
 *
 * `createConnector` and `setConnectorEndpoint` are documented to take a plain point as well as an end, because
 * "an arrow from this point to that object" is how a tool knows the drag it just made, and making every tool
 * build an end before it can say what it drew is ceremony that protects nothing: the point is turned into a
 * `free` end here, once, on the way in, so that the document only ever holds the form it is specified to hold.
 * A point with a `NaN` in it is not an end and is not made into one — that is the check that has always been
 * here, in the same place, under a slightly wider question.
 */
function inputEnd(value: unknown): Endpoint | null {
  if (isEndpoint(value)) return value;
  const point = value as Partial<Point> | null | undefined;
  if (typeof point?.x === 'number' && typeof point.y === 'number' && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    return freeEndpoint({ x: point.x, y: point.y });
  }
  return null;
}

function storedEnd(end: Endpoint, other: Point, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (end.kind === 'free') return freeEndpoint({ x: end.x, y: end.y });
  const rect = rects.get(end.objectId);
  if (rect === undefined) return attachedEndpoint(end.objectId, { x: end.fallback.x, y: end.fallback.y });
  return attachedEndpoint(end.objectId, sideAnchor(rect, nearestSide(rect, other)));
}

function endsAreEqual(a: Endpoint, b: Endpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'free' && b.kind === 'free') return a.x === b.x && a.y === b.y;
  if (a.kind === 'attached' && b.kind === 'attached') {
    return a.objectId === b.objectId && a.fallback.x === b.fallback.x && a.fallback.y === b.fallback.y;
  }
  return false;
}

/**
 * Join two things with an arrow, in one transaction, and return its id.
 *
 * Three things stop an arrow being created, and all of them are checked before anything is written:
 *
 *  - an end that is not an end — a point with a `NaN` in it, or an object id that is not a string;
 *  - **the same object at both ends** (TC-08): an arrow from a shape to itself has no direction and says
 *    nothing, and a person who meant to draw one has drawn a loop on the spot they were already pointing at;
 *  - **two ends closer than `CONNECTOR_MIN_LENGTH_WORLD`** (TC-09): a drag that short is a click that
 *    wobbled, and an arrow the width of a cursor is a smudge somebody now has to delete.
 *
 * The distance is measured between the *resolved* points, so an arrow between two objects whose anchors are
 * far apart is not refused because the pointer travelled a short way, and an arrow whose ends happen to land
 * on the same pixel is. Exactly the minimum length is created: a boundary is a boundary, not a suggestion.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint | Point,
  to: Endpoint | Point,
  by: string,
): string | null {
  // Read as ends first, and only then asked anything: a caller that says "an arrow from here to there" and
  // hands over two points means two ends attached to nothing, and that is the one thing a point can mean.
  // The document never sees the bare point — it gets the end it is specified to hold, written on the way in.
  const start = inputEnd(from);
  const finish = inputEnd(to);
  if (start === null || finish === null) return null;
  if (start.kind === 'attached' && finish.kind === 'attached' && start.objectId === finish.objectId) return null;

  const rects = attachableRects(snapshot(doc));

  if (!(endsLength(start, finish, rects) >= CONNECTOR_MIN_LENGTH_WORLD)) return null;

  const resolved = resolveEndpoints({ from: start, to: finish }, rects);

  // Stored at the anchor of the side each end is drawn at, rather than at the point the pointer let go: the
  // fallback and the drawing then agree from the first frame, and an arrow whose object is deleted later goes
  // back to where its side was (connector.target_deleted) instead of to where somebody's hand happened to stop.
  const storedFrom = storedEnd(start, resolved.to, rects);
  const storedTo = storedEnd(finish, resolved.from, rects);
  const id = newId();
  const connector = new Y.Map<unknown>();
  const objects = objectsOf(doc);
  const z = highestZ(objects) + 1;

  doc.transact(() => {
    connector.set('type', CONNECTOR_OBJECT_TYPE);
    // Not stored at all would be a different decision: zeros say "this object has no box of its own" to
    // anything reading the document raw, which is true, while a copy of the derived box would be a number
    // that goes out of date the moment somebody moves a shape.
    connector.set('x', 0);
    connector.set('y', 0);
    connector.set('width', 0);
    connector.set('height', 0);
    connector.set('z', z);
    connector.set('createdAt', Date.now());
    connector.set('createdBy', typeof by === 'string' ? by : '');
    connector.set('from', storedFrom);
    connector.set('to', storedTo);
    objects.set(id, connector);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move one end of an arrow: re-attach it, detach it, or pin it somewhere else.
 *
 * This is what the two handles of a selected arrow do (connector.reattach), and it is the only way an
 * existing arrow's ends change. It answers false, and writes nothing, when:
 *
 *  - the arrow is not there (TC-29 — it was deleted in another tab while this person was dragging);
 *  - the end is not a usable end, or holds a point that is not a point;
 *  - the end would point at **the object already at the other end** — an arrow from A to B whose B-end is
 *    dragged back onto A is an arrow from A to A, and the handle snaps back rather than redrawing the arrow
 *    on top of a shape;
 *  - nothing would change.
 *
 * An end attached to an object is stored at that object's current anchor, so an arrow re-attached to a shape
 * that has since moved is drawn where the shape is now, not where the pointer let go.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: ConnectorEnd,
  endpoint: Endpoint | Point,
): boolean {
  const connector = connectorOf(objectsOf(doc), id);
  if (connector === undefined) return false;
  if (end !== 'from' && end !== 'to') return false;
  const wanted = inputEnd(endpoint);
  if (wanted === null) return false;

  const otherEnd = end === 'from' ? 'to' : 'from';
  const other = endpointOf(connector, otherEnd);
  if (other === null) return false;

  // An arrow that ends where it starts says nothing, and redrawing it would lose the arrow this person had.
  if (wanted.kind === 'attached' && other.kind === 'attached' && wanted.objectId === other.objectId) {
    return false;
  }

  const rects = attachableRects(snapshot(doc));
  // Too short after the change is the same refusal as at creation: an arrow of three pixels is a mis-click,
  // and a handle dragged back onto its own arrow leaves the arrow where it was rather than shrinking it out
  // of existence.
  const ends = end === 'from' ? { from: wanted, to: other } : { from: other, to: wanted };
  if (!(endsLength(ends.from, ends.to, rects) >= CONNECTOR_MIN_LENGTH_WORLD)) return false;

  const resolved = resolveEndpoints(ends, rects);

  const stored = storedEnd(wanted, end === 'from' ? resolved.to : resolved.from, rects);
  const current = endpointOf(connector, end);
  if (current !== null && endsAreEqual(current, stored)) return false;

  doc.transact(() => {
    connector.set(end, stored);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Turn the ends of arrows that pointed at deleted objects into free ends, in the caller's transaction.
 *
 * Called by `deleteObjects` from inside its own transaction, which is what makes one undo bring the object
 * back *with* its arrows attached again rather than with an arrow lying pointing at an empty space (TC-13).
 * It is called before the objects are removed, because the whole job is to write down where the object's side
 * was while the object is still there to be asked.
 *
 * An arrow with nothing attached to the deleted ids is not written at all, and a call that changes nothing
 * opens no transaction: deleting a sticky note would otherwise rewrite every arrow on the board and put a
 * step full of no-ops into the undo history of everybody who deletes something.
 *
 * The end that comes away keeps its arrow: the arrow is the relationship between two things, and losing the
 * relationship because one of the things went away is how a board loses the shape of a process.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (!Array.isArray(deletedIds) || deletedIds.length === 0) return;
  const gone = new Set(deletedIds);
  const objects = objectsOf(doc);
  // Read the boxes before anything is deleted: after that there is nothing left to compute an anchor from,
  // and the stored fallback would be a worse answer for an object this board still had a moment ago.
  const rects = attachableRects(snapshot(doc));

  const changes: { connector: Y.Map<unknown>; key: ConnectorEnd; end: Endpoint }[] = [];
  for (const [id, object] of objects) {
    if (!(object instanceof Y.Map) || object.get('type') !== CONNECTOR_OBJECT_TYPE) continue;
    // An arrow that is itself being deleted has no ends worth rewriting.
    if (gone.has(id)) continue;
    const from = endpointOf(object, 'from');
    const to = endpointOf(object, 'to');
    if (from === null || to === null) continue;

    for (const key of ['from' as ConnectorEnd, 'to' as ConnectorEnd]) {
      const end = key === 'from' ? from : to;
      if (end.kind !== 'attached' || !gone.has(end.objectId)) continue;
      const other = key === 'from' ? to : from;
      const otherPoint = towardOf(other, rects);
      const rect = rects.get(end.objectId);
      changes.push({
        connector: object,
        key,
        // The point where this end was drawn, which is exactly what a free end means: the same place, now
        // belonging to the board instead of to a shape.
        end: freeEndpoint(rect === undefined ? end.fallback : sideAnchor(rect, nearestSide(rect, otherPoint))),
      });
    }
  }
  if (changes.length === 0) return;

  doc.transact(() => {
    for (const change of changes) change.connector.set(change.key, change.end);
  }, LOCAL_ORIGIN);
}

/**
 * Which way an end is pointing: the point another end should be drawn towards.
 *
 * The centre of the object rather than its anchor, because this is the argument to a side decision — the
 * centre is the one point that does not depend on which side gets chosen, which is what keeps the choice
 * from being circular.
 */
function towardOf(end: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  return rect === undefined
    ? { x: end.fallback.x, y: end.fallback.y }
    : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The box an arrow occupies, as the document model wants it derived (connector.follow).
 *
 * Registered below rather than written into `board-model.ts`, because that file's whole discipline is not
 * knowing what kinds of object a board holds: it asks a type it has been told about to explain itself, and
 * this is the answer. It reads only what the object itself stores plus the boxes of the objects it points
 * at, so it never writes and never recurses.
 */
function deriveConnectorBox(object: Y.Map<unknown>, rects: ReadonlyMap<string, Rect>): Rect | null {
  const ends = endsOf(object);
  if (ends === null) return null;
  const resolved = resolveEndpoints(ends, rects);
  return connectorBBox(resolved.from, resolved.to);
}

/**
 * What an arrow stores that a sticky note does not, for the board's report of it.
 *
 * The two ends, and who made the arrow. Without this the board would report an arrow as an object with no
 * contents — the generic reader only knows about positions and text — and a client drawing from that report
 * would have nothing to draw: an arrow is its ends, and everything else about it is a box that is calculated
 * from them.
 */
function connectorFields(object: Y.Map<unknown>): Record<string, unknown> {
  const ends = endsOf(object);
  if (ends === null) return {};
  const createdBy = object.get('createdBy');
  return {
    from: ends.from,
    to: ends.to,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}

/**
 * Arrows announce themselves to the document model: what they store, and where they are given what else is
 * on the board. The model therefore reports an arrow's ends and a derived box, and refuses to move or resize
 * an arrow by writing numbers into it — an arrow's position is its two ends, and only its own type knows how
 * to move them.
 */
registerObjectReader(CONNECTOR_OBJECT_TYPE, {
  box: deriveConnectorBox,
  fields: (object) => connectorFields(object),
});
registerDeleteListener(detachConnectorsTo);
registerKnownObjectType(CONNECTOR_OBJECT_TYPE);

/** `crypto.randomUUID()`, with a fallback for environments without WebCrypto. */
function newId(): string {
  const cryptoRef = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  return `connector-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
}

export type { Endpoint, Side };
