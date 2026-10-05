/**
 * The board document model: the Yjs schema and every mutation to it, in one
 * framework-free module.
 *
 * The document is the single source of truth for what is on the board from
 * story 2 onwards, and it is deliberately the *same* document stories 3 and 4
 * sync and persist — hence `meta.schemaVersion`, and hence every successful
 * mutation being exactly one `doc.transact(fn, LOCAL_ORIGIN)`: one transaction
 * is one sync message and one undo step.
 *
 * Because of that the model is framework-free (no React, no DOM): story 4's
 * Durable Object imports this file to validate and migrate documents.
 *
 * Errors are values, never exceptions. A mutation that cannot be applied —
 * stale id, unknown colour, non-finite coordinates, a no-op that would only
 * produce pointless sync traffic — returns `false` and opens no transaction.
 *
 * Schema (see the design's "Document schema"):
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<string, Y.Map> where each value is
 *            { type: 'sticky', x, y, color, text: Y.Text, z, createdAt, width?, height? }
 * `x`/`y` are the note's top-left in world units; render order sorts by
 * `(z, id)` so clients that merged equal `z` values still agree on stacking.
 * `width`/`height` are only there once a note has been resized: a note without them
 * is `STICKY_SIZE_WORLD` square, which is what every note written before story 7 is.
 *
 * Story 7 added the group operations (`moveObjects`, `resizeObjects`,
 * `deleteObjects`, `bringObjectsToFront`) which work on any object in the document,
 * known or not, and the selection queries (`objectsInRect`, `allObjectIds`,
 * `objectBounds`) which work on a snapshot. The single-object functions story 2 used
 * are thin wrappers over them, so there is one write path and a group of one is
 * spelled the old way.
 */
import * as Y from 'yjs';

import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from './config';
import { rectContains, type Point, type Rect } from './geometry';
import type { StickyColor } from './config';

/** Origin of every local mutation; stories 3 and 8 filter on it. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** The schema this build writes; bumped when the document shape changes. */
export const SCHEMA_VERSION = 1;

/** Object discriminator stored on every object. */
export const STICKY_OBJECT_TYPE = 'sticky';

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const STICKY_TYPE = STICKY_OBJECT_TYPE;

/**
 * `createSticky` returns the new id, or this when the note could not be
 * created. It is falsy, so a caller that ignores the failure cannot end up
 * selecting or editing a note that does not exist.
 */
export const NO_ID = '';

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  /** Always a size, even for a note that stores none: the setting is the fallback. */
  width: number;
  height: number;
}

/**
 * Any object the board can hold, as the document reports it.
 *
 * Sticky notes are the only type this build writes; the fields that belong to a sticky
 * note alone (`color`, `text`) are optional here, and a `StickySnapshot` is this shape
 * with them required. Every selection and transform operation is written against this
 * type, which is what "the same behaviour for every object type" means at this level:
 * stories 9-12 add a type to the registry and get moving, resizing, raising and
 * deleting for nothing.
 */
export interface ObjectSnapshot {
  id: string;
  /** `'sticky'` today; `'shape'`, `'text'`, `'drawing'` when those stories arrive. */
  type: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
  width: number;
  height: number;
  color?: StickyColor;
  text?: string;
}

type ObjectsMap = Y.Map<Y.Map<unknown>>;

function objectsOf(doc: Y.Doc): ObjectsMap {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/** True for the six known colour names; anything else is not a colour we store. */
export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

/**
 * Whether an object is a sticky note, and so has the two fields only a note has.
 *
 * The board hands out `ObjectSnapshot`s, because the board does not know which types exist — that is the
 * registry's business, and the document model sits below it. Anything that is about sticky notes in
 * particular (a colour swatch, a note's text, a test that counts notes) asks this instead of assuming
 * that everything on the board is a note, which is the one thing that stops being true from here on.
 */
export function isStickySnapshot(object: ObjectSnapshot): object is StickySnapshot {
  return object.type === STICKY_OBJECT_TYPE;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function stickyOf(objects: ObjectsMap, id: string): Y.Map<unknown> | undefined {
  if (id === NO_ID) return undefined;
  const note = objects.get(id);
  if (!(note instanceof Y.Map) || note.get('type') !== STICKY_TYPE) return undefined;
  return note;
}

/**
 * Any object by id, of whatever type, as long as it says what type it is.
 *
 * The group operations are written against this rather than against `stickyOf`, so
 * a move, a resize, a raise and a delete reach a shape or a drawing the same way they
 * reach a note, without this file knowing anything about those types (a later story
 * adds them to the registry, not to these functions).
 */
function objectOf(objects: ObjectsMap, id: string): Y.Map<unknown> | undefined {
  if (id === NO_ID) return undefined;
  const object = objects.get(id);
  if (!(object instanceof Y.Map) || typeof object.get('type') !== 'string') return undefined;
  return object;
}

/** Highest `z` in the document (0 when empty); counts every object, known or not. */
function highestZ(objects: ObjectsMap): number {
  let max = 0;
  for (const object of objects.values()) {
    if (!(object instanceof Y.Map)) continue;
    const z = object.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

function textOf(note: Y.Map<unknown>): Y.Text | undefined {
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Prepare a document for use: records the schema version if it is not there
 * yet. Idempotent, so attaching to a document that arrives from storage or
 * from another client (stories 3-4) changes nothing.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>(META_KEY);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (the stored `x`/`y` is the top-left, so
 * the point is offset by half the note) and on top of every other object.
 *
 * Returns the new id, or `NO_ID` when the point is not a usable position.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!finite(at?.x) || !finite(at?.y)) return NO_ID;

  const objects = objectsOf(doc);
  const id = newId();
  const note = new Y.Map<unknown>();
  const z = highestZ(objects) + 1;

  doc.transact(() => {
    note.set('type', STICKY_TYPE);
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    // An unknown colour would be unreadable data, not a note worth keeping:
    // a new note always starts in a colour the board can render.
    note.set('color', isStickyColor(color) ? color : DEFAULT_STICKY_COLOR);
    note.set('text', new Y.Text(''));
    note.set('z', z);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move objects to absolute world positions (their top-left becomes the point given).
 *
 * Absolute rather than "by this much": a gesture that wrote its own running total
 * would land two people who moved the same object at once in two different places,
 * because each would be adding to what it last saw. Writing where each object belongs
 * means the last writer wins and every screen ends up agreeing with it. The positions
 * are absolute too, so a frame that arrives late cannot move anything twice.
 *
 * One transaction for the whole group. Ids that are not in the document are skipped
 * (a colleague may have deleted one while the pointer was down), and so is a write of
 * a position an object already has. A position that is not a real number refuses the
 * whole call: half a group moved is a group with something in the wrong place.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const point of positions.values()) {
    if (!finite(point?.x) || !finite(point?.y)) return 0;
  }

  const objects = objectsOf(doc);
  const targets: { object: Y.Map<unknown>; x: number; y: number }[] = [];
  for (const [id, point] of positions) {
    const object = objectOf(objects, id);
    if (!object) continue;
    if (object.get('x') === point.x && object.get('y') === point.y) continue;
    targets.push({ object, x: point.x, y: point.y });
  }
  if (targets.length === 0) return 0;

  doc.transact(() => {
    for (const target of targets) {
      target.object.set('x', target.x);
      target.object.set('y', target.y);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Give objects a size, and the position that goes with it.
 *
 * This is the operation that turns a note written before story 7 into a resized one:
 * a note with no `width`/`height` renders at the setting, and the first resize writes
 * both fields, so nothing has to be migrated and a board that is never resized keeps
 * the bytes it was written with.
 *
 * As in `moveObjects`: one transaction, missing ids skipped, no write that changes
 * nothing, and a rect that is not a real rectangle (non-finite, or without a positive
 * size) refuses the whole call.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const rect of rects.values()) {
    if (
      !finite(rect?.x) ||
      !finite(rect?.y) ||
      !finite(rect?.width) ||
      !finite(rect?.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return 0;
    }
  }

  const objects = objectsOf(doc);
  const targets: { object: Y.Map<unknown>; rect: Rect }[] = [];
  for (const [id, rect] of rects) {
    const object = objectOf(objects, id);
    if (!object) continue;
    if (
      object.get('x') === rect.x &&
      object.get('y') === rect.y &&
      object.get('width') === rect.width &&
      object.get('height') === rect.height
    ) {
      continue;
    }
    targets.push({ object, rect });
  }
  if (targets.length === 0) return 0;

  doc.transact(() => {
    for (const target of targets) {
      target.object.set('x', target.rect.x);
      target.object.set('y', target.rect.y);
      target.object.set('width', target.rect.width);
      target.object.set('height', target.rect.height);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Raise a group of objects above every object that is not in the group, keeping the
 * order they already had among themselves.
 *
 * The group is sorted by its current stacking (ties by id, which is the order the
 * screen draws them in) and given the numbers straight above the highest unselected
 * object, one per object in that order. The numbers are computed before anything is
 * written, and nothing at all is written when every object already has the number it
 * would be given — so a gesture that raises its selection once per drag, or one that
 * is still firing frames, produces no sync traffic for a stack that has not changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = objectsOf(doc);
  const selected = new Set<string>();
  for (const id of ids) {
    if (objectOf(objects, id)) selected.add(id);
  }
  if (selected.size === 0) return 0;

  let highestUnselected = 0;
  for (const [id, object] of objects) {
    if (!(object instanceof Y.Map) || selected.has(id)) continue;
    const z = object.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > highestUnselected) highestUnselected = z;
  }

  const entries: { id: string; object: Y.Map<unknown>; z: number }[] = [];
  for (const id of selected) {
    const object = objects.get(id);
    if (!(object instanceof Y.Map)) continue;
    const z = object.get('z');
    entries.push({ id, object, z: typeof z === 'number' && Number.isFinite(z) ? z : 0 });
  }
  entries.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const targets: { object: Y.Map<unknown>; z: number }[] = [];
  entries.forEach((entry, rank) => {
    const z = highestUnselected + rank + 1;
    if (entry.z === z) return;
    targets.push({ object: entry.object, z });
  });
  if (targets.length === 0) return 0;

  doc.transact(() => {
    for (const target of targets) target.object.set('z', target.z);
  }, LOCAL_ORIGIN);
  return targets.length;
}

/** Remove objects from the board, in one transaction however many there are. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = objectsOf(doc);
  const present = ids.filter((id) => id !== NO_ID && objects.has(id));
  if (present.length === 0) return 0;

  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/** The rectangle an object occupies in world units. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = finite(obj?.width) && obj.width > 0 ? obj.width : STICKY_SIZE_WORLD;
  const height = finite(obj?.height) && obj.height > 0 ? obj.height : STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width, height };
}

/**
 * The ids of the objects that lie entirely inside a rectangle — the marquee's rule,
 * and deliberately strict: an object the rectangle only touches, or covers half of,
 * is not selected. An object that is partly inside stays unselected, which is the
 * difference between drawing a box around things and drawing a box over them.
 */
export function objectsInRect(
  objects: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  if (!finite(rect?.x) || !finite(rect?.y) || !finite(rect?.width) || !finite(rect?.height)) return [];
  return objects
    .filter((object) => rectContains(rect, objectBounds(object)))
    .map((object) => object.id);
}

/**
 * Every object that can be selected, which is every object the board knows the type
 * of: a snapshot skips what it cannot render, so select-all on a document written by
 * a later story chooses the objects this build can actually move and delete rather
 * than everything in it.
 */
export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  return objects.map((object) => object.id);
}

/** Move a note to a world position. Its top-left becomes `(x, y)`. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/**
 * Raise a note above every other object. A note that is already the unique
 * topmost object changes nothing and returns false, so a drag that keeps
 * firing `bringToFront` cannot generate continuous sync traffic in story 3.
 * With a tie for the top (two clients that both picked `maxZ + 1`) there is
 * still a real change to make, so it is applied.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) === 1;
}

/**
 * Change a note's colour and nothing else: text, position, stacking, creation
 * time and (being local) the selection all stay as they were. Unknown colour
 * names and stale ids are rejected.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;

  const note = stickyOf(objectsOf(doc), id);
  if (!note || note.get('color') === color) return false;

  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

/**
 * The note's text as a `Y.Text`, so typing merges character-by-character once
 * the board is shared. Returns undefined for a note that does not exist.
 * A note whose text field is missing or of the wrong type (a document written
 * by a future story) is repaired in place, so the editor always has something
 * to write to.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = objectsOf(doc);
  const note = stickyOf(objects, id);
  if (!note) return undefined;

  const text = textOf(note);
  if (text) return text;

  const replacement = new Y.Text('');
  doc.transact(() => {
    note.set('text', replacement);
  }, LOCAL_ORIGIN);
  return replacement;
}

function readSticky(id: string, note: Y.Map<unknown>): StickySnapshot | null {
  const x = note.get('x');
  const y = note.get('y');
  const z = note.get('z');
  if (!finite(x) || !finite(y) || !finite(z)) return null;

  const storedColor = note.get('color');
  const text = textOf(note);
  const createdAt = note.get('createdAt');

  return Object.freeze({
    id,
    type: 'sticky' as const,
    x,
    y,
    // A colour from a future story must not hide the note: fall back to the default
    // colour rather than dropping user content.
    color: isStickyColor(storedColor) ? storedColor : DEFAULT_STICKY_COLOR,
    text: text ? text.toString() : '',
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    ...readSize(note),
  });
}

/**
 * The notes to render, in stacking order: ascending `z`, ties broken by id so
 * every client renders the same order even after a merge produced equal `z`.
 * Objects of a `type` this build does not know are skipped, which keeps this
 * build able to open a document written by a later story (shapes, arrows, text)
 * without losing it — and is why select-all cannot choose an object the board
 * cannot draw.
 *
 * The arrays and note objects are frozen: React renders from them and nothing
 * downstream may edit a snapshot in place.
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  for (const [id, object] of objectsOf(doc)) {
    if (!(object instanceof Y.Map)) continue;
    const type = object.get('type');
    if (typeof type !== 'string' || !isKnownObjectType(type)) continue;
    const read = type === STICKY_TYPE ? readSticky(id, object) : readObject(id, object, type);
    if (read) objects.push(read);
  }
  objects.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(objects);
}

/**
 * The object types this document model can read into a snapshot.
 *
 * Sticky notes are in it from the start; a later story adds its own type through the
 * client registry, which calls this so the document model knows to report those objects
 * and the client knows how to draw them. A type nobody registered is not broken, it is
 * simply not selectable or movable by this build — which is the same rule as before,
 * told in one place.
 */
const knownObjectTypes = new Set<string>([STICKY_TYPE]);

/** Tell the document model that objects of this type are ones it can report. */
export function registerKnownObjectType(type: string): void {
  if (typeof type !== 'string' || type === '') throw new Error('an object type needs a name');
  knownObjectTypes.add(type);
}

/** Whether `snapshot` reports objects of this type. */
export function isKnownObjectType(type: string): boolean {
  return knownObjectTypes.has(type);
}

/**
 * An object of a type this build can hold but not draw: everything the board needs in
 * order to select it, move it, resize it, raise it and delete it, and nothing of what
 * it would need to paint it (which is the registry's, in the client).
 */
function readObject(id: string, object: Y.Map<unknown>, type: string): ObjectSnapshot | null {
  const x = object.get('x');
  const y = object.get('y');
  const z = object.get('z');
  if (!finite(x) || !finite(y) || !finite(z)) return null;

  const createdAt = object.get('createdAt');
  const size = readSize(object);

  return Object.freeze({ id, type, x, y, z, createdAt: typeof createdAt === 'number' ? createdAt : 0, ...size });
}

/**
 * The stored size of an object, or the size the board was built at. A board written
 * before story 7 stores no sizes at all; those objects are not of unknown size, they
 * are of the default size, so the setting is read in here rather than migrated out to
 * every board ever made.
 */
function readSize(object: Y.Map<unknown>): { width: number; height: number } {
  const width = object.get('width');
  const height = object.get('height');
  return {
    width: finite(width) && width > 0 ? width : STICKY_SIZE_WORLD,
    height: finite(height) && height > 0 ? height : STICKY_SIZE_WORLD,
  };
}

/** `crypto.randomUUID()`, with a fallback for environments without WebCrypto. */
function newId(): string {
  const cryptoRef = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  return `note-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
}
