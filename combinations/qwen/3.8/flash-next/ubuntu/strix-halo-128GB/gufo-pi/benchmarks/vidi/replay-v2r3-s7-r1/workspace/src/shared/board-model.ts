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
 */
import * as Y from 'yjs';
import type { StickyColor } from './config';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from './config';
import type { Rect, Point } from './geometry';

/** Transaction origin for local user edits (story 8 undo, story 3 echo filter). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

export const SCHEMA_VERSION = 1;

const META = 'meta';
const OBJECTS = 'objects';

/** Base interface for any board object snapshot (generic object operations). */
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
  /** Top-left in world units. */
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher is drawn on top. */
  z: number;
  createdAt: number;
  /** Explicit size; absent means STICKY_SIZE_WORLD (story 7 additive). */
  width?: number;
  height?: number;
}

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
  const width = m.get('width');
  const height = m.get('height');
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  if (typeof z !== 'number') return null;
  const snap: StickySnapshot = {
    id,
    type: 'sticky',
    x,
    y,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : '',
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
  if (typeof width === 'number' && Number.isFinite(width)) snap.width = width;
  if (typeof height === 'number' && Number.isFinite(height)) snap.height = height;
  return snap;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const m of objects.values()) {
    const z = m.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
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
  const z = maxZ(objects) + 1;
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

// ---------- Story 7: group operations ----------

/**
 * Returns the bounding rect of an object snapshot.
 * Falls back to STICKY_SIZE_WORLD when width/height are absent (legacy stickies).
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/**
 * Returns ids of objects in the snapshot that are fully inside `rect`.
 * Objects only partially inside are NOT included.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const result: string[] = [];
  for (const obj of snapshot) {
    const bounds = objectBounds(obj);
    if (
      bounds.x >= rect.x &&
      bounds.y >= rect.y &&
      bounds.x + bounds.width <= rect.x + rect.width &&
      bounds.y + bounds.height <= rect.y + rect.height
    ) {
      result.push(obj.id);
    }
  }
  return result;
}

/**
 * Returns all ids from the snapshot (the snapshot already excludes unknown types).
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

/**
 * Moves multiple objects to absolute positions. Missing ids are skipped.
 * Non-finite positions are rejected. One transaction, returns count applied.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  const objects = getObjectsMap(doc);

  // Validate all positions before opening a transaction
  for (const [_id, pos] of positions) {
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return 0;
  }

  let count = 0;
  doc.transact(() => {
    for (const [id, pos] of positions) {
      const m = objects.get(id);
      if (!m) continue;
      m.set('x', pos.x);
      m.set('y', pos.y);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Resizes multiple objects. Each entry is the new full rect (x, y, width, height).
 * Missing ids are skipped. Non-finite values are rejected (0 applied).
 * On first resize, writes width and height fields to make legacy stickies explicit.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  const objects = getObjectsMap(doc);

  // Validate all rects before opening a transaction
  for (const [_id, r] of rects) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) ||
        !Number.isFinite(r.width) || !Number.isFinite(r.height)) return 0;
  }

  let count = 0;
  doc.transact(() => {
    for (const [id, r] of rects) {
      const m = objects.get(id);
      if (!m) continue;
      m.set('x', r.x);
      m.set('y', r.y);
      m.set('width', r.width);
      m.set('height', r.height);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Raise all specified objects above every unselected object, preserving
 * relative stacking order among the selected ones.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjectsMap(doc);
  const idSet = new Set(ids);

  // Find max z among unselected objects
  let maxUnselectedZ = 0;
  for (const [id, m] of objects.entries()) {
    if (idSet.has(id)) continue;
    const z = m.get('z');
    if (typeof z === 'number' && z > maxUnselectedZ) maxUnselectedZ = z;
  }

  // Collect selected objects sorted by their current z
  const selected: Array<{ m: Y.Map<unknown>; z: number }> = [];
  for (const id of ids) {
    const m = objects.get(id);
    if (!m) continue;
    const z = m.get('z');
    selected.push({ m, z: typeof z === 'number' ? z : 0 });
  }

  if (selected.length === 0) return 0;
  selected.sort((a, b) => a.z - b.z);

  let count = 0;
  doc.transact(() => {
    for (let i = 0; i < selected.length; i++) {
      const newZ = maxUnselectedZ + i + 1;
      selected[i].m.set('z', newZ);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Delete multiple objects. Missing ids are skipped.
 * One transaction, returns count deleted.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjectsMap(doc);

  let count = 0;
  doc.transact(() => {
    for (const id of ids) {
      if (typeof id === 'string' && objects.has(id)) {
        objects.delete(id);
        count++;
      }
    }
  }, LOCAL_ORIGIN);
  return count;
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
