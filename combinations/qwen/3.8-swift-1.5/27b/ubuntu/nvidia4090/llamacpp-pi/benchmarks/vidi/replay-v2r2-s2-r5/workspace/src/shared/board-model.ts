import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  type StickyColor,
} from './config';

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

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

function isValidCoord(n: number): boolean {
  return Number.isFinite(n);
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.get('schemaVersion')) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: StickyColor): string {
  if (!isValidCoord(at.x) || !isValidCoord(at.y)) {
    return '';
  }

  const id = crypto.randomUUID();
  const objects = doc.getMap('objects');

  // Calculate max z
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj as Y.Map<unknown>).get('z') as number;
    if (typeof z === 'number' && z > maxZ) {
      maxZ = z;
    }
  });

  const stickyColor = color ?? DEFAULT_STICKY_COLOR;
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;

  doc.transact(() => {
    const objMap = new Y.Map<unknown>();
    objMap.set('type', 'sticky');
    objMap.set('x', x);
    objMap.set('y', y);
    objMap.set('color', stickyColor);
    objMap.set('text', new Y.Text());
    objMap.set('z', maxZ + 1);
    objMap.set('createdAt', Date.now());
    objects.set(id, objMap);
  }, LOCAL_ORIGIN);

  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return false;
  }

  const objects = doc.getMap('objects');
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    (obj as Y.Map<unknown>).set('x', x);
    (obj as Y.Map<unknown>).set('y', y);
  }, LOCAL_ORIGIN);

  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap('objects');
  const obj = objects.get(id);
  if (!obj) return false;

  const currentZ = (obj as Y.Map<unknown>).get('z') as number;

  // Find max z
  let maxZ = 0;
  objects.forEach((o) => {
    const z = (o as Y.Map<unknown>).get('z') as number;
    if (typeof z === 'number' && z > maxZ) {
      maxZ = z;
    }
  });

  if (currentZ >= maxZ) return false;

  doc.transact(() => {
    (obj as Y.Map<unknown>).set('z', maxZ + 1);
  }, LOCAL_ORIGIN);

  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;

  const objects = doc.getMap('objects');
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    (obj as Y.Map<unknown>).set('color', color);
  }, LOCAL_ORIGIN);

  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap('objects');
  if (!objects.get(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);

  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = doc.getMap('objects');
  const obj = objects.get(id);
  if (!obj) return undefined;
  return (obj as Y.Map<unknown>).get('text') as Y.Text | undefined;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = doc.getMap('objects');
  const result: StickySnapshot[] = [];

  objects.forEach((obj, id) => {
    const map = obj as Y.Map<unknown>;
    const type = map.get('type') as string;
    if (type !== 'sticky') return; // skip unknown types

    const text = map.get('text') as Y.Text | undefined;
    result.push({
      id,
      type: 'sticky',
      x: map.get('x') as number,
      y: map.get('y') as number,
      color: map.get('color') as StickyColor,
      text: text ? text.toString() : '',
      z: map.get('z') as number,
      createdAt: map.get('createdAt') as number,
    });
  });

  // Sort by (z, id)
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id.localeCompare(b.id);
  });

  return result;
}
