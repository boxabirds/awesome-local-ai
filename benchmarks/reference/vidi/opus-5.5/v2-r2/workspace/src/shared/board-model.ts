// Board document schema and every mutation on it. Framework-free: the client
// uses it now; the Durable Object (story 4) will import it for validation.
//
// Y.Doc
//   meta:    Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map { type, x, y, color, text: Y.Text, z, createdAt }>
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

/** Current document schema version, stored in `meta.schemaVersion`. */
export const SCHEMA_VERSION = 1;

/** Transaction origin for changes made by this client (story 3 echo filter, story 8 undo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

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

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

export function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

function zOf(obj: Y.Map<unknown>): number {
  const z = obj.get('z');
  return isFiniteNumber(z) ? z : 0;
}

function maxZ(doc: Y.Doc, exceptId?: string): number {
  let max = 0;
  for (const [id, obj] of objectsMap(doc)) {
    if (id === exceptId || !(obj instanceof Y.Map)) continue;
    max = Math.max(max, zOf(obj));
  }
  return max;
}

/** Sets `meta.schemaVersion` if absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (world units), above every other object.
 * Returns the new id, or `false` for non-finite coordinates or an unknown colour.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y) || !isStickyColor(color)) return false;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ(doc) + 1);
    note.set('createdAt', Date.now());
    objectsMap(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves an object's top-left to (x, y). False for stale ids, non-finite values or no change. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const obj = getObject(doc, id);
  if (!obj) return false;
  if (obj.get('x') === x && obj.get('y') === y) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Puts an object above all others. False for stale ids or when it is already strictly topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = getObject(doc, id);
  if (!obj) return false;
  const others = maxZ(doc, id);
  if (zOf(obj) > others) return false;
  doc.transact(() => obj.set('z', others + 1), LOCAL_ORIGIN);
  return true;
}

/** Changes a sticky note's colour. False for stale ids, non-stickies, unknown colours or no change. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = getObject(doc, id);
  if (!obj || obj.get('type') !== 'sticky' || obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

/** Removes an object. False for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (!objectsMap(doc).has(id)) return false;
  doc.transact(() => objectsMap(doc).delete(id), LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getObject(doc, id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function compareByStacking(a: StickySnapshot, b: StickySnapshot): number {
  if (a.z !== b.z) return a.z - b.z;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Immutable view of all sticky notes, sorted by (z, id). Unknown object types are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, obj] of objectsMap(doc)) {
    if (!(obj instanceof Y.Map) || obj.get('type') !== 'sticky') continue;
    const x = obj.get('x');
    const y = obj.get('y');
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;
    const color = obj.get('color');
    const text = obj.get('text');
    const createdAt = obj.get('createdAt');
    notes.push(
      Object.freeze({
        id,
        type: 'sticky' as const,
        x,
        y,
        color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
        text: text instanceof Y.Text ? text.toString() : '',
        z: zOf(obj),
        createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      }),
    );
  }
  return Object.freeze(notes.sort(compareByStacking));
}
