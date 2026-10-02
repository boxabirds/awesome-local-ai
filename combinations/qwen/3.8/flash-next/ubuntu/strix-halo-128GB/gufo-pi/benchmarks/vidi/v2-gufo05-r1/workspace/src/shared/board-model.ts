/**
 * The board document: a Yjs schema plus every mutation the app performs.
 *
 * Notes live in a `Y.Doc` from the first story that puts anything on the board,
 * so story 3 only has to attach a network provider and story 4 only has to
 * persist this same document. The module is framework-free (no React, no DOM)
 * so the Durable Object can import it unchanged.
 *
 * ```
 * Y.Doc
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<string, Y.Map>
 *     <id>: Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 * ```
 *
 * `x, y` is the note's top-left in world units; `z` is stacking order (higher is
 * on top) and `snapshot` sorts by `(z, id)` so clients that merge concurrent
 * equal `z` values still agree on the order.
 *
 * Errors are values, never exceptions: a stale id, an unknown colour name or a
 * non-finite coordinate makes the call return "no change" (`false`, or `''` for
 * `createSticky`) without opening a transaction, so nothing is synced or
 * persisted for a mutation that did not happen.
 */
import * as Y from 'yjs';

import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

/**
 * Origin of every transaction this module opens. Story 8 uses it to scope undo
 * to local changes and story 3 to avoid echoing changes back over the wire.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Document layout keys, part of the persisted and wire format. */
export const META_KEY = 'meta';
export const OBJECTS_KEY = 'objects';
export const SCHEMA_VERSION = 1;

/** The only object type this story knows; stories 9-12 add the rest. */
export const STICKY_TYPE = 'sticky';

/** An immutable view of one sticky note, as React renders it. */
export interface StickySnapshot {
  readonly id: string;
  readonly type: 'sticky';
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
  readonly z: number;
  readonly createdAt: number;
}

const AN_EPOCH = 0;

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META_KEY) as Y.Map<unknown>;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>;
}

export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);
}

/** A point the board can place a note at. */
function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

/** The `Y.Map` for a sticky note, or `undefined` for a stale/foreign id. */
function stickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== STICKY_TYPE) return undefined;
  return map;
}

function noteText(map: Y.Map<unknown>): Y.Text {
  const existing = map.get('text');
  return existing instanceof Y.Text ? existing : new Y.Text();
}

function readSticky(id: string, map: Y.Map<unknown>): StickySnapshot | null {
  if (map.get('type') !== STICKY_TYPE) return null; // stories 9-12 add types
  const x = map.get('x');
  const y = map.get('y');
  const z = map.get('z');
  const createdAt = map.get('createdAt');
  const color = map.get('color');
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  return {
    id,
    type: STICKY_TYPE,
    x,
    y,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: noteText(map).toString(),
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : AN_EPOCH,
  };
}

/** Stacking order: `z` ascending, ids breaking ties so all clients agree. */
function compareStack(left: StickySnapshot, right: StickySnapshot): number {
  if (left.z !== right.z) return left.z - right.z;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/** Create the `meta` and `objects` containers if they are not there yet. */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (typeof meta.get('schemaVersion') === 'number') return; // already initialised
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Add a sticky note centred on `at` (world units), on top of every other note.
 * Returns the new id, or `''` when the coordinates are not finite.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!at || !isFinitePoint(at.x, at.y) || !isStickyColor(color)) return '';

  const objects = objectsMap(doc);
  const id = crypto.randomUUID();
  const z = highestZ(doc) + 1;
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', STICKY_TYPE);
    map.set('x', at.x - STICKY_SIZE_WORLD / 2);
    map.set('y', at.y - STICKY_SIZE_WORLD / 2);
    map.set('color', color);
    map.set('text', new Y.Text());
    map.set('z', z);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** Largest `z` among the known objects, or 0 for an empty board. */
function highestZ(doc: Y.Doc): number {
  let highest = 0;
  for (const map of objectsMap(doc).values()) {
    const z = map.get('z');
    if (typeof z === 'number' && z > highest) highest = z;
  }
  return highest;
}

/** Move a note to a new top-left. `false` for stale ids or non-finite input. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const map = stickyMap(doc, id);
  if (!map || !isFinitePoint(x, y)) return false;
  doc.transact(() => {
    map.set('x', x);
    map.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above every other note. `false` when it is already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const map = stickyMap(doc, id);
  if (!map) return false;
  const notes = snapshot(doc);
  const top = notes[notes.length - 1];
  // Already the note drawn last (ties included): writing `z` again would only
  // produce pointless sync traffic in story 3.
  if (!top || top.id === id) return false;
  const z = highestZ(doc) + 1;
  doc.transact(() => {
    map.set('z', z);
  }, LOCAL_ORIGIN);
  return true;
}

/** Set a note's colour. `false` for stale ids and unknown colour names. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const map = stickyMap(doc, id);
  if (!map || !isStickyColor(color)) return false;
  doc.transact(() => {
    map.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note. `false` for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's `Y.Text`, or `undefined` when the id is stale or not a note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = stickyMap(doc, id);
  if (!map) return undefined;
  const text = map.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** Every known note, sorted by `(z, id)`. Unknown types are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, map] of objectsMap(doc)) {
    const note = readSticky(id, map);
    if (note) notes.push(note);
  }
  notes.sort(compareStack);
  return Object.freeze(notes);
}
