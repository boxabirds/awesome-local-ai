import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';
import { rectContains, type Rect, type Point } from './geometry';
import { isKnownObjectType } from './object-types';

/**
 * Origin for local (this client) transactions.
 * Story 8 (undo) and story 3 (sync echo avoidance) key off this.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local-origin');

/**
 * Render-ready snapshot of a board object. `width`/`height` are additive
 * (story 7): absent until the first resize, then explicit board units.
 * `color`/`text` are sticky-specific; other types carry defaults so the
 * snapshot shape stays uniform.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
  width?: number;
  height?: number;
  color: StickyColor;
  text: string;
}

export type StickySnapshot = ObjectSnapshot & { type: 'sticky' };

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
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const m = objectMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    m.set('x', x);
    m.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Bring an object to the top of the stack (z = maxZ + 1). Returns `false` for a
 * stale id or when the object is already topmost (no transaction).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const m = objectMap(doc, id);
  if (!m) return false;
  const currentZ = m.get('z');
  if (!isFiniteNumber(currentZ)) return false;
  if (currentZ >= maxZ(doc)) return false; // already topmost
  bringObjectsToFront(doc, [id]);
  return true;
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
  if (!objectMap(doc, id)) return false;
  doc.transact(() => {
    objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** Return the note's Y.Text, or `undefined` for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = objectMap(doc, id);
  if (!m) return undefined;
  const t = m.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/**
 * Read an immutable, render-ready snapshot of all objects, sorted by
 * `(z, id)` so equal-z ties (possible once story 3 syncs) resolve identically
 * on every client. Unknown (unregistered) object types are skipped
 * (forward compatibility).
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  for (const [id, m] of objectsMap(doc).entries()) {
    const type = m.get('type');
    if (typeof type !== 'string' || !isKnownObjectType(type)) continue;
    const x = m.get('x');
    const y = m.get('y');
    const z = m.get('z');
    const createdAt = m.get('createdAt');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) continue;
    const width = m.get('width');
    const height = m.get('height');
    const color = m.get('color');
    const text = m.get('text');
    const base: ObjectSnapshot = {
      id,
      type,
      x,
      y,
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
    };
    if (isFiniteNumber(width) && width > 0) base.width = width;
    if (isFiniteNumber(height) && height > 0) base.height = height;
    out.push(base);
  }
  out.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Story 7: generic group operations (sel.geometry_ops)
// ---------------------------------------------------------------------------

/** Top-left + size of an object in world units (STICKY_SIZE_WORLD fallback). */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = isFiniteNumber(obj.width) && obj.width > 0 ? obj.width : STICKY_SIZE_WORLD;
  const height = isFiniteNumber(obj.height) && obj.height > 0 ? obj.height : STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width, height };
}

/** Ids of objects lying entirely inside `rect` (fully-inside rule). */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snapshot
    .filter((o) => isKnownObjectType(o.type) && rectContains(rect, objectBounds(o)))
    .map((o) => o.id);
}

/** Ids of all objects with a registered type (for select-all). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.filter((o) => isKnownObjectType(o.type)).map((o) => o.id);
}

/**
 * Move objects to absolute top-left positions. Returns the count changed.
 * Non-finite values or an empty map → 0, no transaction; missing ids skipped;
 * otherwise one LOCAL_ORIGIN transaction.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  const targets: Array<[string, number, number]> = [];
  for (const [id, p] of positions) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return 0; // validate all up front
    if (!objectMap(doc, id)) continue; // stale ids skipped
    targets.push([id, p.x, p.y]);
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const [id, x, y] of targets) {
      const m = objectMap(doc, id)!;
      m.set('x', x);
      m.set('y', y);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Resize objects to absolute rects (writes width/height, turning implicit-
 * size objects explicit). Same validation rules as moveObjects.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  const targets: Array<[string, Rect]> = [];
  for (const [id, r] of rects) {
    const ok =
      isFiniteNumber(r.x) &&
      isFiniteNumber(r.y) &&
      isFiniteNumber(r.width) &&
      isFiniteNumber(r.height) &&
      r.width > 0 &&
      r.height > 0;
    if (!ok) return 0; // validate all up front
    if (!objectMap(doc, id)) continue; // stale ids skipped
    targets.push([id, r]);
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const [id, r] of targets) {
      const m = objectMap(doc, id)!;
      m.set('x', r.x);
      m.set('y', r.y);
      m.set('width', r.width);
      m.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Raise all `ids` above every unselected object, preserving their relative
 * stacking order. Missing ids are skipped. Returns the count changed;
 * 0 (no transaction) when there is nothing to raise.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const present = ids.filter((id) => objectMap(doc, id) !== undefined);
  if (present.length === 0) return 0;
  const maxOther = (() => {
    let max = 0;
    for (const [id, m] of objectsMap(doc).entries()) {
      if (present.includes(id)) continue;
      const z = m.get('z');
      if (isFiniteNumber(z) && z > max) max = z;
    }
    return max;
  })();
  doc.transact(() => {
    present.forEach((id, i) => {
      objectMap(doc, id)!.set('z', maxOther + i + 1);
    });
  }, LOCAL_ORIGIN);
  return present.length;
}

/** Remove objects. Returns the count removed. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const present = ids.filter((id) => objectMap(doc, id) !== undefined);
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
