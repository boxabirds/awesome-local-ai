// Board document model: the Yjs schema and every mutation the board performs.
//
// This module is the persisted and wire contract: story 3 attaches a network
// provider to this document and story 4 persists the same document, so the
// schema below is what ends up on disk and on the wire. It is framework-free
// (no React, no DOM) so the Durable Object can import it for validation and
// migration.
//
// Schema
//   meta:    Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map> where each object is
//     { type: 'sticky', x, y, width?, height?, color, text: Y.Text, z, createdAt }
//   (x, y) is the note's top-left in world units; higher z draws on top. A
//   sticky without stored width/height is STICKY_SIZE_WORLD wide and tall - the
//   fields arrive with the first resize (story 7), so no migration rewrites the
//   notes of every board ever made.
//
// Every successful mutation is exactly one transaction carrying LOCAL_ORIGIN, so
// story 8 can group them for undo and story 3 can skip its own echo. Rejected
// input (stale id, unknown colour, non-finite coordinate, already topmost) opens
// no transaction at all and returns false: never throws for user-driven input.
// The group operations (story 7) are the same rule for many objects at once:
// validate everything first, write all survivors in one transaction, report how
// many objects actually changed.

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';
import {
  objectBounds,
  rectContains,
  type Point,
  type Rect,
} from './geometry';

export { objectBounds, type Rect } from './geometry';

/** Transaction origin of every local mutation. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Version of the document schema written into `meta.schemaVersion`. */
export const SCHEMA_VERSION = 1;

const META = 'meta';
const OBJECTS = 'objects';
/** The object type this build ships; stories 9-12 add theirs to this name. */
/** The sticky note object type name; the constant lives in config, next to
 * the other settings the whole app shares. */
export { TYPE_STICKY } from './config';
import { TYPE_STICKY } from './config';

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
  createdAt: number;
}

/**
 * What the generic operations (bounds, marquee, group move) need from any
 * object. `width`/`height` are the stored size; absent means the type's
 * default, which objectBounds resolves. Story 2's StickySnapshot is one kind
 * of ObjectSnapshot.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
}

export interface PointLike {
  x: number;
  y: number;
}

type YObject = Y.Map<unknown>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(META);
}

function objectsMap(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>(OBJECTS);
}

/**
 * The object as a note the model owns, or null when it is absent, is another
 * type (stories 9-12 will add some), or is too damaged to draw. The type check
 * is what makes unknown types invisible rather than an error.
 */
function stickyMapOf(doc: Y.Doc, id: string): YObject | null {
  if (typeof id !== 'string' || id === '') return null;
  const object = objectsMap(doc).get(id);
  if (!(object instanceof Y.Map)) return null;
  if (object.get('type') !== TYPE_STICKY) return null;
  if (!(object.get('text') instanceof Y.Text)) return null;
  if (!isFiniteNumber(object.get('x'))) return null;
  if (!isFiniteNumber(object.get('y'))) return null;
  if (!isFiniteNumber(object.get('z'))) return null;
  return object;
}

/**
 * The object types whose fields this model understands. Select-all offers
 * these and only these: an object of a type this build does not know is not
 * something it can promise to move, resize or delete safely. Stories 9-12
 * add their types to the model, and to this set, as they add them here.
 */
const KNOWN_OBJECT_TYPES: ReadonlySet<string> = new Set<string>([TYPE_STICKY]);

/**
 * Any object entry this build can position and stack: a Y.Map with finite
 * x, y and z, of any type. The single-object sticky door (stickyMapOf) is
 * stricter; the group operations use this one, so a selection holding a type
 * from a newer story moves as well as a sticky does.
 */
function readableObject(doc: Y.Doc, id: string): YObject | null {
  if (typeof id !== 'string' || id === '') return null;
  const object = objectsMap(doc).get(id);
  if (!(object instanceof Y.Map)) return null;
  if (!isFiniteNumber(object.get('x'))) return null;
  if (!isFiniteNumber(object.get('y'))) return null;
  if (!isFiniteNumber(object.get('z'))) return null;
  return object;
}

/** Read one object; null when it is not a sticky this story can render. */
function readSticky(id: string, object: YObject): StickySnapshot | null {
  if (object.get('type') !== TYPE_STICKY) return null;
  const x = object.get('x');
  const y = object.get('y');
  const z = object.get('z');
  const text = object.get('text');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  if (!(text instanceof Y.Text)) return null;
  const color = object.get('color');
  const createdAt = object.get('createdAt');
  const width = object.get('width');
  const height = object.get('height');
  return {
    id,
    type: TYPE_STICKY,
    x,
    y,
    // a colour this build does not know (a newer client added one) keeps the
    // note visible on the default instead of hiding the user's idea
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text.toString(),
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    // the stored size when a resize wrote one; the implicit default otherwise
    ...(isFiniteNumber(width) ? { width } : {}),
    ...(isFiniteNumber(height) ? { height } : {}),
  };
}

/** Stacking order: z ascending, ids breaking ties so every client agrees. */
function compareStack(a: StickySnapshot, b: StickySnapshot): number {
  return a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Highest z on the board, 0 when there are no notes, so the first note gets z 1. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const object of objectsMap(doc).values()) {
    const z = object.get('z');
    if (isFiniteNumber(z) && z > max && object.get('type') === TYPE_STICKY) max = z;
  }
  return max;
}

/** Prepare a document for use: writes `meta.schemaVersion` when it is absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Add a note centred on `at` (the stored position is the top-left), on top of
 * every other note. Returns its id, or '' when the point is not usable.
 */
export function createSticky(doc: Y.Doc, at: PointLike, color?: StickyColor): string {
  if (
    at === null ||
    typeof at !== 'object' ||
    !isFiniteNumber(at.x) ||
    !isFiniteNumber(at.y)
  ) {
    return '';
  }
  const fill: StickyColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
  const id = newId();
  const z = maxZ(doc) + 1;
  const objects = objectsMap(doc);
  const half = STICKY_SIZE_WORLD / 2;
  doc.transact(() => {
    const object = new Y.Map<unknown>();
    object.set('type', TYPE_STICKY);
    object.set('x', at.x - half);
    object.set('y', at.y - half);
    object.set('color', fill);
    object.set('z', z);
    object.set('createdAt', Date.now());
    object.set('text', new Y.Text());
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note to a new top-left. False when the id or a coordinate is bad. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  // the single-object door stays sticky-only, exactly as before story 7
  if (stickyMapOf(doc, id) === null) return false;
  moveObjects(doc, new Map([[id, { x, y }]]));
  return true;
}

/**
 * Raise a note above every other one. False when it is already the topmost note,
 * so a drag that only jitters never emits a pointless sync update (story 3).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Recolour a note, touching nothing else. Unknown colour names are rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const object = stickyMapOf(doc, id);
  if (object === null) return false;
  if (object.get('color') === color) return true; // already that colour
  doc.transact(() => {
    object.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object from the board. False when there is nothing to remove. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

// --- Group operations (story 7) ---------------------------------------------
//
// The rules every group operation follows, learned from story 2:
//   - everything is validated before anything is written, so one bad entry
//     applies nothing (never half a selection);
//   - the survivors are written in exactly one transaction, which is one undo
//     unit for story 8 and one update for story 3;
//   - ids that vanished mid-gesture are skipped, and an entry whose stored
//     value already equals the target is not rewritten;
//   - the return value is how many objects actually changed, 0 for a call
//     that could do nothing, and no transaction is opened for it.

/**
 * The ids of every object in `objects` that lies entirely inside `rect`, in
 * the order given - the marquee's rule, decided by rectContains: an object
 * the rectangle only clips, or touches from outside, does not answer.
 */
export function objectsInRect(
  objects: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const ids: string[] = [];
  for (const object of objects) {
    if (rectContains(rect, objectBounds(object))) ids.push(object.id);
  }
  return ids;
}

/**
 * Every object id select-all may offer: known types only. An object of a type
 * this build does not know stays unselectable, exactly as it stays unrendered.
 */
export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  const ids: string[] = [];
  for (const object of objects) {
    if (KNOWN_OBJECT_TYPES.has(object.type)) ids.push(object.id);
  }
  return ids;
}

/**
 * Move many objects at once, each to its own absolute position: one
 * transaction for the whole group. A position that is not finite rejects the
 * entire call (returns 0, writes nothing); ids that are gone by the time the
 * group is written are skipped.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  const entries: [string, YObject, number, number][] = [];
  for (const [id, at] of positions) {
    if (
      at === null ||
      typeof at !== 'object' ||
      !isFiniteNumber(at.x) ||
      !isFiniteNumber(at.y)
    ) {
      return 0;
    }
    const object = readableObject(doc, id);
    if (object !== null) entries.push([id, object, at.x, at.y]);
  }

  const writes = entries.filter(
    ([, object, x, y]) => object.get('x') !== x || object.get('y') !== y,
  );
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [, object, x, y] of writes) {
      object.set('x', x);
      object.set('y', y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Resize many objects at once, each to its own absolute rect (position and
 * size together - a group resize moves objects as it scales them). One
 * transaction; a non-finite rect rejects the whole call; gone ids are skipped.
 * The first write to a sticky that never stored a size writes both fields, so
 * from then on its size is explicit.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  const entries: [string, YObject, Rect][] = [];
  for (const [id, rect] of rects) {
    if (
      rect === null ||
      typeof rect !== 'object' ||
      !isFiniteNumber(rect.x) ||
      !isFiniteNumber(rect.y) ||
      !isFiniteNumber(rect.width) ||
      !isFiniteNumber(rect.height)
    ) {
      return 0;
    }
    const object = readableObject(doc, id);
    if (object !== null) entries.push([id, object, rect]);
  }

  const writes = entries.filter(
    ([, object, rect]) =>
      object.get('x') !== rect.x ||
      object.get('y') !== rect.y ||
      object.get('width') !== rect.width ||
      object.get('height') !== rect.height,
  );
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [, object, rect] of writes) {
      object.set('x', rect.x);
      object.set('y', rect.y);
      object.set('width', rect.width);
      object.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Raise a whole selection above every object that is not in it, keeping the
 * selection's own relative order: z becomes maxUnselected + rank. One
 * transaction; gone ids are skipped; nothing is written when the group is
 * already on top in that order, so a drag that only jitters is silent.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const selected = new Set(ids);
  const group: [string, YObject, number][] = [];
  let maxUnselected = 0;

  for (const [id, object] of objectsMap(doc)) {
    if (!(object instanceof Y.Map)) continue;
    const z = object.get('z');
    if (!isFiniteNumber(z)) continue;
    if (selected.has(id)) group.push([id, object, z]);
    else if (z > maxUnselected) maxUnselected = z;
  }
  if (group.length === 0) return 0;

  // the same order the board draws them in: z ascending, ids breaking ties
  group.sort((a, b) => (a[2] !== b[2] ? a[2] - b[2] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const writes: [YObject, number][] = [];
  group.forEach(([, object, z], rank) => {
    const wanted = maxUnselected + rank + 1;
    if (z !== wanted) writes.push([object, wanted]);
  });
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [object, z] of writes) object.set('z', z);
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Remove many objects in one transaction (one undo unit). Ids that are not on
 * the board are skipped; the count of actual removals is returned.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsMap(doc);
  const present: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    if (objects.get(id) instanceof Y.Map) present.push(id);
  }
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/** The note's shared text, or undefined when the id is not a readable note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = stickyMapOf(doc, id);
  if (object === null) return undefined;
  const text = object.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Every renderable note, in draw order (bottom to top). Unknown types and
 * unreadable objects are skipped, so a newer client's shapes do not break this
 * renderer. The array is freshly built: callers memoise it.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, object] of objectsMap(doc)) {
    const note = readSticky(id, object);
    if (note !== null) notes.push(note);
  }
  notes.sort(compareStack);
  return notes;
}

/** Stacking comparator, exported for the renderer's own ordering checks. */
export function compareStacking(a: StickySnapshot, b: StickySnapshot): number {
  return compareStack(a, b);
}

/**
 * Every renderable note in the order it was created: the order the renderer puts
 * the notes in the DOM. `snapshot` answers which note is drawn on top; this
 * answers where each note lives. A note's element is never moved after it is
 * placed - the browser stacks it by its `z` value instead - because moving an
 * element that has the pointer captured ends the drag that is using it.
 */
export function snapshotByCreation(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, object] of objectsMap(doc)) {
    const note = readSticky(id, object);
    if (note !== null) notes.push(note);
  }
  return notes;
}

function newId(): string {
  const cryptoRef: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (cryptoRef !== undefined && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  // a deterministic-enough fallback for engines without crypto.randomUUID
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
