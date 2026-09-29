/**
 * The board document model: the Yjs schema and every mutation the board performs.
 *
 * Framework-free on purpose — the client renders a snapshot of it today, and from
 * story 4 the Durable Object imports the very same module to validate and migrate
 * the persisted document. This story keeps the document in memory only.
 *
 * Document schema:
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<string /* id *\/, Y.Map>
 *     <id>: { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 *
 * Every successful mutation runs inside a single `doc.transact(fn, LOCAL_ORIGIN)`,
 * which emits exactly one `update`. A rejected call (stale id, unknown colour,
 * non-finite numbers, bring-to-front on the top note) returns `false` *before*
 * opening a transaction, so it emits nothing — this keeps story 3's sync free of
 * no-op traffic and story 8's undo free of no-op steps.
 */
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config.js';

/**
 * The transaction origin every local mutation passes to `doc.transact`. Story 8's
 * undo manager filters on it, and story 3 uses it to avoid echoing a change back to
 * the peer that made it. A `unique symbol` keeps it from colliding with any other
 * origin a provider might use.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** The persisted/wire schema version this build writes and expects. */
export const SCHEMA_VERSION = 1;

/** An immutable read view of one sticky note in the document. */
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

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStickyColor = (value: unknown): value is StickyColor =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);

const metaMap = (doc: Y.Doc): Y.Map<unknown> => doc.getMap('meta');

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap('objects') as Y.Map<Y.Map<unknown>>;

/** The `Y.Map` for `id`, or undefined when absent or not a map. */
const objectEntry = (doc: Y.Doc, id: string): Y.Map<unknown> | undefined => {
  const entry = objectsMap(doc).get(id);
  return entry instanceof Y.Map ? entry : undefined;
};

/** The `Y.Map` for a sticky note only; undefined for a missing or non-sticky id. */
const stickyEntry = (doc: Y.Doc, id: string): Y.Map<unknown> | undefined => {
  const entry = objectEntry(doc, id);
  return entry && entry.get('type') === 'sticky' ? entry : undefined;
};

/** Highest `z` across every object (0 when the board is empty). */
const maxZ = (objects: Y.Map<Y.Map<unknown>>): number => {
  let highest = 0;
  for (const entry of objects.values()) {
    const z = entry.get('z');
    if (typeof z === 'number' && z > highest) highest = z;
  }
  return highest;
};

/** Prepare a document for use: set `meta.schemaVersion` once if it is absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/** Add a sticky centred on world point `at`; returns its new id ('' when rejected). */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color?: StickyColor,
): string {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return '';
  const safeColor: StickyColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
  const id = crypto.randomUUID();
  const objects = objectsMap(doc);
  const z = maxZ(objects) + 1;
  const createdAt = Date.now();
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', safeColor);
    note.set('text', new Y.Text(''));
    note.set('z', z);
    note.set('createdAt', createdAt);
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note's top-left to (x, y); false when the id is missing or a number is not finite. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const entry = stickyEntry(doc, id);
  if (!entry) return false;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  doc.transact(() => {
    entry.set('x', x);
    entry.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above every other; false when it is already on top or the id is missing. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const entry = stickyEntry(doc, id);
  if (!entry) return false;
  const objects = objectsMap(doc);
  const top = maxZ(objects);
  const current = entry.get('z');
  // Already the highest: a no-op that must not emit an update.
  if (typeof current === 'number' && current >= top) return false;
  doc.transact(() => {
    entry.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Repaint a note; false when the id is missing or the colour name is unknown. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const entry = stickyEntry(doc, id);
  if (!entry) return false;
  if (!isStickyColor(color)) return false;
  doc.transact(() => {
    entry.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note; false when the id is missing. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const entry = stickyEntry(doc, id);
  if (!entry) return false;
  doc.transact(() => {
    objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's live `Y.Text` handle, or undefined when the id is missing. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = stickyEntry(doc, id);
  if (!entry) return undefined;
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** Read one note into an immutable snapshot (undefined for a non-sticky entry). */
const readSticky = (id: string, entry: Y.Map<unknown>): StickySnapshot | undefined => {
  if (entry.get('type') !== 'sticky') return undefined;
  const text = entry.get('text');
  const color = entry.get('color');
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
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
};

/** Compare by (z, id) so equal z values (possible once story 3 syncs) still order identically. */
const byThenId = (a: StickySnapshot, b: StickySnapshot): number =>
  a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** All sticky notes as an immutable array sorted by (z, id); unknown types are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, entry] of objectsMap(doc).entries()) {
    if (!(entry instanceof Y.Map)) continue; // forward-compatible skip
    const note = readSticky(id, entry);
    if (note) notes.push(note);
  }
  notes.sort(byThenId);
  return notes;
}
