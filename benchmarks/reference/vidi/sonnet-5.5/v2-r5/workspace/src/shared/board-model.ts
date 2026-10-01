import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');
export const SCHEMA_VERSION = 1;
const HALF = 2;

export interface StickySnapshot {
  id: string; type: 'sticky'; x: number; y: number; color: StickyColor; text: string; z: number; createdAt: number;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
  }
}

function isColor(c: unknown): c is StickyColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, c);
}

function zOf(obj: Y.Map<unknown>): number {
  const z = obj.get('z');
  return typeof z === 'number' ? z : 0;
}

function maxZ(doc: Y.Doc, exceptId?: string): number {
  let max = 0;
  objectsOf(doc).forEach((obj, id) => {
    if (id !== exceptId && obj instanceof Y.Map) max = Math.max(max, zOf(obj));
  });
  return max;
}

/** Returns the new id, or false when the coordinates are not finite numbers. */
export function createSticky(
  doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR,
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

function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const obj = getObject(doc, id);
  if (!obj || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (obj.get('x') === x && obj.get('y') === y) return false;
  doc.transact(() => { obj.set('x', x); obj.set('y', y); }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = getObject(doc, id);
  if (!obj) return false;
  const others = maxZ(doc, id);
  if (zOf(obj) > others) return false;
  doc.transact(() => obj.set('z', others + 1), LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const obj = getObject(doc, id);
  if (!obj || !isColor(color) || obj.get('color') === color) return false;
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

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map) || obj.get('type') !== 'sticky') return;
    const x = obj.get('x');
    const y = obj.get('y');
    const color = obj.get('color');
    const text = obj.get('text');
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const createdAt = obj.get('createdAt');
    out.push({
      id, type: 'sticky', x, y,
      color: isColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: zOf(obj),
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
    });
  });
  return out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
