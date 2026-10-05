/**
 * The board document model: the Yjs schema plus every mutation the app can
 * perform on board content.
 *
 * The document is the single source of truth for board content, in this story
 * held in memory only. Story 3 attaches a network provider to the same document
 * and story 4 persists it, which is why the schema carries `meta.schemaVersion`
 * and every mutation runs in one transaction tagged with `LOCAL_ORIGIN`.
 *
 * Schema:
 *   meta:    Y.Map { schemaVersion: number }
 *   objects: Y.Map<id, Y.Map> where each object Y.Map holds
 *            type: string          ('sticky' today; unknown types are ignored)
 *            x, y: number          (top-left, world units)
 *            color: StickyColor    (sticky only)
 *            text: Y.Text          (sticky only)
 *            z: number             (stacking; higher is drawn on top)
 *            createdAt: number     (epoch ms)
 *
 * Rules that every mutation follows:
 *  - invalid input (stale id, unknown colour, non-finite coordinate) returns
 *    `false` *before* a transaction is opened, so a rejection costs no update
 *    and no sync traffic;
 *  - a successful mutation is exactly one `doc.transact(..., LOCAL_ORIGIN)`;
 *  - nothing here throws for user-driven input.
 *
 * Framework-free on purpose: the Durable Object (story 4) imports this module
 * for validation and migration, so it must never touch React or the DOM.
 */

import * as Y from 'yjs';
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor
} from './config';

/** Transaction origin for changes made by this client (story 8 undo, story 3 echo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** The object type this story renders; unknown types are skipped (stories 9-12). */
export const STICKY_OBJECT_TYPE = 'sticky';

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

export interface PointLike {
  readonly x: number;
  readonly y: number;
}

type ObjMap = Y.Map<unknown>;

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Is `color` one of the six preset colour names? */
export function isStickyColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && (COLOR_NAMES as string[]).includes(color);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The document's object map, creating it if the doc has never been initialised. */
function objectsOf(doc: Y.Doc): Y.Map<ObjMap> {
  return doc.getMap('objects') as Y.Map<ObjMap>;
}

function metaOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

function objectMap(doc: Y.Doc, id: string): ObjMap | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const value = objectsOf(doc).get(id);
  return value instanceof Y.Map ? (value as ObjMap) : undefined;
}

/** The highest `z` in the document, or 0 when there are no objects. */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const object of objectsOf(doc).values()) {
    const z = object.get('z');
    if (isFiniteNumber(z) && z > top) top = z;
  }
  return top;
}

/** Create the document's maps and set `meta.schemaVersion` if it is absent. */
export function initDoc(doc: Y.Doc): void {
  // Creating a Y.Map is a no-op when it already exists, and writing the version
  // inside one transaction keeps an empty doc to a single update.
  doc.transact(() => {
    const meta = metaOf(doc);
    objectsOf(doc);
    if (typeof meta.get('schemaVersion') !== 'number') {
      meta.set('schemaVersion', BOARD_SCHEMA_VERSION);
    }
  }, LOCAL_ORIGIN);
}

/**
 * Add a sticky note centred on `at` (the stored top-left is `at` minus half the
 * note size), on top of every other note. Returns the new id, or '' when the
 * coordinates are not finite numbers.
 */
export function createSticky(doc: Y.Doc, at: PointLike, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return '';
  if (!isStickyColor(color)) return '';

  const id = createId();
  const top = maxZ(doc) + 1;
  doc.transact(() => {
    const object = new Y.Map<unknown>();
    object.set('type', STICKY_OBJECT_TYPE);
    object.set('x', at.x - STICKY_SIZE_WORLD / 2);
    object.set('y', at.y - STICKY_SIZE_WORLD / 2);
    object.set('color', color);
    object.set('text', new Y.Text());
    object.set('z', top);
    object.set('createdAt', Date.now());
    objectsOf(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note to a new top-left. False for a stale id or non-finite numbers. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const object = objectMap(doc, id);
  if (!object) return false;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  doc.transact(() => {
    object.set('x', x);
    object.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Give a note the highest `z`. False when it is already topmost or missing. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const object = objectMap(doc, id);
  if (!object) return false;
  const top = maxZ(doc);
  const current = object.get('z');
  // Already on top: a write here would be a pointless update on the wire.
  if (isFiniteNumber(current) && current >= top) return false;
  doc.transact(() => {
    object.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's colour. False for a stale id or an unknown colour name. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const object = objectMap(doc, id);
  if (!object) return false;
  if (!isStickyColor(color)) return false;
  if (object.get('color') === color) return false;
  doc.transact(() => {
    object.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. False for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const object = objectMap(doc, id);
  if (!object) return false;
  doc.transact(() => {
    objectsOf(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, or undefined when the id is not a sticky note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = objectMap(doc, id);
  if (!object || object.get('type') !== STICKY_OBJECT_TYPE) return undefined;
  const text = object.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** Read one object into an immutable snapshot, or null when it is not renderable. */
function readObject(id: string, object: ObjMap): StickySnapshot | null {
  if (object.get('type') !== STICKY_OBJECT_TYPE) return null;
  const color = object.get('color');
  const text = object.get('text');
  const createdAt = object.get('createdAt');
  return {
    id,
    type: STICKY_OBJECT_TYPE as 'sticky',
    x: isFiniteNumber(object.get('x')) ? (object.get('x') as number) : 0,
    y: isFiniteNumber(object.get('y')) ? (object.get('y') as number) : 0,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: isFiniteNumber(object.get('z')) ? (object.get('z') as number) : 0,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0
  };
}

/**
 * Immutable view of every known object, sorted by (z, id). `id` breaks ties so
 * two clients that sync equal `z` values still render the same order. Unknown
 * `type` values are skipped, which is what lets stories 9-12 ship later without
 * breaking this renderer.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, object] of objectsOf(doc)) {
    if (!(object instanceof Y.Map)) continue;
    const read = readObject(id, object as ObjMap);
    if (read) notes.push(read);
  }
  notes.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return notes;
}

/** `crypto.randomUUID` with a fallback for environments without WebCrypto. */
function createId(): string {
  const cryptoRef = typeof crypto === 'undefined' ? undefined : crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  const random = Math.random().toString(36).slice(2, 10);
  return `id-${Date.now().toString(36)}-${random}`;
}
