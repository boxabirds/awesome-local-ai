// src/shared/board-model.ts
// Yjs document schema + all mutations for the board.
// Framework-free so the Durable Object (story 4) can import it.

import * as Y from 'yjs';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DEFAULT_STICKY_COLOR, type StickyColor } from './config';

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

function getMeta(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

export function initDoc(doc: Y.Doc): void {
  const meta = getMeta(doc);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

function isValidColor(color: string): color is StickyColor {
  return color in STICKY_COLORS;
}

function isFiniteCoord(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });
  return maxZ;
}

export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: StickyColor): string {
  if (!isFiniteCoord(at.x, at.y)) return '';
  const c = color ?? DEFAULT_STICKY_COLOR;
  const id = crypto.randomUUID();
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;
  const z = getMaxZ(doc) + 1;
  const text = new Y.Text();

  doc.transact(() => {
    const objects = getObjects(doc);
    const obj = new Y.Map<unknown>();
    obj.set('type', 'sticky');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('color', c);
    obj.set('text', text);
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteCoord(x, y)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  const currentZ = (obj.get('z') as number) ?? 0;
  const maxZ = getMaxZ(doc);
  if (currentZ >= maxZ) return false;

  doc.transact(() => {
    obj.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isValidColor(color)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  if (!objects.has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  return obj.get('text') as Y.Text | undefined;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjects(doc);
  const result: StickySnapshot[] = [];

  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (type !== 'sticky') return; // skip unknown types

    const text = obj.get('text') as Y.Text | undefined;
    result.push({
      id,
      type: 'sticky',
      x: (obj.get('x') as number) ?? 0,
      y: (obj.get('y') as number) ?? 0,
      color: (obj.get('color') as StickyColor) ?? DEFAULT_STICKY_COLOR,
      text: text ? text.toString() : '',
      z: (obj.get('z') as number) ?? 0,
      createdAt: (obj.get('createdAt') as number) ?? 0,
    });
  });

  // Sort by (z, id) for stable ordering
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id.localeCompare(b.id);
  });

  return result;
}
