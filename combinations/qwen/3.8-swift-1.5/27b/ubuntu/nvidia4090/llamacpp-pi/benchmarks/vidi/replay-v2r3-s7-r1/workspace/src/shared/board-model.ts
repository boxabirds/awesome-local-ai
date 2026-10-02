import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';
import { rectContains, type Rect, type Point } from './geometry';

/**
 * Origin for local (this client) transactions.
 * Story 8 (undo) and story 3 (sync echo avoidance) key off this.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local-origin');

/**
 * Render-ready snapshot of a single board object. `width`/`height` are
 * optional: sticky notes created before story 7 have no explicit size and
 * fall back to STICKY_SIZE_WORLD (see `objectBounds`).
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
 * Names of object types known to the board model. The client-side registry
 * (story 7) calls `registerBoardType` when a type is registered; `sticky` is
 * built in. `snapshot` and `allObjectIds` skip unregistered types so boards
 * stay readable when unknown types appear.
 */
const registeredTypes = new Set<string>([OBJECT_TYPE_STICKY]);

export function registerBoardType(type: string): void {
  registeredTypes.add(type);
}

export function isBoardTypeRegistered(type: string): boolean {
  return registeredTypes.has(type);
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
 * Thin wrapper over the story 7 group operation.
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
  const top = maxZ(doc);
  if (currentZ >= top) return false; // already topmost
  doc.transact(() => {
    m.set('z', top + 1);
  }, LOCAL_ORIGIN);
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

/** Remove an object. Returns `false` for a stale id (no transaction). Thin wrapper over the story 7 group operation. */
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

// ---------------------------------------------------------------------------
// Story 7: generic group operations
// ---------------------------------------------------------------------------

/**
 * The object's bounds in world units. Objects without explicit `width`/
 * `height` (pre-story-7 stickies) fall back to STICKY_SIZE_WORLD.
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
 * Ids of the objects lying ENTIRELY inside `rect` (marquee rule). Objects only
 * partly inside, or merely touching the edge from outside, are excluded.
 */
export function objectsInRect(snapshotArr: readonly ObjectSnapshot[], rect: Rect): string[] {
  const out: string[] = [];
  for (const obj of snapshotArr) {
    if (rectContains(rect, objectBounds(obj))) out.push(obj.id);
  }
  return out;
}

/** Ids of every registered-type object in `snapshot` (select-all). */
export function allObjectIds(snapshotArr: readonly ObjectSnapshot[]): string[] {
  const out: string[] = [];
  for (const obj of snapshotArr) {
    if (registeredTypes.has(obj.type)) out.push(obj.id);
  }
  return out;
}

/**
 * Move objects to absolute top-left positions. Missing ids are skipped;
 * non-finite positions or an empty list → 0 with no transaction. Returns the
 * number of objects changed (one LOCAL_ORIGIN transaction).
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return 0;
  }
  const targets: [Y.Map<unknown>, Point][] = [];
  for (const [id, p] of positions) {
    const m = objectMap(doc, id);
    if (!m) continue;
    targets.push([m, p]);
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const [m, p] of targets) {
      m.set('x', p.x);
      m.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Resize objects to absolute world-space rects (writes x, y, width and height,
 * turning implicit-size stickies explicit). Same error rules as moveObjects.
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
  const targets: [Y.Map<unknown>, Rect][] = [];
  for (const [id, r] of rects) {
    const m = objectMap(doc, id);
    if (!m) continue;
    targets.push([m, r]);
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const [m, r] of targets) {
      m.set('x', r.x);
      m.set('y', r.y);
      m.set('width', r.width);
      m.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Raise all given objects above every unselected object, preserving their
 * relative stacking order (z = maxUnselectedZ + rank). Returns the number of
 * objects raised.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const idSet = new Set(ids);
  const selected: { m: Y.Map<unknown>; z: number; id: string }[] = [];
  let maxUnselectedZ = 0;
  for (const [id, m] of objectsMap(doc).entries()) {
    const z = m.get('z');
    if (!isFiniteNumber(z)) continue;
    if (idSet.has(id)) {
      selected.push({ m, z, id });
    } else if (z > maxUnselectedZ) {
      maxUnselectedZ = z;
    }
  }
  if (selected.length === 0) return 0;
  selected.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : 1));
  doc.transact(() => {
    selected.forEach((s, i) => s.m.set('z', maxUnselectedZ + i + 1));
  }, LOCAL_ORIGIN);
  return selected.length;
}

/** Delete every existing object in `ids` (missing ones skipped). Returns the number deleted. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const present = [...new Set(ids)].filter((id) => objectMap(doc, id) !== undefined);
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/**
 * Read an immutable, render-ready snapshot of every registered-type object,
 * sorted by `(z, id)` so equal-z ties (possible once story 3 syncs) resolve
 * identically on every client. Unknown object types are skipped (forward
 * compatibility). Sticky notes carry their colour and text; `width`/`height`
 * are present only when explicitly stored (story 7 additive fields).
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  for (const [id, m] of objectsMap(doc).entries()) {
    const type = m.get('type');
    if (typeof type !== 'string' || !registeredTypes.has(type)) continue;
    const x = m.get('x');
    const y = m.get('y');
    const z = m.get('z');
    const createdAt = m.get('createdAt');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) continue;
    const width = m.get('width');
    const height = m.get('height');
    const base: ObjectSnapshot = {
      id,
      type,
      x,
      y,
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    };
    if (isFiniteNumber(width)) base.width = width;
    if (isFiniteNumber(height)) base.height = height;
    if (type === OBJECT_TYPE_STICKY) {
      const color = m.get('color');
      const text = m.get('text');
      const sticky: StickySnapshot = {
        ...base,
        type: 'sticky',
        color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
        text: text instanceof Y.Text ? text.toString() : '',
      };
      out.push(sticky);
    } else {
      out.push(base);
    }
  }
  out.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}
