/**
 * The board document: Yjs schema and every mutation on it.
 *
 * Framework-free so the Durable Object (story 4) can import it for validation and migration.
 * This schema is the future persisted format (story 4) and wire format (story 3):
 *
 *   Y.Doc
 *     meta:    Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<id, Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }>
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`. Rejected calls
 * (stale id, unknown colour, non-finite numbers, no-ops) return false before opening a
 * transaction, so they emit no update. Nothing here throws for user-driven input.
 */
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

/** Transaction origin for changes made by this client (story 3 uses it to avoid echo, story 8 for undo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

export const SCHEMA_VERSION = 1;
const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const STICKY_TYPE = 'sticky';
const HALF = 2;
/** z of the first object on an empty board is FIRST_Z. */
const FIRST_Z = 1;

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

function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap<ObjectMap>(OBJECTS_KEY);
}

function objectOf(doc: Y.Doc, id: string): ObjectMap | undefined {
  const value: unknown = objectsOf(doc).get(id);
  return value instanceof Y.Map ? (value as ObjectMap) : undefined;
}

function isStickyColor(color: string): color is StickyColor {
  return Object.prototype.hasOwnProperty.call(STICKY_COLORS, color);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Highest z among all objects, or FIRST_Z - 1 when the board is empty. */
function maxZ(doc: Y.Doc): number {
  let max = FIRST_Z - 1;
  objectsOf(doc).forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const z = finiteNumber(value.get('z'));
    if (z !== undefined && z > max) max = z;
  });
  return max;
}

/** Sets meta.schemaVersion when absent (a no-op on an already initialised doc). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META_KEY);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
}

/**
 * Creates a sticky centred on world point `at`, on top of every other object.
 * Returns the new id, or '' (no transaction) when `at` is not finite.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  const safeColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    objectsOf(doc).set(id, note);
    note.set('type', STICKY_TYPE);
    note.set('x', at.x - STICKY_SIZE_WORLD / HALF);
    note.set('y', at.y - STICKY_SIZE_WORLD / HALF);
    note.set('color', safeColor);
    note.set('text', new Y.Text());
    note.set('z', maxZ(doc) + 1);
    note.set('createdAt', Date.now());
  }, LOCAL_ORIGIN);
  return id;
}

/** True when an object with this id is on the board. */
export function hasObject(doc: Y.Doc, id: string): boolean {
  return objectOf(doc, id) !== undefined;
}

/** Moves an object's top-left to world (x, y). False for stale ids, non-finite values and no-ops. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const obj = objectOf(doc, id);
  if (!obj) return false;
  if (obj.get('x') === x && obj.get('y') === y) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Puts an object above all others. False (no update) when it is already alone on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objectOf(doc, id);
  if (!obj) return false;
  const z = finiteNumber(obj.get('z'));
  let top = FIRST_Z - 1;
  objectsOf(doc).forEach((value, key) => {
    if (key === id || !(value instanceof Y.Map)) return;
    const other = finiteNumber(value.get('z'));
    if (other !== undefined && other > top) top = other;
  });
  // Strictly above every other object already: nothing to do (and nothing to sync).
  if (z !== undefined && z > top) return false;
  const next = top + 1;
  doc.transact(() => obj.set('z', next), LOCAL_ORIGIN);
  return true;
}

/** Changes a sticky's colour. False for stale ids, unknown colours and the current colour. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = objectOf(doc, id);
  if (!obj || obj.get('type') !== STICKY_TYPE || obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

/** Removes an object. False for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (!objectsOf(doc).has(id)) return false;
  doc.transact(() => objectsOf(doc).delete(id), LOCAL_ORIGIN);
  return true;
}

/** The shared text of a sticky, or undefined for stale ids and non-sticky objects. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objectOf(doc, id);
  if (!obj || obj.get('type') !== STICKY_TYPE) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function readSticky(id: string, value: unknown): StickySnapshot | undefined {
  if (!(value instanceof Y.Map) || value.get('type') !== STICKY_TYPE) return undefined;
  const x = finiteNumber(value.get('x'));
  const y = finiteNumber(value.get('y'));
  if (x === undefined || y === undefined) return undefined;
  const rawColor = value.get('color');
  const text = value.get('text');
  return {
    id,
    type: STICKY_TYPE,
    x,
    y,
    color: typeof rawColor === 'string' && isStickyColor(rawColor) ? rawColor : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: finiteNumber(value.get('z')) ?? FIRST_Z - 1,
    createdAt: finiteNumber(value.get('createdAt')) ?? 0,
  };
}

/** Immutable view of the board sorted by (z, id); unknown or malformed objects are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectsOf(doc).forEach((value, id) => {
    const note = readSticky(id, value);
    if (note) notes.push(note);
  });
  notes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}
