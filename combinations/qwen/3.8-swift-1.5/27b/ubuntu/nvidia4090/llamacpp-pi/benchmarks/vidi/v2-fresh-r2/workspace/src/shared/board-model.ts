/**
 * Yjs board document model — all mutations for the whiteboard.
 *
 * Framework-free: the Durable Object (story 4) will import this module.
 * Every successful mutation is one `doc.transact(fn, LOCAL_ORIGIN)`.
 * Rejections (stale id, unknown colour, non-finite coords, topmost
 * bringToFront) return false before opening a transaction.
 */

import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';

/** Unique origin symbol for local (this-client) transactions. */
export const LOCAL_ORIGIN: unique symbol = Symbol('LOCAL_ORIGIN');

/** Immutable snapshot of a single sticky note. */
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

/**
 * Initialise the document schema. Sets `meta.schemaVersion` to 1 if absent.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    meta.set('schemaVersion', 1);
  }
  // Ensure objects map exists
  doc.getMap('objects');
}

/** Get the objects Y.Map from the doc. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getObjects(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects');
}

/** Check if a coordinate is finite. */
function isFiniteCoord(n: number): boolean {
  return Number.isFinite(n);
}

/**
 * Create a new sticky note centred at the given world point.
 * Returns the new note's id.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFiniteCoord(at.x) || !isFiniteCoord(at.y)) {
    throw new RangeError('createSticky: coordinates must be finite');
  }

  const id = crypto.randomUUID();
  const objects = getObjects(doc);

  // Compute max z
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const text = new Y.Text();
  const obj = new Y.Map();
  obj.set('type', 'sticky');
  obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
  obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
  obj.set('color', color);
  obj.set('text', text);
  obj.set('z', maxZ + 1);
  obj.set('createdAt', Date.now());

  doc.transact(() => {
    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move an object to a new world position. Returns true on success.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteCoord(x) || !isFiniteCoord(y)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Bring an object to the front (highest z). Returns true on success.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  const currentZ = obj.get('z') as number;

  // Find max z
  let maxZ = 0;
  objects.forEach((o) => {
    const z = o.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  // Already topmost
  if (currentZ === maxZ) return false;

  doc.transact(() => {
    obj.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Set a sticky note's colour. Returns true on success.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  // Validate colour
  if (!(color in STICKY_COLORS)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Delete an object from the board. Returns true on success.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  if (!objects.has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Get the Y.Text for a sticky note, or undefined if not found.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  return obj.get('text') as Y.Text | undefined;
}

/**
 * Get an immutable snapshot of all objects, sorted by (z, id).
 * Unknown types are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjects(doc);
  const result: StickySnapshot[] = [];

  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (type !== 'sticky') return; // skip unknown types

    const text = obj.get('text');
    result.push({
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: obj.get('color') as StickyColor,
      text: text ? (text as Y.Text).toString() : '',
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    });
  });

  // Sort by (z, id)
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id.localeCompare(b.id);
  });

  return result;
}
