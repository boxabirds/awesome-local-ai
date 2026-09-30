import * as Y from 'yjs';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DEFAULT_STICKY_COLOR, type StickyColor } from './config';
import { isKnownType } from './known-types';
import { rectContains, type Rect, type Point } from './geometry';

export const LOCAL_ORIGIN: unique symbol = Symbol('LOCAL_ORIGIN');

/** Generic snapshot of a board object (story 7). Width/height are explicit
 * fields; stickies created before story 7 fall back to STICKY_SIZE_WORLD. */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
}

/** Cast a generic snapshot to its sticky flavour (story 7 generic model). */
export function asSticky(snap: ObjectSnapshot): StickySnapshot {
  return snap as StickySnapshot;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  return maxZ;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Bounds of an object in world units. Stickies without explicit width/height
 * (created before story 7) use STICKY_SIZE_WORLD (PRD compatibility).
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: positiveNumber(obj.width, STICKY_SIZE_WORLD),
    height: positiveNumber(obj.height, STICKY_SIZE_WORLD),
  };
}

/**
 * Ids of the objects lying ENTIRELY inside `rect` (marquee rule, PRD
 * sel.marquee): an object only partly inside, or touching the edge, is not
 * selected.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snapshot
    .filter((obj) => rectContains(rect, objectBounds(obj)))
    .map((obj) => obj.id);
}

/**
 * Ids of all selectable objects: objects of unregistered types are excluded
 * (PRD sel.all).
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot
    .filter((obj) => isKnownType(obj.type))
    .map((obj) => obj.id);
}

function finitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function finiteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) && Number.isFinite(r.y) &&
    Number.isFinite(r.width) && Number.isFinite(r.height) &&
    r.width > 0 && r.height > 0
  );
}

/**
 * Move objects to absolute world positions. One LOCAL_ORIGIN transaction;
 * returns the number of objects changed. Non-finite values → 0 and no
 * transaction; missing ids are skipped; empty list → 0 and no transaction.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  const objects = getObjects(doc);
  const toApply: Array<[Y.Map<unknown>, number, number]> = [];
  for (const [id, p] of positions) {
    if (!finitePoint(p)) return 0;
    const obj = objects.get(id);
    if (!obj) continue;
    toApply.push([obj, p.x, p.y]);
  }
  if (toApply.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, x, y] of toApply) {
      obj.set('x', x);
      obj.set('y', y);
    }
  }, LOCAL_ORIGIN);
  return toApply.length;
}

/**
 * Resize objects to absolute world rects. Writes explicit width/height,
 * turning implicit-size stickies explicit on first resize. One LOCAL_ORIGIN
 * transaction; returns the number of objects changed. Non-finite rects → 0
 * and no transaction; missing ids are skipped; empty list → 0, no
 * transaction.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  const objects = getObjects(doc);
  const toApply: Array<[Y.Map<unknown>, Rect]> = [];
  for (const [id, r] of rects) {
    if (!finiteRect(r)) return 0;
    const obj = objects.get(id);
    if (!obj) continue;
    toApply.push([obj, r]);
  }
  if (toApply.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, r] of toApply) {
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return toApply.length;
}

/**
 * Raise all `ids` above every unselected object, preserving their relative
 * stacking order (reassign z = maxUnselectedZ + rank). One LOCAL_ORIGIN
 * transaction; returns the number of objects changed. Missing ids are
 * skipped; empty list → 0, no transaction.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjects(doc);
  const selected = new Set(ids);
  const sel: Array<{ id: string; obj: Y.Map<unknown>; z: number }> = [];
  for (const id of ids) {
    const obj = objects.get(id);
    if (!obj) continue;
    const z = obj.get('z');
    if (typeof z !== 'number' || !Number.isFinite(z)) continue;
    sel.push({ id, obj, z });
  }
  if (sel.length === 0) return 0;
  let maxUnselectedZ = 0;
  objects.forEach((obj, id) => {
    if (selected.has(id)) return;
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxUnselectedZ) maxUnselectedZ = z;
  });
  // Everything already above every unselected object: stacking unchanged,
  // no transaction (PRD perf: one transaction per gesture).
  if (sel.every((s) => s.z > maxUnselectedZ)) return 0;
  sel.sort((a, b) => (a.z - b.z) || a.id.localeCompare(b.id));
  doc.transact(() => {
    sel.forEach((entry, rank) => {
      entry.obj.set('z', maxUnselectedZ + rank + 1);
    });
  }, LOCAL_ORIGIN);
  return sel.length;
}

/**
 * Delete objects by id. One LOCAL_ORIGIN transaction; returns the number of
 * objects removed. Missing ids are skipped; empty list → 0, no transaction.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjects(doc);
  const toDelete = ids.filter((id) => objects.has(id));
  if (toDelete.length === 0) return 0;
  doc.transact(() => {
    for (const id of toDelete) objects.delete(id);
  }, LOCAL_ORIGIN);
  return toDelete.length;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
  // Ensure objects map exists
  doc.getMap('objects');
}

export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
    return '';
  }
  const id = crypto.randomUUID();
  const objects = getObjects(doc);
  const z = getMaxZ(doc) + 1;
  const text = new Y.Text();
  const obj = new Y.Map();
  obj.set('type', 'sticky');
  obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
  obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
  obj.set('color', color);
  obj.set('text', text);
  obj.set('z', z);
  obj.set('createdAt', Date.now());
  doc.transact(() => {
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

// Story 2 single-object operations are thin wrappers over the group
// versions (story 7).

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;
  const currentZ = obj.get('z') as number;
  const maxZ = getMaxZ(doc);
  if (currentZ === maxZ) return false;
  return bringObjectsToFront(doc, [id]) === 1;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!(color in STICKY_COLORS)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  const text = obj.get('text');
  if (text instanceof Y.Text) return text;
  return undefined;
}

export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects = getObjects(doc);
  const result: ObjectSnapshot[] = [];
  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (!isKnownType(type)) return; // skip unknown types
    const x = obj.get('x') as number;
    const y = obj.get('y') as number;
    const z = obj.get('z') as number;
    const createdAt = obj.get('createdAt') as number;
    const base: ObjectSnapshot = {
      id,
      type,
      x,
      y,
      width: positiveNumber(obj.get('width'), STICKY_SIZE_WORLD),
      height: positiveNumber(obj.get('height'), STICKY_SIZE_WORLD),
      z,
      createdAt,
    };
    if (type === 'sticky') {
      const color = obj.get('color') as StickyColor;
      const textObj = obj.get('text');
      const text = textObj instanceof Y.Text ? textObj.toString() : '';
      result.push({ ...base, color, text } as StickySnapshot);
    } else {
      result.push(base);
    }
  });
  // Sort by (z, id) for stable ordering
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id.localeCompare(b.id);
  });
  return result;
}
