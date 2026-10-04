import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';

/** Origin symbol for local (this client) transactions. */
export const LOCAL_ORIGIN: unique symbol = Symbol('LOCAL_ORIGIN');

/** Immutable snapshot of a sticky note for rendering. */
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
 * Initialize the Y.Doc schema. Sets `meta.schemaVersion` to 1 if absent,
 * and ensures the `objects` map exists.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
  // Ensure the objects map exists (accessing it creates it if absent).
  doc.getMap('objects');
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function isValidColor(color: string): color is StickyColor {
  return color in STICKY_COLORS;
}

function isFiniteCoord(n: number): boolean {
  return Number.isFinite(n);
}

/**
 * Create a new sticky note centred at the given world point.
 * Returns the new note's id, or empty string if coordinates are invalid.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFiniteCoord(at.x) || !isFiniteCoord(at.y)) return '';
  if (!isValidColor(color)) return '';

  const id = crypto.randomUUID();
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;
  const objects = getObjects(doc);

  // Compute maxZ
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const noteMap = new Y.Map<unknown>();
  const text = new Y.Text();
  noteMap.set('type', 'sticky');
  noteMap.set('x', x);
  noteMap.set('y', y);
  noteMap.set('color', color);
  noteMap.set('text', text);
  noteMap.set('z', maxZ + 1);
  noteMap.set('createdAt', Date.now());

  doc.transact(() => {
    objects.set(id, noteMap);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move an object to new world coordinates. Returns true if the change was applied.
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
 * Bring an object to the front (highest z). Returns true if a change was made.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  const currentZ = obj.get('z') as number;
  let maxZ = 0;
  objects.forEach((o) => {
    const z = o.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  if (currentZ === maxZ) return false; // already topmost

  doc.transact(() => {
    obj.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a sticky note's colour. Returns true if the change was applied.
 */
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

/**
 * Delete an object from the document. Returns true if it was removed.
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
 * Get the Y.Text for a sticky note, or undefined if the id is unknown.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  return obj.get('text') as Y.Text | undefined;
}

/**
 * Return an immutable array of all sticky notes, sorted by (z, id).
 * Unknown object types are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjects(doc);
  const result: StickySnapshot[] = [];

  objects.forEach((obj, id) => {
    const type = obj.get('type');
    if (type !== 'sticky') return; // skip unknown types

    const text = obj.get('text') as Y.Text | undefined;
    result.push({
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: obj.get('color') as StickyColor,
      text: text ? text.toString() : '',
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    });
  });

  // Sort by (z, id) for stable render order
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return result;
}
