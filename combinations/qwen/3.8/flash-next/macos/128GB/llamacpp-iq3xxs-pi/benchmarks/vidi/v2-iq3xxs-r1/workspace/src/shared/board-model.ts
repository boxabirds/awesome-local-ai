import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';
import { rectContains, type Rect } from './geometry';

/**
 * Transaction origin for every mutation this client makes. Story 8 uses it for
 * per-user undo, story 3 to avoid echoing changes back over the wire.
 *
 * This module is the *only* place that writes the board document. It is
 * framework-free on purpose: from story 4 the Durable Object imports it for
 * validation and migration, and from story 3 the same document is synced.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Document maps (the persisted / wire format; see spec/stories/002 design). */
export const META_MAP = 'meta';
export const OBJECTS_MAP = 'objects';
/** Bumped only when the schema below changes. */
export const SCHEMA_VERSION = 1;

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  /** Top-left corner in world units. */
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher is drawn on top. */
  z: number;
  createdAt: number;
  /** Width in world units; may be undefined for pre-story-7 stickies. */
  width?: number;
  /** Height in world units; may be undefined for pre-story-7 stickies. */
  height?: number;
}

/** Generic snapshot for any object type (used by group operations). */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
}

/** A point in world coordinates. */
export interface WorldPoint {
  x: number;
  y: number;
}

type AnyMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<AnyMap> {
  return doc.getMap<AnyMap>(OBJECTS_MAP);
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isStickyMap(m: AnyMap | undefined): m is AnyMap {
  return m instanceof Y.Map && m.get('type') === 'sticky';
}

/**
 * Create `meta` and stamp the schema version once. Safe to call on every load;
 * a second call performs no transaction (no update event).
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>(META_MAP);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
}

/** Read one sticky Y.Map into an immutable snapshot value. */
function readSticky(id: string, m: AnyMap): StickySnapshot {
  const raw = m.get('text');
  const text = raw instanceof Y.Text ? raw.toString() : typeof raw === 'string' ? raw : '';
  const color = m.get('color');
  const w = m.get('width');
  const h = m.get('height');
  return {
    id,
    type: 'sticky',
    x: asFiniteNumber(m.get('x')),
    y: asFiniteNumber(m.get('y')),
    color: typeof color === 'string' && color in STICKY_COLORS ? (color as StickyColor) : DEFAULT_STICKY_COLOR,
    text,
    z: asFiniteNumber(m.get('z')),
    createdAt: asFiniteNumber(m.get('createdAt')),
    width: typeof w === 'number' && Number.isFinite(w) ? w : undefined,
    height: typeof h === 'number' && Number.isFinite(h) ? h : undefined,
  };
}

/**
 * All sticky notes in paint order: ascending `(z, id)` so equal `z` values
 * (possible once story 3 merges concurrent edits) render identically on every
 * client. Objects with an unknown `type` are skipped for forward compatibility
 * (stories 9-12 add shapes, text, images, arrows).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  for (const [id, m] of objectsOf(doc)) {
    if (!(m instanceof Y.Map)) continue;
    if (m.get('type') !== 'sticky') continue; // unknown object kinds are ignored
    out.push(readSticky(id, m));
  }
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsOf(doc).values()) {
    if (isStickyMap(m)) max = Math.max(max, asFiniteNumber(m.get('z')));
  }
  return max;
}

/**
 * Create a sticky note *centred* on the world point `at` (the stored x,y is the
 * top-left, i.e. `at` minus half the note size) with `z = maxZ + 1`.
 *
 * Returns the new id, or `''` when the request was rejected (non-finite point or
 * unknown colour); nothing is written in that case.
 */
export function createSticky(
  doc: Y.Doc,
  at: WorldPoint,
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  if (!(color in STICKY_COLORS)) return '';

  const id = crypto.randomUUID();
  const half = STICKY_SIZE_WORLD / 2;
  const z = maxZ(doc) + 1;
  const createdAt = Date.now();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'sticky');
    m.set('x', at.x - half);
    m.set('y', at.y - half);
    m.set('color', color);
    m.set('z', z);
    m.set('createdAt', createdAt);
    m.set('text', new Y.Text(''));
    objectsOf(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note to world (x, y). False for stale ids or non-finite numbers. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const m = objectsOf(doc).get(id);
  if (!(m instanceof Y.Map)) return false;
  doc.transact(() => {
    m.set('x', x);
    m.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above every other note. False when it is already on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const m = objectsOf(doc).get(id);
  if (!isStickyMap(m)) return false;
  const z = asFiniteNumber(m.get('z'));
  const top = maxZ(doc);
  if (z >= top) return false; // already topmost: never emit a pointless update
  doc.transact(() => m.set('z', top + 1), LOCAL_ORIGIN);
  return true;
}

/** Recolour a note by name. False for stale ids and unknown colour names. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!(color in STICKY_COLORS)) return false;
  const m = objectsOf(doc).get(id);
  if (!isStickyMap(m)) return false;
  if (m.get('color') === color) return false; // no-op: no update, no sync traffic
  doc.transact(() => m.set('color', color), LOCAL_ORIGIN);
  return true;
}

/** Remove any board object. False for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (!(objectsOf(doc).get(id) instanceof Y.Map)) return false;
  doc.transact(() => objectsOf(doc).delete(id), LOCAL_ORIGIN);
  return true;
}

/** The shared Y.Text of a sticky note, for minimal-diff editing (story 3). */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = objectsOf(doc).get(id);
  if (!isStickyMap(m)) return undefined;
  const text = m.get('text');
  return text instanceof Y.Text ? text : undefined;
}

// ------------------------------------------------------------------ text
// The sticky text helpers live in the client module next to the editor that
// uses them; they are re-exported here so the model surface (and tests) can
// reach them from one place.
export { applyTextDiff, clampToLimit, counterVisible } from '../client/objects/StickyText';
export type { FontFit, MeasureFont } from '../client/objects/StickyText';

// ------------------------------------------------------------------ group operations (story 7)

/**
 * Return the bounding rect of a snapshot. Falls back to STICKY_SIZE_WORLD
 * for stickies without explicit width/height.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const w = obj.width ?? STICKY_SIZE_WORLD;
  const h = obj.height ?? STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width: w, height: h };
}

/**
 * Return ids of objects that lie fully inside the given rect (marquee selection).
 * Uses rectContains for the fully-inside rule.
 */
export function objectsInRect(
  snapshotList: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const out: string[] = [];
  for (const obj of snapshotList) {
    if (rectContains(rect, objectBounds(obj))) out.push(obj.id);
  }
  return out;
}

/**
 * Return all ids from a snapshot list that are of known/registered types.
 * Unknown types are excluded (forward compatibility for stories 9–12).
 */
export function allObjectIds(snapshotList: readonly ObjectSnapshot[]): string[] {
  // In this context "registered" means sticky (the only type we know about in the model).
  return snapshotList.filter((o) => o.type !== 'unknown').map((o) => o.id);
}

/**
 * Move multiple objects to absolute positions. Returns the count actually changed.
 * Rejects non-finite positions with 0 and no transaction; missing ids are skipped.
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, WorldPoint>,
): number {
  if (positions.size === 0) return 0;
  // Reject non-finite positions
  for (const pos of positions.values()) {
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return 0;
  }
  const objs = objectsOf(doc);
  let count = 0;
  doc.transact(() => {
    for (const [id, pos] of positions) {
      const m = objs.get(id);
      if (!(m instanceof Y.Map)) continue;
      m.set('x', pos.x);
      m.set('y', pos.y);
      count++;
    }
  }, LOCAL_ORIGIN);
  if (count === 0) return 0;
  return count;
}

/**
 * Resize multiple objects to absolute rects. Returns count changed.
 * Rejects non-finite rects or empty list with 0 and no transaction.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.width) || !Number.isFinite(r.height)) return 0;
    if (r.width <= 0 || r.height <= 0) return 0;
  }
  const objs = objectsOf(doc);
  let count = 0;
  doc.transact(() => {
    for (const [id, r] of rects) {
      const m = objs.get(id);
      if (!(m instanceof Y.Map)) continue;
      m.set('x', r.x);
      m.set('y', r.y);
      m.set('width', r.width);
      m.set('height', r.height);
      count++;
    }
  }, LOCAL_ORIGIN);
  if (count === 0) return 0;
  return count;
}

/**
 * Bring objects to front: assign z values above the current max unselected z,
 * preserving relative stacking among the selected objects.
 * Returns count changed.
 */
export function bringObjectsToFront(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  const objs = objectsOf(doc);
  const idSet = new Set(ids);
  let maxUnselectedZ = -Infinity;
  let maxZVal = -Infinity;
  const entries: { id: string; m: AnyMap; z: number }[] = [];
  for (const [id, m] of objs) {
    if (!(m instanceof Y.Map)) continue;
    const z = asFiniteNumber(m.get('z'));
    if (idSet.has(id)) {
      entries.push({ id, m, z });
    } else {
      maxUnselectedZ = Math.max(maxUnselectedZ, z);
    }
    maxZVal = Math.max(maxZVal, z);
  }
  if (entries.length === 0) return 0;
  // Sort by existing z to preserve relative order
  entries.sort((a, b) => a.z - b.z);
  const baseZ = maxUnselectedZ === -Infinity ? maxZVal : maxUnselectedZ;
  let count = 0;
  doc.transact(() => {
    for (let i = 0; i < entries.length; i++) {
      const newZ = baseZ + 1 + i;
      if (entries[i].z !== newZ) {
        entries[i].m.set('z', newZ);
        count++;
      }
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Delete multiple objects. Returns count actually deleted.
 * Empty list → 0, no transaction. Missing ids are skipped.
 */
export function deleteObjects(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  const objs = objectsOf(doc);
  let count = 0;
  doc.transact(() => {
    for (const id of ids) {
      if (objs.get(id) instanceof Y.Map) {
        objs.delete(id);
        count++;
      }
    }
  }, LOCAL_ORIGIN);
  return count;
}
