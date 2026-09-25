import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from './config';
import type { StickyColor } from './config';
import type { Point } from '../client/canvas/camera';
import { rectContains, isValidRect, type Rect } from './geometry';

/**
 * Board document model (story 2).
 *
 * All board content lives in a Yjs `Y.Doc` from day one: stories 3-4 will
 * attach a network provider and persistence to this same document. This
 * module owns the schema and every mutation; it is framework-free so the
 * Durable Object (story 4) can import it for validation and migration.
 *
 * Schema:
 * ```
 * Y.Doc
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map keyed by id; each value is a Y.Map with:
 *     type: 'sticky'
 *     x: number, y: number        // top-left, world units
 *     color: StickyColor
 *     text: Y.Text
 *     z: number                   // stacking; higher is on top
 *     createdAt: number           // epoch ms
 * ```
 *
 * Contract errors (stale id, unknown colour, non-finite coordinates) are
 * rejected with `false` (or `''` for createSticky) before opening a
 * transaction, so they emit no Yjs update and never throw.
 */

/** Transaction origin for all local mutations (story 8 undo / story 3 echo-avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.localOrigin');

/** Immutable view of one sticky note, as rendered by the client. */
export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  /** Set once a group resize (story 7) changes the note's size. */
  width?: number;
  height?: number;
}

/**
 * A generic board object (story 7). `sticky` is the first registered type;
 * `width`/`height` are optional because the sticky default
 * (STICKY_SIZE_WORLD) predates them. Objects of unregistered types keep
 * their raw record in `data` so nothing is lost before their code arrives.
 */
export interface ObjectSnapshot {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly createdAt: number;
  readonly text?: string;
  readonly color?: string;
  readonly width?: number;
  readonly height?: number;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** A read-only view of the whole board, sorted for rendering. */
export type Snapshot = readonly ObjectSnapshot[];

/**
 * Object types this build renders and can reason about (selection, marquee,
 * Ctrl+A). Objects of other types remain in the doc untouched, but generic
 * operations skip them (the registry keeps them out of the renderer too).
 */
export const KNOWN_OBJECT_TYPES: readonly string[] = ['sticky'];

/** Top-left of an object's world-space bounding box (default sticky size when unset). */
export function objectBounds(o: ObjectSnapshot): Rect {
  return {
    x: o.x,
    y: o.y,
    width: o.width ?? STICKY_SIZE_WORLD,
    height: o.height ?? STICKY_SIZE_WORLD,
  };
}

/** Current schema version (the persisted and wire contract). */
const SCHEMA_VERSION = 1;

const META_KEY = 'meta';
const SCHEMA_VERSION_KEY = 'schemaVersion';
const OBJECTS_KEY = 'objects';

const TYPE_KEY = 'type';
const X_KEY = 'x';
const Y_KEY = 'y';
const COLOR_KEY = 'color';
const TEXT_KEY = 'text';
const Z_KEY = 'z';
const WIDTH_KEY = 'width';
const HEIGHT_KEY = 'height';
const CREATED_AT_KEY = 'createdAt';

const STICKY_TYPE = 'sticky';

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

function objects(doc: Y.Doc): Y.Map<Y.Map<any>> {
  return doc.getMap(OBJECTS_KEY);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get(Z_KEY);
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/** Ensure the document's meta exists with `schemaVersion` set (once). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (meta.has(SCHEMA_VERSION_KEY)) return;
  doc.transact(() => {
    meta.set(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (top-left is `at - STICKY_SIZE_WORLD/2`),
 * on top of all existing objects. Returns the new id, or `''` when the
 * inputs are invalid (no transaction opened).
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: StickyColor): string {
  const chosen = color ?? DEFAULT_STICKY_COLOR;
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !isStickyColor(chosen)) return '';
  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set(TYPE_KEY, STICKY_TYPE);
  obj.set(X_KEY, at.x - STICKY_SIZE_WORLD / 2);
  obj.set(Y_KEY, at.y - STICKY_SIZE_WORLD / 2);
  obj.set(COLOR_KEY, chosen);
  obj.set(TEXT_KEY, new Y.Text());
  obj.set(Z_KEY, maxZ(doc) + 1);
  obj.set(CREATED_AT_KEY, Date.now());
  doc.transact(() => {
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move a note's top-left to (x, y). Returns false for a stale id or
 * non-finite coordinates (no transaction opened). Story 7: a thin wrapper
 * over the generic moveObjects.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/** True when the object exists in the board doc. */
export function hasObject(doc: Y.Doc, id: string): boolean {
  return objects(doc).get(id) !== undefined;
}

/**
 * Raise a note above every other object. Returns false for a stale id or
 * when the note is already on top (no transaction opened).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc).get(id);
  if (!obj) return false;
  const top = maxZ(doc);
  const current = typeof obj.get(Z_KEY) === 'number' ? (obj.get(Z_KEY) as number) : 0;
  if (current >= top) return false; // already on top: no pointless sync traffic
  doc.transact(() => {
    obj.set(Z_KEY, top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Change a note's colour. Returns false for a stale id or a colour name
 * that is not one of STICKY_COLORS (no transaction opened).
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = objects(doc).get(id);
  if (!obj) return false;
  if (obj.get(COLOR_KEY) === color) return false; // no-op
  doc.transact(() => {
    obj.set(COLOR_KEY, color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note from the board. Returns false for a stale id. Story 7: a thin wrapper over deleteObjects. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

/** The note's Y.Text, if the note exists; undefined for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  if (!obj) return undefined;
  const text = obj.get(TEXT_KEY);
  return text instanceof Y.Text ? text : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Immutable snapshots of every board object (story 7: any registered type),
 * sorted by (z, id) so concurrent equal z values (possible once story 3
 * syncs) give every client the same render order.
 *
 * Optional fields appear only when the object stores them: `width`/`height`
 * (written by the first group resize, Key decision 5), `color`/`text`
 * (sticky). Objects of unknown types keep their generic fields so the
 * renderer can skip them without data loss in the doc.
 */
export function snapshot(doc: Y.Doc): Snapshot {
  const out: ObjectSnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    const type = obj.get(TYPE_KEY);
    if (typeof type !== 'string') return;
    const width = obj.get(WIDTH_KEY);
    const height = obj.get(HEIGHT_KEY);
    const color = obj.get(COLOR_KEY);
    const text = obj.get(TEXT_KEY);
    out.push({
      id,
      type,
      x: asNumber(obj.get(X_KEY), 0),
      y: asNumber(obj.get(Y_KEY), 0),
      z: asNumber(obj.get(Z_KEY), 0),
      createdAt: asNumber(obj.get(CREATED_AT_KEY), 0),
      width: Number.isFinite(width) ? (width as number) : undefined,
      height: Number.isFinite(height) ? (height as number) : undefined,
      color: typeof color === 'string' ? color : undefined,
      text: text instanceof Y.Text ? text.toString() : undefined,
    });
  });
  // (z, id) gives every client the same order even with concurrent equal z values.
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// --- Generic group operations (story 7) -------------------------------------

/**
 * Move several objects' top-left corners. Stale ids and non-finite positions
 * are skipped. Returns the number of objects actually moved (0 = no
 * transaction opened, so no update is emitted).
 */
export function moveObjects(doc: Y.Doc, positions: Map<string, Point>): number {
  const map = objects(doc);
  const entries: Array<[Y.Map<any>, number, number]> = [];
  positions.forEach((p, id) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const obj = map.get(id);
    if (!obj) return;
    entries.push([obj, p.x, p.y]);
  });
  if (entries.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, x, y] of entries) {
      obj.set(X_KEY, x);
      obj.set(Y_KEY, y);
    }
  }, LOCAL_ORIGIN);
  return entries.length;
}

/**
 * Place several objects at explicit world-space rects. Stale ids and
 * non-finite rects are skipped. Returns the number of objects actually
 * changed (0 = no transaction opened, so no update is emitted).
 */
export function resizeObjects(doc: Y.Doc, rects: Map<string, Rect>): number {
  const map = objects(doc);
  const entries: Array<[Y.Map<any>, Rect]> = [];
  rects.forEach((r, id) => {
    if (!isValidRect(r)) return;
    const obj = map.get(id);
    if (!obj) return;
    entries.push([obj, r]);
  });
  if (entries.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, r] of entries) {
      obj.set(X_KEY, r.x);
      obj.set(Y_KEY, r.y);
      obj.set(WIDTH_KEY, r.width);
      obj.set(HEIGHT_KEY, r.height);
    }
  }, LOCAL_ORIGIN);
  return entries.length;
}

/**
 * Raise the given ids above every other object, in the given order (the last
 * id ends on top). Stale ids are skipped. Returns the number raised
 * (0 = no transaction opened).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const live = ids.filter((id) => objects(doc).get(id) !== undefined);
  if (live.length === 0) return 0;
  const top = maxZ(doc);
  doc.transact(() => {
    live.forEach((id, i) => {
      objects(doc).get(id)!.set(Z_KEY, top + i + 1);
    });
  }, LOCAL_ORIGIN);
  return live.length;
}

/**
 * Delete several objects in one transaction. Stale ids are skipped. Returns
 * the number actually deleted (0 = no transaction opened).
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const map = objects(doc);
  const live = ids.filter((id) => map.get(id) !== undefined);
  if (live.length === 0) return 0;
  doc.transact(() => {
    for (const id of live) map.delete(id);
  }, LOCAL_ORIGIN);
  return live.length;
}

// --- Selection queries over a snapshot (story 7) ----------------------------

/** The ids of every known object in the snapshot (Ctrl+A). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  const out: string[] = [];
  for (const o of snapshot) {
    if (KNOWN_OBJECT_TYPES.includes(o.type)) out.push(o.id);
  }
  return out;
}

/** Ids of known objects whose bounds lie fully inside `rect` (marquee). */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const out: string[] = [];
  for (const o of snapshot) {
    if (!KNOWN_OBJECT_TYPES.includes(o.type)) continue;
    if (rectContains(rect, objectBounds(o))) out.push(o.id);
  }
  return out;
}
