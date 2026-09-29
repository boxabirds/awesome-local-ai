/**
 * The board document: the Yjs schema plus every mutation.
 *
 * This is the future persisted format (story 4) and the live wire format
 * (story 3), which is why it carries `meta.schemaVersion` from the start and
 * tags local changes with `LOCAL_ORIGIN`. The module is framework-free on
 * purpose: the client imports it now, the Durable Object can import the same
 * file later for validation and migration.
 *
 * Schema
 * ```
 * Y.Doc
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<string /* id *\/, Y.Map>
 *     <id>: Y.Map {
 *       type: 'sticky'
 *       x: number, y: number   // top-left corner, world units
 *       color: StickyColor
 *       text: Y.Text
 *       z: number              // stacking; higher is drawn on top
 *       createdAt: number      // epoch ms
 *     }
 * ```
 *
 * Unknown `type` values are skipped rather than throwing, so a document
 * written by a later story (shapes, arrows, ...) still opens here.
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
 * every rejected mutation returns `false` before a transaction is opened, so a
 * stale id, an unknown colour or a non-finite coordinate never produces an
 * update event (and therefore never sync traffic). The module never throws for
 * user-driven input.
 */

import * as Y from 'yjs';

import {
  DEFAULT_STICKY_COLOR,
  STICKY_SIZE_WORLD,
  isStickyColor,
  type StickyColor,
} from './config';

/** Origin tag for mutations made on this client. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Names of the shared types that make up the schema. */
const META_MAP = 'meta';
const OBJECTS_MAP = 'objects';
const SCHEMA_VERSION = 1;

/** What the renderer needs to know about one sticky note. */
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

export type ObjectMap = Y.Map<Y.Map<unknown> | undefined>;

function objectsOf(doc: Y.Doc): ObjectMap {
  return doc.getMap(OBJECTS_MAP) as unknown as ObjectMap;
}

function entryOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string') return undefined;
  const entry = objectsOf(doc).get(id);
  return entry instanceof Y.Map ? entry : undefined;
}

function isStickyEntry(entry: Y.Map<unknown> | undefined): entry is Y.Map<unknown> {
  return entry !== undefined && entry.get('type') === 'sticky';
}

/** Finite numbers only: NaN and +/-Infinity must never reach the document. */
function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

/** Highest `z` currently in the document (over every object type). */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsOf(doc).values()) {
    const z = entry instanceof Y.Map ? entry.get('z') : undefined;
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

/**
 * Bring the document up to the current schema. Idempotent: it writes
 * `meta.schemaVersion` only when it is absent, so calling it on every load
 * costs nothing and never produces an update for a document that is current.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_MAP);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (world units), on top of everything
 * else, and return its id.
 *
 * `at` is the point the user aimed at - the click point or the centre of the
 * visible board - so the stored `x, y` (the top-left) is `at` minus half the
 * note size. An unknown colour or a non-finite point is rejected and returns an
 * empty string.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!at || !isFinitePoint(at.x, at.y)) return '';
  if (!isStickyColor(color)) return '';

  const id = crypto.randomUUID();
  const half = STICKY_SIZE_WORLD / 2;
  doc.transact(() => {
    const objects = objectsOf(doc);
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - half);
    note.set('y', at.y - half);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ(doc) + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move an object to a new top-left corner, in world units. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinitePoint(x, y)) return false;
  const entry = entryOf(doc, id);
  if (entry === undefined) return false;
  if (entry.get('x') === x && entry.get('y') === y) return false;
  doc.transact(() => {
    entry.set('x', x);
    entry.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Restack an object above every other one. Returns false (and writes nothing,
 * so story 3 sends no pointless sync traffic) when the object is already on
 * top - including when it is tied on `z` but sorted last by id.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const entry = entryOf(doc, id);
  if (entry === undefined) return false;
  const z = entry.get('z');
  const objects = objectsOf(doc);
  let topId = '';
  let topZ = Number.NEGATIVE_INFINITY;
  for (const [otherId, other] of objects) {
    const otherZ = other instanceof Y.Map ? other.get('z') : undefined;
    if (typeof otherZ !== 'number' || !Number.isFinite(otherZ)) continue;
    if (otherZ > topZ || (otherZ === topZ && otherId > topId)) {
      topZ = otherZ;
      topId = otherId;
    }
  }
  if (topId === id) return false;
  const nextZ = (Number.isFinite(topZ) ? topZ : 0) + 1;
  if (typeof z === 'number' && z === nextZ) return false;
  doc.transact(() => {
    entry.set('z', nextZ);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's colour. Text, position, stacking and id are untouched. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const entry = entryOf(doc, id);
  if (!isStickyEntry(entry)) return false;
  if (entry.get('color') === color) return false;
  doc.transact(() => {
    entry.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const entry = objects.get(id);
  if (!(entry instanceof Y.Map)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's text as a shared `Y.Text`, or undefined when there is no such note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = entryOf(doc, id);
  if (!isStickyEntry(entry)) return undefined;
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function readSticky(id: string, entry: Y.Map<unknown>): StickySnapshot | null {
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
  const color = entry.get('color');
  const text = entry.get('text');
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }
  return {
    id,
    type: 'sticky',
    x,
    y,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: typeof z === 'number' && Number.isFinite(z) ? z : 0,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}

/**
 * The board as plain, frozen data for React: sticky notes sorted by `(z, id)`
 * - the id tie-break makes the order the same on every client once concurrent
 * creation (story 3) produces equal `z` values. Unknown or damaged entries are
 * skipped.
 *
 * Recomputed on demand; `useBoardDoc` memoises it between document changes.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const list: StickySnapshot[] = [];
  for (const [id, entry] of objectsOf(doc)) {
    if (!(entry instanceof Y.Map)) continue;
    if (entry.get('type') !== 'sticky') continue;
    const note = readSticky(id, entry);
    if (note !== null) list.push(note);
  }
  list.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  for (const note of list) Object.freeze(note);
  return Object.freeze(list);
}
