/**
 * The board document model: the Yjs schema plus every mutation the UI can
 * perform on a board object.
 *
 * Framework-free on purpose — the Durable Object (story 4) imports this module
 * for validation and migration, and the client renders an immutable snapshot of
 * it. One successful mutation is one `doc.transact(fn, LOCAL_ORIGIN)`; rejected
 * mutations (stale id, unknown colour, non-finite coordinates, pointless
 * re-stacking) return before a transaction is opened, so they emit no update.
 *
 * Schema (this is the format story 4 persists and story 3 syncs):
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

/** Name of the `Y.Map` holding `{ schemaVersion }`. */
export const META_MAP = 'meta';
/** Name of the `Y.Map<id, Y.Map>` holding the board objects. */
export const OBJECTS_MAP = 'objects';
/** `meta.schemaVersion` written by {@link initDoc}. */
export const SCHEMA_VERSION = 1;
/** The only `type` value this story renders; unknown types are skipped. */
export const STICKY_TYPE = 'sticky';

/** Transaction origin of every local mutation (story 8 undo, story 3 echo guard). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** One sticky note, as rendered by the client. */
export interface StickySnapshot {
  id: string;
  type: 'sticky';
  /** Top-left corner in world units. */
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher is drawn on top. */
  z: number;
  createdAt: number;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** True when `value` is one of the six preset colour names. */
export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap(OBJECTS_MAP) as Y.Map<Y.Map<unknown>>;

/** The raw entry for `id`, or undefined when absent or of an unknown shape. */
function entryOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const value: unknown = objectsOf(doc).get(id);
  return value instanceof Y.Map && value.get('type') === STICKY_TYPE ? value : undefined;
}

/** Largest `z` in the document (0 when there are no objects). */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const value of objectsOf(doc).values()) {
    const z: unknown = value instanceof Y.Map ? value.get('z') : undefined;
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

/** Creates the document's root maps; sets `meta.schemaVersion` once. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_MAP);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
  // Touch the objects map so it exists in the document from the start.
  objectsOf(doc);
}

/**
 * Creates a sticky note centred on `at` (top-left = at − STICKY_SIZE_WORLD / 2)
 * on top of every other note. Returns the new id, or `false` when the point is
 * not a finite coordinate.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!at || !finite(at.x) || !finite(at.y)) return false;
  const id = crypto.randomUUID();
  const ytext = new Y.Text();
  const map = new Y.Map<unknown>();
  const z = maxZ(doc) + 1;
  doc.transact(() => {
    map.set('type', STICKY_TYPE);
    map.set('x', at.x - STICKY_SIZE_WORLD / 2);
    map.set('y', at.y - STICKY_SIZE_WORLD / 2);
    map.set('color', isStickyColor(color) ? color : DEFAULT_STICKY_COLOR);
    map.set('text', ytext);
    map.set('z', z);
    map.set('createdAt', Date.now());
    objectsOf(doc).set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves a note to world `(x, y)`. False when rejected or a no-op. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const map = entryOf(doc, id);
  if (!map) return false;
  if (!finite(x) || !finite(y)) return false;
  if (map.get('x') === x && map.get('y') === y) return false;
  doc.transact(() => {
    map.set('x', x);
    map.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Re-stacks a note above every other note. False when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const map = entryOf(doc, id);
  if (!map) return false;
  const z: unknown = map.get('z');
  const top = maxZ(doc);
  if (typeof z === 'number' && z >= top) return false;
  doc.transact(() => {
    map.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Changes only the colour of a note. False for a stale id or unknown colour. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const map = entryOf(doc, id);
  if (!map) return false;
  if (!isStickyColor(color)) return false;
  if (map.get('color') === color) return false;
  doc.transact(() => {
    map.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes an object. False when the id is unknown. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, or `undefined` when the id is not a sticky note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = entryOf(doc, id);
  const ytext: unknown = map?.get('text');
  return ytext instanceof Y.Text ? ytext : undefined;
}

/** Immutable snapshot of every known object, sorted by `(z, id)`. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, value] of objectsOf(doc)) {
    if (!(value instanceof Y.Map)) continue; // forward compatibility
    if (value.get('type') !== STICKY_TYPE) continue; // stories 9-12 objects
    const ytext: unknown = value.get('text');
    const color: unknown = value.get('color');
    notes.push({
      id,
      type: STICKY_TYPE,
      x: finite(value.get('x')) ? (value.get('x') as number) : 0,
      y: finite(value.get('y')) ? (value.get('y') as number) : 0,
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: ytext instanceof Y.Text ? ytext.toString() : '',
      z: finite(value.get('z')) ? (value.get('z') as number) : 0,
      createdAt: finite(value.get('createdAt')) ? (value.get('createdAt') as number) : 0,
    });
  }
  // `(z, id)` so two clients that merged equal z values still agree on order.
  notes.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return notes;
}
