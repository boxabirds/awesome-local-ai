// Yjs board schema and every board mutation. Framework-free so the Durable
// Object (story 4) can import it for validation/migration.
//
// Schema:
//   Y.Doc
//     meta: Y.Map { schemaVersion: 1 }
//     objects: Y.Map<string, Y.Map> with { type:'sticky', x, y, color, text: Y.Text, z, createdAt }

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

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

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFinitePoint(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function stickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  return obj;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', 1);
  }, LOCAL_ORIGIN);
}

// Places the note's top-left so the note is centred on `at`.
// Returns the new id, or false for non-finite coordinates.
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!isFinitePoint(at)) return false;
  const objects = objectsMap(doc);
  const z = maxZ(objects) + 1;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', new Y.Text(''));
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  const top = maxZ(objects);
  const z = obj.get('z');
  if (typeof z === 'number' && z === top) return false;
  doc.transact(() => {
    obj.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = stickyMap(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

// Render order: (z, id). Sorting by id as a tie-break keeps every client's
// order identical once story 3 syncs concurrent equal-z notes. Unknown types
// are skipped for forward compatibility with stories 9-12.
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, obj] of objectsMap(doc)) {
    if (obj.get('type') !== 'sticky') continue;
    const color = obj.get('color');
    const text = obj.get('text');
    notes.push({
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    });
  }
  notes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}
