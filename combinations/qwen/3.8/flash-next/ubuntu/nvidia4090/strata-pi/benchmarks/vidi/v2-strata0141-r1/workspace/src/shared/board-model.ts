import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/**
 * The board document model (anchor `board.model`).
 *
 * Y.Doc schema - this is the format story 4 persists and story 3 syncs, so it
 * is versioned from day one:
 *
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map> where each value is
 *            { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 *
 * The module is framework-free (no React, no DOM) so the story 4 Durable Object
 * can import it for validation and migration. It never throws for user-driven
 * input: every rejection (stale id, unknown colour, non-finite coordinate,
 * pointless no-op) returns `false` before a transaction is opened, so no
 * `update` event is emitted.
 */

/** Schema version written to `meta.schemaVersion`. */
export const SCHEMA_VERSION = 1;

/**
 * Transaction origin for every local mutation. Story 8 uses it for undo and
 * story 3 uses it to avoid echoing a change back to its author.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

export interface StickySnapshot {
  readonly id: string;
  readonly type: 'sticky';
  /** Top-left corner, world units. */
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
  /** Stacking order; higher is drawn on top. */
  readonly z: number;
  readonly createdAt: number;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStickyColor = (value: unknown): value is StickyColor =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(STICKY_COLORS, value) &&
  (STICKY_COLORS as Record<string, string>)[value] !== undefined;

const objectMapOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>('objects');

const asObjectMap = (value: unknown): Y.Map<unknown> | undefined =>
  value instanceof Y.Map ? value : undefined;

/** WebCrypto when this environment has it. */
function webCrypto(): Crypto | undefined {
  return (globalThis as { crypto?: Crypto }).crypto;
}

/** Ids are UUIDs so concurrent clients cannot collide (story 3). */
function randomId(): string {
  const crypto = webCrypto();
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/** Highest `z` currently in the document (0 when there are no objects). */
function maxZ(objects: Y.Map<unknown>): number {
  let highest = 0;
  objects.forEach((value) => {
    const z = asObjectMap(value)?.get('z');
    if (isFiniteNumber(z) && z > highest) {
      highest = z;
    }
  });
  return highest;
}

/** Apply the story 2 schema to a document (idempotent). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>('meta');
  if (meta.get('schemaVersion') === SCHEMA_VERSION) {
    return;
  }
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (world units), on top of everything
 * else. Returns the new id, or an empty string when the point or colour is
 * invalid (no id exists, and no transaction is opened).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) {
    return '';
  }
  if (!isStickyColor(color)) {
    return '';
  }
  const id = randomId();
  doc.transact(() => {
    const objects = objectMapOf(doc);
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    // Coordinates are the note's top-left, so the stored position is half a
    // note up and to the left of the point it is centred on.
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text(''));
    note.set('z', maxZ(objects) + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move an object to a new top-left position. `false` when stale or a no-op. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return false;
  }
  const note = asObjectMap(objectMapOf(doc).get(id));
  if (!note) {
    return false;
  }
  if (note.get('x') === x && note.get('y') === y) {
    return false;
  }
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise an object above every other one. `false` when stale or already on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectMapOf(doc);
  const note = asObjectMap(objects.get(id));
  if (!note) {
    return false;
  }
  const highest = maxZ(objects);
  if (note.get('z') === highest) {
    return false;
  }
  doc.transact(() => {
    note.set('z', highest + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a sticky's colour. `false` for a stale id, unknown or unchanged colour. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) {
    return false;
  }
  const note = asObjectMap(objectMapOf(doc).get(id));
  if (!note || note.get('type') !== 'sticky') {
    return false;
  }
  if (note.get('color') === color) {
    return false;
  }
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. `false` when the id is stale. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectMapOf(doc);
  if (!objects.has(id)) {
    return false;
  }
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's `Y.Text` (shared with story 3), or `undefined` for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = asObjectMap(objectMapOf(doc).get(id));
  if (!note || note.get('type') !== 'sticky') {
    return undefined;
  }
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

const stickyFrom = (id: string, value: unknown): StickySnapshot | undefined => {
  const note = asObjectMap(value);
  if (!note || note.get('type') !== 'sticky') {
    return undefined; // stories 9-12 add other types: skip them here
  }
  const x = note.get('x');
  const y = note.get('y');
  const z = note.get('z');
  const createdAt = note.get('createdAt');
  const color = note.get('color');
  const text = note.get('text');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return undefined; // a half-written object is not renderable
  }
  return Object.freeze({
    id,
    type: 'sticky' as const,
    x,
    y,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  });
};

/**
 * Immutable render model: sticky notes only, ordered by `(z, id)` so every
 * client computes the same stacking even when concurrent edits produce equal
 * `z` values.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectMapOf(doc).forEach((value, id) => {
    const note = stickyFrom(id, value);
    if (note) {
      notes.push(note);
    }
  });
  notes.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}
