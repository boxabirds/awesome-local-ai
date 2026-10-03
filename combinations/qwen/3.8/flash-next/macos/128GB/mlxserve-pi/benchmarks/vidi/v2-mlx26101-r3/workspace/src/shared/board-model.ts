import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

/**
 * The board document schema and every mutation of it.
 *
 * This module is framework-free on purpose: the client renders a snapshot of it today,
 * story 3 syncs the same document between peers and story 4 persists it (the Durable
 * Object imports this file to validate and migrate), so the shape below is the wire and
 * storage contract from the start.
 *
 * ```text
 * Y.Doc
 *   meta: Y.Map    { schemaVersion: 1 }
 *   objects: Y.Map<string /* id *\/, Y.Map>
 *     <id>: Y.Map {
 *       type: 'sticky'
 *       x: number, y: number   // top-left, world units
 *       color: StickyColor
 *       text: Y.Text
 *       z: number              // stacking; higher is on top
 *       createdAt: number      // epoch ms
 *     }
 * ```
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`; a rejected
 * mutation (stale id, unknown colour, non-finite coordinates, pointless re-stack) returns
 * `false` before a transaction is opened, so it emits no update and will cost no sync
 * traffic in story 3. The module never throws for user-driven input.
 */

/** Origin of every local mutation; story 8 uses it for undo, story 3 to avoid echo. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Document schema version written by {@link initDoc}. */
export const SCHEMA_VERSION = 1;

/** Names of the top-level shared types of the document. */
export const META_MAP = 'meta';
export const OBJECTS_MAP = 'objects';

/** The `type` discriminator of a sticky note. Unknown values are skipped by the reader. */
export const STICKY_TYPE = 'sticky';

export interface StickySnapshot {
  readonly id: string;
  readonly type: 'sticky';
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
  readonly z: number;
  readonly createdAt: number;
}

/** Point in world units. */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

type YObject = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>(OBJECTS_MAP);
}

/** True for one of the six colour names (runtime check: values arrive from the wire). */
export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

/** A member of `objects` that this version of the client knows how to render. */
function stickyObject(objects: Y.Map<YObject>, id: string): YObject | null {
  const object = objects.get(id);
  if (object === undefined || !(object instanceof Y.Map) || object.get('type') !== STICKY_TYPE) {
    return null;
  }
  return object;
}

function readZ(object: YObject): number {
  const z = object.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

/** Highest stacking order in the document; 0 for an empty one. */
function maxZ(objects: Y.Map<YObject>): number {
  let max = 0;
  for (const object of objects.values()) {
    if (object instanceof Y.Map && object.get('type') === STICKY_TYPE) {
      max = Math.max(max, readZ(object));
    }
  }
  return max;
}

/**
 * Ids are `crypto.randomUUID()`, so notes created offline by different peers (story 3)
 * never collide. The fallback only runs where the Web Crypto UUID helper is missing.
 */
function newId(): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoObject?.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

/**
 * Prepare a document for use, recording the schema version once. An existing version -
 * including one written by a newer client - is left alone, so loading a stored document
 * never rewrites its metadata.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>(META_MAP);
  if (typeof meta.get('schemaVersion') === 'number') {
    return;
  }
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Add a sticky note centred on `at` (the stored `x`/`y` are the top-left, hence the
 * half-size offset) and on top of every existing note.
 *
 * @returns the new id, or `''` when the point or colour was rejected.
 */
export function createSticky(
  doc: Y.Doc,
  at: WorldPoint,
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFinitePoint(at.x, at.y) || !isStickyColor(color)) {
    return '';
  }
  const id = newId();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const object = new Y.Map<unknown>();
    object.set('type', STICKY_TYPE);
    object.set('x', at.x - STICKY_SIZE_WORLD / 2);
    object.set('y', at.y - STICKY_SIZE_WORLD / 2);
    object.set('color', color);
    object.set('text', new Y.Text());
    object.set('z', maxZ(objects) + 1);
    object.set('createdAt', Date.now());
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move a note to a new top-left, in world units. Moving a note onto the position it
 * already has is a no-op (`false`), which keeps drag frames from emitting updates.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinitePoint(x, y)) {
    return false;
  }
  const object = stickyObject(objectsOf(doc), id);
  if (object === null) {
    return false;
  }
  if (object.get('x') === x && object.get('y') === y) {
    return false;
  }
  doc.transact(() => {
    object.set('x', x);
    object.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Stack a note above every other one. Returns `false` when it is already on top, so a
 * drag that grabs the top note costs no update.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const object = stickyObject(objects, id);
  if (object === null) {
    return false;
  }
  const top = maxZ(objects);
  if (readZ(object) === top) {
    return false;
  }
  doc.transact(() => {
    object.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Change a note's colour, leaving text, position, stacking and creation time untouched.
 * Unknown colour names and stale ids are rejected.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) {
    return false;
  }
  const object = stickyObject(objectsOf(doc), id);
  if (object === null || object.get('color') === color) {
    return false;
  }
  doc.transact(() => {
    object.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note (and with it its `Y.Text`). A stale id is rejected. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (stickyObject(objects, id) === null) {
    return false;
  }
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The note's text as a `Y.Text`, so typing merges character-wise with other peers
 * (story 3) instead of overwriting them. `undefined` for a stale or foreign object.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = stickyObject(objectsOf(doc), id);
  const text = object?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** Read one note, or `null` when a peer wrote something this client cannot render. */
function readSticky(id: string, object: YObject): StickySnapshot | null {
  const x = object.get('x');
  const y = object.get('y');
  const color = object.get('color');
  const text = object.get('text');
  const z = object.get('z');
  const createdAt = object.get('createdAt');
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !isStickyColor(color) ||
    !(text instanceof Y.Text) ||
    typeof z !== 'number' ||
    !Number.isFinite(z)
  ) {
    return null;
  }
  return {
    id,
    type: 'sticky',
    x,
    y,
    color,
    text: text.toString(),
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}

/**
 * Render order: notes sorted by `(z, id)`. The id tie-break matters as soon as two peers
 * stack at the same time (story 3): equal `z` values still give every client the same
 * order. Objects of unknown `type` - the shapes and frames of later stories - and
 * malformed notes are skipped rather than thrown on.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, object] of objectsOf(doc).entries()) {
    if (!(object instanceof Y.Map) || object.get('type') !== STICKY_TYPE) {
      continue;
    }
    const note = readSticky(id, object);
    if (note !== null) {
      notes.push(note);
    }
  }
  notes.sort(compareNotes);
  return notes;
}

function compareNotes(a: StickySnapshot, b: StickySnapshot): number {
  if (a.z !== b.z) {
    return a.z - b.z;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
