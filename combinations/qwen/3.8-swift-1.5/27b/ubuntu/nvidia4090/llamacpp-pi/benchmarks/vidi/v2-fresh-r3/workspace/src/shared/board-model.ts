import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';

// Origin for local (this-client) transactions. Story 8 uses it for undo and
// story 3 uses it to avoid echoing remote updates.
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6:local-origin');

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

const META_SCHEMA_VERSION = 1;

/**
 * Document schema (the future persisted and wire contract):
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string /* id *\/, Y.Map>
 *       <id>: Y.Map {
 *         type: 'sticky', x: number, y: number, color: StickyColor,
 *         text: Y.Text, z: number, createdAt: number
 *       }
 */

export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

/** Sets `meta.schemaVersion` if absent. Idempotent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', META_SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function stickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  return obj;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

function isFinitePoint(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Creates a sticky note centred on `at` (top-left = at − STICKY_SIZE_WORLD/2),
 * on top of all other notes (z = maxZ + 1). Returns the new id, or `''` when
 * the coordinates are not finite (no transaction is opened).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFinitePoint(at) || !isStickyColor(color)) return '';

  const id = crypto.randomUUID();
  const sticky = new Y.Map<unknown>();
  sticky.set('type', 'sticky');
  sticky.set('x', at.x - STICKY_SIZE_WORLD / 2);
  sticky.set('y', at.y - STICKY_SIZE_WORLD / 2);
  sticky.set('color', color);
  sticky.set('text', new Y.Text());
  sticky.set('z', maxZ(doc) + 1);
  sticky.set('createdAt', Date.now());

  doc.transact(() => {
    objectsMap(doc).set(id, sticky);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves a note's top-left to world (x, y). False (no transaction) for stale ids or non-finite coordinates. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Gives the note the highest z (maxZ + 1). False (no transaction) if it already is topmost or the id is stale. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  const z = obj.get('z');
  if (typeof z !== 'number' || z >= maxZ(doc)) return false;
  doc.transact(() => {
    obj.set('z', maxZ(doc) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets only the `color` field. False (no transaction) for unknown colour
 * names, stale ids, or when the note already has that colour.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes the object with this id. False (no transaction) for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's Y.Text, or undefined for stale/unknown ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = stickyMap(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so concurrent
 * equal z values (possible once story 3 syncs) still give every client the
 * same render order. Unknown `type` values are skipped (forward
 * compatibility for stories 9–12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectsMap(doc).forEach((obj, id) => {
    if (obj.get('type') !== 'sticky') return;
    const text = obj.get('text');
    notes.push({
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
  notes.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}
