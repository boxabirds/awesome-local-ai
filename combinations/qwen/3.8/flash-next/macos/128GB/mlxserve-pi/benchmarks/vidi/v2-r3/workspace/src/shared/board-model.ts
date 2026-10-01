// Board document model: the Yjs schema plus every mutation the app performs.
//
// Framework-free on purpose — no React, no DOM — so the Cloudflare Durable
// Object (story 4) can import this module for validation/migration, and so
// story 3 can attach a network provider to the same document without
// touching it.
//
// Document schema (this is the future persisted format of story 4 and the
// wire format of story 3, hence `meta.schemaVersion`):
//
//   Y.Doc
//     meta:    Y.Map { schemaVersion: 1 }
//     objects: Y.Map<string /* id */, Y.Map>
//       <id>: Y.Map {
//         type: 'sticky'
//         x: number, y: number   // top-left, world units
//         color: StickyColor
//         text: Y.Text
//         z: number              // stacking; higher is on top
//         createdAt: number      // epoch ms
//       }
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

/** Transaction origin of local user edits (story 8 undo, story 3 echo guard). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Written once by `initDoc`; bumped by future migrations. */
export const SCHEMA_VERSION = 1;

const META_MAP = 'meta';
const OBJECTS_MAP = 'objects';

/** Immutable read view of one sticky note object. */
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

/** The `objects` map: id -> per-object Y.Map. Renderer skips unknown types. */
export function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

/**
 * Generate an object id. `crypto.randomUUID` is used where available (all
 * target browsers, Node >= 19); the fallback keeps non-browser hosts (test
 * environments without a Web Crypto global) working.
 */
function newId(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/** Set meta.schemaVersion if absent; idempotent (no rewrite, no extra update). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_MAP);
  if (!meta.has('schemaVersion')) meta.set('schemaVersion', SCHEMA_VERSION);
}

/** Highest z currently in the document (0 for an empty document). */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((map) => {
    const z = map.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  });
  return max;
}

/** Is `id` the object the renderer draws last, i.e. by (z, id) order? */
function isTopmost(objects: Y.Map<Y.Map<unknown>>, id: string): boolean {
  let topZ = -Infinity;
  let topId: string | null = null;
  objects.forEach((map, key) => {
    const z = map.get('z');
    if (!isFiniteNumber(z)) return;
    if (z > topZ || (z === topZ && (topId === null || key > topId))) {
      topZ = z;
      topId = key;
    }
  });
  return topId === id;
}

/**
 * Create a sticky note centred on `at` (world units): the stored top-left is
 * `at - STICKY_SIZE_WORLD / 2`. The note is yellow unless a colour is given,
 * starts with empty text and is stacked on top of every other object.
 *
 * Returns the new id, or '' when the coordinates are not finite (nothing is
 * written, no transaction is opened).
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: StickyColor): string {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return '';
  const fillColor: StickyColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
  const objects = getObjects(doc);
  const id = newId();
  const half = STICKY_SIZE_WORLD / 2;
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', 'sticky');
    map.set('x', at.x - half);
    map.set('y', at.y - half);
    map.set('color', fillColor);
    map.set('text', new Y.Text(''));
    map.set('z', maxZ(objects) + 1);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move an object to a new world-space top-left. False for stale ids. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const map = getObjects(doc).get(id);
  if (map === undefined) return false;
  doc.transact(() => {
    map.set('x', x);
    map.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raise an object above everything else (z = maxZ + 1). Returns false — and
 * writes nothing — for a stale id or for the object that is already on top,
 * so a repeated "bring to front" never produces pointless sync traffic.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const map = objects.get(id);
  if (map === undefined || isTopmost(objects, id)) return false;
  doc.transact(() => {
    map.set('z', maxZ(objects) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Change a sticky note's colour, leaving text, position, stacking and the
 * (client-side) selection untouched. Unknown colour names and stale ids
 * return false and write nothing.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const map = getObjects(doc).get(id);
  if (map === undefined) return false;
  doc.transact(() => {
    map.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. False (no transaction) for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's Y.Text (the shared edit surface), or undefined for stale/non-sticky ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = getObjects(doc).get(id);
  if (map === undefined) return undefined;
  const text = map.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable, render-ready view of the board: notes sorted by (z, id) — the id
 * tie-break keeps stacking identical on every client once story 3 syncs —
 * with objects of unknown `type` skipped (forward compatibility for the
 * shapes/text/images of stories 9-12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  getObjects(doc).forEach((map, id) => {
    if (map === undefined || !(map instanceof Y.Map) || map.get('type') !== 'sticky') return;
    const x = map.get('x');
    const y = map.get('y');
    const z = map.get('z');
    const createdAt = map.get('createdAt');
    const color = map.get('color');
    const text = map.get('text');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return;
    notes.push(
      Object.freeze({
        id,
        type: 'sticky' as const,
        x,
        y,
        color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
        text: text instanceof Y.Text ? text.toString() : '',
        z,
        createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      }),
    );
  });
  notes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}
