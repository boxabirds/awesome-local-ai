/**
 * The board document model: the Yjs schema plus every mutation the app can
 * perform on board objects.
 *
 * This module is deliberately framework-free (no React, no DOM) so that the
 * Durable Object from story 4 can import it for validation and migration, and
 * so that story 3 can attach a network provider to the very same document.
 *
 * Schema (this is the future persisted and wire format, hence `meta`):
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string, Y.Map>
 *       <id>: Y.Map {
 *         type: 'sticky'
 *         x: number, y: number   // top-left, world units
 *         color: StickyColor
 *         text: Y.Text
 *         z: number              // stacking order, higher is on top
 *         createdAt: number      // epoch ms
 *       }
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
 * every rejection (stale id, unknown colour, non-finite number, pointless
 * no-op) returns `false` **before** a transaction is opened, so it produces no
 * update and therefore no sync traffic. The module never throws for
 * user-driven input.
 */

import * as Y from 'yjs';

import {
  DEFAULT_STICKY_COLOR,
  isStickyColor,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config.js';

/** Origin of every local transaction (story 8 undo, story 3 echo avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Name of the document metadata map. */
export const DOC_META_MAP = 'meta';
/** Name of the object map. */
export const DOC_OBJECTS_MAP = 'objects';
/** Schema version written into `meta` (story 4 migrates from this number). */
export const SCHEMA_VERSION = 1;
/** The only object type this story knows; stories 9-12 add others. */
export const STICKY_TYPE = 'sticky';

/** Field names inside one object map. */
export const OBJECT_FIELDS = {
  type: 'type',
  x: 'x',
  y: 'y',
  color: 'color',
  text: 'text',
  z: 'z',
  createdAt: 'createdAt',
} as const;

/** An immutable view of one sticky note, as rendered by the client. */
export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

/** Objects map, typed as the map-of-maps it is. */
type ObjectsMap = Y.Map<Y.Map<unknown>>;

const objectsOf = (doc: Y.Doc): ObjectsMap =>
  doc.getMap<Y.Map<unknown>>(DOC_OBJECTS_MAP) as unknown as ObjectsMap;

const metaOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>(DOC_META_MAP);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const readStickyMap = (objects: ObjectsMap, id: string): Y.Map<unknown> | undefined => {
  const map = objects.get(id);
  if (!(map instanceof Y.Map)) return undefined;
  if (map.get(OBJECT_FIELDS.type) !== STICKY_TYPE) return undefined;
  return map;
};

/** Highest z in the document (0 when there are no objects). */
function maxZ(objects: ObjectsMap): number {
  let max = 0;
  objects.forEach((map) => {
    if (!(map instanceof Y.Map)) return;
    const z = map.get(OBJECT_FIELDS.z);
    if (isFiniteNumber(z) && z > max) max = z;
  });
  return max;
}

/** A unique object id. `crypto.randomUUID` is available in browser and worker. */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Environment without the Web Crypto helper: still unique, just not a UUID.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Prepare a document for use. Idempotent: it never rewrites the schema version
 * of a document that already has one, so reopening a stored document (story 4)
 * does not produce an update.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = metaOf(doc);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (its stored position is the top-left,
 * `at - STICKY_SIZE_WORLD / 2`), on top of every other object (z = maxZ + 1).
 *
 * Returns the new id, or `false` when the point is not finite or the colour is
 * not one of the six.
 */
export function createSticky(
  doc: Y.Doc,
  at: WorldPoint,
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return false;
  if (!isStickyColor(color)) return false;

  const objects = objectsOf(doc);
  const z = maxZ(objects) + 1;
  const id = newId();

  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set(OBJECT_FIELDS.type, STICKY_TYPE);
    map.set(OBJECT_FIELDS.x, at.x - STICKY_SIZE_WORLD / 2);
    map.set(OBJECT_FIELDS.y, at.y - STICKY_SIZE_WORLD / 2);
    map.set(OBJECT_FIELDS.color, color);
    map.set(OBJECT_FIELDS.text, new Y.Text());
    map.set(OBJECT_FIELDS.z, z);
    map.set(OBJECT_FIELDS.createdAt, Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move an object to a new top-left, in world units. `false` for a stale id or
 * a non-finite coordinate; a move to the position it already has is a no-op.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const map = readStickyMap(objectsOf(doc), id);
  if (!map) return false;
  if (map.get(OBJECT_FIELDS.x) === x && map.get(OBJECT_FIELDS.y) === y) return false;

  doc.transact(() => {
    map.set(OBJECT_FIELDS.x, x);
    map.set(OBJECT_FIELDS.y, y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Stack an object above every other one. Returns `false` when the object is
 * unknown or is already topmost, so a drag that grabs the top note costs no
 * sync traffic (story 3) and story 8's undo has nothing to undo.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const map = readStickyMap(objects, id);
  if (!map) return false;
  const z = map.get(OBJECT_FIELDS.z);
  const top = maxZ(objects);
  if (isFiniteNumber(z) && z >= top) return false;

  doc.transact(() => {
    map.set(OBJECT_FIELDS.z, top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Change a sticky's colour. Only the `color` field is written: text, position
 * and stacking are untouched, so the note keeps its place in every sense.
 * Unknown colour names and stale ids return `false` and write nothing.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const map = readStickyMap(objectsOf(doc), id);
  if (!map) return false;
  if (map.get(OBJECT_FIELDS.color) === color) return false;

  doc.transact(() => {
    map.set(OBJECT_FIELDS.color, color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. `false` when the id does not exist (nothing to delete). */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (!(objects.get(id) instanceof Y.Map)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The shared text of a sticky note, for text editing (`applyTextDiff` writes
 * the minimal change into it). `undefined` when there is no such note.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = readStickyMap(objectsOf(doc), id);
  if (!map) return undefined;
  const text = map.get(OBJECT_FIELDS.text);
  return text instanceof Y.Text ? text : undefined;
}

/** Read one object map into a snapshot, or `undefined` when it is not a note. */
function readSnapshot(id: string, map: Y.Map<unknown>): StickySnapshot | undefined {
  if (map.get(OBJECT_FIELDS.type) !== STICKY_TYPE) return undefined;

  const x = map.get(OBJECT_FIELDS.x);
  const y = map.get(OBJECT_FIELDS.y);
  const z = map.get(OBJECT_FIELDS.z);
  const color = map.get(OBJECT_FIELDS.color);
  const createdAt = map.get(OBJECT_FIELDS.createdAt);
  const text = map.get(OBJECT_FIELDS.text);

  // A malformed object is skipped rather than rendered: a document written by
  // a future version must not take the whole board down.
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;
  if (!isStickyColor(color)) return undefined;

  return {
    id,
    type: 'sticky',
    x,
    y,
    color,
    text: text instanceof Y.Text ? text.toString() : '',
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
}

/**
 * Every sticky note as an immutable array, sorted by (z, id) so that two notes
 * with the same z (possible once story 3 syncs concurrent creates) still draw
 * in the same order on every client. Objects of an unknown `type` are skipped:
 * forward compatibility for stories 9-12.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectsOf(doc).forEach((map, id) => {
    if (!(map instanceof Y.Map)) return;
    const note = readSnapshot(id, map);
    if (note) notes.push(note);
  });
  notes.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return notes;
}
