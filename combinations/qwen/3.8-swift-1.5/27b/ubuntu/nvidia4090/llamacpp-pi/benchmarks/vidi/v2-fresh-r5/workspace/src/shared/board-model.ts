import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';
import type { Rect, Point } from './geometry';
import { rectContains } from './geometry';
import { detachConnectorsTo } from './objects/connector';
import { resolveEndpoints, connectorBBox } from './geometry/connector-geometry';
import type { Endpoint } from './geometry/connector-geometry';

/** Origin symbol for local (this client) transactions. */
export const LOCAL_ORIGIN: unique symbol = Symbol('LOCAL_ORIGIN');

/** Immutable snapshot of a board object for rendering. */
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
  // Shape-specific
  kind?: string;
  fill?: string;
  stroke?: string;
  // Connector-specific
  from?: Endpoint;
  to?: Endpoint;
}

/** @deprecated Use ObjectSnapshot instead. */
export type StickySnapshot = ObjectSnapshot;

/**
 * Initialize the Y.Doc schema. Sets `meta.schemaVersion` to 1 if absent,
 * and ensures the `objects` map exists.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
  // Ensure the objects map exists (accessing it creates it if absent).
  doc.getMap('objects');
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function isValidColor(color: string): color is StickyColor {
  return color in STICKY_COLORS;
}

function isFiniteCoord(n: number): boolean {
  return Number.isFinite(n);
}

/**
 * Create a new sticky note centred at the given world point.
 * Returns the new note's id, or empty string if coordinates are invalid.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFiniteCoord(at.x) || !isFiniteCoord(at.y)) return '';
  if (!isValidColor(color)) return '';

  const id = crypto.randomUUID();
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;
  const objects = getObjects(doc);

  // Compute maxZ
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const noteMap = new Y.Map<unknown>();
  const text = new Y.Text();
  noteMap.set('type', 'sticky');
  noteMap.set('x', x);
  noteMap.set('y', y);
  noteMap.set('color', color);
  noteMap.set('text', text);
  noteMap.set('z', maxZ + 1);
  noteMap.set('createdAt', Date.now());

  doc.transact(() => {
    objects.set(id, noteMap);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move an object to new world coordinates. Returns true if the change was applied.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteCoord(x) || !isFiniteCoord(y)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Bring an object to the front (highest z). Returns true if a change was made.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  const currentZ = obj.get('z') as number;
  let maxZ = 0;
  objects.forEach((o) => {
    const z = o.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  if (currentZ === maxZ) return false; // already topmost

  doc.transact(() => {
    obj.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a sticky note's colour. Returns true if the change was applied.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isValidColor(color)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Delete an object from the document. Returns true if it was removed.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  if (!objects.has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Get the Y.Text for a sticky note, or undefined if the id is unknown.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  return obj.get('text') as Y.Text | undefined;
}

/**
 * Return an immutable array of all objects, sorted by (z, id).
 * Unknown object types are skipped.
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects = getObjects(doc);
  const result: ObjectSnapshot[] = [];

  objects.forEach((obj, id) => {
    const type = obj.get('type');
    if (type !== 'sticky' && type !== 'text' && type !== 'shape' && type !== 'connector') return; // skip unknown types

    const text = obj.get('text') as Y.Text | undefined;
    const width = obj.get('width') as number | undefined;
    const height = obj.get('height') as number | undefined;
    const entry: ObjectSnapshot = {
      id,
      type: type as string,
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      text: text ? text.toString() : '',
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    };
    if (type === 'sticky') {
      entry.color = obj.get('color') as StickyColor;
    }
    if (type === 'shape') {
      entry.kind = obj.get('kind') as string;
      entry.fill = obj.get('fill') as string;
      entry.stroke = obj.get('stroke') as string;
    }
    if (type === 'connector') {
      entry.from = obj.get('from') as Endpoint;
      entry.to = obj.get('to') as Endpoint;
      // Derive bbox from resolved endpoints
      const rects = new Map<string, Rect>();
      objects.forEach((o, oid) => {
        if (oid === id) return;
        const ot = o.get('type');
        if (ot === 'sticky' || ot === 'text' || ot === 'shape') {
          rects.set(oid, {
            x: o.get('x') as number,
            y: o.get('y') as number,
            width: (o.get('width') as number) ?? STICKY_SIZE_WORLD,
            height: (o.get('height') as number) ?? STICKY_SIZE_WORLD,
          });
        }
      });
      const connSnap = {
        id, type: 'connector' as const, x: 0, y: 0, width: 0, height: 0,
        z: entry.z, createdAt: entry.createdAt,
        from: entry.from!, to: entry.to!,
      };
      const { from: fp, to: tp } = resolveEndpoints(connSnap, rects);
      const bbox = connectorBBox(fp, tp);
      entry.x = bbox.x;
      entry.y = bbox.y;
      entry.width = bbox.width;
      entry.height = bbox.height;
    } else {
      if (width !== undefined) entry.width = width;
      if (height !== undefined) entry.height = height;
    }
    result.push(entry);
  });

  // Sort by (z, id) for stable render order
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return result;
}

// ─── Story 7: Geometry and group operations ───────────────────────────────────

/**
 * Get the bounds (world rect) of an object, using STICKY_SIZE_WORLD as
 * fallback for width/height when not explicitly set.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const w = obj.width ?? STICKY_SIZE_WORLD;
  const h = obj.height ?? STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width: w, height: h };
}

/**
 * Return the ids of all objects whose bounds are fully contained within `rect`.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snapshot
    .filter((obj) => rectContains(rect, objectBounds(obj)))
    .map((obj) => obj.id);
}

/**
 * Return the ids of all objects with a registered type.
 * (Currently only 'sticky' is registered; unknown types are excluded.)
 */
export function allObjectIds(doc: Y.Doc): string[] {
  const objects = getObjects(doc);
  const ids: string[] = [];
  objects.forEach((_obj, id) => {
    // Only include objects with a known type
    const type = (_obj as Y.Map<unknown>).get('type');
    if (type === 'sticky' || type === 'text' || type === 'shape' || type === 'connector') ids.push(id);
  });
  return ids;
}

/**
 * Move multiple objects to absolute positions. Returns the count of objects
 * actually changed. Non-finite values or missing ids are skipped.
 * One LOCAL_ORIGIN transaction per call.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;

  // Validate all positions are finite
  for (const [, p] of positions) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  }

  const objects = getObjects(doc);
  let changed = 0;

  doc.transact(() => {
    for (const [id, p] of positions) {
      const obj = objects.get(id);
      if (!obj) continue; // skip missing ids
      obj.set('x', p.x);
      obj.set('y', p.y);
      changed++;
    }
  }, LOCAL_ORIGIN);

  return changed;
}

/**
 * Resize multiple objects to absolute rects. Writes width and height fields.
 * Returns the count of objects actually changed.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;

  // Validate all rects have finite values
  for (const [, r] of rects) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) ||
        !Number.isFinite(r.width) || !Number.isFinite(r.height)) return 0;
  }

  const objects = getObjects(doc);
  let changed = 0;

  doc.transact(() => {
    for (const [id, r] of rects) {
      const obj = objects.get(id);
      if (!obj) continue; // skip missing ids
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
      changed++;
    }
  }, LOCAL_ORIGIN);

  return changed;
}

/**
 * Bring the given objects to the front, above all unselected objects,
 * while preserving their relative z-order. Returns the count changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjects(doc);
  const idSet = new Set(ids);

  // Find max z among unselected objects
  let maxUnselectedZ = 0;
  objects.forEach((obj, id) => {
    if (idSet.has(id)) return;
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxUnselectedZ) maxUnselectedZ = z;
  });

  // Get current z of selected objects, sorted
  const selectedEntries: { id: string; z: number }[] = [];
  for (const id of ids) {
    const obj = objects.get(id);
    if (!obj) continue;
    selectedEntries.push({ id, z: (obj.get('z') as number) || 0 });
  }
  selectedEntries.sort((a, b) => a.z - b.z);

  let changed = 0;
  doc.transact(() => {
    selectedEntries.forEach((entry, i) => {
      const newZ = maxUnselectedZ + 1 + i;
      const obj = objects.get(entry.id);
      if (obj && (obj.get('z') as number) !== newZ) {
        obj.set('z', newZ);
        changed++;
      }
    });
  }, LOCAL_ORIGIN);

  return changed;
}

/**
 * Delete multiple objects from the document. Returns the count removed.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjects(doc);
  let changed = 0;

  doc.transact(() => {
    // Detach connectors before removing objects
    detachConnectorsTo(doc, ids as string[]);
    for (const id of ids) {
      if (objects.has(id)) {
        objects.delete(id);
        changed++;
      }
    }
  }, LOCAL_ORIGIN);

  return changed;
}
