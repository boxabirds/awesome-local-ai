import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

const SCHEMA_VERSION = 1;
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

type ObjectMap = Y.Map<unknown>;

const objectsOf = (doc: Y.Doc) => doc.getMap<ObjectMap>('objects');

function isColor(c: unknown): c is StickyColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, c);
}

function zOf(obj: ObjectMap): number {
  const z = obj.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsOf(doc).forEach((o) => {
    max = Math.max(max, zOf(o));
  });
  return max;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
  }
}

/** Creates a note whose centre is `at`. Returns the new id, or false for non-finite coordinates. */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !isColor(color)) return false;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj: ObjectMap = new Y.Map();
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
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objectsOf(doc).get(id);
  if (!obj) return false;
  const top = maxZ(doc);
  let atTop = 0;
  objectsOf(doc).forEach((o) => {
    if (zOf(o) === top) atTop++;
  });
  // Already uniquely topmost: nothing to do.
  if (zOf(obj) === top && atTop === 1) return false;
  doc.transact(() => obj.set('z', top + 1), LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const obj = objectsOf(doc).get(id);
  if (!obj || !isColor(color)) return false;
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
  const out: StickySnapshot[] = [];
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map) || obj.get('type') !== 'sticky') return;
    const text = obj.get('text');
    const color = obj.get('color');
    const x = obj.get('x');
    const y = obj.get('y');
    out.push({
      id,
      type: 'sticky',
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
      color: isColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: zOf(obj),
      createdAt: Number(obj.get('createdAt')) || 0,
    });
  });
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
