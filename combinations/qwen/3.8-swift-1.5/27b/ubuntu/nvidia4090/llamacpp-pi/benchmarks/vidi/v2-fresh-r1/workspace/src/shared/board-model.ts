// Board document model: Yjs schema + all mutations.
// Framework-free; shared by the client now and the Durable Object in story 4.

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/** Origin marker for local edits (used by story 8 undo and story 3 echo suppression). */
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

/**
 * Initialise the document schema. Sets meta.schemaVersion if absent.
 * Safe to call multiple times (idempotent).
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
  // Ensure objects map exists
  doc.getMap('objects');
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  return maxZ;
}

/**
 * Create a new sticky note centred at the given world point.
 * Returns the new note's id. Returns an empty string if coordinates are non-finite.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: StickyColor): string {
  if (!isFiniteNum(at.x) || !isFiniteNum(at.y)) return '';
  const id = crypto.randomUUID();
  const c = color ?? DEFAULT_STICKY_COLOR;
  const text = new Y.Text();

  doc.transact(() => {
    const objects = getObjects(doc);
    const note = new Y.Map();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', c);
    note.set('text', text);
    note.set('z', getMaxZ(doc) + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move an object to new world coordinates.
 * Returns true if the move was applied, false if the id is stale or coords are non-finite.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNum(x) || !isFiniteNum(y)) return false;
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
 * Bring an object to the front (highest z).
 * Returns true if z was changed, false if already topmost or id is stale.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  const currentZ = obj.get('z') as number;
  const maxZ = getMaxZ(doc);
  if (currentZ >= maxZ) return false;

  doc.transact(() => {
    obj.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a sticky note's colour.
 * Returns true if the colour was applied, false if the id is stale or colour is unknown.
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
 * Delete an object from the board.
 * Returns true if the object was removed, false if the id is stale.
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
 * Get the Y.Text for a sticky note, or undefined if the id is stale.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  const text = obj.get('text');
  if (text instanceof Y.Text) return text;
  return undefined;
}

/**
 * Return an immutable snapshot of all sticky notes, sorted by (z, id).
 * Unknown object types are skipped (forward compatibility).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjects(doc);
  const result: StickySnapshot[] = [];

  objects.forEach((obj, id) => {
    const type = obj.get('type');
    if (type !== 'sticky') return; // skip unknown types

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

  // Sort by (z, id) for stable render order
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return result;
}
