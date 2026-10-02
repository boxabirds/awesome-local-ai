/**
 * Board document model (stories 2, 7).
 *
 * Owns the Yjs schema and every mutation of board objects. Framework-free on
 * purpose: the Durable Object imports this module from story 4 for validation
 * and migration, and story 3 attaches a network provider to the same document.
 *
 * Schema
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string, Y.Map>
 *       <id>: Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt, width?, height? }
 */
import * as Y from 'yjs';
import type { StickyColor } from './config';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from './config';
import type { Rect } from './geometry';
import { rectContains } from './geometry';

/** Transaction origin for local user edits (story 8 undo, story 3 echo filter). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

export const SCHEMA_VERSION = 1;

const META = 'meta';
const OBJECTS = 'objects';

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  /** Top-left in world units. */
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher is drawn on top. */
  z: number;
  createdAt: number;
  /** Explicit width; absent means STICKY_SIZE_WORLD. */
  width?: number;
  /** Explicit height; absent means STICKY_SIZE_WORLD. */
  height?: number;
}

/**
 * Union type for all board objects. Currently only sticky notes exist;
 * stories 9-12 will add text, shapes, drawings, images.
 */
export type ObjectSnapshot = StickySnapshot;

export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFinitePoint(x: unknown, y: unknown): boolean {
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
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

// --- Story 7: generic group operations ---

/**
 * Returns the bounding rect of an object snapshot.
 * For sticky notes without explicit width/height, falls back to STICKY_SIZE_WORLD.
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
 * Returns ids of objects entirely contained within `rect` (for marquee selection).
 * An object touching the edge from outside is NOT selected.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const result: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) {
      result.push(obj.id);
    }
  }
  return result;
}

/**
 * Returns ids of all known (registered-type) objects in the snapshot.
 * Unknown types are already excluded from snapshot, so this just maps.
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

/**
 * Move multiple objects to absolute positions.
 * Returns the number of objects actually moved.
 * Rejects non-finite values with 0; skips missing ids; one transaction.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, { x: number; y: number }>): number {
  if (positions.size === 0) return 0;

  // Validate all positions first
  for (const [, pos] of positions) {
    if (!isFinitePoint(pos.x, pos.y)) return 0;
  }

  const objects = getObjectsMap(doc);
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
 * Resize multiple objects. Writes width and height (turning implicit-size objects explicit).
 * Returns the number of objects actually resized.
 * Rejects non-finite values with 0; skips missing ids; one transaction.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;

  // Validate all rects first
  for (const [, r] of rects) {
    if (!isFinitePoint(r.x, r.y) || !isFiniteNumber(r.width) || !isFiniteNumber(r.height)) return 0;
    if (r.width <= 0 || r.height <= 0) return 0;
  }

  const objects = getObjectsMap(doc);
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
 * Bring objects to front, keeping their relative stacking order among themselves,
 * but placing them all above unselected objects.
 * Returns the number of objects whose z was changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjectsMap(doc);

  // Find max z among unselected objects
  const idSet = new Set(ids);
  let maxUnselectedZ = 0;
  for (const [objId, m] of objects.entries()) {
    if (idSet.has(objId)) continue;
    const z = m.get('z');
    if (typeof z === 'number' && z > maxUnselectedZ) maxUnselectedZ = z;
  }

  // Sort the selected ids by their current z to preserve relative order
  const selectedWithZ: Array<{ id: string; z: number }> = [];
  for (const id of ids) {
    const m = objects.get(id);
    if (!m) continue;
    const z = m.get('z');
    selectedWithZ.push({ id, z: typeof z === 'number' ? z : 0 });
  }
  selectedWithZ.sort((a, b) => a.z - b.z);

  let count = 0;
  doc.transact(() => {
    for (let i = 0; i < selectedWithZ.length; i++) {
      const newZ = maxUnselectedZ + i + 1;
      const m = objects.get(selectedWithZ[i].id);
      if (m && m.get('z') !== newZ) {
        m.set('z', newZ);
        count++;
      } else if (m) {
        count++; // already at the right z, still counts as "applied"
      }
    }
  }, LOCAL_ORIGIN);

  return count;
}

/**
 * Delete multiple objects. Returns the number actually deleted.
 * Skips missing ids; one transaction for all.
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
