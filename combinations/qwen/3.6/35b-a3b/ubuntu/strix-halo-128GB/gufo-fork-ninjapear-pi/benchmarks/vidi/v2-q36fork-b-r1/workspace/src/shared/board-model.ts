import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  MAX_OBJECT_SIZE_WORLD,
} from './config';
import type { StickyColor } from './config';

export const LOCAL_ORIGIN = 'local-origin';

export { STICKY_SIZE_WORLD };

// ---- Snapshot types ----

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  width?: number;
  height?: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  [key: string]: unknown;
}

/** Generic object snapshot — the shape stored in Y.Doc. */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
  [key: string]: unknown;
}

// ---- Helpers ----

/** Initialise the document meta if absent. */
export function initDoc(doc: Y.Doc): void {
  if (!doc.getMap('meta').get('schemaVersion')) {
    doc.transact(() => {
      doc.getMap('meta').set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

function getObjectsMap(doc: Y.Doc): unknown {
  return doc.getMap('objects');
}

function getField(inner: any, key: string): any {
  try {
    return inner.get(key);
  } catch {
    return undefined;
  }
}

function setField(inner: any, key: string, val: any): void {
  inner.set(key, val);
}

function getMaxZ(objects: unknown): number {
  let max = 0;
  const objMap = objects as Y.Map<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (objMap as any).forEach((inner: any) => {
    if (typeof inner?.get === 'function') {
      const z = Number(getField(inner, 'z'));
      if (z > max) max = z;
    }
  });
  return max;
}

/** Get the bounding rect of an object. Falls back to STICKY_SIZE_WORLD if no width/height. */
export function objectBounds(obj: Record<string, unknown>): { x: number; y: number; width: number; height: number } {
  const w = (obj.width as number) ?? STICKY_SIZE_WORLD;
  const h = (obj.height as number) ?? STICKY_SIZE_WORLD;
  return {
    x: (obj.x as number) ?? 0,
    y: (obj.y as number) ?? 0,
    width: w,
    height: h,
  };
}

// ---- Create / single-object ops (retained for compatibility) ----

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color?: StickyColor,
): string {
  if (!isFinite(at.x) || !isFinite(at.y)) {
    return '';
  }
  const objects = getObjectsMap(doc);
  const maxZ = getMaxZ(objects);
  const id = crypto.randomUUID();
  const inner = new Y.Map() as Y.Map<unknown>;

  doc.transact(() => {
    setField(inner, 'type', 'sticky');
    setField(inner, 'x', at.x);
    setField(inner, 'y', at.y);
    setField(inner, 'color', color ?? DEFAULT_STICKY_COLOR);
    setField(inner, 'text', new Y.Text());
    setField(inner, 'z', maxZ + 1);
    setField(inner, 'createdAt', Date.now());
    (objects as any).set(id, inner);
  }, LOCAL_ORIGIN);

  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const result = bringObjectsToFront(doc, [id]);
  return result > 0;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!(color in STICKY_COLORS)) return false;
  const objects = getObjectsMap(doc) as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return false;

  doc.transact(() => {
    setField(inner, 'color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjectsMap(doc) as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return undefined;
  const textVal = getField(inner, 'text');
  if (textVal instanceof Y.Text) return textVal;
  return undefined;
}

// ---- Group operations ----

/** Filter objects whose entire bounding box lies inside `rect`. */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: { x: number; y: number; width: number; height: number }): string[] {
  const result: string[] = [];
  for (const obj of snapshot) {
    const b = objectBounds(obj);
    if (
      obj.id &&
      b.x >= rect.x &&
      b.y >= rect.y &&
      b.x + b.width <= rect.x + rect.width &&
      b.y + b.height <= rect.y + rect.height
    ) {
      result.push(obj.id);
    }
  }
  return result;
}

/** Return all object ids from the snapshot. Filters out unregistered types if `knownTypes` is provided. */
export function allObjectIds(snapshot: readonly ObjectSnapshot[], knownTypes?: ReadonlySet<string>): string[] {
  if (!knownTypes) {
    // No filtering — return all ids
    return snapshot.map(o => o.id).filter(Boolean) as string[];
  }
  return snapshot
    .filter(o => knownTypes.has(o.type))
    .map(o => o.id)
    .filter(Boolean) as string[];
}

/**
 * Move multiple objects atomically. Each entry maps id → {x, y}.
 * Returns count of successfully moved objects.
 * Non-finite coordinates are rejected (return 0). Empty map → 0. Missing ids skipped.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, { x: number; y: number }>): number {
  if (positions.size === 0) return 0;

  const objects = getObjectsMap(doc) as Y.Map<any>;
  let moved = 0;

  doc.transact(() => {
    for (const [id, pos] of positions) {
      if (!isFinite(pos.x) || !isFinite(pos.y)) continue;
      const inner = objects.get(id);
      if (!inner || typeof inner.get !== 'function') continue;
      setField(inner, 'x', pos.x);
      setField(inner, 'y', pos.y);
      moved++;
    }
  }, LOCAL_ORIGIN);

  return moved;
}

/**
 * Resize multiple objects atomically. Each entry maps id → {x, y, width, height}.
 * Returns count of successfully resized objects.
 * Writes width/height fields, turning implicit-size stickies explicit.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, { x: number; y: number; width: number; height: number }>): number {
  if (rects.size === 0) return 0;

  const objects = getObjectsMap(doc) as Y.Map<any>;
  let resized = 0;

  doc.transact(() => {
    for (const [id, r] of rects) {
      if (!isFinite(r.x) || !isFinite(r.y) || !isFinite(r.width) || !isFinite(r.height)) continue;
      if (r.width < 0 || r.height < 0) continue;
      const inner = objects.get(id);
      if (!inner || typeof inner.get !== 'function') continue;
      setField(inner, 'x', r.x);
      setField(inner, 'y', r.y);
      setField(inner, 'width', r.width);
      setField(inner, 'height', r.height);
      resized++;
    }
  }, LOCAL_ORIGIN);

  return resized;
}

/**
 * Bring selected objects to front. Sets their z to above all unselected objects
 * while preserving relative ordering among selected ones.
 * Returns count changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjectsMap(doc) as Y.Map<any>;
  const existingZ = new Map<string, number>();

  (objects as any).forEach((inner: any, key: string) => {
    if (typeof inner?.get === 'function') {
      existingZ.set(key, Number(getField(inner, 'z')) ?? 0);
    }
  });

  // Find the highest z among unselected objects
  let maxUnselectedZ = 0;
  for (const [id, z] of existingZ) {
    if (!ids.includes(id) && z > maxUnselectedZ) {
      maxUnselectedZ = z;
    }
  }

  // Sort selected ids to preserve their relative order
  const sortedIds = [...ids].sort((a, b) => (existingZ.get(a) ?? 0) - (existingZ.get(b) ?? 0));

  let changed = 0;
  doc.transact(() => {
    for (let i = 0; i < sortedIds.length; i++) {
      const id = sortedIds[i];
      const newZ = maxUnselectedZ + 1 + i;
      const inner = objects.get(id);
      if (!inner || typeof inner.get !== 'function') continue;
      const currentZ = getField(inner, 'z');
      if (currentZ !== newZ) {
        setField(inner, 'z', newZ);
        changed++;
      }
    }
  }, LOCAL_ORIGIN);

  return changed;
}

/** Delete multiple objects. Returns count deleted. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjectsMap(doc) as Y.Map<any>;
  let deleted = 0;

  doc.transact(() => {
    for (const id of ids) {
      if ((objects as any).has(id)) {
        objects.delete(id);
        deleted++;
      }
    }
  }, LOCAL_ORIGIN);

  return deleted;
}

// ---- Read helpers for rendering ----

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjectsMap(doc) as Y.Map<any>;
  const result: StickySnapshot[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (objects as any).forEach((raw: any, key: string) => {
    if (!raw || typeof raw.get !== 'function') return;
    const inner = raw;
    const type = getField(inner, 'type');
    if (type !== 'sticky') return;

    result.push({
      id: key,
      type: 'sticky' as const,
      x: Number(getField(inner, 'x')) ?? 0,
      y: Number(getField(inner, 'y')) ?? 0,
      color: (getField(inner, 'color') as StickyColor) ?? DEFAULT_STICKY_COLOR,
      text: (() => {
        const t = getField(inner, 'text');
        if (t instanceof Y.Text) return t.toString();
        return String(t ?? '');
      })(),
      z: Number(getField(inner, 'z')) ?? 0,
      createdAt: Number(getField(inner, 'createdAt')) ?? 0,
    });
  });

  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return Object.freeze(result);
}
