/**
 * Yjs-based board document model.
 *
 * Framework-free so the Durable Object (story 4) can import it for validation/migration.
 * All mutations go through `doc.transact(fn, LOCAL_ORIGIN)`.
 */
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/** Transaction origin marking local user actions. */
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

const VALID_COLORS: ReadonlySet<string> = new Set(Object.keys(STICKY_COLORS));

/** Initialise the document schema if not already done. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (z > max) max = z;
  });
  return max;
}

/**
 * Create a sticky note centred at (at.x, at.y) in world coordinates.
 * The stored x,y is the top-left corner: at minus half the note size.
 * z = maxZ + 1 (new notes go on top).
 * Returns the new id.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const objects = getObjects(doc);
  const id = crypto.randomUUID();
  const z = maxZ(objects) + 1;
  doc.transact(() => {
    if (objects.has(id)) return; // id collision (should never happen)
    const yMap = new Y.Map();
    objects.set(id, yMap);
    yMap.set('type', 'sticky');
    yMap.set('x', at.x - STICKY_SIZE_WORLD / 2);
    yMap.set('y', at.y - STICKY_SIZE_WORLD / 2);
    yMap.set('color', color);
    yMap.set('z', z);
    yMap.set('createdAt', Date.now());
    const yText = new Y.Text();
    yMap.set('text', yText);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a sticky note to world position (x, y). Returns false if id not found or coords not finite. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Bring a sticky note to the front (highest z). Returns false if already top or id not found. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  const currentZ = obj.get('z') as number;
  const mz = maxZ(objects);
  if (currentZ >= mz) return false; // already on top
  doc.transact(() => {
    obj.set('z', mz + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Set the colour of a sticky note. Returns false for invalid colour or missing id. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!VALID_COLORS.has(color)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Delete a sticky note. Returns false if id not found. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** Get the Y.Text of a sticky note, or undefined if not found. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  return obj.get('text') as Y.Text;
}

/** Return a snapshot of all sticky notes, sorted by (z, id), skipping unknown types. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjects(doc);
  const result: StickySnapshot[] = [];
  objects.forEach((obj, id) => {
    const type = obj.get('type');
    if (type !== 'sticky') return; // skip unknown types
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
