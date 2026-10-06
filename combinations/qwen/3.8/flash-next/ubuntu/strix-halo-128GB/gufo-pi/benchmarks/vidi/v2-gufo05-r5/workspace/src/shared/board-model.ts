/**
 * The board document model: the Yjs schema plus every mutation the app can perform.
 *
 * This module is framework-free (no React, no DOM beyond `crypto`) so the Durable
 * Object added in story 4 can import it for validation and migration, and so the same
 * code runs on the client and the server. It is also the future persisted format
 * (story 4) and the future wire format (story 3), which is why `meta.schemaVersion`
 * exists.
 *
 * Schema
 * ```
 * Y.Doc
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<string /* id *\/, Y.Map>
 *     <id>: Y.Map {
 *       type: 'sticky'
 *       x: number, y: number   // top-left corner, world units
 *       color: StickyColor
 *       text: Y.Text
 *       z: number              // stacking order, higher is drawn on top
 *       createdAt: number      // epoch milliseconds
 *     }
 * ```
 *
 * Every successful mutation runs in exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
 * rejections (stale id, unknown colour, non-finite coordinates, bringing the topmost
 * note to the front) return `false` before a transaction is opened, so they produce no
 * update and no sync traffic. The module never throws for user-driven input, and an
 * object it does not understand is skipped rather than crashing the board.
 */
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';
import { type Point, type Rect, rectContains } from './geometry';

/** Transaction origin for changes made by this user (story 3 never echoes these back). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** The schema version this build writes and understands. */
export const SCHEMA_VERSION = 1;

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';

/** An immutable view of one sticky note, as rendered by React. */
export interface StickySnapshot {
  readonly id: string;
  readonly type: 'sticky';
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
  readonly z: number;
  readonly createdAt: number;
  /** Explicit width (world units); absent = STICKY_SIZE_WORLD (story 7 additive). */
  readonly width?: number;
  /** Explicit height (world units); absent = STICKY_SIZE_WORLD (story 7 additive). */
  readonly height?: number;
}

/** Any board object snapshot (extends with new types in stories 9–12). */
export type ObjectSnapshot = StickySnapshot;

type ObjectsMap = Y.Map<Y.Map<unknown>>;

function objectsOf(doc: Y.Doc): ObjectsMap {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function textOf(raw: Y.Map<unknown>): string {
  const text = raw.get('text');
  if (text instanceof Y.Text) return text.toString();
  return typeof text === 'string' ? text : '';
}

/**
 * Reads one object into a snapshot, or `undefined` when it is not a note this build
 * understands (an unknown `type` from a later story, or a malformed record).
 */
function readObject(id: string, raw: Y.Map<unknown>): StickySnapshot | undefined {
  if (raw.get('type') !== 'sticky') return undefined;
  const x = raw.get('x');
  const y = raw.get('y');
  const z = raw.get('z');
  const color = raw.get('color');
  if (!finite(x) || !finite(y) || !finite(z) || !isStickyColor(color)) return undefined;
  const createdAt = raw.get('createdAt');
  const w = raw.get('width');
  const h = raw.get('height');
  return Object.freeze({
    id,
    type: 'sticky' as const,
    x,
    y,
    color,
    text: textOf(raw),
    z,
    createdAt: finite(createdAt) ? createdAt : 0,
    ...(finite(w) ? { width: w } : {}),
    ...(finite(h) ? { height: h } : {}),
  });
}

/** The render order: higher `z` last, `id` breaking ties so every client agrees. */
function compareStack(a: { z: number; id: string }, b: { z: number; id: string }): number {
  return a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Reads and validates every object in the document. */
function readAll(doc: Y.Doc): StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, raw] of objectsOf(doc)) {
    if (!(raw instanceof Y.Map)) continue;
    const note = readObject(id, raw);
    if (note) notes.push(note);
  }
  return notes.sort(compareStack);
}

/** True when `name` is one of the six palette colour names. */
export function isKnownColor(name: string): boolean {
  return isStickyColor(name);
}

/** Creates the document's root structures and records the schema version once. */
export function initDoc(doc: Y.Doc): void {
  objectsOf(doc); // creates the root map lazily; writing the first note stores it
  const meta = doc.getMap<unknown>(META_KEY);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (world units), on top of every other note.
 *
 * Returns the new id, or `''` when nothing was written: the point is not finite or the
 * colour name is unknown. (`''` is the falsy "no note" id; the contract keeps the
 * return type `string` so callers can pass it straight to `select`.)
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const x = at?.x;
  const y = at?.y;
  if (!finite(x) || !finite(y) || !isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', x - STICKY_SIZE_WORLD / 2);
    note.set('y', y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text(''));
    note.set('z', topZ(objects) + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

function noteMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const raw = objectsOf(doc).get(id);
  if (!(raw instanceof Y.Map)) return undefined;
  return raw.get('type') === 'sticky' ? raw : undefined;
}

/** The largest `z` in the document, 0 when there are no objects. */
function topZ(objects: ObjectsMap): number {
  let top = 0;
  for (const raw of objects.values()) {
    if (!(raw instanceof Y.Map)) continue;
    const z = raw.get('z');
    if (finite(z) && z > top) top = z;
  }
  return top;
}

/** The id drawn above all others, following the same order as `snapshot`. */
function topId(objects: ObjectsMap): string | undefined {
  let best: { id: string; z: number } | undefined;
  for (const [id, raw] of objects) {
    if (!(raw instanceof Y.Map)) continue;
    const z = raw.get('z');
    if (!finite(z)) continue;
    if (!best || compareStack({ z, id }, best) > 0) {
      best = { id, z };
    }
  }
  return best?.id;
}

/** Moves a note to a new top-left corner (world units). */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!finite(x) || !finite(y)) return false;
  const note = noteMap(doc, id);
  if (!note) return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raises a note above every other note. False when it is already drawn on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const note = noteMap(doc, id);
  if (!note) return false;
  if (topId(objects) === id) return false;
  const next = topZ(objects) + 1;
  doc.transact(() => {
    note.set('z', next);
  }, LOCAL_ORIGIN);
  return true;
}

/** Changes a note's colour, leaving text, position and stacking untouched. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const note = noteMap(doc, id);
  if (!note) return false;
  if (note.get('color') === color) return false; // no-op: nothing to sync
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes an object (any type) from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, for editing. Undefined when the id is stale. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = noteMap(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** All notes as immutable data, in render order (sorted by `z` then `id`). */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return Object.freeze(readAll(doc));
}

// ---- Story 7: generic group operations -------------------------------------------

/** Returns the bounding rectangle of an object (with STICKY_SIZE_WORLD fallback). */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/**
 * Returns ids of objects in `snapshot` that are fully contained within `rect`.
 * Objects only partly inside (or merely touching the edge) are NOT selected.
 */
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) {
      ids.push(obj.id);
    }
  }
  return ids;
}

/** Returns ids of all objects in the snapshot (already filtered to known types by readAll). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

/**
 * Moves multiple objects to absolute positions. Returns count changed.
 * Skips missing ids; rejects non-finite values and empty lists (no transaction).
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, Point>,
): number {
  if (positions.size === 0) return 0;
  // Validate all positions are finite before starting transaction
  for (const pos of positions.values()) {
    if (!finite(pos.x) || !finite(pos.y)) return 0;
  }
  let count = 0;
  doc.transact(() => {
    for (const [id, pos] of positions) {
      const obj = objectsOf(doc).get(id);
      if (!(obj instanceof Y.Map)) continue;
      obj.set('x', pos.x);
      obj.set('y', pos.y);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Resizes multiple objects by writing x, y, width, height. Returns count changed.
 * Skips missing ids; rejects non-finite values and empty lists (no transaction).
 * The first resize of a sticky note writes both width and height explicitly.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;
  // Validate all rect values are finite
  for (const r of rects.values()) {
    if (!finite(r.x) || !finite(r.y) || !finite(r.width) || !finite(r.height)) return 0;
  }
  let count = 0;
  doc.transact(() => {
    for (const [id, rect] of rects) {
      const obj = objectsOf(doc).get(id);
      if (!(obj instanceof Y.Map)) continue;
      obj.set('x', rect.x);
      obj.set('y', rect.y);
      obj.set('width', rect.width);
      obj.set('height', rect.height);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Raises all objects in `ids` above all unselected objects while preserving
 * relative z order among the selected objects. Returns count changed.
 */
export function bringObjectsToFront(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  const objects = objectsOf(doc);
  const idSet = new Set(ids);

  // Find the maximum z among unselected objects
  let maxUnselectedZ = 0;
  for (const [id, raw] of objects) {
    if (idSet.has(id)) continue;
    if (!(raw instanceof Y.Map)) continue;
    const z = raw.get('z');
    if (finite(z) && z > maxUnselectedZ) maxUnselectedZ = z;
  }

  // Sort selected ids by their current z (to preserve relative order)
  const selected: { id: string; z: number }[] = [];
  for (const id of ids) {
    const raw = objects.get(id);
    if (!(raw instanceof Y.Map)) continue;
    const z = raw.get('z');
    selected.push({ id, z: finite(z) ? z : 0 });
  }
  selected.sort((a, b) => a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  let count = 0;
  doc.transact(() => {
    for (let i = 0; i < selected.length; i++) {
      const obj = objects.get(selected[i]!.id);
      if (!(obj instanceof Y.Map)) continue;
      const newZ = maxUnselectedZ + 1 + i;
      if (obj.get('z') !== newZ) {
        obj.set('z', newZ);
        count++;
      }
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Deletes multiple objects. Returns count actually deleted.
 * Skips missing ids; empty list → 0, no transaction.
 */
export function deleteObjects(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  const objects = objectsOf(doc);
  // Check which ids exist
  const existing = ids.filter((id) => objects.has(id));
  if (existing.length === 0) return 0;
  let count = 0;
  doc.transact(() => {
    for (const id of existing) {
      objects.delete(id);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}
