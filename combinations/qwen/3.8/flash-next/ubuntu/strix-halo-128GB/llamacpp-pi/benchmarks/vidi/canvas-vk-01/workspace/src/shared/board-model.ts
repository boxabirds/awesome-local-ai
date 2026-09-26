import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';

/**
 * Board document model: owns the Yjs schema and all mutations.
 * Framework-free so the Durable Object (story 4) can import it.
 */

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

function getObjectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function getMaxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number | undefined;
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta') as Y.Map<unknown>;
  if (meta.get('schemaVersion') === undefined) {
    meta.set('schemaVersion', 1);
  }
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const objects = getObjectsMap(doc);
  const id = crypto.randomUUID();
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;

  doc.transact(() => {
    const z = getMaxZ(objects) + 1;
    const map = new Y.Map<unknown>();
    map.set('type', 'sticky');
    map.set('x', x);
    map.set('y', y);
    map.set('color', color);
    map.set('text', new Y.Text(''));
    map.set('z', z);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);

  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const objects = getObjectsMap(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);

  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjectsMap(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  const z = obj.get('z') as number;
  const maxZ = getMaxZ(objects);
  if (z >= maxZ) return false;

  doc.transact(() => {
    obj.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);

  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!VALID_COLORS.has(color)) return false;
  const objects = getObjectsMap(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);

  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getObjectsMap(doc);
  if (!objects.has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);

  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjectsMap(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  const text = obj.get('text');
  if (text instanceof Y.Text) return text;
  return undefined;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjectsMap(doc);
  const result: StickySnapshot[] = [];

  objects.forEach((obj, id) => {
    const type = obj.get('type');
    if (type !== 'sticky') return;
    const text = obj.get('text');
    result.push({
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: obj.get('color') as StickyColor,
      text: text instanceof Y.Text ? text.toString() : '',
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
