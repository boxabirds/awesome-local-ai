import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';
import { rectContains, type Rect, type Point } from './geometry';
import { getObjectType } from '../client/objects/registry';

// Origin for local (this-client) transactions. Story 8 uses it for undo and
// story 3 uses it to avoid echoing remote updates.
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6:local-origin');

/**
 * Generic board object snapshot (story 7). `type` plus per-type fields;
 * unknown types are tolerated (forward compatibility for stories 9–12) and
 * skipped by the renderer and by select-all.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
  /** Sticky notes (story 2). */
  color?: StickyColor;
  text?: string;
  /** Story 7: explicit size; absent on pre-story-7 stickies (fallback STICKY_SIZE_WORLD). */
  width?: number;
  height?: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

const META_SCHEMA_VERSION = 1;

/**
 * Document schema (the future persisted and wire contract):
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string /* id *\/, Y.Map>
 *       <id>: Y.Map {
 *         type: 'sticky', x: number, y: number, color: StickyColor,
 *         text: Y.Text, z: number, createdAt: number
 *       }
 */

export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

/** Sets `meta.schemaVersion` if absent. Idempotent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', META_SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function stickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  return obj;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

function isFinitePoint(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Creates a sticky note centred on `at` (top-left = at − STICKY_SIZE_WORLD/2),
 * on top of all other notes (z = maxZ + 1). Returns the new id, or `''` when
 * the coordinates are not finite (no transaction is opened).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFinitePoint(at) || !isStickyColor(color)) return '';

  const id = crypto.randomUUID();
  const sticky = new Y.Map<unknown>();
  sticky.set('type', 'sticky');
  sticky.set('x', at.x - STICKY_SIZE_WORLD / 2);
  sticky.set('y', at.y - STICKY_SIZE_WORLD / 2);
  sticky.set('color', color);
  sticky.set('text', new Y.Text());
  sticky.set('z', maxZ(doc) + 1);
  sticky.set('createdAt', Date.now());

  doc.transact(() => {
    objectsMap(doc).set(id, sticky);
  }, LOCAL_ORIGIN);
  return id;
}

// ---------------------------------------------------------------------------
// Story 7: generic object bounds and group operations.
// Every mutating call: non-finite values or an empty id list → 0 and no
// transaction; missing ids are skipped; otherwise one LOCAL_ORIGIN
// transaction returning the count of objects changed.
// ---------------------------------------------------------------------------

/** The object's world-space bounds; stickies without explicit width/height use STICKY_SIZE_WORLD. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/**
 * Ids of the objects lying entirely inside `rect` (marquee rule,
 * sel.marquee): an object touching the edge from outside is not included.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snapshot.filter((o) => rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/**
 * Ids of every object with a registered type (select-all, sel.all):
 * unknown types are excluded.
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.filter((o) => getObjectType(o.type) !== undefined).map((o) => o.id);
}

function isFiniteRect(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

/**
 * Moves each id's top-left to the given absolute world position (group move
 * and nudge). Absolute writes converge under concurrent editing. Missing ids
 * are skipped. Returns the number of objects moved; 0 (no transaction) for an
 * empty map or any non-finite position.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const [id, p] of positions) {
    if (!id || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  }
  const objects = objectsMap(doc);
  let changed = 0;
  doc.transact(() => {
    for (const [id, p] of positions) {
      const obj = objects.get(id);
      if (!obj) continue;
      if (obj.get('x') === p.x && obj.get('y') === p.y) continue;
      obj.set('x', p.x);
      obj.set('y', p.y);
      changed++;
    }
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Sets each id's bounds (x, y, width, height) — group resize. The first
 * resize turns an implicit-size sticky explicit (writes both fields).
 * Returns the number of objects resized; 0 (no transaction) for an empty map
 * or any non-finite rect.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const [id, r] of rects) {
    if (!id || !isFiniteRect(r)) return 0;
  }
  const objects = objectsMap(doc);
  let changed = 0;
  doc.transact(() => {
    for (const [id, r] of rects) {
      const obj = objects.get(id);
      if (!obj) continue;
      const w = obj.get('width');
      const h = obj.get('height');
      if (
        obj.get('x') === r.x &&
        obj.get('y') === r.y &&
        (typeof w === 'number' ? w : STICKY_SIZE_WORLD) === r.width &&
        (typeof h === 'number' ? h : STICKY_SIZE_WORLD) === r.height
      ) {
        continue;
      }
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
      changed++;
    }
  }, LOCAL_ORIGIN);
  return changed;
}

function zOf(obj: Y.Map<unknown>): number {
  const z = obj.get('z');
  return typeof z === 'number' ? z : 0;
}

/**
 * Raises every id above all unselected objects, preserving the selection's
 * relative stacking order (sel.group_move): z = maxUnselectedZ + rank, where
 * rank is the object's (z, id) order within the selection. When `topId` is
 * given (the dragged object), it takes the highest rank. Returns the number
 * of objects whose z changed; 0 for an empty list, missing ids, or a
 * selection already on top.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[], topId?: string): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const selected = new Map<string, Y.Map<unknown>>();
  for (const id of ids) {
    const obj = objects.get(id);
    if (obj) selected.set(id, obj);
  }
  if (selected.size === 0) return 0;

  const sorted = [...selected.entries()].sort(
    (a, b) => zOf(a[1]) - zOf(b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  if (topId && selected.has(topId)) {
    const i = sorted.findIndex(([id]) => id === topId);
    if (i >= 0 && i < sorted.length - 1) {
      const [entry] = sorted.splice(i, 1);
      sorted.push(entry);
    }
  }

  let maxUnselectedZ = 0;
  objects.forEach((obj, id) => {
    if (selected.has(id)) return;
    const z = zOf(obj);
    if (z > maxUnselectedZ) maxUnselectedZ = z;
  });

  let changed = 0;
  doc.transact(() => {
    sorted.forEach(([, obj], i) => {
      const nextZ = maxUnselectedZ + i + 1;
      if (zOf(obj) !== nextZ) {
        obj.set('z', nextZ);
        changed++;
      }
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/** Removes every id that exists. Returns the number removed; 0 for an empty list. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  let changed = 0;
  doc.transact(() => {
    for (const id of new Set(ids)) {
      if (!objects.has(id)) continue;
      objects.delete(id);
      changed++;
    }
  }, LOCAL_ORIGIN);
  return changed;
}

// ---------------------------------------------------------------------------
// Story 2 single-object functions — thin wrappers over the group versions.
// ---------------------------------------------------------------------------

/** Moves a note's top-left to world (x, y). False (no transaction) for stale ids or non-finite coordinates. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/** Gives the note the highest z (maxZ + 1). False (no transaction) if it already is topmost or the id is stale. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/**
 * Sets only the `color` field. False (no transaction) for unknown colour
 * names, stale ids, or when the note already has that colour.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes the object with this id. False (no transaction) for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** The note's Y.Text, or undefined for stale/unknown ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = stickyMap(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Immutable snapshot of every board object (any type), sorted by (z, id) so
 * concurrent equal z values (possible once story 3 syncs) still give every
 * client the same render order. Objects without a string `type` are skipped.
 */
export function snapshotObjects(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  objectsMap(doc).forEach((obj, id) => {
    const type = obj.get('type');
    if (typeof type !== 'string') return;
    const text = obj.get('text');
    out.push({
      id,
      type,
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
      color: isStickyColor(obj.get('color')) ? (obj.get('color') as StickyColor) : undefined,
      text: text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : undefined,
      width: num(obj.get('width')),
      height: num(obj.get('height')),
    });
  });
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so concurrent
 * equal z values (possible once story 3 syncs) still give every client the
 * same render order. Unknown `type` values are skipped (forward
 * compatibility for stories 9–12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshotObjects(doc).filter((o): o is StickySnapshot => o.type === 'sticky');
}
