// The board document model: Yjs schema + all mutations (story 2, board.model).
// Framework-free: the client uses it now and the Durable Object will import
// the same module for validation/migration in story 4.
//
// Schema (the future persisted and wire contract):
//   meta: Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map {
//     type: 'sticky'
//     x, y: number            // top-left, world units
//     color: StickyColor
//     text: Y.Text
//     z: number               // stacking; higher is on top
//     createdAt: number       // epoch ms
//   }>
//
// Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
// rejections (stale id, unknown colour, non-finite numbers, no-ops) return
// false before opening a transaction. Never throws for user-driven input.

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';
import { rectContains, type Point, type Rect } from './geometry';

/** Origin for local (this client's) transactions; undo (story 8) and
 *  echo-suppression (story 3) key off it. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local-origin');

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

const SCHEMA_VERSION = 1;
const STICKY_TYPE = 'sticky';

/** Object types the board schema knows (story 7). `sticky` is built in;
 *  every later object type (and the test-only `testbox`) registers itself
 *  here so snapshots, select-all and the worker's validation agree. */
const KNOWN_TYPES = new Set<string>([STICKY_TYPE]);

/** Registers an object type with the board schema (module-load time). */
export function registerBoardType(type: string): void {
  KNOWN_TYPES.add(type);
}

/** True when the board schema knows this object type. */
export function isKnownBoardType(type: string): boolean {
  return KNOWN_TYPES.has(type);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** The entry's Y.Map when `id` is a sticky note; undefined otherwise. */
function stickyEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = objectsMap(doc).get(id);
  if (!entry || entry.get('type') !== STICKY_TYPE) return undefined;
  return entry;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsMap(doc).values()) {
    const z = entry.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

function finitePair(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

/** Sets meta.schemaVersion if absent; never overwrites an existing version. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Creates a sticky note centred on `at` in the default (or given) colour and
 * returns its new id. `at` with non-finite coordinates, or an unknown colour,
 * is rejected with no transaction and the id ''.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!finitePair(at.x, at.y) || !isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', STICKY_TYPE);
    entry.set('x', at.x - STICKY_SIZE_WORLD / 2);
    entry.set('y', at.y - STICKY_SIZE_WORLD / 2);
    entry.set('color', color);
    entry.set('text', new Y.Text());
    entry.set('z', maxZ(doc) + 1);
    entry.set('createdAt', Date.now());
    objectsMap(doc).set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Moves a note's top-left corner to (x, y). Returns true when a change was
 * applied; false for a stale id, non-finite coordinates, or an exact no-op.
 * Thin wrapper over the generic group move (story 7).
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/**
 * Raises a note above every other note. Returns true when a change was
 * applied; false for a stale id or a note already topmost (no-op).
 * Thin wrapper over the generic group stacking (story 7).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/**
 * Sets a note's colour. Returns true when a change was applied; false for a
 * stale id, an unknown colour name, or the note's current colour (no-op).
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const entry = stickyEntry(doc, id);
  if (!entry) return false;
  if (entry.get('color') === color) return false;
  doc.transact(() => {
    entry.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes an object from the document; false for a stale id.
 *  Thin wrapper over the generic group delete (story 7). */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** The note's Y.Text, if `id` exists and is a sticky. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = stickyEntry(doc, id);
  if (!entry) return undefined;
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Generic object snapshot (story 7, sel.all_types): one entry per object the
 * board schema knows, sorted by (z, id). `width`/`height` are `undefined`
 * when the object predates explicit sizing (implicit STICKY_SIZE_WORLD).
 * Unknown `type` values are skipped (forward compatibility for stories 9-12);
 * the (z, id) tie-break keeps every client in the same order.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Explicit size in world units; undefined → the type's default size. */
  width: number | undefined;
  height: number | undefined;
  z: number;
  createdAt: number;
  /** sticky only. */
  color: StickyColor | undefined;
  /** sticky only. */
  text: string;
}

export function objectsSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  for (const [id, entry] of objectsMap(doc).entries()) {
    const type = entry.get('type');
    if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) continue;
    const text = entry.get('text');
    const width = entry.get('width');
    const height = entry.get('height');
    objects.push({
      id,
      type,
      x: entry.get('x') as number,
      y: entry.get('y') as number,
      width: typeof width === 'number' ? width : undefined,
      height: typeof height === 'number' ? height : undefined,
      z: entry.get('z') as number,
      createdAt: entry.get('createdAt') as number,
      color: type === STICKY_TYPE ? (entry.get('color') as StickyColor) : undefined,
      text: text instanceof Y.Text ? text.toString() : '',
    });
  }
  objects.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return objects;
}

/** The object's bounds in world units (implicit-size stickies read
 *  STICKY_SIZE_WORLD; the first resize turns them explicit). */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/** Ids of the objects lying ENTIRELY inside `rect` (marquee rule). */
export function objectsInRect(objects: readonly ObjectSnapshot[], rect: Rect): string[] {
  return objects.filter((o) => rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/** Ids of every selectable object (unknown types are already excluded from
 *  the snapshot; select-all must never select them). */
export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  return objects.map((o) => o.id);
}

function finiteRect(x: number, y: number, width: number, height: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height);
}

/**
 * Moves objects to absolute world positions (group move and nudge).
 * Returns the number of objects changed. Non-finite values reject the whole
 * call (0, no transaction); missing ids are skipped; a no-op is 0.
 * Exactly one LOCAL_ORIGIN transaction per successful call.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  }
  const objects = objectsMap(doc);
  const changed = new Map<string, Point>();
  for (const [id, p] of positions) {
    const entry = objects.get(id);
    if (!entry) continue; // missing id skipped
    if (entry.get('x') === p.x && entry.get('y') === p.y) continue;
    changed.set(id, p);
  }
  if (changed.size === 0) return 0;
  doc.transact(() => {
    for (const [id, p] of changed) {
      const entry = objects.get(id);
      if (!entry) continue;
      entry.set('x', p.x);
      entry.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return changed.size;
}

/**
 * Resizes objects to absolute world rects, writing x/y/width/height (turning
 * implicit-size stickies explicit). Returns the number of objects changed;
 * non-finite rects reject the whole call (0, no transaction); missing ids
 * are skipped; a no-op is 0.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (!finiteRect(r.x, r.y, r.width, r.height)) return 0;
  }
  const objects = objectsMap(doc);
  const changed = new Map<string, Rect>();
  for (const [id, r] of rects) {
    const entry = objects.get(id);
    if (!entry) continue; // missing id skipped
    if (
      entry.get('x') === r.x &&
      entry.get('y') === r.y &&
      entry.get('width') === r.width &&
      entry.get('height') === r.height
    ) {
      continue;
    }
    changed.set(id, r);
  }
  if (changed.size === 0) return 0;
  doc.transact(() => {
    for (const [id, r] of changed) {
      const entry = objects.get(id);
      if (!entry) continue;
      entry.set('x', r.x);
      entry.set('y', r.y);
      entry.set('width', r.width);
      entry.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return changed.size;
}

function entryZ(entry: Y.Map<unknown>): number {
  const z = entry.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

/**
 * Raises the whole selection above every unselected object, preserving the
 * relative stacking among the selected ones (z = maxUnselectedZ + rank).
 * Returns the number of objects whose z changed; a no-op is 0.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const selectedSet = new Set(ids);
  const objects = objectsMap(doc);
  const selected: { id: string; entry: Y.Map<unknown> }[] = [];
  for (const id of ids) {
    const entry = objects.get(id);
    if (entry) selected.push({ id, entry });
  }
  if (selected.length === 0) return 0;
  let maxUnselected = 0;
  for (const [id, entry] of objects.entries()) {
    if (selectedSet.has(id)) continue;
    const z = entryZ(entry);
    if (z > maxUnselected) maxUnselected = z;
  }
  selected.sort((a, b) => entryZ(a.entry) - entryZ(b.entry) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const updates = new Map<string, number>();
  selected.forEach(({ id, entry }, rank) => {
    const z = maxUnselected + 1 + rank;
    if (entryZ(entry) !== z) updates.set(id, z);
  });
  if (updates.size === 0) return 0;
  doc.transact(() => {
    for (const [id, z] of updates) {
      const entry = objects.get(id);
      if (entry) entry.set('z', z);
    }
  }, LOCAL_ORIGIN);
  return updates.size;
}

/**
 * Deletes objects; returns the number removed. Missing ids are skipped; an
 * empty list is 0. Exactly one LOCAL_ORIGIN transaction per successful call.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const present = ids.filter((id) => objects.get(id) !== undefined);
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id). Unknown `type`
 * values are skipped (forward compatibility for stories 9-12). The (z, id)
 * tie-break keeps every client in the same order once story 3 syncs.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, entry] of objectsMap(doc).entries()) {
    if (entry.get('type') !== STICKY_TYPE) continue;
    const text = entry.get('text');
    notes.push({
      id,
      type: STICKY_TYPE,
      x: entry.get('x') as number,
      y: entry.get('y') as number,
      color: entry.get('color') as StickyColor,
      text: text instanceof Y.Text ? text.toString() : '',
      z: entry.get('z') as number,
      createdAt: entry.get('createdAt') as number,
    });
  }
  notes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}
