/**
 * Board document model: the Yjs schema and all mutations.
 *
 * Framework-free so the Durable Object and the client both import the same code.
 * One `doc.transact(fn, LOCAL_ORIGIN)` per successful mutation.
 *
 * Schema:
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map>
 *     <id>: Y.Map { type, x, y, color, text: Y.Text, z, createdAt }
 */
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, type StickyColor } from './config';

export const LOCAL_ORIGIN: unique symbol = Symbol('LOCAL_ORIGIN');

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

export const SCHEMA_VERSION = 1;

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }
}

function objects(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects');
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFinitePoint(at.x, at.y)) return '';
  const obj = objects(doc);
  const id = crypto.randomUUID();
  const item = new Y.Map<any>();
  item.set('type', 'sticky');
  item.set('x', at.x);
  item.set('y', at.y);
  item.set('color', color);
  item.set('text', new Y.Text());
  item.set('z', nextZ(obj));
  item.set('createdAt', Date.now());
  doc.transact(() => {
    obj.set(id, item);
  }, LOCAL_ORIGIN);
  return id;
}

function nextZ(obj: Y.Map<any>): number {
  let max = 0;
  obj.forEach((item) => {
    const z = (item.get('z') as number) ?? 0;
    if (z > max) max = z;
  });
  return max + 1;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinitePoint(x, y)) return false;
  const item = objects(doc).get(id);
  if (!item) return false;
  doc.transact(() => {
    item.set('x', x);
    item.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc);
  const item = obj.get(id);
  if (!item) return false;
  let max = 0;
  obj.forEach((i) => {
    const z = (i.get('z') as number) ?? 0;
    if (z > max) max = z;
  });
  const z = (item.get('z') as number) ?? 0;
  if (z >= max) return false; // already topmost: no pointless sync traffic
  doc.transact(() => {
    item.set('z', max + 1);
  }, LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!(color in STICKY_COLORS)) return false;
  const item = objects(doc).get(id);
  if (!item) return false;
  doc.transact(() => {
    item.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc);
  if (!obj.has(id)) return false;
  doc.transact(() => {
    obj.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const item = objects(doc).get(id);
  if (!item) return undefined;
  return item.get('text') as Y.Text | undefined;
}

/** All stickies sorted by (z, id); unknown object types are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objects(doc).forEach((item, id) => {
    if (item.get('type') !== 'sticky') return;
    out.push({
      id,
      type: 'sticky',
      x: (item.get('x') as number) ?? 0,
      y: (item.get('y') as number) ?? 0,
      color: (item.get('color') as StickyColor) ?? DEFAULT_STICKY_COLOR,
      text: (item.get('text') as Y.Text)?.toString() ?? '',
      z: (item.get('z') as number) ?? 0,
      createdAt: (item.get('createdAt') as number) ?? 0,
    });
  });
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
