import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';
import { rectContains } from './geometry';
import type { Rect, Point } from './geometry';

/**
 * Origin for local (this client) transactions.
 * Story 8 (undo) and story 3 (sync echo avoidance) key off this.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local-origin');

/**
 * Render-ready snapshot of any board object. `width`/`height` are optional:
 * sticky notes created before story 7 have no explicit size and render at
 * STICKY_SIZE_WORLD (objectBounds applies the fallback).
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
  /** Sticky-only fields (present when type === 'sticky'). */
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
 * Types this model knows how to snapshot/operate on. The client's object-type
 * registry (src/client/objects/registry.tsx) adds its types here at import
 * time so select-all and the renderer agree on what is a real object.
 */
const KNOWN_TYPES = new Set<string>([OBJECT_TYPE_STICKY]);

export function isKnownObjectType(type: string): boolean {
  return KNOWN_TYPES.has(type);
}

/** Called by the object-type registry when a type is registered. */
export function registerKnownObjectType(type: string): void {
  KNOWN_TYPES.add(type);
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
    m.set('width', STICKY_SIZE_WORLD);
    m.set('height', STICKY_SIZE_WORLD);
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
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
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
  return bringObjectsToFront(doc, [id]) === 1;
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
  return deleteObjects(doc, [id]) === 1;
}

/** Return the note's Y.Text, or `undefined` for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = objectMap(doc, id);
  if (!m) return undefined;
  const t = m.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/**
 * Read an immutable, render-ready snapshot of every known object, sorted by
 * `(z, id)` so equal-z ties (possible once story 3 syncs) resolve identically
 * on every client. Unknown object types are skipped (forward compatibility).
 */
export function objects(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  for (const [id, m] of objectsMap(doc).entries()) {
    const type = m.get('type');
    if (typeof type !== 'string' || !isKnownObjectType(type)) continue;
    const x = m.get('x');
    const y = m.get('y');
    const z = m.get('z');
    const createdAt = m.get('createdAt');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) continue;
    const snap: ObjectSnapshot = {
      id,
      type,
      x,
      y,
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    };
    const width = m.get('width');
    const height = m.get('height');
    if (isFiniteNumber(width) && width > 0) snap.width = width;
    if (isFiniteNumber(height) && height > 0) snap.height = height;
    if (type === OBJECT_TYPE_STICKY) {
      const color = m.get('color');
      const text = m.get('text');
      snap.color = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
      snap.text = text instanceof Y.Text ? text.toString() : '';
    }
    out.push(snap);
  }
  out.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/**
 * Read an immutable, render-ready snapshot of all sticky notes, sorted by
 * `(z, id)`. Unknown object types are skipped (forward compatibility).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return objects(doc).filter((o) => o.type === OBJECT_TYPE_STICKY) as StickySnapshot[];
}

/* ------------------------------------------------------------------ */
/* Story 7: geometry-backed group operations                           */
/* ------------------------------------------------------------------ */

/**
 * World-unit bounds of an object. Stickies without explicit width/height
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
 * Ids of the objects lying entirely inside `rect` (marquee rule). Objects
 * only partly inside are not included.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snapshot.filter((o) => rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/** Ids of every select-able object (registered types only), for select-all. */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.filter((o) => isKnownObjectType(o.type)).map((o) => o.id);
}

/**
 * Move the given objects' top-left corners to absolute world positions.
 * Returns the number of objects changed. Non-finite positions reject the whole
 * call (0, no transaction); missing ids are skipped; empty map → 0. One
 * LOCAL_ORIGIN transaction per call.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return 0;
  }
  let count = 0;
  doc.transact(() => {
    for (const [id, p] of positions) {
      const m = objectMap(doc, id);
      if (!m) continue; // deleted remotely mid-gesture: skip
      m.set('x', p.x);
      m.set('y', p.y);
      count += 1;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Set the given objects' bounds to absolute world rects, writing width and
 * height (turning implicit-size stickies explicit). Same error rules as
 * moveObjects.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (
      !isFiniteNumber(r.x) ||
      !isFiniteNumber(r.y) ||
      !isFiniteNumber(r.width) ||
      !isFiniteNumber(r.height) ||
      r.width <= 0 ||
      r.height <= 0
    ) {
      return 0;
    }
  }
  let count = 0;
  doc.transact(() => {
    for (const [id, r] of rects) {
      const m = objectMap(doc, id);
      if (!m) continue;
      m.set('x', r.x);
      m.set('y', r.y);
      m.set('width', r.width);
      m.set('height', r.height);
      count += 1;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Raise the given objects above every unselected object while preserving
 * their relative stacking order (z = maxUnselectedZ + rank). Returns the
 * number of objects changed; missing ids skipped.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const entries: { id: string; z: number }[] = [];
  for (const id of ids) {
    const m = objectMap(doc, id);
    if (!m) continue;
    const z = m.get('z');
    if (!isFiniteNumber(z)) continue;
    entries.push({ id, z });
  }
  if (entries.length === 0) return 0;
  const selectedSet = new Set(ids);
  let maxUnselectedZ = 0;
  for (const [id, m] of objectsMap(doc).entries()) {
    if (selectedSet.has(id)) continue;
    const z = m.get('z');
    if (isFiniteNumber(z) && z > maxUnselectedZ) maxUnselectedZ = z;
  }
  // Rank by current stacking order (z, then id for determinism).
  entries.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let count = 0;
  doc.transact(() => {
    entries.forEach((e, rank) => {
      const m = objectMap(doc, e.id);
      if (!m) return;
      m.set('z', maxUnselectedZ + rank + 1);
      count += 1;
    });
  }, LOCAL_ORIGIN);
  return count;
}

/** Remove the given objects. Returns the number removed; missing ids skipped. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  let count = 0;
  doc.transact(() => {
    for (const id of ids) {
      if (objectMap(doc, id)) {
        objectsMap(doc).delete(id);
        count += 1;
      }
    }
  }, LOCAL_ORIGIN);
  return count;
}
