import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

/**
 * Board document model: the Yjs schema and every mutation a user can perform on the board.
 *
 * The module is framework-free and side-effect-free apart from the document itself, so the
 * client uses it today and the Durable Object (story 4) can import the same code for
 * validation and migration. This schema is also the future persisted format (story 4) and
 * the wire format (story 3), which is why `meta.schemaVersion` exists.
 *
 * Schema:
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map> with, per note:
 *            { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`; rejections
 * (stale id, unknown colour, non-finite coordinates, already-topmost `bringToFront`) return
 * `false` *before* opening a transaction, so they emit no update and — from story 3 on — no
 * sync traffic. The functions never throw for user-driven input.
 */

/** Transaction origin of local user edits (story 8 undo manager, story 3 echo filter). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Current document schema version, written to `meta.schemaVersion` by `initDoc`. */
export const SCHEMA_VERSION = 1;

const META_MAP = 'meta';
const OBJECTS_MAP = 'objects';

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

const metaMap = (doc: Y.Doc): Y.Map<unknown> => doc.getMap(META_MAP);

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap(OBJECTS_MAP) as unknown as Y.Map<Y.Map<unknown>>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStickyColor = (value: unknown): value is StickyColor =>
  typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);

const numberField = (map: Y.Map<unknown>, key: string, fallback = 0): number => {
  const value = map.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

/**
 * Prepare a document for use: records the schema version when absent. Idempotent — a second
 * call writes nothing, so re-attaching a provider or re-loading a stored document is free.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/** Largest `z` currently in use across all objects (0 for an empty board). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const value of objectsMap(doc).values()) {
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > top) top = z;
  }
  return top;
}

/**
 * Create a sticky note centred on the world point `at` (so its top-left is
 * `at` minus half the note size) on top of every other object, and return its id.
 *
 * Returns the empty string when `at` is not a finite point; nothing is written then.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFiniteNumber(at?.x) || !isFiniteNumber(at?.y)) return '';
  const fill: StickyColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;

  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', 'sticky');
    map.set('x', at.x - STICKY_SIZE_WORLD / 2);
    map.set('y', at.y - STICKY_SIZE_WORLD / 2);
    map.set('color', fill);
    map.set('text', new Y.Text(''));
    map.set('z', z);
    map.set('createdAt', Date.now());
    objectsMap(doc).set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note (world coordinates for its top-left). `false` for a stale id. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const map = objectsMap(doc).get(id);
  if (!map) return false;
  doc.transact(() => {
    map.set('x', x);
    map.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raise a note above every other object (`z = maxZ + 1`). `false` — with no transaction —
 * when the note is missing or already the uniquely topmost object, so a pointless raise
 * never produces sync traffic in story 3. Notes tied on the top `z` are still raised, since
 * the `(z, id)` render order would change.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const map = objectsMap(doc).get(id);
  if (!map) return false;
  const z = numberField(map, 'z');
  let aboveOrTied = false;
  for (const other of objectsMap(doc).values()) {
    if (other === map) continue;
    const otherZ = numberField(other, 'z');
    if (otherZ >= z) {
      aboveOrTied = true;
      break;
    }
  }
  if (!aboveOrTied) return false;
  const target = maxZ(doc) + 1;
  doc.transact(() => {
    map.set('z', target);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's fill colour. `false` for a stale id or a colour outside `STICKY_COLORS`. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const map = objectsMap(doc).get(id);
  if (!map) return false;
  if (map.get('color') === color) return false;
  doc.transact(() => {
    map.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. `false` for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const map = objectsMap(doc).get(id);
  if (!map) return false;
  doc.transact(() => {
    objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, or `undefined` when the id is stale or not a note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'sticky') return undefined;
  const text = map.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable render model: every known sticky note sorted by `(z, id)` — the id tie-break
 * keeps concurrent equal `z` values (possible once story 3 syncs) in the same order on
 * every client. Objects with an unknown `type` are skipped, so later stories' objects do
 * not break an older client.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, map] of objectsMap(doc)) {
    if (map.get('type') !== 'sticky') continue;
    const text = map.get('text');
    const color = map.get('color');
    notes.push({
      id,
      type: 'sticky',
      x: numberField(map, 'x'),
      y: numberField(map, 'y'),
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: numberField(map, 'z'),
      createdAt: numberField(map, 'createdAt'),
    });
  }
  notes.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return notes;
}
