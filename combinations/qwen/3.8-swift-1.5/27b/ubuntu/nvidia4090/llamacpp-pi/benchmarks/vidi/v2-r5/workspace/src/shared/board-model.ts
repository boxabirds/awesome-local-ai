// src/shared/board-model.ts
// Yjs document schema + all mutations for the board.
// Framework-free so the Durable Object (story 4) can import it.

import * as Y from 'yjs';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DEFAULT_STICKY_COLOR, type StickyColor } from './config';
import type { Rect, Point } from './geometry';

export const LOCAL_ORIGIN: unique symbol = Symbol('LOCAL_ORIGIN');

// Generic object snapshot base
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
  createdAt: number;
  width?: number;
  height?: number;
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

function isFiniteRect(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
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

// ─── Group operations (story 7) ───────────────────────────────────────────────

/**
 * Returns the bounding rect of an object in world units.
 * For sticky notes without explicit width/height, uses STICKY_SIZE_WORLD.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = (obj as StickySnapshot).width ?? STICKY_SIZE_WORLD;
  const height = (obj as StickySnapshot).height ?? STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width, height };
}

/**
 * Returns the ids of all objects whose bounds lie entirely within the given rect.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const result: string[] = [];
  for (const obj of snapshot) {
    const bounds = objectBounds(obj);
    if (
      bounds.x >= rect.x &&
      bounds.y >= rect.y &&
      bounds.x + bounds.width <= rect.x + rect.width &&
      bounds.y + bounds.height <= rect.y + rect.height
    ) {
      result.push(obj.id);
    }
  }
  return result;
}

/**
 * Returns the ids of all objects with a registered type.
 * (In practice, all objects in the doc are registered; this excludes any
 *  unregistered types that might exist.)
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map(obj => obj.id);
}

/**
 * Moves multiple objects to absolute positions.
 * Returns the count of objects successfully moved.
 * Non-finite positions are rejected (0, no transaction).
 * Missing ids are skipped.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;

  // Validate all positions are finite
  for (const [, p] of positions) {
    if (!isFiniteCoord(p.x, p.y)) return 0;
  }

  const objects = getObjects(doc);
  let count = 0;

  doc.transact(() => {
    for (const [id, pos] of positions) {
      const obj = objects.get(id);
      if (!obj) continue;
      obj.set('x', pos.x);
      obj.set('y', pos.y);
      count++;
    }
  }, LOCAL_ORIGIN);

  return count;
}

/**
 * Resizes multiple objects to absolute rects.
 * Writes x, y, width, height for each object.
 * Returns the count of objects successfully resized.
 * Non-finite rects are rejected (0, no transaction).
 * Missing ids are skipped.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;

  // Validate all rects are finite
  for (const [, r] of rects) {
    if (!isFiniteRect(r)) return 0;
  }

  const objects = getObjects(doc);
  let count = 0;

  doc.transact(() => {
    for (const [id, rect] of rects) {
      const obj = objects.get(id);
      if (!obj) continue;
      obj.set('x', rect.x);
      obj.set('y', rect.y);
      obj.set('width', rect.width);
      obj.set('height', rect.height);
      count++;
    }
  }, LOCAL_ORIGIN);

  return count;
}

/**
 * Brings the given objects to the front (above all unselected objects),
 * preserving their relative z-order among themselves.
 * Returns the count of objects whose z was changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjects(doc);

  // Collect the selected objects and their current z
  const selected: { id: string; z: number }[] = [];
  for (const id of ids) {
    const obj = objects.get(id);
    if (!obj) continue;
    const z = (obj.get('z') as number) ?? 0;
    selected.push({ id, z });
  }

  if (selected.length === 0) return 0;

  // Find max z of unselected objects
  const selectedSet = new Set(ids);
  let maxUnselectedZ = 0;
  objects.forEach((obj, id) => {
    if (!selectedSet.has(id)) {
      const z = (obj.get('z') as number) ?? 0;
      if (z > maxUnselectedZ) maxUnselectedZ = z;
    }
  });

  // Sort selected by current z (stable)
  selected.sort((a, b) => a.z - b.z);

  // Assign new z values: maxUnselectedZ + 1, +2, ...
  let count = 0;
  doc.transact(() => {
    for (let i = 0; i < selected.length; i++) {
      const newZ = maxUnselectedZ + 1 + i;
      if (newZ !== selected[i].z) {
        const obj = objects.get(selected[i].id);
        if (obj) {
          obj.set('z', newZ);
          count++;
        }
      }
    }
  }, LOCAL_ORIGIN);

  return count;
}

/**
 * Deletes multiple objects. Returns the count of objects deleted.
 * Missing ids are skipped.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjects(doc);
  let count = 0;

  doc.transact(() => {
    for (const id of ids) {
      if (objects.has(id)) {
        objects.delete(id);
        count++;
      }
    }
  }, LOCAL_ORIGIN);

  return count;
}

// ─── Single-object wrappers (story 2 compatibility) ──────────────────────────

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteCoord(x, y)) return false;
  const objects = getObjects(doc);
  if (!objects.has(id)) return false;
  const count = moveObjects(doc, new Map([[id, { x, y }]]));
  return count === 1;
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
  const count = deleteObjects(doc, [id]);
  return count === 1;
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
    const width = obj.get('width') as number | undefined;
    const height = obj.get('height') as number | undefined;
    result.push({
      id,
      type: 'sticky',
      x: (obj.get('x') as number) ?? 0,
      y: (obj.get('y') as number) ?? 0,
      color: (obj.get('color') as StickyColor) ?? DEFAULT_STICKY_COLOR,
      text: text ? text.toString() : '',
      z: (obj.get('z') as number) ?? 0,
      createdAt: (obj.get('createdAt') as number) ?? 0,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    });
  });

  // Sort by (z, id) for stable ordering
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id.localeCompare(b.id);
  });

  return result;
}
