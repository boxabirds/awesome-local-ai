import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';

/**
 * Board document model (story 2).
 *
 * Yjs schema (the future persisted format, story 4, and wire format, story 3):
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map (id -> Y.Map)
 *     <id>: Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 *
 * - x, y are the note's top-left in world units.
 * - z is stacking order; higher is on top.
 * - Unknown `type` values are skipped by the renderer (forward compatibility).
 *
 * The module is framework-free so the Durable Object (story 4) can import it.
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
 * rejections (stale id, unknown colour, non-finite coordinates, bringToFront
 * on the topmost note) return false before opening a transaction.
 */

export const LOCAL_ORIGIN: unique symbol = Symbol('local-origin');

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

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const SCHEMA_VERSION = 1;

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY);
}

function stickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  return obj;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/** Sets meta.schemaVersion once. Idempotent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (world point), on top of everything.
 * Returns the new id, or '' when the coordinates are not finite.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  if (!isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  const text = new Y.Text();
  doc.transact(() => {
    const objects = objectsMap(doc);
    const obj = new Y.Map();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', text);
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves a note's top-left to world (x, y). */
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

/** Raises a note above all others. No-op (false) if it is already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  const objects = objectsMap(doc);
  const z = obj.get('z');
  const top = maxZ(objects);
  if (typeof z === 'number' && z >= top) return false;
  doc.transact(() => {
    obj.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Changes a note's colour. Unknown colour names or stale ids are rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes a note from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  doc.transact(() => {
    objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The Y.Text of a sticky note, or undefined for unknown/non-sticky ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = stickyMap(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so concurrent
 * equal z values still order identically on every client. Unknown object
 * types are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objectsMap(doc).forEach((obj, id) => {
    if (obj.get('type') !== 'sticky') return;
    const text = obj.get('text');
    const color = obj.get('color');
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    const createdAt = obj.get('createdAt');
    out.push({
      id,
      type: 'sticky',
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: typeof z === 'number' ? z : 0,
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
    });
  });
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
