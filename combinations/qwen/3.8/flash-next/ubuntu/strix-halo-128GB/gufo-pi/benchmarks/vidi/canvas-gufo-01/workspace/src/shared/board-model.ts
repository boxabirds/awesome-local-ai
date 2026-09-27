// The board document model: Yjs schema + all mutations. Framework-free so the
// Durable Object (story 4) can import it too. This module is the single writer
// of the document schema; React renders immutable snapshots.

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  type StickyColor,
} from './config';

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

const COLOR_NAMES = new Set(Object.keys(STICKY_COLORS));

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>('meta');
  if (!meta.has('schemaVersion')) meta.set('schemaVersion', 1);
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    initDoc(doc);
    const objects = objectsMap(doc);
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x);
    note.set('y', at.y);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ(objects) + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  });
  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  let applied = false;
  doc.transact(() => {
    const note = objectsMap(doc).get(id);
    if (!note || note.get('type') !== 'sticky') return;
    note.set('x', x);
    note.set('y', y);
    applied = true;
  });
  return applied;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  let applied = false;
  doc.transact(() => {
    const objects = objectsMap(doc);
    const note = objects.get(id);
    if (!note || note.get('type') !== 'sticky') return;
    const z = note.get('z');
    const top = maxZ(objects);
    if (typeof z === 'number' && z === top) return; // already on top: no update
    note.set('z', top + 1);
    applied = true;
  });
  return applied;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!COLOR_NAMES.has(color)) return false;
  let applied = false;
  doc.transact(() => {
    const note = objectsMap(doc).get(id);
    if (!note || note.get('type') !== 'sticky') return;
    if (note.get('color') === color) return; // no-op: no update
    note.set('color', color);
    applied = true;
  });
  return applied;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  let applied = false;
  doc.transact(() => {
    const objects = objectsMap(doc);
    if (!objects.has(id)) return;
    objects.delete(id);
    applied = true;
  });
  return applied;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objectsMap(doc).get(id);
  if (!note || note.get('type') !== 'sticky') return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** Notes sorted by (z, id) so every client renders the same stacking order. Unknown types skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  for (const [id, obj] of objectsMap(doc)) {
    if (obj.get('type') !== 'sticky') continue; // forward compatibility: skip unknown types
    const x = obj.get('x');
    const y = obj.get('y');
    const color = obj.get('color');
    const text = obj.get('text');
    const z = obj.get('z');
    const createdAt = obj.get('createdAt');
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    out.push({
      id,
      type: 'sticky',
      x,
      y,
      color: COLOR_NAMES.has(String(color)) ? (color as StickyColor) : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: typeof z === 'number' ? z : 0,
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
    });
  }
  out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
