/**
 * The board document model: a Yjs schema plus every mutation the client (and,
 * from story 4, the Durable Object) performs. Framework-free by design.
 *
 * Schema (the future persisted and wire contract):
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string /* id *\/, Y.Map>
 *       <id>: Y.Map {
 *         type: 'sticky'
 *         x: number, y: number   // top-left, world units
 *         color: StickyColor
 *         text: Y.Text
 *         z: number              // stacking; higher is on top
 *         createdAt: number      // epoch ms
 *       }
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`.
 * Rejections (stale id, unknown colour, non-finite coordinates, pointless
 * no-ops) return `false` before opening a transaction, so no update event is
 * emitted. The module never throws for user-driven input.
 */
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/** Origin tag for every local mutation (story 8 undo, story 3 echo filter). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

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

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

/** Set `meta.schemaVersion` when absent; never overwrites an existing value. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/**
 * Create a sticky note centred on `at` (top-left is `at` minus half the note
 * size), on top of every existing note. Returns the new id, or `''` when the
 * point is not finite or the colour is unknown.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFinitePoint(at.x, at.y) || !isStickyColor(color)) return '';
  const objects = objectsMap(doc);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const note = new Y.Map();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ(objects) + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note by id. Returns false when the id is stale or a coordinate is not finite. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinitePoint(x, y)) return false;
  const note = objectsMap(doc).get(id);
  if (!note || note.get('type') !== 'sticky') return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above all others (`z = maxZ + 1`). False when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const note = objects.get(id);
  if (!note || note.get('type') !== 'sticky') return false;
  const target = maxZ(objects) + 1;
  const current = note.get('z');
  if (typeof current === 'number' && current >= target - 1) return false;
  doc.transact(() => {
    note.set('z', maxZ(objects) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Recolour a note. Unknown colour names or stale ids return false and write nothing. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const note = objectsMap(doc).get(id);
  if (!note || note.get('type') !== 'sticky') return false;
  if (note.get('color') === color) return true;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. False when the id is unknown. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shared Y.Text of a sticky note, for the text editor. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objectsMap(doc).get(id);
  if (!note || note.get('type') !== 'sticky') return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function readSticky(id: string, note: Y.Map<unknown>): StickySnapshot | null {
  if (note.get('type') !== 'sticky') return null;
  const text = note.get('text');
  const x = note.get('x');
  const y = note.get('y');
  const z = note.get('z');
  const createdAt = note.get('createdAt');
  const color = note.get('color');
  return {
    id,
    type: 'sticky',
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: typeof z === 'number' ? z : 0,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}

/**
 * An immutable list of every sticky note, ordered by `(z, id)` so clients that
 * sync (story 3) still agree on stacking when concurrent edits produce equal
 * `z` values. Objects with unknown `type` values are skipped (forward
 * compatibility for later stories).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  for (const [id, note] of objectsMap(doc).entries()) {
    const snap = readSticky(id, note);
    if (snap) out.push(snap);
  }
  out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
