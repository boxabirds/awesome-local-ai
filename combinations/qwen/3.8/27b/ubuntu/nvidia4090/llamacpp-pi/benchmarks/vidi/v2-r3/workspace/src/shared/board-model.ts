/**
 * Board document model: the Yjs schema and all mutations.
 *
 * Framework-free so the Durable Object and the client both import the same code.
 * One `doc.transact(fn, LOCAL_ORIGIN)` per successful mutation.
 *
 * Schema:
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map>
 *     <id>: Y.Map { type, x, y, color, text: Y.Text, z, createdAt }
 */
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';
import { rectContains } from './geometry';
import type { Point, Rect } from './geometry';

export const LOCAL_ORIGIN: unique symbol = Symbol('LOCAL_ORIGIN');

/**
 * A board object of any registered type (story 7). `width`/`height` are
 * additive persisted fields: sticky notes created before story 7 have no
 * size fields and render at STICKY_SIZE_WORLD (read via objectBounds).
 * `color`/`text` are present only for stickies.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: StickyColor;
  text?: string;
  z: number;
  createdAt: number;
}

export type StickySnapshot = ObjectSnapshot & {
  type: 'sticky';
  color: StickyColor;
  text: string;
};

export const SCHEMA_VERSION = 1;

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }
}

function objects(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects');
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFinitePoint(at.x, at.y)) return '';
  const obj = objects(doc);
  const id = crypto.randomUUID();
  const item = new Y.Map<any>();
  item.set('type', 'sticky');
  item.set('x', at.x);
  item.set('y', at.y);
  item.set('color', color);
  item.set('text', new Y.Text());
  item.set('z', nextZ(obj));
  item.set('createdAt', Date.now());
  doc.transact(() => {
    obj.set(id, item);
  }, LOCAL_ORIGIN);
  return id;
}

function nextZ(obj: Y.Map<any>): number {
  let max = 0;
  obj.forEach((item) => {
    const z = (item.get('z') as number) ?? 0;
    if (z > max) max = z;
  });
  return max + 1;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinitePoint(x, y)) return false;
  const item = objects(doc).get(id);
  if (!item) return false;
  doc.transact(() => {
    item.set('x', x);
    item.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc);
  const item = obj.get(id);
  if (!item) return false;
  let max = 0;
  obj.forEach((i) => {
    const z = (i.get('z') as number) ?? 0;
    if (z > max) max = z;
  });
  const z = (item.get('z') as number) ?? 0;
  if (z >= max) return false; // already topmost: no pointless sync traffic
  doc.transact(() => {
    item.set('z', max + 1);
  }, LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!(color in STICKY_COLORS)) return false;
  const item = objects(doc).get(id);
  if (!item) return false;
  doc.transact(() => {
    item.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc);
  if (!obj.has(id)) return false;
  doc.transact(() => {
    obj.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const item = objects(doc).get(id);
  if (!item) return undefined;
  return item.get('text') as Y.Text | undefined;
}

/* ------------------------------------------------------------------ *
 * Story 7: generic group operations (sel.geometry_ops).
 *
 * Object type registry hook (sel.registry): the client registry
 * (src/client/objects/registry.tsx) calls registerKnownObjectType when a
 * type registers, so the shared code can tell registered (selectable)
 * objects from unknown ones without importing client modules.
 * ------------------------------------------------------------------ */

const knownTypes = new Set<string>(['sticky']);

export function registerKnownObjectType(type: string): void {
  knownTypes.add(type);
}

export function isKnownObjectType(type: string): boolean {
  return knownTypes.has(type);
}

/** Bounds of an object in world units. Stickies without explicit size
 * fields (created before story 7) fall back to STICKY_SIZE_WORLD; other
 * types without size fields have zero bounds. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const sticky = obj.type === 'sticky';
  const width = Number.isFinite(obj.width) ? (obj.width as number) : sticky ? STICKY_SIZE_WORLD : 0;
  const height = Number.isFinite(obj.height) ? (obj.height as number) : sticky ? STICKY_SIZE_WORLD : 0;
  return { x: obj.x, y: obj.y, width, height };
}

/** Ids of the registered-type objects lying entirely inside `rect` (marquee rule). */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const out: string[] = [];
  for (const obj of snapshot) {
    if (!knownTypes.has(obj.type)) continue;
    if (rectContains(rect, objectBounds(obj))) out.push(obj.id);
  }
  return out;
}

/** Ids of every registered-type object (select all; unknown types excluded). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  const out: string[] = [];
  for (const obj of snapshot) {
    if (knownTypes.has(obj.type)) out.push(obj.id);
  }
  return out;
}

/**
 * Write absolute positions for a group of objects in one LOCAL_ORIGIN
 * transaction. Any non-finite value or an empty list: 0, no transaction.
 * Missing ids are skipped. Returns the number of objects changed.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  }
  const objects = doc.getMap('objects');
  let changed = 0;
  doc.transact(
    () => {
      for (const [id, p] of positions) {
        const item = objects.get(id);
        if (!(item instanceof Y.Map)) continue;
        item.set('x', p.x);
        item.set('y', p.y);
        changed += 1;
      }
    },
    LOCAL_ORIGIN,
  );
  return changed;
}

/**
 * Write absolute rects (x, y, width, height) for a group of objects in one
 * LOCAL_ORIGIN transaction; the first resize turns implicit-size stickies
 * explicit. Any non-finite or non-positive result: 0, no transaction.
 * Missing ids are skipped. Returns the number of objects changed.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (
      !Number.isFinite(r.x) ||
      !Number.isFinite(r.y) ||
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.height) ||
      r.width <= 0 ||
      r.height <= 0
    ) {
      return 0;
    }
  }
  const objects = doc.getMap('objects');
  let changed = 0;
  doc.transact(
    () => {
      for (const [id, r] of rects) {
        const item = objects.get(id);
        if (!(item instanceof Y.Map)) continue;
        item.set('x', r.x);
        item.set('y', r.y);
        item.set('width', r.width);
        item.set('height', r.height);
        changed += 1;
      }
    },
    LOCAL_ORIGIN,
  );
  return changed;
}

/**
 * Raise `ids` above every unselected object while keeping their relative
 * stacking order (z = maxUnselectedZ + rank, in current (z, id) order).
 * No-op (0) when nothing changes. One LOCAL_ORIGIN transaction otherwise.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const wanted = new Set(ids);
  const group: Array<{ id: string; z: number }> = [];
  let maxUnselected = Number.NEGATIVE_INFINITY;
  const objects = doc.getMap('objects');
  const seen = new Set<string>();
  objects.forEach((item, id) => {
    if (!(item instanceof Y.Map) || seen.has(id)) return;
    const type = item.get('type');
    if (typeof type !== 'string' || !knownTypes.has(type)) return;
    seen.add(id);
    const z = typeof item.get('z') === 'number' ? (item.get('z') as number) : 0;
    if (wanted.has(id)) group.push({ id, z });
    else maxUnselected = Math.max(maxUnselected, z);
  });
  if (group.length === 0) return 0;
  // Already entirely on top: no write (no sync traffic for a no-op).
  if (group.every((g) => !Number.isFinite(maxUnselected) || g.z > maxUnselected)) return 0;
  group.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const base = Number.isFinite(maxUnselected) ? maxUnselected : 0;
  let changed = 0;
  doc.transact(
    () => {
      group.forEach((g, i) => {
        const item = objects.get(g.id);
        if (!(item instanceof Y.Map)) return;
        const next = base + 1 + i;
        if (item.get('z') !== next) {
          item.set('z', next);
          changed += 1;
        }
      });
    },
    LOCAL_ORIGIN,
  );
  return changed;
}

/** Delete every existing id in one LOCAL_ORIGIN transaction; returns the count. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = doc.getMap('objects');
  let changed = 0;
  doc.transact(
    () => {
      for (const id of new Set(ids)) {
        if (objects.has(id)) {
          objects.delete(id);
          changed += 1;
        }
      }
    },
    LOCAL_ORIGIN,
  );
  return changed;
}

/** All objects (of any known type) sorted by (z, id); unknown types skipped. */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  objects(doc).forEach((item, id) => {
    const type = item.get('type');
    if (typeof type !== 'string' || !knownTypes.has(type)) return;
    const o: ObjectSnapshot = {
      id,
      type,
      x: (item.get('x') as number) ?? 0,
      y: (item.get('y') as number) ?? 0,
      z: (item.get('z') as number) ?? 0,
      createdAt: (item.get('createdAt') as number) ?? 0,
    };
    if (typeof item.get('width') === 'number') o.width = item.get('width') as number;
    if (typeof item.get('height') === 'number') o.height = item.get('height') as number;
    if (type === 'sticky') {
      o.color = (item.get('color') as StickyColor) ?? DEFAULT_STICKY_COLOR;
      o.text = (item.get('text') as Y.Text)?.toString() ?? '';
    }
    out.push(o);
  });
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
