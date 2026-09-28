import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

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

const COLOR_KEYS: Set<string> = new Set(Object.keys(STICKY_COLORS));

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function isValidFinite(n: number): boolean {
  return Number.isFinite(n);
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    });
  }
  // Ensure objects map exists
  doc.getMap('objects');
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color?: StickyColor,
): string {
  if (!isValidFinite(at.x) || !isValidFinite(at.y)) {
    throw new Error('createSticky requires finite coordinates');
  }
  const id = crypto.randomUUID();
  const chosenColor: StickyColor = color ?? DEFAULT_STICKY_COLOR;
  const objects = objectsMap(doc);
  doc.transact(() => {
    // Compute max z
    let maxZ = 0;
    objects.forEach((obj) => {
      const z = obj.get('z') as number;
      if (z > maxZ) maxZ = z;
    });
    const yMap = new Y.Map<unknown>();
    yMap.set('type', 'sticky');
    yMap.set('x', at.x - STICKY_SIZE_WORLD / 2);
    yMap.set('y', at.y - STICKY_SIZE_WORLD / 2);
    yMap.set('color', chosenColor);
    yMap.set('text', new Y.Text(''));
    yMap.set('z', maxZ + 1);
    yMap.set('createdAt', Date.now());
    objects.set(id, yMap);
  }, LOCAL_ORIGIN);
  return id;
}

export function moveObject(
  doc: Y.Doc,
  id: string,
  x: number,
  y: number,
): boolean {
  if (!isValidFinite(x) || !isValidFinite(y)) return false;
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  let maxZ = 0;
  objects.forEach((o) => {
    const z = o.get('z') as number;
    if (z > maxZ) maxZ = z;
  });
  const currentZ = obj.get('z') as number;
  if (currentZ >= maxZ) return false;
  doc.transact(() => {
    obj.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(
  doc: Y.Doc,
  id: string,
  color: string,
): boolean {
  if (!COLOR_KEYS.has(color)) return false;
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  return obj.get('text') as Y.Text;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = objectsMap(doc);
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
