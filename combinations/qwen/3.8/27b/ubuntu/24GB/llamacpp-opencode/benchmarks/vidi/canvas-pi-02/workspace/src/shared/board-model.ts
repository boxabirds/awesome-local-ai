import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from './config';
import type { StickyColor } from './config';

/**
 * Board document model (story 2).
 *
 * All board content lives in a Yjs `Y.Doc` from day one: stories 3-4 will
 * attach a network provider and persistence to this same document. This
 * module owns the schema and every mutation; it is framework-free so the
 * Durable Object (story 4) can import it for validation and migration.
 *
 * Schema:
 * ```
 * Y.Doc
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map keyed by id; each value is a Y.Map with:
 *     type: 'sticky'
 *     x: number, y: number        // top-left, world units
 *     color: StickyColor
 *     text: Y.Text
 *     z: number                   // stacking; higher is on top
 *     createdAt: number           // epoch ms
 * ```
 *
 * Contract errors (stale id, unknown colour, non-finite coordinates) are
 * rejected with `false` (or `''` for createSticky) before opening a
 * transaction, so they emit no Yjs update and never throw.
 */

/** Transaction origin for all local mutations (story 8 undo / story 3 echo-avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.localOrigin');

/** Immutable view of one sticky note, as rendered by the client. */
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

/** Current schema version (the persisted and wire contract). */
const SCHEMA_VERSION = 1;

const META_KEY = 'meta';
const SCHEMA_VERSION_KEY = 'schemaVersion';
const OBJECTS_KEY = 'objects';

const TYPE_KEY = 'type';
const X_KEY = 'x';
const Y_KEY = 'y';
const COLOR_KEY = 'color';
const TEXT_KEY = 'text';
const Z_KEY = 'z';
const CREATED_AT_KEY = 'createdAt';

const STICKY_TYPE = 'sticky';

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

function objects(doc: Y.Doc): Y.Map<Y.Map<any>> {
  return doc.getMap(OBJECTS_KEY);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get(Z_KEY);
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/** Ensure the document's meta exists with `schemaVersion` set (once). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (meta.has(SCHEMA_VERSION_KEY)) return;
  doc.transact(() => {
    meta.set(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (top-left is `at - STICKY_SIZE_WORLD/2`),
 * on top of all existing objects. Returns the new id, or `''` when the
 * inputs are invalid (no transaction opened).
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: StickyColor): string {
  const chosen = color ?? DEFAULT_STICKY_COLOR;
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !isStickyColor(chosen)) return '';
  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set(TYPE_KEY, STICKY_TYPE);
  obj.set(X_KEY, at.x - STICKY_SIZE_WORLD / 2);
  obj.set(Y_KEY, at.y - STICKY_SIZE_WORLD / 2);
  obj.set(COLOR_KEY, chosen);
  obj.set(TEXT_KEY, new Y.Text());
  obj.set(Z_KEY, maxZ(doc) + 1);
  obj.set(CREATED_AT_KEY, Date.now());
  doc.transact(() => {
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move a note's top-left to (x, y). Returns false for a stale id or
 * non-finite coordinates (no transaction opened).
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const obj = objects(doc).get(id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set(X_KEY, x);
    obj.set(Y_KEY, y);
  }, LOCAL_ORIGIN);
  return true;
}

/** True when the object exists in the board doc. */
export function hasObject(doc: Y.Doc, id: string): boolean {
  return objects(doc).get(id) !== undefined;
}

/**
 * Raise a note above every other object. Returns false for a stale id or
 * when the note is already on top (no transaction opened).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc).get(id);
  if (!obj) return false;
  const top = maxZ(doc);
  const current = typeof obj.get(Z_KEY) === 'number' ? (obj.get(Z_KEY) as number) : 0;
  if (current >= top) return false; // already on top: no pointless sync traffic
  doc.transact(() => {
    obj.set(Z_KEY, top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Change a note's colour. Returns false for a stale id or a colour name
 * that is not one of STICKY_COLORS (no transaction opened).
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = objects(doc).get(id);
  if (!obj) return false;
  if (obj.get(COLOR_KEY) === color) return false; // no-op
  doc.transact(() => {
    obj.set(COLOR_KEY, color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note from the board. Returns false for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc).get(id);
  if (!obj) return false;
  doc.transact(() => {
    objects(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's Y.Text, if the note exists; undefined for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  if (!obj) return undefined;
  const text = obj.get(TEXT_KEY);
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshots of every sticky note, sorted by (z, id) so concurrent
 * equal z values (possible once story 3 syncs) give every client the same
 * render order. Objects with an unknown `type` are skipped.
 */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    if (obj.get(TYPE_KEY) !== STICKY_TYPE) return; // unknown type: forward compatible
    const color = obj.get(COLOR_KEY);
    const text = obj.get(TEXT_KEY);
    out.push({
      id,
      type: STICKY_TYPE,
      x: asNumber(obj.get(X_KEY), 0),
      y: asNumber(obj.get(Y_KEY), 0),
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: asNumber(obj.get(Z_KEY), 0),
      createdAt: asNumber(obj.get(CREATED_AT_KEY), 0),
    });
  });
  // (z, id) gives every client the same order even with concurrent equal z values.
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
