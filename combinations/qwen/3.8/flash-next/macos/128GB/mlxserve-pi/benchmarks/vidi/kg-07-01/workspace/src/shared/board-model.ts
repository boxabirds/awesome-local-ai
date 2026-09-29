// Board document schema and every mutation on it. Framework-free: the client uses it now,
// the Durable Object will import it for validation and migration (story 4).
//
// Y.Doc
//   meta: Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map { type: 'sticky'|…, x, y, w?, h?, color, text: Y.Text, z, createdAt }>
//
// Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`. Rejected or no-op calls
// return false / 0 before opening a transaction, so they emit no update.
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';
import type { Rect } from './geometry';

export const SCHEMA_VERSION = 1;

/** Transaction origin for changes made by this client (story 3 skips echoes, story 8 undoes only these). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  /** Persisted width (present after first resize; undefined = STICKY_SIZE_WORLD fallback). */
  width?: number;
  /** Persisted height (present after first resize; undefined = STICKY_SIZE_WORLD fallback). */
  height?: number;
}

/** A generic object snapshot for group operations (any registered type). */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
}

type ObjectMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap<ObjectMap>('objects');
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isStickyColor(c: unknown): c is StickyColor {
  return typeof c === 'string' && Object.hasOwn(STICKY_COLORS, c);
}

function getObject(doc: Y.Doc, id: string): ObjectMap | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

function zOf(obj: ObjectMap): number {
  const z = obj.get('z');
  return isFiniteNumber(z) ? z : 0;
}

/** Highest z among all objects except `exceptId` (0 when there are none). */
function maxZ(doc: Y.Doc, exceptId?: string): number {
  let max = 0;
  objectsOf(doc).forEach((obj, id) => {
    if (id !== exceptId && obj instanceof Y.Map) max = Math.max(max, zOf(obj));
  });
  return max;
}

/** Sets `meta.schemaVersion` if absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>('meta');
  if (meta.has('schemaVersion')) return;
  doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
}

/**
 * Adds a sticky note centred on world point `at`, above all other objects.
 * Returns the new id, or '' (and changes nothing) when `at` is not finite.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', isStickyColor(color) ? color : DEFAULT_STICKY_COLOR);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    objectsOf(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves an object's top-left to world (x, y). */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const obj = getObject(doc, id);
  if (!obj) return false;
  if (obj.get('x') === x && obj.get('y') === y) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Puts an object strictly above every other object. No-op (false) if it already is. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = getObject(doc, id);
  if (!obj) return false;
  const othersMax = maxZ(doc, id);
  if (zOf(obj) > othersMax) return false;
  doc.transact(() => obj.set('z', othersMax + 1), LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = getObject(doc, id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => objects.delete(id), LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getObject(doc, id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function readSticky(id: string, obj: ObjectMap): StickySnapshot | null {
  if (obj.get('type') !== 'sticky') return null;
  const x = obj.get('x');
  const y = obj.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const color = obj.get('color');
  const text = obj.get('text');
  const createdAt = obj.get('createdAt');
  const w = obj.get('width');
  const h = obj.get('height');
  const snap: Record<string, unknown> = {
    id,
    type: 'sticky' as const,
    x,
    y,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: zOf(obj),
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
  if (isFiniteNumber(w)) snap.width = w;
  if (isFiniteNumber(h)) snap.height = h;
  return Object.freeze(snap as unknown as StickySnapshot);
}

/** Render order: by z, then by id so every client agrees when z values tie. */
export function compareStacking(a: { z: number; id: string }, b: { z: number; id: string }): number {
  if (a.z !== b.z) return a.z - b.z;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Immutable list of sticky notes sorted by (z, id). Unknown or malformed objects are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map)) return;
    const s = readSticky(id, obj);
    if (s) out.push(s);
  });
  out.sort(compareStacking);
  return Object.freeze(out);
}

// Story 7: generic group operations.

/**
 * Returns the bounding rect of a snapshot object, using its type's default size
 * if width/height are not persisted.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const w = isFiniteNumber(obj.width) && obj.width! > 0 ? obj.width! : STICKY_SIZE_WORLD;
  const h = isFiniteNumber(obj.height) && obj.height! > 0 ? obj.height! : STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width: w, height: h };
}

/** Returns ids of objects entirely inside `rect` (for marquee selection). */
export function objectsInRect(objects: readonly ObjectSnapshot[], rect: Rect): string[] {
  const out: string[] = [];
  for (const o of objects) {
    const b = objectBounds(o);
    if (
      b.x >= rect.x &&
      b.y >= rect.y &&
      b.x + b.width <= rect.x + rect.width &&
      b.y + b.height <= rect.y + rect.height
    ) {
      out.push(o.id);
    }
  }
  return out;
}

/** Returns all object ids in the snapshot (for select all). */
export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  return objects.map((o) => o.id);
}

/**
 * Moves multiple objects to absolute positions. Missing ids are skipped.
 * Returns the count of objects actually changed. One transaction per call.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, { x: number; y: number }>): number {
  if (positions.size === 0) return 0;
  const entries = [...positions.entries()].filter(([_, p]) => isFiniteNumber(p.x) && isFiniteNumber(p.y));
  if (entries.length === 0) return 0;

  let changed = 0;
  doc.transact(() => {
    for (const [id, pos] of entries) {
      const obj = getObject(doc, id);
      if (!obj) continue;
      if (obj.get('x') !== pos.x || obj.get('y') !== pos.y) {
        obj.set('x', pos.x);
        obj.set('y', pos.y);
        changed++;
      }
    }
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Resizes multiple objects. Writes x, y, width, height. Missing ids are skipped.
 * Returns the count of objects actually changed. One transaction per call.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  const entries = [...rects.entries()].filter(([, r]) =>
    isFiniteNumber(r.x) && isFiniteNumber(r.y) && isFiniteNumber(r.width) && isFiniteNumber(r.height) && r.width >= 0 && r.height >= 0
  );
  if (entries.length === 0) return 0;

  let changed = 0;
  doc.transact(() => {
    for (const [id, rect] of entries) {
      const obj = getObject(doc, id);
      if (!obj) continue;
      const curX = obj.get('x');
      const curY = obj.get('y');
      const curW = obj.get('width');
      const curH = obj.get('height');
      if (curX !== rect.x || curY !== rect.y || curW !== rect.width || curH !== rect.height) {
        obj.set('x', rect.x);
        obj.set('y', rect.y);
        obj.set('width', rect.width);
        obj.set('height', rect.height);
        changed++;
      }
    }
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Puts the given objects above all unselected objects, preserving their relative stacking order.
 * Returns the count of objects whose z actually changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const set = new Set(ids);

  // Gather all objects.
  const all: { id: string; obj: ObjectMap; z: number }[] = [];
  objectsOf(doc).forEach((obj, id) => {
    if (obj instanceof Y.Map) all.push({ id, obj, z: zOf(obj) });
  });

  const selected = all.filter((o) => set.has(o.id));
  const unselected = all.filter((o) => !set.has(o.id));

  if (selected.length === 0) return 0;

  // Maximum z among unselected.
  const unselectedMaxZ = unselected.length > 0 ? Math.max(0, ...unselected.map((o) => o.z)) : 0;

  // Sort selected by current z order to preserve relative stacking.
  selected.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let changed = 0;
  doc.transact(() => {
    for (let i = 0; i < selected.length; i++) {
      const newZ = unselectedMaxZ + i + 1;
      if (selected[i].obj.get('z') !== newZ) {
        selected[i].obj.set('z', newZ);
        changed++;
      }
    }
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Deletes multiple objects. Missing ids are skipped.
 * Returns the count actually deleted. One transaction per call.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsOf(doc);
  let changed = 0;
  doc.transact(() => {
    for (const id of ids) {
      if (objects.has(id)) {
        objects.delete(id);
        changed++;
      }
    }
  }, LOCAL_ORIGIN);
  return changed;
}
