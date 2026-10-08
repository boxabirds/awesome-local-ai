import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  STICKY_SIZE_WORLD,
} from './config';
import type { StickyColor } from './config';

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

  dm.set('x', x);
  dm.set('y', y);

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

  dm.set('color', color as StickyColor);

  return true;
}

/**
 * Delete object `id`. Returns false if stale.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getDocObjects(doc);
  if (!objects.has(id)) {
    return false;
  }

  objects.delete(id);

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
    });
  }

  // Stable sort by (z, id)
  result.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));

  return Object.freeze(result);
}
