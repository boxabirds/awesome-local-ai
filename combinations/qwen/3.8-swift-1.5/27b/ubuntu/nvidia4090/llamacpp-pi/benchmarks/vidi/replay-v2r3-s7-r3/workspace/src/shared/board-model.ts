import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';
import type { Rect } from './geometry';
import { rectContains } from './geometry';
// Note: importing the client registry here is safe — neither module touches
// the other's bindings at module top level (see NOTES.md, story 7).
import { getObjectType } from '../client/objects/registry';

/**
 * Origin for local (this client) transactions.
 * Story 8 (undo) and story 3 (sync echo avoidance) key off this.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local-origin');

/**
 * Generic, render-ready snapshot of one board object (story 7). `width` and
 * `height` are optional: objects created before story 7 have no size fields
 * and render at STICKY_SIZE_WORLD (additive, no migration).
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
  color?: StickyColor;
  text?: string;
  createdAt?: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
  createdAt: number;
}

/** Document schema version (persisted format in story 4, wire format in story 3). */
const SCHEMA_VERSION = 1;
const OBJECT_TYPE_STICKY = 'sticky';

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isStickyColor(c: unknown): c is StickyColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, c);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function objectMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objectsMap(doc).get(id);
}

/** Highest z among all objects, or 0 when the board is empty. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsMap(doc).values()) {
    const z = m.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

/**
 * Ensure the document has its meta block. Idempotent: sets `meta.schemaVersion`
 * only if absent, so calling it on an already-initialised doc is a no-op.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a sticky note centred on `at` (world units). The note's top-left is
 * placed at `at - STICKY_SIZE_WORLD/2` and it is stacked on top (z = maxZ + 1).
 * Returns the new id, or `false` if the coordinates are not finite.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return false;
  if (!isStickyColor(color)) return false;
  const id = crypto.randomUUID();
  const text = new Y.Text();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', OBJECT_TYPE_STICKY);
    m.set('x', at.x - STICKY_SIZE_WORLD / 2);
    m.set('y', at.y - STICKY_SIZE_WORLD / 2);
    m.set('color', color);
    m.set('text', text);
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move an object's top-left to world `(x, y)`. Returns `true` on success,
 * `false` for a stale id or non-finite coordinates (no transaction in that case).
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/**
 * Bring an object to the top of the stack. Returns `false` for a stale id or
 * when the object is already topmost (no transaction).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/**
 * Set a sticky note's colour. Returns `false` for a stale id or an unknown
 * colour name (no transaction). Text, position and stacking are untouched.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const m = objectMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    m.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. Returns `false` for a stale id (no transaction). */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** Return the note's Y.Text, or `undefined` for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = objectMap(doc, id);
  if (!m) return undefined;
  const t = m.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/**
 * Read an immutable, render-ready snapshot of all sticky notes, sorted by
 * `(z, id)` so equal-z ties (possible once story 3 syncs) resolve identically
 * on every client. Unknown object types are skipped (forward compatibility).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  for (const [id, m] of objectsMap(doc).entries()) {
    if (m.get('type') !== OBJECT_TYPE_STICKY) continue;
    const x = m.get('x');
    const y = m.get('y');
    const z = m.get('z');
    const createdAt = m.get('createdAt');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) continue;
    const color = m.get('color');
    const text = m.get('text');
    const width = m.get('width');
    const height = m.get('height');
    out.push({
      id,
      type: 'sticky',
      x,
      y,
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      ...(isFiniteNumber(width) ? { width } : {}),
      ...(isFiniteNumber(height) ? { height } : {}),
    });
  }
  out.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Story 7: generic group operations and geometry helpers.
//
// Every mutating call rejects non-finite values and empty id lists with 0 and
// no transaction, skips missing ids, and otherwise performs one LOCAL_ORIGIN
// transaction returning the count of objects changed.
// ---------------------------------------------------------------------------

/**
 * Read an immutable snapshot of ALL objects in the doc (any type, including
 * unregistered ones — forward compatibility), sorted by `(z, id)` like
 * `snapshot`. Objects without finite x/y/z are skipped.
 */
export function allObjects(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  for (const [id, m] of objectsMap(doc).entries()) {
    const x = m.get('x');
    const y = m.get('y');
    const z = m.get('z');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) continue;
    const type = m.get('type');
    if (typeof type !== 'string') continue;
    const width = m.get('width');
    const height = m.get('height');
    const createdAt = m.get('createdAt');
    const obj: ObjectSnapshot = { id, type, x, y, z };
    if (isFiniteNumber(width)) obj.width = width;
    if (isFiniteNumber(height)) obj.height = height;
    if (isFiniteNumber(createdAt)) obj.createdAt = createdAt;
    const color = m.get('color');
    if (isStickyColor(color)) obj.color = color;
    const text = m.get('text');
    if (text instanceof Y.Text) obj.text = text.toString();
    out.push(obj);
  }
  out.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/**
 * The object's bounding rect in world units. Objects without explicit
 * `width`/`height` (created before story 7) use STICKY_SIZE_WORLD.
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
 * Ids of the objects lying ENTIRELY inside `rect` (marquee rule, PRD
 * sel.marquee). Pure geometry — no registry filtering.
 */
export function objectsInRect(objects: readonly ObjectSnapshot[], rect: Rect): string[] {
  const out: string[] = [];
  for (const o of objects) {
    if (rectContains(rect, objectBounds(o))) out.push(o.id);
  }
  return out;
}

/**
 * Ids of all objects whose type is registered (select-all, PRD sel.all).
 * Objects of unknown types are excluded.
 */
export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  const out: string[] = [];
  for (const o of objects) {
    if (getObjectType(o.type)) out.push(o.id);
  }
  return out;
}

/**
 * Move several objects to absolute world positions in one transaction.
 * `positions` maps object id → new top-left. Non-finite positions reject the
 * whole call (0, no transaction); missing ids are skipped. Returns the number
 * of objects moved.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, { x: number; y: number }>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return 0;
  }
  const objects = objectsMap(doc);
  let applied = 0;
  doc.transact(() => {
    for (const [id, p] of positions) {
      const m = objects.get(id);
      if (!m) continue;
      m.set('x', p.x);
      m.set('y', p.y);
      applied++;
    }
  }, LOCAL_ORIGIN);
  return applied;
}

/**
 * Resize/reposition several objects to absolute world rects in one
 * transaction. Writes `x`, `y`, `width` and `height`, turning implicit-size
 * objects (no width/height fields) explicit. Non-finite rects reject the whole
 * call (0, no transaction); missing ids are skipped. Returns the number of
 * objects changed.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (
      !isFiniteNumber(r.x) ||
      !isFiniteNumber(r.y) ||
      !isFiniteNumber(r.width) ||
      !isFiniteNumber(r.height)
    ) {
      return 0;
    }
  }
  const objects = objectsMap(doc);
  let applied = 0;
  doc.transact(() => {
    for (const [id, r] of rects) {
      const m = objects.get(id);
      if (!m) continue;
      m.set('x', r.x);
      m.set('y', r.y);
      m.set('width', r.width);
      m.set('height', r.height);
      applied++;
    }
  }, LOCAL_ORIGIN);
  return applied;
}

/**
 * Raise the given objects above every unselected object, preserving their
 * relative stacking order: each gets z = maxUnselectedZ + rank (rank by
 * current z, ties by id). Returns the number of objects whose z changed
 * (0 and no transaction when nothing changes).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const idSet = new Set(ids);
  const ranked: { id: string; z: number }[] = [];
  for (const id of ids) {
    const m = objects.get(id);
    if (!m) continue;
    const z = m.get('z');
    if (!isFiniteNumber(z)) continue;
    ranked.push({ id, z });
  }
  if (ranked.length === 0) return 0;
  ranked.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : 1));

  let maxUnselectedZ = 0;
  for (const [id, m] of objects.entries()) {
    if (idSet.has(id)) continue;
    const z = m.get('z');
    if (isFiniteNumber(z) && z > maxUnselectedZ) maxUnselectedZ = z;
  }

  let changed = 0;
  doc.transact(() => {
    ranked.forEach((o, i) => {
      const z = maxUnselectedZ + i + 1;
      const m = objects.get(o.id);
      if (m && m.get('z') !== z) {
        m.set('z', z);
        changed++;
      }
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Remove several objects in one transaction. Missing ids are skipped. Returns
 * the number of objects removed (0 and no transaction for an empty list).
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  let applied = 0;
  doc.transact(() => {
    for (const id of ids) {
      if (!objects.get(id)) continue;
      objects.delete(id);
      applied++;
    }
  }, LOCAL_ORIGIN);
  return applied;
}
