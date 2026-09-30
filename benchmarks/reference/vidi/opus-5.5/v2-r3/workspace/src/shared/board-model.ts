// Board document model: the Yjs schema and every mutation on it.
// Framework-free so the Durable Object (story 4) can import it too.
//
// Y.Doc
//   meta:    Y.Map { schemaVersion }
//   objects: Y.Map<id, Y.Map { type, x, y, color, text: Y.Text, z, createdAt }>
import * as Y from 'yjs';
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/** Transaction origin for every local mutation (story 8 undo, story 3 echo filtering). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

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

const HALF = 2;

function meta(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

export function getObjectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return objects(doc);
}

export function isStickyColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, color);
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objects(doc).get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

function zOf(obj: Y.Map<unknown>): number {
  const z = obj.get('z');
  return isFiniteNumber(z) ? z : 0;
}

function maxZ(doc: Y.Doc, exceptId?: string): number {
  let max = 0;
  objects(doc).forEach((obj, id) => {
    if (id === exceptId || !(obj instanceof Y.Map)) return;
    max = Math.max(max, zOf(obj));
  });
  return max;
}

export function initDoc(doc: Y.Doc): void {
  if (meta(doc).has('schemaVersion')) return;
  doc.transact(() => {
    meta(doc).set('schemaVersion', BOARD_SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (world units), on top of all objects.
 * Returns the new id, or '' when `at` is not finite (nothing written).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y) || !isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / HALF);
    obj.set('y', at.y - STICKY_SIZE_WORLD / HALF);
    obj.set('color', color);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Sets an object's top-left position. */
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

/** Raises an object above all others. No-op (false) when already strictly topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = getObject(doc, id);
  if (!obj) return false;
  const others = maxZ(doc, id);
  if (zOf(obj) > others) return false;
  doc.transact(() => {
    obj.set('z', others + 1);
  }, LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = getObject(doc, id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (!objects(doc).has(id)) return false;
  doc.transact(() => {
    objects(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = getObject(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function toSticky(id: string, obj: Y.Map<unknown>): StickySnapshot | null {
  if (obj.get('type') !== 'sticky') return null;
  const x = obj.get('x');
  const y = obj.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const color = obj.get('color');
  const text = obj.get('text');
  const createdAt = obj.get('createdAt');
  return Object.freeze({
    id,
    type: 'sticky' as const,
    x,
    y,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: zOf(obj),
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  });
}

/** Immutable list of renderable objects sorted by (z, id); unknown types are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const list: StickySnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map)) return;
    const s = toSticky(id, obj);
    if (s) list.push(s);
  });
  list.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(list);
}
