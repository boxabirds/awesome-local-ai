import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/** Origin symbol for local transactions (used by story 8 undo and story 3 to avoid echo). */
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
 * Safe to call multiple times.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function isFinitePair(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function isValidColor(c: string): c is StickyColor {
  return c in STICKY_COLORS;
}

/**
 * Create a new sticky note centred at the given world point.
 * Returns the new note's id.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!isFinitePair(at.x, at.y)) return '';
  const objects = getObjects(doc);
  const id = crypto.randomUUID();
  const halfSize = STICKY_SIZE_WORLD / 2;
  const x = at.x - halfSize;
  const y = at.y - halfSize;

  // Compute max z
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  const text = new Y.Text();
  const note = new Y.Map<unknown>();
  note.set('type', 'sticky');
  note.set('x', x);
  note.set('y', y);
  note.set('color', color);
  note.set('text', text);
  note.set('z', maxZ + 1);
  note.set('createdAt', Date.now());

  doc.transact(() => {
    objects.set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move an object to new world coordinates (top-left).
 * Returns true if the move was applied, false if the id is unknown or coords are non-finite.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinitePair(x, y)) return false;
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
 * Returns true if z changed, false if already topmost or id unknown.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  const currentZ = (obj.get('z') as number) ?? 0;
  let maxZ = 0;
  objects.forEach((o) => {
    const z = (o.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  if (currentZ >= maxZ) return false;

  doc.transact(() => {
    obj.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set the colour of a sticky note.
 * Returns true if applied, false if colour is unknown or id is stale.
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
 * Delete an object by id.
 * Returns true if deleted, false if id not found.
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
  return (obj.get('text') as Y.Text) ?? undefined;
}

/**
 * Return a snapshot of all sticky notes, sorted by (z, id).
 * Unknown object types are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjects(doc);
  const result: StickySnapshot[] = [];

  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (type !== 'sticky') return;

    const x = (obj.get('x') as number) ?? 0;
    const y = (obj.get('y') as number) ?? 0;
    const color = (obj.get('color') as StickyColor) ?? DEFAULT_STICKY_COLOR;
    const text = (obj.get('text') as Y.Text)?.toString() ?? '';
    const z = (obj.get('z') as number) ?? 0;
    const createdAt = (obj.get('createdAt') as number) ?? 0;

    result.push({ id, type: 'sticky', x, y, color, text, z, createdAt });
  });

  result.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  return result;
}
