/**
 * The board document model: the Yjs schema and every mutation of board objects.
 *
 * Framework-free on purpose — the client imports it now, and from story 4 the
 * Durable Object imports the same module to validate and migrate the document.
 *
 * Schema (this becomes the persisted format of story 4 and the wire format of
 * story 3, hence `meta.schemaVersion`):
 *
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<string, Y.Map> where each value is
 *            { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 */
import * as Y from 'yjs';

import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/** Origin of every local transaction (story 8 undo, story 3 echo avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** An immutable view of one sticky note in the document. */
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

/** Schema version written into `meta.schemaVersion` (stories 3-4 migrate it). */
export const SCHEMA_VERSION = 1;

/** Names of the shared types the schema uses. */
export const META_MAP = 'meta';
export const OBJECTS_MAP = 'objects';

const OBJECT_KEYS = {
  type: 'type',
  x: 'x',
  y: 'y',
  color: 'color',
  text: 'text',
  z: 'z',
  createdAt: 'createdAt',
} as const;

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Only the six named colours are writable; anything else is rejected. */
export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

/** The `Y.Map` of a note, or undefined when the id is stale or not a note. */
function stickyMapOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const value = objectsOf(doc).get(id);
  if (!value || !(value instanceof Y.Map)) return undefined;
  if (value.get(OBJECT_KEYS.type) !== 'sticky') return undefined;
  return value;
}

/** Highest stacking value in the document, 0 when there is none. */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const value of objectsOf(doc).values()) {
    if (value instanceof Y.Map) {
      const z = value.get(OBJECT_KEYS.z);
      if (typeof z === 'number' && z > top) top = z;
    }
  }
  return top;
}

/**
 * Ensures `meta.schemaVersion` is set.
 * Never overwrites an existing version.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_MAP);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (the stored `x`/`y` are the top-left).
 * Returns the new id, or `''` when the input is rejected.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const x = at?.x;
  const y = at?.y;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isStickyColor(color)) return '';

  let id = '';
  doc.transact(() => {
    id = crypto.randomUUID();
    const map = new Y.Map<unknown>();
    map.set(OBJECT_KEYS.type, 'sticky');
    map.set(OBJECT_KEYS.x, x - STICKY_SIZE_WORLD / 2);
    map.set(OBJECT_KEYS.y, y - STICKY_SIZE_WORLD / 2);
    map.set(OBJECT_KEYS.color, color);
    map.set(OBJECT_KEYS.text, new Y.Text());
    // z = maxZ + 1 puts a new note on top of all other notes.
    map.set(OBJECT_KEYS.z, maxZ(doc) + 1);
    map.set(OBJECT_KEYS.createdAt, Date.now());
    objectsOf(doc).set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves a note to world `(x, y)`. False for stale ids or non-finite input. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const map = stickyMapOf(doc, id);
  if (!map) return false;
  if (map.get(OBJECT_KEYS.x) === x && map.get(OBJECT_KEYS.y) === y) return false;

  doc.transact(() => {
    map.set(OBJECT_KEYS.x, x);
    map.set(OBJECT_KEYS.y, y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Stacks the note above every other object. False when it is already top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const map = stickyMapOf(doc, id);
  if (!map) return false;
  const top = maxZ(doc);
  const z = map.get(OBJECT_KEYS.z);
  // Already topmost: no transaction, so story 3 sends nothing.
  if (typeof z === 'number' && z >= top) return false;

  doc.transact(() => {
    map.set(OBJECT_KEYS.z, top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Sets the note colour. False for stale ids and unknown colour names. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const map = stickyMapOf(doc, id);
  if (!map) return false;
  if (map.get(OBJECT_KEYS.color) === color) return false;

  doc.transact(() => {
    map.set(OBJECT_KEYS.color, color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes the object. False for unknown ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (!objects.has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, or undefined when there is no such note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = stickyMapOf(doc, id);
  const text = map?.get(OBJECT_KEYS.text);
  return text instanceof Y.Text ? text : undefined;
}

/** Reads one object, or undefined when it is unknown or too malformed to draw. */
function readObject(id: string, map: Y.Map<unknown>): StickySnapshot | undefined {
  if (map.get(OBJECT_KEYS.type) !== 'sticky') return undefined;
  const x = map.get(OBJECT_KEYS.x);
  const y = map.get(OBJECT_KEYS.y);
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;

  const color = map.get(OBJECT_KEYS.color);
  const text = map.get(OBJECT_KEYS.text);
  const z = map.get(OBJECT_KEYS.z);
  const createdAt = map.get(OBJECT_KEYS.createdAt);
  return {
    id,
    type: 'sticky',
    x,
    y,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: typeof z === 'number' ? z : 0,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}

/**
 * Immutable snapshot of every known object, sorted by `(z, id)` so equal `z`
 * values (possible once story 3 syncs) order identically on every client.
 * Objects with an unknown `type` are skipped for forward compatibility.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, map] of objectsOf(doc)) {
    if (!(map instanceof Y.Map)) continue;
    const note = readObject(id, map);
    if (note) notes.push(note);
  }
  // `(z, id)` is a total order, so every client paints the same stacking.
  notes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}

