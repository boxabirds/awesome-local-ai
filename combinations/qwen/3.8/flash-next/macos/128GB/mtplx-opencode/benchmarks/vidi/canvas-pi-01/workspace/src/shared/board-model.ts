/**
 * Story 2 · the board document model (design "Board document model").
 *
 * A framework-free module that owns every mutation of the shared document. It
 * is written against a real `Y.Doc` so the exact same code will, in story 3,
 * be synced between people and, in story 4, persisted by the Durable Object —
 * hence `meta.schemaVersion` and the transaction origin.
 *
 * Document schema:
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map { type, x, y, color, text: Y.Text, z, createdAt }>
 *
 * The module never throws for user-driven input: a stale id, an unknown colour
 * or a non-finite coordinate returns `false` and opens no transaction (so no
 * pointless update / sync traffic). A successful mutation is exactly one
 * `doc.transact(fn, LOCAL_ORIGIN)`.
 */
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';
import { rectContains, type Rect } from './geometry';

/**
 * The object types the board renderer knows how to show. Select-all and
 * marquee only ever pick types from this set, so a `type` written by a newer
 * client (stories 9–12) never becomes selectable or resolvable until its
 * registry entry is registered here (PRD `sel.all_types`, TC-08).
 */
const KNOWN_TYPES: ReadonlySet<string> = new Set(['sticky']);

/**
 * Transaction origin for local edits. Story 8's undo manager and story 3's
 * provider distinguish local from remote changes by origin, so every local
 * mutation is tagged with this single symbol.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/**
 * An immutable view of one board object, safe to hand to React.
 *
 * Story 7 broadened this from sticky-note-only to a generic object snapshot:
 * every object carries a bounding size (`width`/`height`, falling back to the
 * default sticky size when a document predates explicit sizes). The sticky-only
 * fields (`color`, `text`) stay optional so the sticky renderer and the
 * cross-document convergence checks keep working while later-story object types
 * (which have neither) can share the same shape. `StickySnapshot` is kept as an
 * alias so existing imports are unaffected.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  createdAt: number;
  color?: StickyColor;
  text?: string;
}

/** @deprecated Kept for source compatibility; use {@link ObjectSnapshot}. */
export type StickySnapshot = ObjectSnapshot;

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';

type StickyRecord = Y.Map<unknown>;

function objects(doc: Y.Doc): Y.Map<StickyRecord> {
  return doc.getMap<StickyRecord>(OBJECTS_KEY);
}

function isSticky(record: StickyRecord | undefined): record is StickyRecord {
  return record !== undefined && record.get('type') === 'sticky';
}

/** Highest `z` currently in the document (0 when empty). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  objects(doc).forEach((record) => {
    if (!isSticky(record)) return;
    const z = record.get('z');
    if (typeof z === 'number' && z > top) top = z;
  });
  return top;
}

function finite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

/** A stable identifier. Falls back where `crypto.randomUUID` is unavailable. */
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback for exotic runtimes; still effectively unique.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Ensure the document metadata exists (idempotent: only writes once). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META_KEY);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      if (meta.get('schemaVersion') === undefined) meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a sticky note centred on `at` (the top-left is `at` minus half the
 * note size), on top of every other note (z = maxZ + 1). Returns the new id.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const id = newId();
  const top = maxZ(doc) + 1;
  const half = STICKY_SIZE_WORLD / 2;
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - half);
    note.set('y', at.y - half);
    note.set('color', color);
    note.set('text', new Y.Text(''));
    note.set('z', top);
    note.set('createdAt', Date.now());
    objects(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move a note to world `(x, y)`. Returns false (no transaction) for a stale
 * id or a non-finite coordinate.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const record = objects(doc).get(id);
  if (!isSticky(record)) return false;
  if (!finite(x, y)) return false;
  if (record.get('x') === x && record.get('y') === y) return false;
  doc.transact(() => {
    record.set('x', x);
    record.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raise a note to the front. Returns false (no transaction) for a stale id or
 * a note that is already the topmost — avoiding pointless sync traffic later.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const record = objects(doc).get(id);
  if (!isSticky(record)) return false;
  const current = record.get('z');
  if (typeof current !== 'number') return false;
  const top = maxZ(doc);
  if (current >= top) return false;
  doc.transact(() => {
    record.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Change a note's colour. Rejects an unknown colour name and a no-op recolour
 * (already that colour), returning false without a transaction.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const record = objects(doc).get(id);
  if (!isSticky(record)) return false;
  if (!Object.prototype.hasOwnProperty.call(STICKY_COLORS, color)) return false;
  if (record.get('color') === color) return false;
  doc.transact(() => {
    record.set('color', color as StickyColor);
  }, LOCAL_ORIGIN);
  return true;
}

/** Delete a note. Returns false (no transaction) for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const map = objects(doc);
  if (!map.has(id)) return false;
  doc.transact(() => {
    map.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's `Y.Text`, or undefined if the id is missing or not a note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const record = objects(doc).get(id);
  if (!isSticky(record)) return undefined;
  return record.get('text') as Y.Text | undefined;
}

/* ---- Story 7 · multi-object operations (one undo step, one broadcast) ------ */

/**
 * Move every listed object to an absolute world position in ONE transaction.
 * A `positions` entry with a non-finite coordinate is skipped; a missing id is
 * skipped. Returns the number of objects actually moved.
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): number {
  const map = objects(doc);
  const writes: Array<[StickyRecord, number, number]> = [];
  for (const [id, at] of positions) {
    const record = map.get(id);
    if (record === undefined) continue;
    if (!finite(at.x, at.y)) continue;
    if (record.get('x') === at.x && record.get('y') === at.y) continue;
    writes.push([record, at.x, at.y]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [record, x, y] of writes) {
      record.set('x', x);
      record.set('y', y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Resize every listed object to an absolute world rectangle in ONE transaction.
 * The first resize writes `width`/`height`, making an implicit sticky size
 * explicit (design: no migration, the size is written on first resize). A rect
 * with any non-finite component is skipped; so is a missing id. Returns the
 * number of objects actually resized.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  const map = objects(doc);
  const writes: Array<[StickyRecord, Rect]> = [];
  for (const [id, rect] of rects) {
    const record = map.get(id);
    if (record === undefined) continue;
    if (!finite(rect.x, rect.y, rect.width, rect.height)) continue;
    writes.push([record, rect]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [record, rect] of writes) {
      record.set('x', rect.x);
      record.set('y', rect.y);
      record.set('width', rect.width);
      record.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Delete every listed object in ONE transaction. Missing ids are skipped.
 * Returns the number of objects actually deleted (design: deletes are undoable
 * as one step because they happen in one transaction).
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const map = objects(doc);
  const present: string[] = [];
  for (const id of ids) {
    if (map.has(id)) present.push(id);
  }
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) map.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/**
 * Raise every listed object above the unselected objects in ONE transaction,
 * preserving the selection's relative order (design Key decision 4). New z
 * values start one above the top of everything, so the whole selection lifts as
 * a block. If every selected object is *already* above every unselected one,
 * nothing changes and 0 is returned (no transaction, no pointless sync).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const map = objects(doc);
  const selectedIds = new Set(ids);

  const selected: Array<{ record: StickyRecord; z: number; index: number }> = [];
  let index = 0;
  for (const id of ids) {
    const record = map.get(id);
    if (record === undefined) continue;
    const z = record.get('z');
    if (typeof z !== 'number') continue;
    selected.push({ record, z, index: index++ });
  }
  if (selected.length === 0) return 0;

  // The highest z among objects NOT in the selection.
  let unselectedMax = 0;
  map.forEach((record, id) => {
    if (selectedIds.has(id)) return;
    const z = record.get('z');
    if (typeof z === 'number' && z > unselectedMax) unselectedMax = z;
  });

  // Order the selection bottom-to-top (current z, ties keep call order) so the
  // lift preserves that order.
  const ordered = [...selected].sort((a, b) => (a.z !== b.z ? a.z - b.z : a.index - b.index));
  // If the lowest selected object already sits above everything unselected, the
  // block is already at the front — leave the document untouched.
  if (ordered.every((item) => item.z > unselectedMax)) return 0;

  doc.transact(() => {
    for (let i = 0; i < ordered.length; i++) {
      ordered[i].record.set('z', unselectedMax + 1 + i);
    }
  }, LOCAL_ORIGIN);
  return ordered.length;
}

/**
 * A plain, immutable snapshot of every object, ordered by `(z, id)` so the
 * render order is deterministic even once equal `z` values appear after a
 * story-3 merge. Unknown `type` values are skipped (forward compatibility): a
 * type is only snapshotted when it is registered in {@link KNOWN_TYPES} or
 * declared on `globalThis.__vidi6TestTypes` (used by the test-only fixtures).
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const result: ObjectSnapshot[] = [];
  const allowed = allowedTypes();
  objects(doc).forEach((record, id) => {
    const type = record.get('type');
    if (typeof type !== 'string' || !allowed.has(type)) return;
    const entry: ObjectSnapshot = {
      id,
      type,
      x: record.get('x') as number,
      y: record.get('y') as number,
      z: record.get('z') as number,
      width: readSize(record.get('width')),
      height: readSize(record.get('height')),
      createdAt: record.get('createdAt') as number,
    };
    if (isSticky(record)) {
      const text = record.get('text');
      entry.color = record.get('color') as StickyColor;
      entry.text = text instanceof Y.Text ? text.toString() : '';
    }
    result.push(entry);
  });
  result.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}

/* ---- Story 7 · multi-object reads and group operations -------------------- */

function readSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : STICKY_SIZE_WORLD;
}

/**
 * The set of types the current runtime can resolve: the production registry
 * plus any types a test fixture declared on `globalThis.__vidi6TestTypes`. Kept
 * out of the client registry module so `snapshot()` stays a pure Yjs read with
 * no React or DOM dependency (and no `node:fs`-free import cycle).
 */
function allowedTypes(): ReadonlySet<string> {
  const extra = (globalThis as { __vidi6TestTypes?: readonly string[] }).__vidi6TestTypes;
  if (!extra || extra.length === 0) return KNOWN_TYPES;
  const merged = new Set(KNOWN_TYPES);
  for (const type of extra) merged.add(type);
  return merged;
}

/** The world-space rectangle an object snapshot occupies. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}

/**
 * Every object id, in snapshot (z, id) order. Because `snapshot()` already
 * drops unregistered types, this is the select-all candidate list and never
 * offers an unresolvable object (PRD `sel.all_types`).
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

/**
 * The ids of objects lying **entirely** inside `rect` — the marquee's
 * fully-inside rule (PRD `sel.marquee`), implemented with the pure
 * {@link rectContains} helper so it can be unit-tested without a DOM.
 */
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  return snapshot.filter((obj) => rectContains(rect, objectBounds(obj))).map((obj) => obj.id);
}