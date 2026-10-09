import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

/**
 * The board document model: the Yjs schema plus every mutation the client performs
 * (and, from story 4, the Durable Object performs). Framework-free on purpose, and it
 * never throws for user-driven input: a rejected change returns `false` and opens no
 * transaction, so nothing is synced or persisted.
 *
 * Schema (the future persisted and wire contract, `meta.schemaVersion` = 1):
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string, Y.Map>
 *       <id>: Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 */

/** Transaction origin of everything this client does (story 8 undo, story 3 echo guard). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Schema version written to `meta.schemaVersion` by `initDoc`. */
export const SCHEMA_VERSION = 1;

/** Y.Map name holding `{ schemaVersion }`. */
export const META_MAP = 'meta';
/** Y.Map name holding `<id, Y.Map>`; `useBoardDoc` observes it deeply. */
export const OBJECTS_MAP = 'objects';

/** The object type this story's renderer knows; unknown types are skipped. */
export const STICKY_TYPE = 'sticky';

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  /** Top-left in world units. */
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher is drawn on top. */
  z: number;
  createdAt: number;
}

type YObject = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>(OBJECTS_MAP);
}

function metaOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META_MAP);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(point: { x: number; y: number } | undefined): point is { x: number; y: number } {
  return !!point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

/** Runtime colour validation: the doc can hold anything once story 3 syncs. */
export function isStickyColor(value: unknown): value is StickyColor {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(STICKY_COLORS, value)
  );
}

/**
 * `crypto.randomUUID` where available (browsers, Node 19+); the fallback only exists
 * for a jsdom/worker environment that withholds `crypto`, and is still collision-safe
 * enough for a single client (which is all this story has).
 */
function newId(): string {
  const cryptoRef: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (typeof cryptoRef?.randomUUID === 'function') return cryptoRef.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Highest `z` currently in the document (0 when there are no objects). */
function maxZ(objects: Y.Map<YObject>): number {
  let max = 0;
  objects.forEach((item) => {
    if (!(item instanceof Y.Map)) return;
    const z = item.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  });
  return max;
}

/**
 * Creates `meta` with `schemaVersion` when it is missing. Idempotent, so story 4 can
 * call it on every load.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = metaOf(doc);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Creates a yellow sticky note centred on `at` (world units): the stored `x`/`y` is
 * the top-left, i.e. `at` minus half `STICKY_SIZE_WORLD`. `z = maxZ + 1`, so a new note
 * is on top of every other one. Returns the new id, or `false` for a non-finite point
 * or an unknown colour.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!isPoint(at)) return false;
  if (!isStickyColor(color)) return false;
  const id = newId();
  const offset = STICKY_SIZE_WORLD / 2;
  doc.transact(() => {
    const objects = objectsOf(doc);
    const item = new Y.Map<unknown>();
    item.set('type', STICKY_TYPE);
    item.set('x', at.x - offset);
    item.set('y', at.y - offset);
    item.set('color', color);
    item.set('text', new Y.Text(''));
    item.set('z', maxZ(objects) + 1);
    item.set('createdAt', Date.now());
    objects.set(id, item);
  }, LOCAL_ORIGIN);
  return id;
}

/** True while `id` names an object in the document. */
export function objectExists(doc: Y.Doc, id: string): boolean {
  return id.length > 0 && objectsOf(doc).has(id);
}

function objectOf(doc: Y.Doc, id: string): YObject | undefined {
  if (!id) return undefined;
  const item = objectsOf(doc).get(id);
  return item instanceof Y.Map ? item : undefined;
}

/**
 * Writes a new top-left position (world units). Returns false for a stale id, a
 * non-finite coordinate, or when the position already is `x`/`y`.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const item = objectOf(doc, id);
  if (!item) return false;
  if (item.get('x') === x && item.get('y') === y) return false;
  doc.transact(() => {
    item.set('x', x);
    item.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raises `id` above every other object (`z = maxZ + 1`). Returns false for a stale id
 * or when the object is already topmost, so story 3 never syncs a pointless change.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const item = objectOf(doc, id);
  if (!item) return false;
  const objects = objectsOf(doc);
  const z = item.get('z');
  const top = maxZ(objects);
  // Already topmost (or unusable): no transaction, so story 3 syncs nothing.
  if (!isFiniteNumber(z) || z >= top) return false;
  doc.transact(() => {
    item.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets the note colour, leaving text, position, stacking and creation time untouched.
 * Returns false for a stale id, a non-sticky object, an unknown colour name, or when
 * the note already has that colour.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== STICKY_TYPE) return false;
  if (item.get('color') === color) return false;
  doc.transact(() => {
    item.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes the object (and its `Y.Text`) from the document. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const item = objectOf(doc, id);
  if (!item) return false;
  const objects = objectsOf(doc);
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, or undefined when the note is gone or not a sticky. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== STICKY_TYPE) return undefined;
  const text = item.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function readSticky(id: string, item: YObject): StickySnapshot | undefined {
  if (item.get('type') !== STICKY_TYPE) return undefined;
  const x = item.get('x');
  const y = item.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;
  const colorValue = item.get('color');
  const z = item.get('z');
  const createdAt = item.get('createdAt');
  const text = item.get('text');
  return {
    id,
    type: STICKY_TYPE,
    x,
    y,
    color: isStickyColor(colorValue) ? colorValue : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : '',
    z: isFiniteNumber(z) ? z : 0,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
}

/**
 * The immutable list of sticky notes to render, sorted by `(z, id)` so every client
 * paints the same order even when concurrent edits produce equal `z` values. Objects
 * of an unknown `type` (stories 9-12) are skipped rather than thrown about.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectsOf(doc).forEach((item, id) => {
    if (!(item instanceof Y.Map)) return;
    const note = readSticky(id, item);
    if (note) notes.push(note);
  });
  notes.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return notes;
}
