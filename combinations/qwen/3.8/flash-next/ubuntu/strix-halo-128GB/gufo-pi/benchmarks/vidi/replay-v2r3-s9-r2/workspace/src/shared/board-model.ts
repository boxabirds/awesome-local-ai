/**
 * Board document model (story 2).
 *
 * Owns the Yjs schema and every mutation of board objects. Framework-free on
 * purpose: the Durable Object imports this module from story 4 for validation
 * and migration, and story 3 attaches a network provider to the same document.
 *
 * Schema
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string, Y.Map>
 *       <id>: Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 *       <id>: Y.Map { type: 'text', x, y, width, height, text: Y.Text, size,
 *                     widthMode: 'auto'|'fixed', z, createdAt, createdBy }   (story 9)
 */
import * as Y from 'yjs';
import type { StickyColor, TextSize } from './config';
import {
  DEFAULT_STICKY_COLOR,
  DEFAULT_TEXT_SIZE,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  TEXT_SIZES,
  TEXT_MIN_WIDTH_WORLD,
} from './config';
import type { Rect } from './geometry';
import { rectContains } from './geometry';
import type { TextSnapshot, TextWidthMode } from './objects/text';

/** Transaction origin for local user edits (story 8 undo, story 3 echo filter). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

export const SCHEMA_VERSION = 1;

const META = 'meta';
const OBJECTS = 'objects';

/** Fields every object type stores (story 9 makes the schema extensible). */
export interface BaseObjectSnapshot {
  id: string;
  type: string;
  /** Top-left in world units. */
  x: number;
  y: number;
  /** Width in world units (falls back to the type default when absent). */
  width?: number;
  /** Height in world units (falls back to the type default when absent). */
  height?: number;
  /** Stacking order; higher is drawn on top. */
  z: number;
  createdAt: number;
  /** Client id of the creator (story 9 text objects). */
  createdBy?: string;
}

export interface StickySnapshot extends BaseObjectSnapshot {
  id: string;
  type: 'sticky';
  /** Top-left in world units. */
  x: number;
  y: number;
  /** Width in world units (falls back to STICKY_SIZE_WORLD for legacy notes). */
  width?: number;
  /** Height in world units (falls back to STICKY_SIZE_WORLD for legacy notes). */
  height?: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher is drawn on top. */
  z: number;
  createdAt: number;
}

/** Generic object snapshot union (extensible for future types). */
export type ObjectSnapshot = StickySnapshot | TextSnapshot;

export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFinitePoint(x: unknown, y: unknown): boolean {
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y);
}

export function getObjectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS);
}

/** Sets `meta.schemaVersion` when absent. Never overwrites an existing version. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

function readSticky(id: string, m: Y.Map<unknown>): StickySnapshot | null {
  if (m.get('type') !== 'sticky') return null; // forward compatibility: skip unknown types
  const x = m.get('x');
  const y = m.get('y');
  const z = m.get('z');
  const createdAt = m.get('createdAt');
  const color = m.get('color');
  const text = m.get('text');
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  if (typeof z !== 'number') return null;
  const width = m.get('width');
  const height = m.get('height');
  return {
    id,
    type: 'sticky',
    x,
    y,
    width: typeof width === 'number' && Number.isFinite(width) ? width : undefined,
    height: typeof height === 'number' && Number.isFinite(height) ? height : undefined,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : '',
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}

/** True when `value` is one of the four text size presets. */
export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);
}

function isTextWidthMode(value: unknown): value is TextWidthMode {
  return value === 'auto' || value === 'fixed';
}

/**
 * Reads a `text` object. Story 9: `width`/`height` are stored by the client
 * that made the last local change so every client can draw selection bounds
 * without measuring. An object without a usable size is skipped (forward
 * compatibility).
 */
function readText(id: string, m: Y.Map<unknown>): TextSnapshot | null {
  if (m.get('type') !== 'text') return null;
  const x = m.get('x');
  const y = m.get('y');
  const z = m.get('z');
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  if (typeof z !== 'number') return null;
  const width = m.get('width');
  const height = m.get('height');
  const size = m.get('size');
  const widthMode = m.get('widthMode');
  const text = m.get('text');
  const createdBy = m.get('createdBy');
  const createdAt = m.get('createdAt');
  return {
    id,
    type: 'text',
    x,
    y,
    width: typeof width === 'number' && Number.isFinite(width) ? width : TEXT_MIN_WIDTH_WORLD,
    height: typeof height === 'number' && Number.isFinite(height) ? height : TEXT_SIZES[DEFAULT_TEXT_SIZE],
    text: text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : '',
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: isTextWidthMode(widthMode) ? widthMode : 'auto',
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : undefined,
  };
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const m of objects.values()) {
    const z = m.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/** The `z` a new object should take: above every object on the board. */
export function nextZ(objects: Y.Map<Y.Map<unknown>>): number {
  return maxZ(objects) + 1;
}

/**
 * Creates a sticky note centred on the world point `at`.
 * Returns the new id, or `''` when the point or colour is invalid.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!at || !isFinitePoint(at?.x, at?.y)) return '';
  if (!isStickyColor(color)) return '';

  const objects = getObjectsMap(doc);
  const id = crypto.randomUUID();
  const z = nextZ(objects);
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'sticky');
    m.set('x', x);
    m.set('y', y);
    m.set('color', color);
    m.set('text', new Y.Text());
    m.set('z', z);
    m.set('createdAt', Date.now());
    objects.set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

function getStickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const m = getObjectsMap(doc).get(id);
  if (!m || m.get('type') !== 'sticky') return undefined;
  return m;
}

/** Moves a note to a new world top-left. Returns false when rejected or unchanged. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  if (!isFinitePoint(x, y)) return false;
  if (m.get('x') === x && m.get('y') === y) return false;

  doc.transact(() => {
    m.set('x', x);
    m.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

// --- Story 7: group operations ---

/** Returns the bounding rect of an object, using the type's default size. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const isText = obj.type === 'text';
  const fallback = isText ? TEXT_MIN_WIDTH_WORLD : STICKY_SIZE_WORLD;
  const fallbackHeight = isText ? TEXT_SIZES[DEFAULT_TEXT_SIZE] : STICKY_SIZE_WORLD;
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? fallback,
    height: obj.height ?? fallbackHeight,
  };
}

/** Returns ids of objects fully inside the given rect (for marquee selection). */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) {
      ids.push(obj.id);
    }
  }
  return ids;
}

/** Returns all object ids from the snapshot (already excludes unknown types). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

function isFiniteRect(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

/**
 * Move multiple objects to absolute positions. Returns count of objects actually moved.
 * Skips missing ids; rejects non-finite values with 0 and no transaction.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, { x: number; y: number }>): number {
  if (positions.size === 0) return 0;
  // Validate all positions are finite
  for (const pos of positions.values()) {
    if (!isFinitePoint(pos.x, pos.y)) return 0;
  }

  const objects = getObjectsMap(doc);
  let count = 0;

  doc.transact(() => {
    for (const [id, pos] of positions) {
      const m = objects.get(id);
      if (!m) continue;
      const curX = m.get('x') as number;
      const curY = m.get('y') as number;
      if (curX === pos.x && curY === pos.y) continue;
      m.set('x', pos.x);
      m.set('y', pos.y);
      count++;
    }
  }, LOCAL_ORIGIN);

  return count;
}

/**
 * Resize multiple objects to absolute rects. Returns count of objects actually resized.
 * Writes both width and height fields, making implicit-size objects explicit.
 * Rejects non-finite rects with 0 and no transaction.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  // Validate all rects are finite
  for (const r of rects.values()) {
    if (!isFiniteRect(r)) return 0;
  }

  const objects = getObjectsMap(doc);
  let count = 0;

  doc.transact(() => {
    for (const [id, rect] of rects) {
      const m = objects.get(id);
      if (!m) continue;
      const curX = m.get('x') as number;
      const curY = m.get('y') as number;
      const curW = (m.get('width') as number | undefined) ?? undefined;
      const curH = (m.get('height') as number | undefined) ?? undefined;
      // For legacy objects without explicit width/height, compare against STICKY_SIZE_WORLD
      const effectiveW = curW ?? STICKY_SIZE_WORLD;
      const effectiveH = curH ?? STICKY_SIZE_WORLD;
      if (curX === rect.x && curY === rect.y && effectiveW === rect.width && effectiveH === rect.height) continue;
      m.set('x', rect.x);
      m.set('y', rect.y);
      m.set('width', rect.width);
      m.set('height', rect.height);
      count++;
    }
  }, LOCAL_ORIGIN);

  return count;
}

/**
 * Raise all objects in `ids` above every unselected object, preserving their
 * relative stacking order among themselves. Returns count of objects changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjectsMap(doc);
  const idSet = new Set(ids);

  // Find max z of unselected objects
  let maxUnselectedZ = 0;
  let minSelectedZ = Infinity;
  for (const [objId, m] of objects.entries()) {
    const z = m.get('z');
    if (typeof z !== 'number') continue;
    if (idSet.has(objId)) {
      if (z < minSelectedZ) minSelectedZ = z;
    } else {
      if (z > maxUnselectedZ) maxUnselectedZ = z;
    }
  }

  if (minSelectedZ === Infinity) return 0; // no selected objects found

  // Collect selected objects sorted by current z to preserve relative order
  const selected: Array<{ id: string; m: Y.Map<unknown>; z: number }> = [];
  for (const id of ids) {
    const m = objects.get(id);
    if (!m) continue;
    const z = m.get('z');
    if (typeof z !== 'number') continue;
    selected.push({ id, m, z });
  }
  selected.sort((a, b) => a.z - b.z);

  // Assign new z values above maxUnselectedZ
  let count = 0;
  doc.transact(() => {
    for (let i = 0; i < selected.length; i++) {
      const newZ = maxUnselectedZ + i + 1;
      if (selected[i].z !== newZ) {
        selected[i].m.set('z', newZ);
        count++;
      }
    }
  }, LOCAL_ORIGIN);

  return count;
}

/**
 * Delete multiple objects. Returns count of objects actually deleted.
 * Skips missing ids; empty list → 0, no transaction.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjectsMap(doc);
  let count = 0;

  doc.transact(() => {
    for (const id of ids) {
      if (objects.has(id)) {
        objects.delete(id);
        count++;
      }
    }
  }, LOCAL_ORIGIN);

  return count;
}

/** Raises a note above every other note. Returns false when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  const objects = getObjectsMap(doc);
  const z = m.get('z');
  const top = maxZ(objects);
  if (typeof z === 'number' && z === top) return false;

  doc.transact(() => {
    m.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Applies one of the six preset colours. Returns false for unknown colours/stale ids. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  if (!isStickyColor(color)) return false;
  if (m.get('color') === color) return false;

  doc.transact(() => {
    m.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes an object from the board. Returns false when the id is unknown. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getObjectsMap(doc);
  if (typeof id !== 'string' || !objects.has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The `Y.Text` holding a note's text, for collaborative editing (story 3). */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getStickyMap(doc, id);
  if (!m) return undefined;
  const text = m.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable view of every known object, sorted by `(z, id)` so all clients
 * agree on the render order even when concurrent edits produce equal `z`.
 * Objects of unknown `type` are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjectsMap(doc);
  const notes: StickySnapshot[] = [];
  for (const [id, m] of objects.entries()) {
    const note = readSticky(id, m);
    if (note) notes.push(note);
  }
  notes.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}

/**
 * Immutable view of every *known* object type (story 9), sorted by `(z, id)`.
 * `snapshot()` stays sticky-only so story 2 callers keep their typing.
 */
export function snapshotObjects(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects = getObjectsMap(doc);
  const all: ObjectSnapshot[] = [];
  for (const [id, m] of objects.entries()) {
    const type = m.get('type');
    const obj = type === 'text' ? readText(id, m) : readSticky(id, m);
    if (obj) all.push(obj);
  }
  all.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return all;
}
