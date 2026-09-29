import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/**
 * Board document model: the Yjs schema plus every mutation the client (and,
 * from story 4, the Durable Object) performs. Framework-free on purpose so the
 * Durable Object can import it for validation/migration. See design.md "Board
 * document model" (anchor board.model).
 *
 * Schema:
 *   Y.Doc
 *     meta:    Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string, Y.Map> where each value is
 *              { type:'sticky', x, y, color, text: Y.Text, z, createdAt }
 */

/** Transaction origin for local edits (used by story 8 undo, story 3 echo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** The persisted/wire schema version (story 4 migration hook). */
export const SCHEMA_VERSION = 1;

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

const META = 'meta';
const OBJECTS = 'objects';

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>(OBJECTS);

const isSticky = (value: unknown): value is Y.Map<unknown> =>
  value instanceof Y.Map && value.get('type') === 'sticky';

const isColor = (value: string): value is StickyColor =>
  Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);

const finite = (value: number): boolean => Number.isFinite(value);

/** (z, id) ascending: higher z later; equal z tie-broken by id for stability. */
const compareOrder = (a: { z: number; id: string }, b: { z: number; id: string }): number =>
  a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Create the schema markers if absent. Idempotent: a document that already
 * carries `meta.schemaVersion` gets no transaction (no update event).
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
    // Touching `objects` inside the same transaction guarantees it exists in
    // the shared structure so subscribers observe the same top-level type.
    objectsMap(doc);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (top-left = at - half size), on top of
 * every existing note. Returns the new id, or '' when `at` is not finite.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!finite(at.x) || !finite(at.y)) return '';

  let maxZ = 0;
  objectsMap(doc).forEach((value) => {
    if (isSticky(value)) {
      const z = value.get('z');
      if (typeof z === 'number' && z > maxZ) maxZ = z;
    }
  });

  const id = crypto.randomUUID();
  const note = new Y.Map<unknown>();
  doc.transact(() => {
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ + 1);
    note.set('createdAt', Date.now());
    objectsMap(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note (top-left world coordinates). Rejects stale ids, non-finite. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!finite(x) || !finite(y)) return false;
  const note = objectsMap(doc).get(id);
  if (!isSticky(note)) return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above every other note (z = maxZ + 1). No-op when topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  let maxZ = 0;
  let topId: string | null = null;
  let topZ = -Infinity;
  let found = false;

  objectsMap(doc).forEach((value, key) => {
    if (!isSticky(value)) return;
    const z = value.get('z');
    const zn = typeof z === 'number' ? z : 0;
    if (zn > maxZ) maxZ = zn;
    if (topId === null || compareOrder({ z: zn, id: key }, { z: topZ, id: topId }) > 0) {
      topZ = zn;
      topId = key;
    }
    if (key === id) found = true;
  });

  if (!found || topId === id) return false;
  const note = objectsMap(doc).get(id);
  if (!isSticky(note)) return false;
  doc.transact(() => {
    note.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's colour. Rejects stale ids and unknown colour names. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isColor(color)) return false;
  const note = objectsMap(doc).get(id);
  if (!isSticky(note)) return false;
  if (note.get('color') === color) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. Rejects stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared Y.Text, or undefined for a missing / non-note id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objectsMap(doc).get(id);
  if (!isSticky(note)) return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * An immutable snapshot of every sticky note, sorted by (z, id) ascending so
 * the renderer paints lowest-first (the last entry is on top). Objects with an
 * unknown `type` are skipped (forward compatibility for stories 9-12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const result: StickySnapshot[] = [];
  objectsMap(doc).forEach((value, id) => {
    if (!isSticky(value)) return;
    const color = value.get('color');
    const text = value.get('text');
    result.push({
      id,
      type: 'sticky',
      x: value.get('x') as number,
      y: value.get('y') as number,
      color: isColor(color as string) ? (color as StickyColor) : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: value.get('z') as number,
      createdAt: value.get('createdAt') as number,
    });
  });
  result.sort(compareOrder);
  return result;
}
