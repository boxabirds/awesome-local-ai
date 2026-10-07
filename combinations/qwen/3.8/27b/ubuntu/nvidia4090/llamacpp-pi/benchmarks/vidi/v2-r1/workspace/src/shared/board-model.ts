// Board document model (story 2, board.model contract).
//
// All board content lives in a Y.Doc from day one so that story 3 only
// attaches a network provider and story 4 only persists the same document.
// This module is framework-free: the Durable Object (story 4) imports it for
// validation/migration.
//
// Document schema (the future persisted and wire contract):
//   Y.Doc
//     meta: Y.Map { schemaVersion: 1 }
//     objects: Y.Map<string /* id */, Y.Map>
//       <id>: Y.Map {
//         type: 'sticky'
//         x: number, y: number     // top-left, world units
//         color: StickyColor
//         text: Y.Text
//         z: number                // stacking; higher is on top
//         createdAt: number        // epoch ms
//       }

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';
import { rectContains, type Point, type Rect } from './geometry';

/** Transaction origin for all local mutations (used by story 8 undo and
 *  by story 3 to avoid echo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.localOrigin');

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

/**
 * Generic snapshot of one board object of a known type (story 7).
 *
 * `width`/`height` are persisted fields written by the first group resize;
 * objects created before story 7 (or by other tools) omit them, and readers
 * fall back to the type's default size (STICKY_SIZE_WORLD for stickies — see
 * `objectBounds`).
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  /** Top-left, world units. */
  x: number;
  y: number;
  /** Stacking; higher is on top. */
  z: number;
  width?: number;
  height?: number;
  color?: string;
  text: string;
  createdAt?: number;
}

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const SCHEMA_VERSION = 1;
const STICKY_TYPE = 'sticky';

/**
 * Object types this client can render and operate on (story 7 registry).
 * Seeded with the story 2 type; the client-side registry adds more at import
 * time. Unknown types stay in the document but are invisible to selection,
 * rendering and group operations (forward compatibility for stories 9–12).
 */
const knownObjectTypes: Set<string> = new Set([STICKY_TYPE]);

/** Register an object type as known (called by the client registry). */
export function registerKnownObjectType(type: string): void {
  knownObjectTypes.add(type);
}

export function isKnownObjectType(type: string): boolean {
  return knownObjectTypes.has(type);
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY);
}

function isStickyColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && color in STICKY_COLORS;
}

function isValidCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Set `meta.schemaVersion` if absent. Idempotent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (top-left = at − STICKY_SIZE_WORLD/2),
 * on top of all other notes (z = maxZ + 1). Returns the new id, or `null` for
 * non-finite coordinates (no transaction in that case).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | null {
  if (!isValidCoord(at.x) || !isValidCoord(at.y)) return null;

  const map = objects(doc);
  let maxZ = 0;
  map.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const id = randomId();
  const text = new Y.Text();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', STICKY_TYPE);
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', text);
    obj.set('z', maxZ + 1);
    obj.set('createdAt', Date.now());
    map.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move an object's top-left to world (x, y). False for stale ids or
 *  non-finite coordinates (no transaction). Thin wrapper over `moveObjects`. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/**
 * Raise `id` above every other object. False when the note is already
 * topmost (or the id is stale) — a pointless update (no transaction).
 * Thin wrapper over `bringObjectsToFront`.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Change a note's colour. Unknown colours and stale ids return false with
 *  no transaction. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = objects(doc).get(id);
  if (!obj) return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. False for stale ids (no transaction).
 *  Thin wrapper over `deleteObjects`. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** The Y.Text of a sticky note, if it exists. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so that every
 * client renders the same stacking order (equal-z ties, possible once
 * story 3 syncs, break by id). Unknown object types are skipped (forward
 * compatibility for later stories).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    if (obj.get('type') !== STICKY_TYPE) return;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    const color = obj.get('color');
    const createdAt = obj.get('createdAt');
    if (!isValidCoord(x) || !isValidCoord(y)) return;
    if (!isStickyColor(color)) return;
    if (typeof z !== 'number' || typeof createdAt !== 'number') return;
    const text = obj.get('text');
    out.push(
      Object.freeze({
        id,
        type: 'sticky' as const,
        x,
        y,
        color,
        text: text instanceof Y.Text ? text.toString() : '',
        z,
        createdAt,
      }),
    );
  });
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(out);
}

/**
 * Immutable snapshot of every object of a *known* type, sorted by (z, id)
 * (story 7). Unknown types are skipped, so remote objects from later stories
 * can never break selection, rendering or group operations. Well-formedness:
 * finite x/y/z; width/height/color/createdAt are read only when present and
 * finite, so pre-story-7 stickies keep working without them.
 */
export function objectsSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    const type = obj.get('type');
    if (typeof type !== 'string' || !knownObjectTypes.has(type)) return;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    if (!isValidCoord(x) || !isValidCoord(y) || !isValidCoord(z)) return;
    const width = obj.get('width');
    const height = obj.get('height');
    const color = obj.get('color');
    const createdAt = obj.get('createdAt');
    const snap: ObjectSnapshot = {
      id,
      type,
      x,
      y,
      z,
      text: obj.get('text') instanceof Y.Text ? (obj.get('text') as Y.Text).toString() : '',
    };
    if (isValidCoord(width)) snap.width = width;
    if (isValidCoord(height)) snap.height = height;
    if (typeof color === 'string') snap.color = color;
    if (typeof createdAt === 'number') snap.createdAt = createdAt;
    out.push(Object.freeze(snap));
  });
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(out);
}

/**
 * Bounds of one object in world units. Objects without persisted width and
 * height use the default sticky size (story 7: "width/height read with a
 * STICKY_SIZE_WORLD fallback").
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/** Ids of every object in the snapshot (all known, well-formed objects). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

/**
 * Ids of the objects whose bounds lie *fully* inside `rect` (the marquee's
 * containment rule): an object only partly inside, or merely touching the
 * rectangle from outside, is not selected.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snapshot
    .filter((obj) => rectContains(rect, objectBounds(obj)))
    .map((obj) => obj.id);
}

/**
 * Move many objects' top-left corners in one LOCAL_ORIGIN transaction.
 * Missing ids are skipped; any non-finite coordinate refuses the whole call
 * (0 applied, no transaction). Returns the number of objects changed.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!isValidCoord(p.x) || !isValidCoord(p.y)) return 0;
  }
  const map = objects(doc);
  let changed = 0;
  doc.transact(() => {
    positions.forEach((p, id) => {
      const obj = map.get(id);
      if (!obj) return; // missing (deleted remotely) → skipped
      if (obj.get('x') === p.x && obj.get('y') === p.y) return;
      obj.set('x', p.x);
      obj.set('y', p.y);
      changed += 1;
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Resize and reposition many objects in one LOCAL_ORIGIN transaction, writing
 * explicit `width`/`height` (the first resize materialises both fields).
 * Missing ids are skipped; any non-finite value refuses the whole call
 * (0 applied, no transaction). Returns the number of objects changed.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (
      !isValidCoord(r.x) ||
      !isValidCoord(r.y) ||
      !isValidCoord(r.width) ||
      !isValidCoord(r.height)
    ) {
      return 0;
    }
  }
  const map = objects(doc);
  let changed = 0;
  doc.transact(() => {
    rects.forEach((r, id) => {
      const obj = map.get(id);
      if (!obj) return; // missing (deleted remotely) → skipped
      if (
        obj.get('x') === r.x &&
        obj.get('y') === r.y &&
        obj.get('width') === r.width &&
        obj.get('height') === r.height
      ) {
        return;
      }
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
      changed += 1;
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Raise every id in `ids` above all unselected objects in one transaction,
 * preserving the selected objects' relative stacking order (they are ranked
 * by their current (z, id) order and re-assigned z = maxUnselectedZ + rank,
 * but never lowered). Returns the number of objects whose z changed (0 when
 * the selection is already topmost).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const map = objects(doc);
  const selected: { id: string; z: number }[] = [];
  let maxUnselectedZ = 0;
  map.forEach((obj, id) => {
    const rawZ = obj.get('z');
    const z = typeof rawZ === 'number' && Number.isFinite(rawZ) ? rawZ : 0;
    if (ids.includes(id)) {
      selected.push({ id, z });
    } else if (z > maxUnselectedZ) {
      maxUnselectedZ = z;
    }
  });
  if (selected.length === 0) return 0;
  selected.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const targets = new Map<string, number>();
  let changed = 0;
  selected.forEach((s, i) => {
    const target = maxUnselectedZ + i + 1;
    if (target > s.z) {
      targets.set(s.id, target);
      changed += 1;
    }
  });
  if (changed === 0) return 0;
  doc.transact(() => {
    targets.forEach((z, id) => {
      const obj = map.get(id);
      if (obj) obj.set('z', z);
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Delete every existing id in `ids` in one LOCAL_ORIGIN transaction.
 * Missing ids are skipped. Returns the number of objects deleted.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const map = objects(doc);
  const existing = ids.filter((id) => map.has(id));
  if (existing.length === 0) return 0;
  doc.transact(() => {
    for (const id of existing) map.delete(id);
  }, LOCAL_ORIGIN);
  return existing.length;
}

function randomId(): string {
  // Ids are crypto.randomUUID(); the fallback keeps non-secure contexts working.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
