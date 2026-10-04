import * as Y from 'yjs';
import {
  CONNECTOR_TYPE,
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  canReadObjectType,
  objectBounds,
  onObjectsDeleted,
  registerDerivedBounds,
  registerObjectReader,
  snapshot,
  type BoundsResolver,
  type ObjectSnapshot,
} from '../board-model';
import type { Point, Rect } from '../geometry';
import {
  ENDS,
  connectorBBox,
  endpointValue,
  isConnectorLongEnough,
  otherEnd,
  readEndpoint,
  resolveEndpoints,
  type ConnectorEnds,
  type End,
  type Endpoint,
} from '../geometry/connector-geometry';

/**
 * Arrows on the board (story 10): the schema, and every mutation of it.
 *
 * An arrow is a line between two places on the board, each of which is either a point or the side of
 * another object. That is the whole of what makes it a new kind of thing rather than a shape with a
 * line through it: an arrow does not know where it is. It knows what it is *attached to*, and where
 * it is drawn is worked out from that and from where those things are now - which is why an arrow
 * follows a shape that somebody drags across the board without a single byte being written about the
 * arrow, and why two people can move the two things at the two ends of one arrow at the same moment
 * and both see one arrow with two ends in two places, rather than two arguments about where it is.
 *
 * ```text
 * objects/<id>: Y.Map {
 *   type: 'connector'
 *   from, to: { kind: 'attached', objectId, fallback: {x, y} }
 *            | { kind: 'free', x, y }
 *   x, y, width, height: number   // the box the arrow was made in; see below
 *   z, createdAt, createdBy
 * }
 * ```
 *
 * The two ends are the arrow; `x`, `y`, `width` and `height` are a photograph of where the ends
 * happened to be when it was created. They are written so that a client which cannot work a box out
 * from ends - an older build, a board exported and re-imported by hand - still draws the arrow where
 * it was drawn rather than dropping it or putting it at the origin, and they are read by nobody on a
 * board that can do the arithmetic: {@link snapshot} overwrites all four with the box the ends are in
 * now (see {@link registerDerivedBounds}). That is also why an arrow has no `color`, no `kind` and no
 * `label`: an arrow is not drawn in a colour of its own, and what would a label on a line between two
 * things be written about?
 *
 * An end names an object by id and *never* by a position that is kept up to date with it. So an arrow
 * whose object has been deleted needs nothing done to it: it is drawn at the `fallback` point stored
 * in it, and if the object comes back - an undo, a peer that still has it - the end fastens to it
 * again by itself. {@link detachConnectorsTo} is a deliberate write, for the case where the arrow must
 * keep the shape it had after the delete rather than keep the possibility of following it.
 *
 * Every mutation is one `doc.transact(fn, LOCAL_ORIGIN)`, and a rejected one - stale id, both ends on
 * one object, an arrow shorter than a click, an end re-fastened to the object at its other end -
 * returns before a transaction is opened, so it emits no update and costs no sync traffic. Like the
 * rest of `shared`, this module never throws for user-driven input, and knows nothing about pointers,
 * dots, arrowheads or React.
 */

// The type's name is the board model's, because the model's reader has to know it; it is re-exported
// so that the code which writes arrows says `CONNECTOR_TYPE`, from where it stands.
export { CONNECTOR_TYPE } from '../board-model';

/** Where an end is fastened. Kept in the geometry module, which is where the arithmetic on it is. */
export type { Endpoint, End, Side, ConnectorEnds } from '../geometry/connector-geometry';

/**
 * An arrow, as the board reads it.
 *
 * Both ends are required here, unlike the optional `from`/`to` on {@link ObjectSnapshot}: an arrow with
 * an end this client cannot read is an arrow it cannot draw - there is no line, no box, nothing to
 * select - and {@link asConnectorSnapshot} says `null` for one rather than inventing a place for the
 * end that is missing. The board model's generic reader leaves an unreadable end out, which is what
 * lets this be the place that decides.
 */
export interface ConnectorSnapshot extends ObjectSnapshot {
  readonly type: 'connector';
  readonly from: Endpoint;
  readonly to: Endpoint;
}

// The model is allowed to read arrows as soon as this module is loaded, and to work out where they are
// drawn; a client that never imports this file skips arrow objects instead of failing on them. The
// three registrations are at the bottom of the file, after the functions they name exist.

type YObject = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>(OBJECTS_MAP);
}

/** A member of `objects` that is an arrow this client can read. */
function connectorObject(objects: Y.Map<YObject>, id: string): YObject | null {
  const object = objects.get(id);
  if (
    object === undefined ||
    !(object instanceof Y.Map) ||
    object.get('type') !== CONNECTOR_TYPE
  ) {
    return null;
  }
  if (!canReadObjectType(CONNECTOR_TYPE)) {
    return null;
  }
  return object;
}

function readZ(object: YObject): number {
  const z = object.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

/** Highest stacking order of any readable object; 0 for an empty document. */
function maxZ(objects: Y.Map<YObject>): number {
  let max = 0;
  for (const object of objects.values()) {
    if (object instanceof Y.Map && canReadObjectType(object.get('type'))) {
      max = Math.max(max, readZ(object));
    }
  }
  return max;
}

/**
 * Ids are `crypto.randomUUID()`, so arrows made offline by different peers (story 3) cannot collide
 * with a note, a shape or another arrow - the same rule the rest of the board follows, and the reason
 * an end may be stored as a bare id with no version next to it.
 */
function newId(): string {
  const cryptoObject: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (typeof cryptoObject?.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

/**
 * Where everything on the board is drawn, by id.
 *
 * One call for the whole board, because the question an arrow asks - where are the two things I am
 * attached to - is never asked about one object at a time. This is the map {@link resolveEndpoints}
 * and every component that draws an arrow works from: the board's snapshot, turned into boxes.
 *
 * The boxes are the snapshot's, so an arrow's own box is already the derived one. An arrow is never
 * attached to another arrow (the tool will not let an end be dropped on one, and an arrow's box is not
 * a shape's edge), and when one is - written by something that is not this client - the answer comes
 * from a box that is a consequence of something else's rather than a lie about there being an edge.
 */
export function boardRects(objects: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of objects) {
    rects.set(object.id, objectBounds(object));
  }
  return rects;
}

/** The two ends of a snapshot, if it has both; `null` for anything that is not a drawable arrow. */
function endsOf(object: ObjectSnapshot): ConnectorEnds | null {
  const { from, to } = object;
  return from === undefined || to === undefined ? null : { from, to };
}

/** Where an arrow is drawn, for the board's reader (see {@link registerDerivedBounds}). */
const connectorBounds: BoundsResolver = (object, rects) => {
  const ends = endsOf(object);
  if (ends === null) {
    // An arrow with an end that cannot be read has no line, and an object with no box is not drawn,
    // not selected and not hit - story 9's rule for a box of not-a-number, for the same reason.
    return null;
  }
  const points = resolveEndpoints(ends, rects);
  return connectorBBox(points.from, points.to);
};

/** The boxes of the objects an arrow could be attached to, as the document holds them now. */
function liveRects(doc: Y.Doc): Map<string, Rect> {
  return boardRects(snapshot(doc));
}

/** Whether the two ends name the same object. */
function isSameObject(from: Endpoint, to: Endpoint): boolean {
  return (
    from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId
  );
}

/**
 * An end as it is stored, once its place on the board is known.
 *
 * A free end is the point it was released at. An attached end keeps the object it names and takes the
 * *anchor* as its fallback - the midpoint of the side it was drawn on - rather than the point the
 * pointer was let go at, because the fallback is what the end is drawn at when its object is gone, and
 * a fallback taken from the pointer leaves an arrow that ends a few units inside a shape, or outside
 * it, the moment the shape is deleted: the exact thing that makes an arrow look like a mistake rather
 * than like a thing that outlived its object on purpose.
 */
function storedEnd(endpoint: Endpoint, point: Point): Endpoint {
  return endpoint.kind === 'attached'
    ? { kind: 'attached', objectId: endpoint.objectId, fallback: point }
    : endpoint;
}

/** Whether a stored end and the end that is being asked for are the same end in the same place. */
function isSameEnd(stored: unknown, next: Endpoint): boolean {
  const current = readEndpoint(stored);
  if (current === null || current.kind !== next.kind) {
    return false;
  }
  if (current.kind === 'free' && next.kind === 'free') {
    return current.x === next.x && current.y === next.y;
  }
  return (
    current.kind === 'attached' &&
    next.kind === 'attached' &&
    current.objectId === next.objectId &&
    current.fallback.x === next.fallback.x &&
    current.fallback.y === next.fallback.y
  );
}

/** The ends of a stored arrow, in the order the arrow is drawn; `null` when either is unreadable. */
function storedEnds(object: YObject): ConnectorEnds | null {
  const from = readEndpoint(object.get('from'));
  const to = readEndpoint(object.get('to'));
  return from === null || to === null ? null : { from, to };
}

/**
 * Put an arrow on the board between two ends.
 *
 * An end is a place or a thing: `free` for a point on the board, `attached` for the side of an object.
 * Neither end has to name anything that exists - an end aimed at a shape that has just been deleted by
 * somebody else is created anyway and drawn at the point it was aimed at (see the note on
 * {@link storedEnd}), because the alternative is to tell a person who was quick enough to lose their
 * arrow, which is a worse answer than an arrow with one end in the air.
 *
 * What is stored for an attached end is the object's id and the anchor it was drawn at. Both ends are
 * anchored once, here, against each other: the aim for each end is the other end's object's centre,
 * which is the one thing about the other end that does not depend on where this end is going to be
 * (see {@link endpointAim}).
 *
 * @returns the new id, or `null` when either end is not an end, when both ends name the same object,
 * when the arrow as it would be drawn is shorter than {@link CONNECTOR_MIN_LENGTH_WORLD} - a drag that
 * drifted, not an arrow - or when there is nobody to credit it to. Nothing is written for a refusal.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  const start = readEndpoint(from);
  const finish = readEndpoint(to);
  if (start === null || finish === null) {
    return null;
  }
  if (typeof by !== 'string' || by === '') {
    return null;
  }
  // An arrow from a shape to itself is a line that leaves a side and comes back to it, and there is no
  // way to draw one that is not a drawing of a joke. Refused before anything is written, so the tool
  // stays armed and the person can draw the arrow they meant.
  if (isSameObject(start, finish)) {
    return null;
  }

  const points = resolveEndpoints({ from: start, to: finish }, liveRects(doc));
  // Measured after the ends have been looked up, which is the only length that describes what would be
  // on the board: two ends fastened to shapes that are 3 units apart make a 3 unit arrow however far
  // the pointer travelled to get between them.
  if (!isConnectorLongEnough(points.from, points.to)) {
    return null;
  }

  const box = connectorBBox(points.from, points.to);
  const id = newId();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const object = new Y.Map<unknown>();
    object.set('type', CONNECTOR_TYPE);
    object.set('from', endpointValue(storedEnd(start, points.from)));
    object.set('to', endpointValue(storedEnd(finish, points.to)));
    // The box this arrow was drawn in, for a client that cannot derive one. An update event will
    // disagree with it as soon as either end's object moves, and that disagreement is the design.
    object.set('x', box.x);
    object.set('y', box.y);
    object.set('width', box.width);
    object.set('height', box.height);
    object.set('z', maxZ(objects) + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', by);
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move one end of an arrow: re-fasten it to another object, or set it free at a point.
 *
 * This is what a dragged end handle leaves behind when the pointer is let go (connector.reattach). The
 * other end is not read, changed or moved, which is what lets two people each drag one end of the same
 * arrow and see one arrow with two ends - the two writes are to different keys of one `Y.Map`, and Yjs
 * merges them the way it merges two people typing in two parts of one note.
 *
 * Refused, and nothing written:
 * - an id that is not on the board, or is not an arrow;
 * - an end that is not `from` or `to`, and an endpoint that is not an endpoint (a `NaN`, an unknown
 *   `kind`, an attached end with no fallback to fall back to);
 * - fastening this end to the object the *other* end is fastened to, which is TC-08's arrow-from-a-shape
 *   to-itself arriving by the other road; the handle is snapped back by whoever drew it;
 * - an arrow shorter than {@link CONNECTOR_MIN_LENGTH_WORLD} once the end is in place.
 *
 * @returns whether the end moved
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: End,
  endpoint: Endpoint,
): boolean {
  const object = connectorObject(objectsOf(doc), id);
  if (object === null) {
    return false;
  }
  // Typed as `End`, but a value that arrived over a wire has not read the type.
  if (!ENDS.includes(end)) {
    return false;
  }
  const next = readEndpoint(endpoint);
  if (next === null) {
    return false;
  }
  const other = readEndpoint(object.get(otherEnd(end)));
  if (other === null) {
    // The end that is not being moved cannot be read, so the arrow cannot be drawn and there is no
    // position for the end that is being moved to be right *relative to*. Not a thing to guess at.
    return false;
  }
  if (isSameObject(next, other)) {
    return false;
  }

  const ends: ConnectorEnds = end === 'from' ? { from: next, to: other } : { from: other, to: next };
  const points = resolveEndpoints(ends, liveRects(doc));
  if (!isConnectorLongEnough(points.from, points.to)) {
    return false;
  }
  const written = storedEnd(next, end === 'from' ? points.from : points.to);
  if (isSameEnd(object.get(end), written)) {
    // The end is already where it is being asked to go: not a change, so not an update on the wire
    // either - the difference between a handle released once and a handle released twenty times.
    return false;
  }
  doc.transact(() => {
    // The whole endpoint, not its innards: an endpoint is replaced as one piece so that no reader can
    // ever see an end that is half one object and half another.
    object.set(end, endpointValue(written));
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Free every arrow end fastened to an object that is going away.
 *
 * Called by the board model inside {@link deleteObjects}' own transaction, through
 * {@link onObjectsDeleted}: an arrow is not deleted with its shape, and its end is not left attached to
 * an id that no longer means anything. It becomes a `free` end, at the point it was *actually drawn* -
 * which is where the arrow does not move when the shape under one end of it vanishes.
 *
 * That is a choice, and the other choice is available in the same place: leave the end `attached` to the
 * id that is going, and the arrow is still drawn (at its fallback), and would fasten itself to the shape
 * again if an undo brought the shape back. What detaching buys is the difference between an arrow that
 * goes on following a shape that comes back and one that has finished following it: a person who deleted
 * the shape to get rid of it should not have an arrow dragged back to the place it was, by an undo meant
 * for something else. Deleting the *arrow* is undone by story 8 as usual; this is the arrow that stays.
 *
 * The anchors are read before the deletions happen, which is why this is called from inside the
 * transaction and not after it: after, the boxes are gone and every freed end would be left at a
 * fallback that was written when the arrow was made, possibly a long way from where it was drawn.
 *
 * Writes with the transaction it was handed rather than opening one of its own, so that the shape
 * leaving and the end coming loose are one change to the board - one update on the wire, one undo step.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: Iterable<string>): void {
  const ids = new Set<string>();
  for (const id of deletedIds) {
    if (typeof id === 'string' && id !== '') {
      ids.add(id);
    }
  }
  if (ids.size === 0) {
    return;
  }
  const objects = objectsOf(doc);
  // Read once, before anything is written: the boxes of the objects being deleted are still on the
  // board while the caller's transaction is open, and they are what the freed ends are left at.
  const all = snapshot(doc);
  const rects = boardRects(all);
  for (const object of all) {
    if (object.type !== CONNECTOR_TYPE) {
      continue;
    }
    const ends = endsOf(object);
    if (ends === null) {
      continue;
    }
    const loose = (endpoint: Endpoint): boolean =>
      endpoint.kind === 'attached' && ids.has(endpoint.objectId);
    if (!loose(ends.from) && !loose(ends.to)) {
      continue;
    }
    const points = resolveEndpoints(ends, rects);
    const raw = objects.get(object.id);
    if (raw === undefined || !(raw instanceof Y.Map) || storedEnds(raw) === null) {
      // Gone already, or not an arrow any more. There is nothing here to write to, and writing to what
      // is left would not make an arrow.
      continue;
    }
    if (loose(ends.from)) {
      raw.set('from', endpointValue({ kind: 'free', x: points.from.x, y: points.from.y }));
    }
    if (loose(ends.to)) {
      raw.set('to', endpointValue({ kind: 'free', x: points.to.x, y: points.to.y }));
    }
  }
}

/** The board model's hook: arrows come loose when what they are fastened to is deleted. */
function detachOnDelete(doc: Y.Doc, ids: readonly string[]): void {
  detachConnectorsTo(doc, ids);
}

/**
 * An arrow's two ends as the document holds them, or `null`.
 *
 * This is what a client that is about to *change* an end reads - the ends as stored, not as they would
 * be drawn. Nothing that draws an arrow should use it: drawing wants {@link resolveEndpoints} against
 * the boxes on the board, which is the question "where is this arrow now" rather than "what does this
 * arrow say".
 */
export function getConnectorEnds(doc: Y.Doc, id: string): ConnectorEnds | null {
  const object = connectorObject(objectsOf(doc), id);
  return object === null ? null : storedEnds(object);
}

/**
 * The object as an arrow, or `null` when the snapshot is of something else, or of an arrow this client
 * cannot draw.
 *
 * There is no default for an unreadable end, which is the difference between this function and
 * `asShapeSnapshot`: a shape written with a kind this client does not know is still a shape, and is
 * drawn as a rectangle, because a rectangle is what a shape is when nothing has been said about it. An
 * arrow with a missing end has no line to draw and no box to draw it in - and the alternative, a line
 * to `(0, 0)`, is an arrow pointing at a place nobody aimed at. Such an object stays in the document
 * untouched, and is not drawn, selected or hit.
 */
export function asConnectorSnapshot(object: ObjectSnapshot | undefined): ConnectorSnapshot | null {
  if (object === undefined || object.type !== CONNECTOR_TYPE) {
    return null;
  }
  const ends = endsOf(object);
  if (ends === null) {
    return null;
  }
  return {
    ...object,
    type: CONNECTOR_TYPE,
    from: ends.from,
    to: ends.to,
    createdBy: typeof object.createdBy === 'string' ? object.createdBy : undefined,
  };
}

/** The arrow's two ends as they are drawn now, given the boxes on the board now. */
export function connectorPoints(
  connector: ConnectorSnapshot,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return resolveEndpoints({ from: connector.from, to: connector.to }, rects);
}

// Everything this type can do to the board from the moment it is loaded: be read, be drawn where its
// ends are, and come loose from whatever is deleted. Below the functions they name, because a module's
// top level runs in order and `const` is not there yet before it has been.
registerObjectReader(CONNECTOR_TYPE);
registerDerivedBounds(CONNECTOR_TYPE, connectorBounds);
onObjectsDeleted(detachOnDelete);
