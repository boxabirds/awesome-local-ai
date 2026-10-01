import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

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

const SCHEMA_VERSION = 1;

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function isColor(c: string): c is StickyColor {
  return Object.prototype.hasOwnProperty.call(STICKY_COLORS, c);
}

function zOf(obj: Y.Map<unknown>): number {
  const z = obj.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((o) => {
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

/** Returns the new id, or '' when the coordinates are not finite (nothing is written). */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    objects(doc).set(id, obj);
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', isColor(color) ? color : DEFAULT_STICKY_COLOR);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
  }, LOCAL_ORIGIN);
  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const obj = objects(doc).get(id);
  if (!obj || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc).get(id);
  if (!obj) return false;
  let othersMax = 0;
  let hasOther = false;
  objects(doc).forEach((o, k) => {
    if (k === id) return;
    hasOther = true;
    othersMax = Math.max(othersMax, zOf(o));
  });
  if (!hasOther || zOf(obj) > othersMax) return false;
  doc.transact(() => obj.set('z', othersMax + 1), LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const obj = objects(doc).get(id);
  if (!obj || !isColor(color)) return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (!objects(doc).has(id)) return false;
  doc.transact(() => objects(doc).delete(id), LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const t = objects(doc).get(id)?.get('text');
  return t instanceof Y.Text ? t : undefined;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objects(doc).forEach((o, id) => {
    if (!(o instanceof Y.Map) || o.get('type') !== 'sticky') return;
    const text = o.get('text');
    const color = o.get('color') as string;
    out.push({
      id,
      type: 'sticky',
      x: Number(o.get('x')) || 0,
      y: Number(o.get('y')) || 0,
      color: isColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: zOf(o),
      createdAt: Number(o.get('createdAt')) || 0,
    });
  });
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
