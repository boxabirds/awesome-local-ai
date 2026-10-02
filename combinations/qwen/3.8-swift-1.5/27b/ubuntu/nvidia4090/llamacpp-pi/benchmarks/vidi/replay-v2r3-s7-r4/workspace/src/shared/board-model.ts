import * as Y from 'yjs';
import { rectContains, type Point, type Rect } from './geometry';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';

/**
 * Origin for local (this client) transactions.
 * Story 8 (undo) and story 3 (sync echo avoidance) key off this.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local-origin');

/**
 * Render-ready snapshot of a board object. Story 7 generalised the former
 * sticky-only snapshot: `width`/`height` are persisted only from the first
 * resize onwards (absent for stickies created before story 7, in which case
 * `objectBounds` falls back to STICKY_SIZE_WORLD). `color`/`text` are present
 * for sticky notes.
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
  color?: StickyColor;
  text?: string;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

/** Document schema version (persisted format in story 4, wire format in story 3). */
const SCHEMA_VERSION = 1;
const OBJECT_TYPE_STICKY = 'sticky';

/**
 * Types registered by the client object-type registry (story 7). The shared
 * model uses this set so `snapshot`/`allObjectIds` can skip unregistered
 * (unknown) object types without importing client code.
 */
const knownTypes = new Set<string>([OBJECT_TYPE_STICKY]); // native type; the registry marks the rest

export function markTypeKnown(type: string): void {
  knownTypes.add(type);
}

export function isTypeKnown(type: string): boolean {
  return knownTypes.has(type);
}

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
 * Story 7: thin wrapper over the generic group operation.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/**
 * Bring an object to the top of the stack. Returns `false` for a
 * stale id or when the object is already topmost (no transaction).
 * Story 7: thin wrapper over the generic group operation.
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
 * Read an immutable, render-ready snapshot of all objects of registered
 * types, sorted by `(z, id)` so equal-z ties (possible once story 3 syncs)
 * resolve identically on every client. Unknown object types are skipped
 * (forward compatibility).
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  for (const [id, m] of objectsMap(doc).entries()) {
    const type = m.get('type');
    if (typeof type !== 'string' || !knownTypes.has(type)) continue;
    const x = m.get('x');
    const y = m.get('y');
    const z = m.get('z');
    const createdAt = m.get('createdAt');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) continue;
    const width = m.get('width');
    const height = m.get('height');
    const color = m.get('color');
    const text = m.get('text');
    out.push({
      id,
      type,
      x,
      y,
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      ...(isFiniteNumber(width) ? { width } : {}),
      ...(isFiniteNumber(height) ? { height } : {}),
      ...(isStickyColor(color) ? { color } : {}),
      ...(text instanceof Y.Text ? { text: text.toString() } : {}),
    });
  }
  out.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Story 7: geometry helpers and generic group operations
// ---------------------------------------------------------------------------

/**
 * World-space bounds of an object. Stickies without persisted `width`/`height`
 * (created before story 7) fall back to STICKY_SIZE_WORLD.
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
 * Ids of the objects lying ENTIRELY inside `rect` (marquee rule: an object
 * only partly inside, or merely touching the edge, is not selected).
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snapshot.filter((o) => rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/**
 * Ids of every selectable object (registered types only — unknown types in
 * the snapshot are excluded from select-all).
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.filter((o) => isTypeKnown(o.type)).map((o) => o.id);
}

/**
 * Move the top-left of each object to its absolute world position. Missing
 * ids are skipped; non-finite positions or an empty map → 0, no transaction.
 * Returns the number of objects changed.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  const changes: Array<[Y.Map<unknown>, number, number]> = [];
  for (const [id, p] of positions) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) continue;
    const m = objectMap(doc, id);
    if (!m) continue;
    changes.push([m, p.x, p.y]);
  }
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const [m, x, y] of changes) {
      m.set('x', x);
      m.set('y', y);
    }
  }, LOCAL_ORIGIN);
  return changes.length;
}

/**
 * Set each object's absolute bounds (x, y, width, height). Writing
 * width/height turns an implicit-size sticky explicit. Missing ids are
 * skipped; non-finite rects or an empty map → 0, no transaction. Returns the
 * number of objects changed.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  const changes: Array<[Y.Map<unknown>, Rect]> = [];
  for (const [id, r] of rects) {
    if (
      !isFiniteNumber(r.x) ||
      !isFiniteNumber(r.y) ||
      !isFiniteNumber(r.width) ||
      !isFiniteNumber(r.height)
    ) {
      continue;
    }
    const m = objectMap(doc, id);
    if (!m) continue;
    changes.push([m, r]);
  }
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const [m, r] of changes) {
      m.set('x', r.x);
      m.set('y', r.y);
      m.set('width', r.width);
      m.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return changes.length;
}

/**
 * Raise every listed object above all unselected objects, preserving their
 * relative stacking order (reassign z = maxUnselectedZ + rank). Missing/stale
 * ids are skipped; an empty list or a no-op → 0, no transaction. Returns the
 * number of objects changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const idSet = new Set(ids);
  const selected: Array<{ m: Y.Map<unknown>; z: number; id: string }> = [];
  for (const id of ids) {
    const m = objectMap(doc, id);
    if (!m) continue;
    const z = m.get('z');
    if (!isFiniteNumber(z)) continue;
    selected.push({ m, z, id });
  }
  if (selected.length === 0) return 0;

  let maxUnselected = 0;
  for (const [id, m] of objectsMap(doc).entries()) {
    if (idSet.has(id)) continue;
    const z = m.get('z');
    if (isFiniteNumber(z) && z > maxUnselected) maxUnselected = z;
  }

  // Relative order by current z (id tie-break, matching snapshot order).
  selected.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const targetZ = selected.map((_, i) => maxUnselected + 1 + i);
  if (selected.every((s, i) => s.z === targetZ[i])) return 0; // already on top, in order
  doc.transact(() => {
    for (let i = 0; i < selected.length; i++) selected[i].m.set('z', targetZ[i]);
  }, LOCAL_ORIGIN);
  return selected.length;
}

/**
 * Delete every listed object. Missing ids are skipped; an empty list → 0,
 * no transaction. Returns the number of objects deleted.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const existing = ids.filter((id) => objects.get(id) !== undefined);
  if (existing.length === 0) return 0;
  doc.transact(() => {
    for (const id of existing) objects.delete(id);
  }, LOCAL_ORIGIN);
  return existing.length;
}
