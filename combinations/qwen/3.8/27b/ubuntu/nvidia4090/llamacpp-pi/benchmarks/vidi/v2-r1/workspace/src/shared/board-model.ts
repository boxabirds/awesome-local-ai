// Board document model (story 2, board.model contract).
//
// All board content lives in a Y.Doc from day one so that story 3 only
// attaches a network provider and story 4 only persists the same document.
// This module is framework-free: the Durable Object (story 4) imports it for
// validation/migration.
//
// Document schema (the future persisted and wire contract):
//   Y.Doc
//     meta: Y.Map { schemaVersion: 1 }
//     objects: Y.Map<string /* id */, Y.Map>
//       <id>: Y.Map {
//         type: 'sticky'
//         x: number, y: number     // top-left, world units
//         color: StickyColor
//         text: Y.Text
//         z: number                // stacking; higher is on top
//         createdAt: number        // epoch ms
//       }

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/** Transaction origin for all local mutations (used by story 8 undo and
 *  by story 3 to avoid echo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.localOrigin');

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
const STICKY_TYPE = 'sticky';

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY);
}

function isStickyColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && color in STICKY_COLORS;
}

function isValidCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Set `meta.schemaVersion` if absent. Idempotent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (top-left = at − STICKY_SIZE_WORLD/2),
 * on top of all other notes (z = maxZ + 1). Returns the new id, or `null` for
 * non-finite coordinates (no transaction in that case).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | null {
  if (!isValidCoord(at.x) || !isValidCoord(at.y)) return null;

  const map = objects(doc);
  let maxZ = 0;
  map.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const id = randomId();
  const text = new Y.Text();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', STICKY_TYPE);
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', text);
    obj.set('z', maxZ + 1);
    obj.set('createdAt', Date.now());
    map.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move an object's top-left to world (x, y). False for stale ids or
 *  non-finite coordinates (no transaction). */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isValidCoord(x) || !isValidCoord(y)) return false;
  const obj = objects(doc).get(id);
  if (!obj) return false;
  if (obj.get('x') === x && obj.get('y') === y) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raise `id` above every other object. False when the note is already
 * topmost (or the id is stale) — a pointless update (no transaction).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const map = objects(doc);
  const obj = map.get(id);
  if (!obj) return false;
  let maxZ = -Infinity;
  map.forEach((o) => {
    const z = o.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  const z = obj.get('z');
  if (typeof z === 'number' && z >= maxZ) return false;
  doc.transact(() => {
    obj.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's colour. Unknown colours and stale ids return false with
 *  no transaction. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = objects(doc).get(id);
  if (!obj) return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. False for stale ids (no transaction). */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const map = objects(doc);
  if (!map.has(id)) return false;
  doc.transact(() => {
    map.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The Y.Text of a sticky note, if it exists. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so that every
 * client renders the same stacking order (equal-z ties, possible once
 * story 3 syncs, break by id). Unknown object types are skipped (forward
 * compatibility for later stories).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    if (obj.get('type') !== STICKY_TYPE) return;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    const color = obj.get('color');
    const createdAt = obj.get('createdAt');
    if (!isValidCoord(x) || !isValidCoord(y)) return;
    if (!isStickyColor(color)) return;
    if (typeof z !== 'number' || typeof createdAt !== 'number') return;
    const text = obj.get('text');
    out.push(
      Object.freeze({
        id,
        type: 'sticky' as const,
        x,
        y,
        color,
        text: text instanceof Y.Text ? text.toString() : '',
        z,
        createdAt,
      }),
    );
  });
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(out);
}

function randomId(): string {
  // Ids are crypto.randomUUID(); the fallback keeps non-secure contexts working.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
