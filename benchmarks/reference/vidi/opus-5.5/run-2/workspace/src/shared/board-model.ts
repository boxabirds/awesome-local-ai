/**
 * Board document schema and every mutation on it (anchor: board.model).
 *
 * Framework-free: the client uses it now; the Durable Object imports it from story 4
 * for validation and migration.
 *
 *   Y.Doc
 *     meta:    Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<id, Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }>
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`. Rejections
 * (stale id, unknown colour, non-finite numbers, no-op) return `false` before opening a
 * transaction, so no Yjs update is emitted. Nothing here throws for user-driven input.
 */
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

/** Transaction origin for changes made by this client (used by undo and sync later). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

export const SCHEMA_VERSION = 1;
const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const STICKY_TYPE = 'sticky';
const HALF = 2;
/** z of the first object on an empty board is FIRST_Z (= 0 + 1). */
const EMPTY_BOARD_MAX_Z = 0;

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

type ObjectMap = Y.Map<unknown>;

function objects(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap<ObjectMap>(OBJECTS_KEY);
}

export function isStickyColor(value: string): value is StickyColor {
  return Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function finite(...values: number[]): boolean {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function zOf(obj: ObjectMap): number {
  const z = obj.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : EMPTY_BOARD_MAX_Z;
}

function maxZ(doc: Y.Doc): number {
  let max = EMPTY_BOARD_MAX_Z;
  objects(doc).forEach((obj) => {
    max = Math.max(max, zOf(obj));
  });
  return max;
}

/** Sets meta.schemaVersion when absent. Emits no update when already initialised. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META_KEY);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (world units), above every other object.
 * Returns the new id, or '' (and changes nothing) for non-finite coordinates.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!finite(at.x, at.y) || !isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', STICKY_TYPE);
    note.set('x', at.x - STICKY_SIZE_WORLD / HALF);
    note.set('y', at.y - STICKY_SIZE_WORLD / HALF);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ(doc) + 1);
    note.set('createdAt', Date.now());
    objects(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves an object's top-left to (x, y) in world units. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const obj = objects(doc).get(id);
  if (obj === undefined || !finite(x, y)) return false;
  if (obj.get('x') === x && obj.get('y') === y) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Puts an object strictly above all others. No update when it already is. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const map = objects(doc);
  const obj = map.get(id);
  if (obj === undefined) return false;
  const own = zOf(obj);
  let othersMax = Number.NEGATIVE_INFINITY;
  map.forEach((other, otherId) => {
    if (otherId !== id) othersMax = Math.max(othersMax, zOf(other));
  });
  if (own > othersMax) return false;
  doc.transact(() => obj.set('z', othersMax + 1), LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const obj = objects(doc).get(id);
  if (obj === undefined || obj.get('type') !== STICKY_TYPE || !isStickyColor(color)) return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const map = objects(doc);
  if (!map.has(id)) return false;
  doc.transact(() => map.delete(id), LOCAL_ORIGIN);
  return true;
}

/** True while an object with this id exists in the document. */
export function hasObject(doc: Y.Doc, id: string): boolean {
  return objects(doc).has(id);
}

/** Calls `onChange` after every change to any object (deep); returns an unsubscribe. */
export function observeObjects(doc: Y.Doc, onChange: () => void): () => void {
  const map = objects(doc);
  const handler = () => onChange();
  map.observeDeep(handler);
  return () => map.unobserveDeep(handler);
}

/** True when `ytext` can no longer be edited (its note was deleted). */
export function isDetachedText(ytext: Y.Text): boolean {
  return ytext.doc === null || ytext._item?.deleted === true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = objects(doc).get(id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function readSticky(id: string, obj: ObjectMap): StickySnapshot | null {
  if (obj.get('type') !== STICKY_TYPE) return null;
  const x = obj.get('x');
  const y = obj.get('y');
  const z = obj.get('z');
  const color = obj.get('color');
  const text = obj.get('text');
  const createdAt = obj.get('createdAt');
  if (typeof x !== 'number' || typeof y !== 'number' || !finite(x, y)) return null;
  return Object.freeze({
    id,
    type: STICKY_TYPE,
    x,
    y,
    color: typeof color === 'string' && isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: typeof z === 'number' && Number.isFinite(z) ? z : EMPTY_BOARD_MAX_Z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  });
}

/** Immutable list of sticky notes sorted by (z, id); unknown object types are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map)) return;
    const note = readSticky(id, obj);
    if (note !== null) notes.push(note);
  });
  notes.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(notes);
}
