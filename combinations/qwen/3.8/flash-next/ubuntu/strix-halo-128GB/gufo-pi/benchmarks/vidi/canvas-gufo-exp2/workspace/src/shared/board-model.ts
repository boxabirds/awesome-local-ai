import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/**
 * The board document schema and every mutation the UI performs on it.
 *
 * Framework-free on purpose: the Durable Object (story 4) imports this module
 * for validation and migration, and the client (story 3) syncs the same
 * document over the network. This story keeps the document in memory only.
 *
 * Schema
 * ```
 * Y.Doc
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<string /* id *\/, Y.Map>
 *     <id>: Y.Map {
 *       type: 'sticky'
 *       x: number, y: number        // top-left, world units
 *       color: StickyColor
 *       text: Y.Text
 *       z: number                   // stacking; higher is on top
 *       createdAt: number           // epoch ms
 *     }
 * ```
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
 * the origin lets story 8 attach undo and story 3 skip echoes. A rejected or
 * no-op mutation returns `false` before a transaction is opened, so it emits
 * no update at all. The module never throws for user-driven input.
 */

export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Schema version written to `meta.schemaVersion` by `initDoc`. */
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

const COLOR_NAMES = Object.keys(STICKY_COLORS) as readonly StickyColor[];

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && (COLOR_NAMES as readonly string[]).includes(value);
}

/** A coordinate the document may store: finite and numeric. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** Prepare `doc` for this schema; idempotent, never overwrites a migration. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/** Highest `z` currently in the document (0 when there are no objects). */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const object of objectsMap(doc).values()) {
    const z = object.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/**
 * Add a sticky note whose centre is `at` (world units), on top of everything
 * else. Returns the new id. An invalid or unknown colour falls back to the
 * default, so the document always holds a valid colour.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const x = isFiniteNumber(at?.x) ? at.x : 0;
  const y = isFiniteNumber(at?.y) ? at.y : 0;
  const safeColor: StickyColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  const z = maxZ(doc) + 1;
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', x - STICKY_SIZE_WORLD / 2);
    note.set('y', y - STICKY_SIZE_WORLD / 2);
    note.set('color', safeColor);
    note.set('text', new Y.Text());
    note.set('z', z);
    note.set('createdAt', Date.now());
    objectsMap(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Look up a sticky note's Y.Map by id; undefined when absent or not a sticky. */
function stickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const object = objectsMap(doc).get(id);
  if (!object || object.get('type') !== 'sticky') return undefined;
  return object;
}

/** Move the note's top-left to (x, y) in world units. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const note = stickyMap(doc, id);
  if (!note) return false;
  if (note.get('x') === x && note.get('y') === y) return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise the note above every other object. No-op when it is already on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const note = stickyMap(doc, id);
  if (!note) return false;
  const z = maxZ(doc);
  if (note.get('z') === z) return false;
  doc.transact(() => {
    note.set('z', z + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a sticky note's colour. Rejects unknown colour names. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const note = stickyMap(doc, id);
  if (!note) return false;
  if (note.get('color') === color) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove any object by id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shared text of a sticky note, for the editor to diff into. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = stickyMap(doc, id);
  if (!note) return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** Build one immutable snapshot object, or undefined when the entry is malformed. */
function readSticky(id: string, note: Y.Map<unknown>): StickySnapshot | undefined {
  const { x, y, color, z, createdAt } = {
    x: note.get('x'),
    y: note.get('y'),
    color: note.get('color'),
    z: note.get('z'),
    createdAt: note.get('createdAt'),
  };
  const text = note.get('text');
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isStickyColor(color) ||
    !isFiniteNumber(z) ||
    !isFiniteNumber(createdAt) ||
    !(text instanceof Y.Text)
  ) {
    return undefined;
  }
  return Object.freeze({
    id,
    type: 'sticky' as const,
    x,
    y,
    color,
    text: text.toString(),
    z,
    createdAt,
  });
}

/**
 * All sticky notes as plain immutable data, sorted by (z, id) so every client
 * renders the same order even when concurrent edits produce equal z values.
 * Objects of unknown or malformed shape are skipped (forward compatibility
 * with stories 9–12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, object] of objectsMap(doc)) {
    if (!object || object.get('type') !== 'sticky') continue;
    const note = readSticky(id, object);
    if (note) notes.push(note);
  }
  notes.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(notes);
}
