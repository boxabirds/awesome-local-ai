/**
 * Board document model (story 2): the Yjs schema plus every mutation.
 *
 * Framework-free on purpose: the Durable Object (story 4) imports this module for
 * validation and migration, and the live-sync provider (story 3) reuses the same
 * transaction origin. Nothing here touches React or the DOM.
 *
 * Schema (this becomes the persisted format in story 4 and the wire format in story 3):
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string /* id *\/, Y.Map>
 *       <id>: Y.Map {
 *         type: 'sticky'
 *         x: number, y: number   // top-left corner, world units
 *         color: StickyColor
 *         text: Y.Text
 *         z: number              // stacking; higher is on top
 *         createdAt: number      // epoch ms
 *       }
 *
 * Unknown `type` values are skipped by the renderer (forward compatibility for
 * later object stories).
 */
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

/** Transaction origin for local user edits (undo in story 8, echo-avoidance in story 3). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

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

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStickyColor = (value: unknown): value is StickyColor =>
  typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects');

/** Read a sticky Y.Map into a snapshot; `null` for unknown shapes or types. */
const readSticky = (id: string, map: Y.Map<unknown>): StickySnapshot | null => {
  if (map.get('type') !== 'sticky') return null;
  const text = map.get('text');
  return {
    id,
    type: 'sticky',
    x: map.get('x') as number,
    y: map.get('y') as number,
    color: map.get('color') as StickyColor,
    text: text instanceof Y.Text ? text.toString() : '',
    z: map.get('z') as number,
    createdAt: map.get('createdAt') as number,
  };
};

/** Highest existing `z` over all objects, or 0 when the board is empty. */
const maxZ = (objects: Y.Map<Y.Map<unknown>>): number => {
  let max = 0;
  for (const map of objects.values()) {
    const z = map.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
};

/** Set `meta.schemaVersion` to 1 when absent. Safe to call repeatedly. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', 1);
  }, LOCAL_ORIGIN);
}

/**
 * Create a square sticky note centred on `at` (the point the user clicked), on top
 * of every other object. Returns the new id, or `''` when `at` is not a finite
 * point or `color` is unknown (never throws for user-driven input).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  // Contract: never throws for user-driven input; invalid input is rejected with
  // an empty (falsy) id and no transaction.
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return '';
  if (!isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const objects = objectsMap(doc);
    const map = new Y.Map<unknown>();
    map.set('type', 'sticky');
    map.set('x', at.x - STICKY_SIZE_WORLD / 2);
    map.set('y', at.y - STICKY_SIZE_WORLD / 2);
    map.set('color', color);
    map.set('text', new Y.Text());
    map.set('z', maxZ(objects) + 1);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note to world `(x, y)` (top-left). Returns false for stale ids. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const objects = objectsMap(doc);
  const map = objects.get(id);
  if (!map || map.get('type') !== 'sticky') return false;
  doc.transact(() => {
    const current = objects.get(id);
    if (!current) return;
    current.set('x', x);
    current.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Stack a note above all others. A no-op false when it is already on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const map = objects.get(id);
  if (!map || map.get('type') !== 'sticky') return false;
  const z = map.get('z');
  const top = maxZ(objects);
  if (isFiniteNumber(z) && z >= top) return false;
  doc.transact(() => {
    const current = objects.get(id);
    if (!current) return;
    current.set('z', maxZ(objects) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Recolour a sticky note. Returns false for stale ids and unknown colours. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const objects = objectsMap(doc);
  const map = objects.get(id);
  if (!map || map.get('type') !== 'sticky') return false;
  doc.transact(() => {
    const current = objects.get(id);
    if (!current) return;
    current.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove any object. Returns false for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The live `Y.Text` of a sticky note, or `undefined` for stale/non-sticky ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'sticky') return undefined;
  const text = map.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable render list: every known sticky, sorted by **id**.
 *
 * Deliberately not sorted by `z`: the renderer maps this list straight to DOM nodes,
 * and re-ordering the DOM moves the element that currently holds pointer capture,
 * which Chromium drops when the node is re-inserted — killing an in-flight drag the
 * moment `bringToFront` runs. Painting order therefore comes from each note's `z`
 * applied as `z-index`, and the id tie-break keeps the list identical for every
 * client once story 3 syncs. Unknown `type` values are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, map] of objectsMap(doc)) {
    const note = readSticky(id, map);
    if (note) notes.push(note);
  }
  notes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}
