import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from '@shared/config';

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

const VALID_COLORS = new Set<string>(Object.keys(STICKY_COLORS));

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') == null) {
    meta.set('schemaVersion', 1);
  }
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color?: StickyColor,
): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const id = crypto.randomUUID();
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (z > maxZ) maxZ = z;
  });
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color ?? DEFAULT_STICKY_COLOR);
    note.set('text', new Y.Text());
    note.set('z', maxZ + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const note = objects.get(id);
  if (!note) return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const note = objects.get(id);
  if (!note) return false;
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (z > maxZ) maxZ = z;
  });
  const currentZ = note.get('z') as number;
  if (currentZ >= maxZ) return false;
  doc.transact(() => {
    note.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!VALID_COLORS.has(color)) return false;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const note = objects.get(id);
  if (!note) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const note = objects.get(id);
  if (!note) return undefined;
  return note.get('text') as Y.Text | undefined;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const result: StickySnapshot[] = [];
  objects.forEach((obj, id) => {
    if (obj.get('type') !== 'sticky') return;
    result.push({
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: obj.get('color') as StickyColor,
      text: (obj.get('text') as Y.Text).toString(),
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    });
  });
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return result;
}
