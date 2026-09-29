// Board document schema and every mutation of it. Framework-free: the Durable Object
// (story 4) imports this module for validation and migration.
//
// Y.Doc
//   meta:    Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }>
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

/** Transaction origin of changes made by this client (used by undo and sync in later stories). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');
export const SCHEMA_VERSION = 1;

export interface StickySnapshot {
  readonly id: string;
  readonly type: 'sticky';
  /** Top-left corner, world units. */
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
  /** Stacking order; higher is on top. */
  readonly z: number;
  /** Epoch milliseconds. */
  readonly createdAt: number;
}

type ObjectMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('objects');
}

function getObject(doc: Y.Doc, id: string): ObjectMap | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map ? (obj as ObjectMap) : undefined;
}

function zOf(obj: ObjectMap): number {
  const z = obj.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsOf(doc).forEach((obj) => {
    if (obj instanceof Y.Map) max = Math.max(max, zOf(obj as ObjectMap));
  });
  return max;
}

export function isStickyColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && Object.hasOwn(STICKY_COLORS, color);
}

/** Sets `meta.schemaVersion` if absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.has('schemaVersion')) return;
  doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (world units), on top of every other object.
 * Returns the new id, or `false` for non-finite coordinates or an unknown colour.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !isStickyColor(color)) return false;
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
    objectsOf(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

export function hasObject(doc: Y.Doc, id: string): boolean {
  return getObject(doc, id) !== undefined;
}

/** Moves an object's top-left to (x, y). False for a stale id, non-finite coordinates or no change. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const obj = getObject(doc, id);
  if (!obj || (obj.get('x') === x && obj.get('y') === y)) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raises an object above all others. False for a stale id or when it is already strictly on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = getObject(doc, id);
  if (!obj) return false;
  const z = zOf(obj);
  let othersMax = -Infinity;
  objectsOf(doc).forEach((other, otherId) => {
    if (otherId !== id && other instanceof Y.Map)
      othersMax = Math.max(othersMax, zOf(other as ObjectMap));
  });
  if (othersMax < z) return false;
  doc.transact(() => obj.set('z', othersMax + 1), LOCAL_ORIGIN);
  return true;
}

/** Changes only the colour. False for a stale id, a non-sticky object, an unknown colour or no change. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = getObject(doc, id);
  if (!obj || obj.get('type') !== 'sticky' || obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (!getObject(doc, id)) return false;
  doc.transact(() => objectsOf(doc).delete(id), LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = getObject(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Immutable sticky notes sorted by (z, id); unknown or malformed objects are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectsOf(doc).forEach((value, id) => {
    if (!(value instanceof Y.Map)) return;
    const obj = value as ObjectMap;
    if (obj.get('type') !== 'sticky') return;
    const x = obj.get('x');
    const y = obj.get('y');
    if (typeof x !== 'number' || typeof y !== 'number') return;
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
        createdAt: typeof createdAt === 'number' ? createdAt : 0,
      }),
    );
  });
  notes.sort((a, b) => a.z - b.z || compareIds(a.id, b.id));
  return Object.freeze(notes);
}
