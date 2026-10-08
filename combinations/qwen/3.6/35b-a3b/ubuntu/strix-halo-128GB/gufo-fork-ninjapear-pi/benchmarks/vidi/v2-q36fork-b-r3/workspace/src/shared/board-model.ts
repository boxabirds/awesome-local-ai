import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  STICKY_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from './config';
import type { StickyColor } from './config';
import type { Point } from '../client/canvas/camera';
import type { Rect } from './geometry';

/** Unique symbol for local transactions (used by undo / network filtering). */
export const LOCAL_ORIGIN: unique symbol = Symbol('local-origin');

// ─── Types ────────────────────────────────────────────────────────────────

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  width?: number;
  height?: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

export function getDocObjects(doc: Y.Doc): any {
  return doc.getMap('objects');
}

function getMaxZ(objects: any): number {
  let max = 0;
  for (const val of objects.values()) {
    if (!(val instanceof Y.Map)) continue;
    const z = Number((val as any).get('z') ?? 0);
    if (z > max) max = z;
  }
  return max;
}

function getDataMap(objs: any, id: string): any {
  const val = objs.get(id);
  return val instanceof Y.Map ? val : null;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Initialise the document meta if absent.
 */
export function initDoc(doc: Y.Doc): void {
  if (!doc.getMap('meta').has('schemaVersion')) {
    doc.transact(() => {
      doc.getMap('meta').set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a sticky note at world coordinates `at`, return its id.
 * The note is placed with top-left at `at` minus half the sticky size.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color?: StickyColor,
): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
    return '';
  }

  const objects = getDocObjects(doc);
  const maxZ = getMaxZ(objects);

  const id = crypto.randomUUID();
  const dataMap = new Y.Map();
  dataMap.set('type', 'sticky');
  dataMap.set('x', at.x - STICKY_SIZE_WORLD / 2);
  dataMap.set('y', at.y - STICKY_SIZE_WORLD / 2);
  dataMap.set('color', color ?? DEFAULT_STICKY_COLOR);
  dataMap.set('text', new Y.Text());
  dataMap.set('z', maxZ + 1);
  dataMap.set('createdAt', Date.now());

  doc.transact(() => {
    objects.set(id, dataMap);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move object `id` to world position `(x, y)`. Returns false if stale/invalid.
 * Uses LOCAL_ORIGIN so it enters the undo history.
 */
export function moveObject(
  doc: Y.Doc,
  id: string,
  x: number,
  y: number,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false;
  }

  const objects = getDocObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return false;

  doc.transact(() => {
    dm.set('x', x);
    dm.set('y', y);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Bring `id` to front (z = maxZ + 1). Returns false if stale or already topmost.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getDocObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return false;

  const currentZ = Number(dm.get('z') ?? 0);
  const maxZ = getMaxZ(objects);
  if (currentZ >= maxZ) {
    return false; // already topmost
  }

  dm.set('z', maxZ + 1);

  return true;
}

/**
 * Change sticky colour. Returns false for stale id or unknown colour.
 * Uses LOCAL_ORIGIN so it enters the undo history.
 */
export function setStickyColor(
  doc: Y.Doc,
  id: string,
  color: string,
): boolean {
  if (!(color in STICKY_COLORS)) {
    return false;
  }

  const objects = getDocObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return false;

  doc.transact(() => {
    dm.set('color', color as StickyColor);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Delete object `id`. Returns false if stale.
 * Uses LOCAL_ORIGIN so it enters the undo history.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getDocObjects(doc);
  if (!objects.has(id)) {
    return false;
  }

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Get the Y.Text for a sticky note (for editing).
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getDocObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return undefined;
  const val = dm.get('text');
  return val instanceof Y.Text ? val : undefined;
}

/**
 * Return a memoisable snapshot of all sticky notes sorted by (z, id).
 * Unknown types are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getDocObjects(doc);
  const result: StickySnapshot[] = [];

  for (const [id, val] of objects) {
    if (!(val instanceof Y.Map)) continue;
    const dm = val as any;
    const type = String(dm.get('type') ?? '');
    if (type !== 'sticky') {
      continue; // skip unknown types (forward compatibility)
    }

    const textVal = dm.get('text');
    const textStr = textVal instanceof Y.Text ? textVal.toString() : '';

    result.push({
      id,
      type: 'sticky' as const,
      x: Number(dm.get('x') ?? 0),
      y: Number(dm.get('y') ?? 0),
      color: String(dm.get('color') ?? DEFAULT_STICKY_COLOR) as StickyColor,
      text: textStr,
      z: Number(dm.get('z') ?? 0),
      createdAt: Number(dm.get('createdAt') ?? 0),
      width: dm.has('width') ? Number(dm.get('width')) : undefined,
      height: dm.has('height') ? Number(dm.get('height')) : undefined,
    });
  }

  // Stable sort by (z, id)
  result.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));

  return Object.freeze(result);
}

// ─── Story 7: Selection geometry & group operations ───────────────
import { rectContains } from './geometry';

/** Return a Rect for an object snapshot. Uses width/height if set;
 *  otherwise falls back to STICKY_SIZE_WORLD for both dimensions.
 */
export function objectBounds(obj: StickySnapshot): Rect {
  const w = obj.width ?? STICKY_SIZE_WORLD;
  const h = obj.height ?? STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width: w, height: h };
}

/** Return ids of objects whose entire bounds lie inside `rect`. */
export function objectsInRect(
  snapshot: readonly StickySnapshot[],
  rect: Rect,
): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) {
      ids.push(obj.id);
    }
  }
  return ids;
}

/** Return ids of all known-registered objects in the snapshot. */
export function allObjectIds(snapshot: readonly StickySnapshot[]): string[] {
  return snapshot.map((o) => o.id);
}

/** Move multiple objects atomically. Returns count changed. */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, Point>,
): number {
  if (positions.size === 0) return 0;

  const objects = getDocObjects(doc);
  let count = 0;

  try {
    doc.transact(() => {
      for (const [id, pos] of positions) {
        if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
        const dm = getDataMap(objects, id);
        if (!dm) continue;
        dm.set('x', pos.x);
        dm.set('y', pos.y);
        count++;
      }
    }, LOCAL_ORIGIN);
  } catch {
    return 0;
  }

  return count;
}

/** Resize multiple objects atomically (writes width/height). Returns count changed. */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;

  const objects = getDocObjects(doc);
  let count = 0;

  try {
    doc.transact(() => {
      for (const [id, r] of rects) {
        if (
          !Number.isFinite(r.x) ||
          !Number.isFinite(r.y) ||
          !Number.isFinite(r.width) ||
          !Number.isFinite(r.height)
        ) {
          continue;
        }
        const dm = getDataMap(objects, id);
        if (!dm) continue;
        dm.set('x', r.x);
        dm.set('y', r.y);
        dm.set('width', r.width);
        dm.set('height', r.height);
        count++;
      }
    }, LOCAL_ORIGIN);
  } catch {
    return 0;
  }

  return count;
}

/** Delete multiple objects atomically. Returns count deleted. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getDocObjects(doc);
  let count = 0;

  try {
    doc.transact(() => {
      for (const id of ids) {
        if (objects.has(id)) {
          objects.delete(id);
          count++;
        }
      }
    }, LOCAL_ORIGIN);
  } catch {
    return 0;
  }

  return count;
}

/** Bring selected objects to front above unselected; preserve relative z order.
 *  Returns count changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getDocObjects(doc);
  const selectedSet = new Set(ids);

  // Find highest Z among unselected objects
  let highestNonSelectedZ = 0;
  for (const [oid, val] of objects) {
    if (!(val instanceof Y.Map)) continue;
    const dm = val as any;
    const z = Number(dm.get('z') ?? 0);
    if (!selectedSet.has(oid) && z > highestNonSelectedZ) {
      highestNonSelectedZ = z;
    }
  }

  // Collect selected objects with their current z, then sort to preserve relative order
  const selectedWithZ: Array<{ id: string; z: number }> = [];
  for (const [oid, val] of objects) {
    if (!selectedSet.has(oid) || !(val instanceof Y.Map)) continue;
    const dm = val as any;
    const z = Number(dm.get('z') ?? 0);
    selectedWithZ.push({ id: oid, z });
  }
  selectedWithZ.sort((a, b) => a.z - b.z);

  const orderedIds = selectedWithZ.map((o) => o.id);

  try {
    doc.transact(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        const dm = getDataMap(objects, orderedIds[i]);
        if (!dm) continue;
        dm.set('z', highestNonSelectedZ + 1 + i);
      }
    }, LOCAL_ORIGIN);
  } catch {
    return 0;
  }

  return orderedIds.length;
}
