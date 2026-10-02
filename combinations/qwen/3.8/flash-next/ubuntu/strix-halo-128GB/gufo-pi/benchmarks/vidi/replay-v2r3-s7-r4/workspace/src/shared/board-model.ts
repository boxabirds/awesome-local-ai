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
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from './config';
import type { Point, Rect } from './geometry';
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
  /** Persisted size; absent until the first resize (defaults to STICKY_SIZE_WORLD). */
  width?: number;
  height?: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher is drawn on top. */
  z: number;
  createdAt: number;
}

/**
 * A selectable board object. Only `sticky` exists today; stories 9–12 add
 * text, shapes, drawings and images with the same shape (id, type, x, y,
 * optional width/height, z) so the generic transform code keeps working.
 */
export type ObjectSnapshot = StickySnapshot;

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
  return {
    id,
    type: 'sticky',
    x,
    y,
    width: typeof width === 'number' && Number.isFinite(width) ? width : undefined,
    height: typeof height === 'number' && Number.isFinite(height) ? height : undefined,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : '',
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
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
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/** Raises a note above every other note. Returns false when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) === 1;
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
  return deleteObjects(doc, [id]) === 1;
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

// --- Story 7: generic group operations -------------------------------------

/** The selectable bounds of an object; stickies default to STICKY_SIZE_WORLD. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/** Ids whose bounds lie entirely inside `rect` (marquee containment rule). */
export function objectsInRect(
  snap: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const ids: string[] = [];
  for (const obj of snap) {
    if (rectContains(rect, objectBounds(obj))) ids.push(obj.id);
  }
  return ids;
}

/** Ids of every selectable object (unknown types are already excluded). */
export function allObjectIds(snap: readonly ObjectSnapshot[]): string[] {
  return snap.map((o) => o.id);
}

function isFinitePoint2(p: Point | undefined): p is Point {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Write absolute world top-left positions for a set of objects in one
 * transaction. Any non-finite position rejects the whole call; missing ids are
 * skipped and unchanged positions are not written. Returns the count changed.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!isFinitePoint2(p)) return 0;
  }
  const objects = getObjectsMap(doc);
  const writes: Array<[Y.Map<unknown>, number, number]> = [];
  for (const [id, p] of positions) {
    if (typeof id !== 'string' || id === '') continue;
    const m = objects.get(id);
    if (!m) continue;
    if (m.get('x') === p.x && m.get('y') === p.y) continue;
    writes.push([m, p.x, p.y]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [m, x, y] of writes) {
      m.set('x', x);
      m.set('y', y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

function isFiniteRect(r: Rect | undefined): r is Rect {
  return (
    !!r &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width > 0 &&
    r.height > 0
  );
}

/**
 * Write absolute rects (x, y and, for the first time, an explicit width/height
 * that turns implicit-size stickies explicit) for a set of objects. Any invalid
 * rect rejects the whole call; missing ids are skipped. Returns the count.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (!isFiniteRect(r)) return 0;
  }
  const objects = getObjectsMap(doc);
  const writes: Array<[Y.Map<unknown>, Rect]> = [];
  for (const [id, r] of rects) {
    if (typeof id !== 'string' || id === '') continue;
    const m = objects.get(id);
    if (!m) continue;
    if (m.get('x') === r.x && m.get('y') === r.y && m.get('width') === r.width && m.get('height') === r.height) {
      continue;
    }
    writes.push([m, r]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [m, r] of writes) {
      m.set('x', r.x);
      m.set('y', r.y);
      m.set('width', r.width);
      m.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

function zOf(m: Y.Map<unknown>): number {
  const z = m.get('z');
  return typeof z === 'number' ? z : 0;
}

/**
 * Raise the given objects above every unselected object while preserving their
 * relative stacking order (`z = maxUnselectedZ + rank`). Missing ids skipped.
 * Returns the count whose `z` actually changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjectsMap(doc);
  const selected = new Set(ids.filter((id) => typeof id === 'string' && objects.has(id)));
  if (selected.size === 0) return 0;

  let maxUnselected = 0;
  for (const [id, m] of objects.entries()) {
    if (selected.has(id)) continue;
    const z = zOf(m);
    if (z > maxUnselected) maxUnselected = z;
  }

  const ordered = [...selected]
    .map((id) => ({ id, m: objects.get(id)!, z: zOf(objects.get(id)!) }))
    .sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const writes: Array<[Y.Map<unknown>, number]> = [];
  ordered.forEach((entry, i) => {
    const target = maxUnselected + i + 1;
    if (entry.z !== target) writes.push([entry.m, target]);
  });
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [m, z] of writes) m.set('z', z);
  }, LOCAL_ORIGIN);
  return writes.length;
}

/** Remove every existing id in one transaction. Returns the count deleted. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjectsMap(doc);
  const present = ids.filter((id) => typeof id === 'string' && objects.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
