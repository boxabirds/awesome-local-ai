import { Doc, Map as YMap, Text as YText } from 'yjs';

import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/**
 * Pure board model for vidi6 (design "board.model").
 *
 * Owns the Yjs document schema and every mutation, so that story 3 only has to
 * attach a network provider and story 4 only has to persist the very same
 * document. The module is framework-free (no React) so the Durable Object can
 * import it for validation and migration.
 *
 * Schema
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map { type:'sticky', x, y, color, text: Y.Text, z, createdAt }>
 *
 * Every successful mutation is a single `doc.transact(fn, LOCAL_ORIGIN)`.
 * Rejections (stale id, unknown colour, non-finite numbers, bringToFront on the
 * topmost note) return `false` before opening a transaction, so they emit no
 * Yjs update — story 3 sees no echo and story 8 no useless undo item. Nothing
 * here ever throws for user-driven input.
 */

/** Origin stamped on every local transaction (used by stories 3 and 8). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

const SCHEMA_VERSION = 1;
const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const STICKY_TYPE = 'sticky';

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

type RawObject = YMap<unknown>;

function objectsOf(doc: Doc): YMap<RawObject> {
  return doc.getMap<RawObject>(OBJECTS_KEY);
}

function isColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

/** Ids are UUIDs; a stable tie-break for render order when `z` ties. */
function newId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Seed the document with `meta.schemaVersion` if it is not already there. Safe
 * to call on every load; a second call is a no-op that emits no update.
 */
export function initDoc(doc: Doc): void {
  const meta = doc.getMap(META_KEY);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
  }
}

function maxZ(objects: YMap<RawObject>): number {
  let max = 0;
  objects.forEach((value) => {
    if (isStickyMap(value)) {
      const z = value.get('z');
      if (typeof z === 'number' && z > max) max = z;
    }
  });
  return max;
}

/** True when the value is a well-formed sticky `Y.Map` (not some future type). */
function isStickyMap(value: unknown): value is RawObject {
  return value instanceof YMap && value.get('type') === STICKY_TYPE;
}

export function createSticky(
  doc: Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  const objects = objectsOf(doc);
  const z = maxZ(objects) + 1;
  const id = newId();
  const half = STICKY_SIZE_WORLD / 2;
  doc.transact(() => {
    const map = new YMap<unknown>();
    map.set('type', STICKY_TYPE);
    map.set('x', at.x - half);
    map.set('y', at.y - half);
    map.set('color', color);
    map.set('text', new YText(''));
    map.set('z', z);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

export function moveObject(doc: Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const value = objectsOf(doc).get(id);
  if (!isStickyMap(value)) return false;
  doc.transact(() => {
    value.set('x', x);
    value.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const value = objects.get(id);
  if (!isStickyMap(value)) return false;
  const currentZ = value.get('z');
  const max = maxZ(objects);
  // Already on top: no change, and no update (avoids pointless sync traffic).
  if (typeof currentZ === 'number' && currentZ === max) return false;
  doc.transact(() => value.set('z', max + 1), LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Doc, id: string, color: string): boolean {
  if (!isColor(color)) return false;
  const value = objectsOf(doc).get(id);
  if (!isStickyMap(value)) return false;
  if (value.get('color') === color) return false;
  doc.transact(() => value.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => objects.delete(id), LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Doc, id: string): YText | undefined {
  const value = objectsOf(doc).get(id);
  if (!isStickyMap(value)) return undefined;
  const text = value.get('text');
  return text instanceof YText ? text : undefined;
}

/**
 * An immutable, ordered view of every sticky note. Unknown object types are
 * skipped (forward compatibility with stories 9-12). Order is `(z, id)` so two
 * clients always render the same stacking, even when a concurrent edit leaves
 * two notes with the same `z`.
 */
export function snapshot(doc: Doc): readonly StickySnapshot[] {
  const result: StickySnapshot[] = [];
  objectsOf(doc).forEach((value, id) => {
    if (!isStickyMap(value)) return;
    const text = value.get('text');
    result.push({
      id,
      type: STICKY_TYPE,
      x: numberOr(value.get('x'), 0),
      y: numberOr(value.get('y'), 0),
      color: isColor(value.get('color')) ? (value.get('color') as StickyColor) : DEFAULT_STICKY_COLOR,
      text: text instanceof YText ? text.toString() : '',
      z: numberOr(value.get('z'), 0),
      createdAt: numberOr(value.get('createdAt'), 0),
    });
  });
  result.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
