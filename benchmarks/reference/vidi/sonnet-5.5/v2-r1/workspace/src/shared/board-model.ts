import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from './config';
import type { StickyColor } from './config';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

export const SCHEMA_VERSION = 1;
const HALF = 2;

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

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) meta.set('schemaVersion', SCHEMA_VERSION);
}

function isColor(color: string): color is StickyColor {
  return Object.prototype.hasOwnProperty.call(STICKY_COLORS, color);
}

function maxZ(doc: Y.Doc, excludeId?: string): number {
  let max = 0;
  objectsOf(doc).forEach((obj, id) => {
    const z = obj.get('z');
    if (id !== excludeId && typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/** Creates a sticky centred on `at`. Returns the new id, or false when the input is rejected. */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !isColor(color)) return false;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    objectsOf(doc).set(id, obj);
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / HALF);
    obj.set('y', at.y - STICKY_SIZE_WORLD / HALF);
    obj.set('color', color);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
  }, LOCAL_ORIGIN);
  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const obj = objectsOf(doc).get(id);
  if (!obj || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (obj.get('x') === x && obj.get('y') === y) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objectsOf(doc).get(id);
  if (!obj) return false;
  const others = maxZ(doc, id);
  const z = obj.get('z');
  if (typeof z === 'number' && z > others) return false;
  doc.transact(() => obj.set('z', others + 1), LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const obj = objectsOf(doc).get(id);
  if (!obj || !isColor(color) || obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (!objectsOf(doc).has(id)) return false;
  doc.transact(() => objectsOf(doc).delete(id), LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = objectsOf(doc).get(id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const result: StickySnapshot[] = [];
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map) || obj.get('type') !== 'sticky') return;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return;
    const text = obj.get('text');
    const color = obj.get('color');
    const createdAt = obj.get('createdAt');
    result.push({
      id,
      type: 'sticky',
      x,
      y,
      color: typeof color === 'string' && isColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z,
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
    });
  });
  return result.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
