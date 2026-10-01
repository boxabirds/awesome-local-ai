import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor, DEFAULT_TEXT_SIZE, type TextSize, TEXT_SIZES } from './config';
import type { Rect } from './geometry';
import { rectContains } from './geometry';
import type { TextSnapshot } from './objects/text';

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

/** Generic object snapshot for group operations (select-all, marquee, bounds). */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
  createdAt: number;
}

/** Union snapshot that includes all known object types. */
export type CombinedSnapshot = StickySnapshot | TextSnapshot;

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

/* ------------------------------------------------------- group operations ---- */

/**
 * Compute the bounding Rect of an object snapshot. Uses explicit width/height when present,
 * otherwise falls back to STICKY_SIZE_WORLD (for stickies created before story 7).
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const w = obj.width ?? STICKY_SIZE_WORLD;
  const h = obj.height ?? STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width: w, height: h };
}

/**
 * Return ids of objects that lie entirely inside `rect` (for marquee selection).
 * Objects only partially inside, or touching the edge from outside, are NOT selected.
 */
export function objectsInRect(
  snapshotArr: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const result: string[] = [];
  for (const obj of snapshotArr) {
    if (rectContains(rect, objectBounds(obj))) {
      result.push(obj.id);
    }
  }
  return result;
}

/** Return ids of all objects in the snapshot array (which already excludes unknown types). */
export function allObjectIds(snapshotArr: readonly ObjectSnapshot[]): string[] {
  return snapshotArr.map((obj) => obj.id);
}

/**
 * Move multiple objects to absolute positions. Skips missing ids and non-finite values.
 * Returns the count of objects actually moved. One transaction if count > 0.
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): number {
  if (positions.size === 0) return 0;
  // Validate all entries before opening a transaction
  const entries: [string, number, number][] = [];
  for (const [id, pos] of positions) {
    if (!isFiniteNumber(pos.x) || !isFiniteNumber(pos.y)) continue;
    entries.push([id, pos.x, pos.y]);
  }
  if (entries.length === 0) return 0;

  let count = 0;
  doc.transact(() => {
    for (const [id, x, y] of entries) {
      const map = objectsMap(doc).get(id);
      if (!map) continue;
      map.set('x', x);
      map.set('y', y);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Resize multiple objects (writes width and height). Skips missing ids and non-finite values.
 * Turns implicit-size stickies explicit.
 * Returns the count of objects actually resized. One transaction if count > 0.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;
  const entries: [string, Rect][] = [];
  for (const [id, rect] of rects) {
    if (!isFiniteNumber(rect.x) || !isFiniteNumber(rect.y) ||
        !isFiniteNumber(rect.width) || !isFiniteNumber(rect.height)) continue;
    entries.push([id, rect]);
  }
  if (entries.length === 0) return 0;

  let count = 0;
  doc.transact(() => {
    for (const [id, rect] of entries) {
      const map = objectsMap(doc).get(id);
      if (!map) continue;
      map.set('x', rect.x);
      map.set('y', rect.y);
      map.set('width', rect.width);
      map.set('height', rect.height);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Bring objects to front: raise the whole selection above all unselected objects
 * while preserving relative z among selected objects.
 * Returns count of objects whose z changed. One transaction if count > 0.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const idSet = new Set(ids);
  const maps: Map<string, Y.Map<unknown>> = new Map();
  let maxUnselectedZ = 0;

  for (const [id, map] of objectsMap(doc)) {
    if (idSet.has(id)) {
      maps.set(id, map);
    } else {
      const z = numberField(map, 'z');
      if (z > maxUnselectedZ) maxUnselectedZ = z;
    }
  }
  if (maps.size === 0) return 0;

  // Sort selected objects by current z to preserve relative order
  const sorted = [...maps.entries()].sort((a, b) => numberField(a[1], 'z') - numberField(b[1], 'z'));

  // Check if all are already above unselected
  let allAbove = true;
  for (const [, map] of sorted) {
    if (numberField(map, 'z') <= maxUnselectedZ) {
      allAbove = false;
      break;
    }
  }
  if (allAbove) return 0;

  let count = 0;
  doc.transact(() => {
    let nextZ = maxUnselectedZ + 1;
    for (const [, map] of sorted) {
      const currentZ = numberField(map, 'z');
      if (currentZ <= maxUnselectedZ) {
        map.set('z', nextZ);
        count++;
      }
      nextZ++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Delete multiple objects. Skips missing ids. Returns count actually deleted.
 * One transaction if count > 0.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  let count = 0;
  doc.transact(() => {
    for (const id of ids) {
      if (objectsMap(doc).has(id)) {
        objectsMap(doc).delete(id);
        count++;
      }
    }
  }, LOCAL_ORIGIN);
  return count;
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

const TEXT_SIZE_KEYS = new Set<string>(Object.keys(TEXT_SIZES));

/**
 * Immutable render model: every known object (sticky + text) sorted by `(z, id)`.
 * Unknown types are skipped so later stories' objects do not break an older client.
 */
export function allObjectsSnapshot(doc: Y.Doc): readonly CombinedSnapshot[] {
  const items: CombinedSnapshot[] = [];
  for (const [id, map] of objectsMap(doc)) {
    const type = map.get('type');
    if (type === 'sticky') {
      const text = map.get('text');
      const color = map.get('color');
      items.push({
        id,
        type: 'sticky',
        x: numberField(map, 'x'),
        y: numberField(map, 'y'),
        width: typeof map.get('width') === 'number' ? map.get('width') as number : STICKY_SIZE_WORLD,
        height: typeof map.get('height') === 'number' ? map.get('height') as number : STICKY_SIZE_WORLD,
        color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
        text: text instanceof Y.Text ? text.toString() : '',
        z: numberField(map, 'z'),
        createdAt: numberField(map, 'createdAt'),
      } as StickySnapshot);
    } else if (type === 'text') {
      const text = map.get('text');
      const size = map.get('size');
      const widthMode = map.get('widthMode');
      items.push({
        id,
        type: 'text',
        x: numberField(map, 'x'),
        y: numberField(map, 'y'),
        width: typeof map.get('width') === 'number' ? map.get('width') as number : 40,
        height: typeof map.get('height') === 'number' ? map.get('height') as number : 26,
        z: numberField(map, 'z'),
        text: text instanceof Y.Text ? text.toString() : '',
        size: typeof size === 'string' && TEXT_SIZE_KEYS.has(size) ? size as TextSize : DEFAULT_TEXT_SIZE,
        widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
      } as TextSnapshot);
    }
  }
  items.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return items;
}
