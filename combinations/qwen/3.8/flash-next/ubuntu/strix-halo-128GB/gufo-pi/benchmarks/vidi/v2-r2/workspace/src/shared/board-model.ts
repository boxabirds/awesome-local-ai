import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from '@shared/config';
import { type Rect, rectContains } from '@shared/geometry';
import { resolveEndpoints as _resolveConnEPs, connectorBBox as _connBBox } from '@shared/geometry/connector-geometry';
import { DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, type ShapeKind, type FillColor, type StrokeColor } from '@shared/config';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  width?: number;
  height?: number;
}

export interface TextObjectSnapshot {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  text: string;
  size: string;
  widthMode: 'auto' | 'fixed';
}

import type { ShapeSnap } from '@shared/objects/shape';
import type { ConnectorSnap } from '@shared/objects/connector';
import type { StrokeSnap } from '@shared/objects/stroke';

export type ObjectSnapshot = StickySnapshot | TextObjectSnapshot | ShapeSnap | ConnectorSnap | StrokeSnap;

// Callback registered by connector.ts to handle detach-on-delete.
let _detachFn: ((doc: Y.Doc, deletedIds: string[]) => void) | null = null;
export function _registerDetachConnectors(fn: (doc: Y.Doc, deletedIds: string[]) => void): void {
  _detachFn = fn;
}

const VALID_COLORS = new Set<string>(Object.keys(STICKY_COLORS));

// Set of types considered "registered" (for allObjectIds). Populated externally
// via the registry; board-model itself just filters by known types.
const registeredTypes = new Set<string>(['sticky']);

/** Called by the registry to inform board-model about a new type. */
export function _registerTypeForModel(type: string): void {
  registeredTypes.add(type);
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') == null) {
    meta.set('schemaVersion', 1);
  }
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color?: StickyColor,
): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const id = crypto.randomUUID();
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (z > maxZ) maxZ = z;
  });
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color ?? DEFAULT_STICKY_COLOR);
    note.set('text', new Y.Text());
    note.set('z', maxZ + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

// --- Object bounds ---

/**
 * Returns the bounding rect of an object snapshot.
 * For stickies without width/height, uses STICKY_SIZE_WORLD.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const w = obj.width ?? STICKY_SIZE_WORLD;
  const h = obj.height ?? STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width: w, height: h };
}

// Note: for text objects, width and height are always present (number, not undefined).

// --- Marquee / select all helpers ---

/**
 * Returns ids of objects that are fully inside the given rect.
 */
export function objectsInRect(
  snapshotArr: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const ids: string[] = [];
  for (const obj of snapshotArr) {
    const bounds = objectBounds(obj);
    if (rectContains(rect, bounds)) {
      ids.push(obj.id);
    }
  }
  return ids;
}

/**
 * Returns all object ids that have a registered type.
 */
export function allObjectIds(snapshotArr: readonly ObjectSnapshot[]): string[] {
  const ids: string[] = [];
  for (const obj of snapshotArr) {
    if (registeredTypes.has(obj.type)) {
      ids.push(obj.id);
    }
  }
  return ids;
}

// --- Group operations ---

/**
 * Move multiple objects to absolute positions. Returns count of objects actually moved.
 * Skips missing ids and rejects non-finite coordinates with 0 and no transaction.
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): number {
  if (positions.size === 0) return 0;
  const objects = doc.getMap<Y.Map<unknown>>('objects');

  // Validate all positions are finite before starting transaction
  for (const pos of positions.values()) {
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return 0;
  }

  // Check which ids exist
  const validEntries: Array<[string, Y.Map<unknown>, { x: number; y: number }]> = [];
  for (const [id, pos] of positions) {
    const obj = objects.get(id);
    if (obj) validEntries.push([id, obj, pos]);
  }
  if (validEntries.length === 0) return 0;

  doc.transact(() => {
    for (const [, obj, pos] of validEntries) {
      obj.set('x', pos.x);
      obj.set('y', pos.y);
    }
  }, LOCAL_ORIGIN);
  return validEntries.length;
}

/**
 * Resize multiple objects. Writes width and height. Returns count changed.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;
  const objects = doc.getMap<Y.Map<unknown>>('objects');

  // Validate all rects are finite
  for (const r of rects.values()) {
    if (
      !Number.isFinite(r.x) ||
      !Number.isFinite(r.y) ||
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.height)
    ) {
      return 0;
    }
  }

  // Check which ids exist
  const validEntries: Array<[Y.Map<unknown>, Rect]> = [];
  for (const [id, rect] of rects) {
    const obj = objects.get(id);
    if (obj) validEntries.push([obj, rect]);
  }
  if (validEntries.length === 0) return 0;

  doc.transact(() => {
    for (const [obj, rect] of validEntries) {
      obj.set('x', rect.x);
      obj.set('y', rect.y);
      obj.set('width', rect.width);
      obj.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return validEntries.length;
}

/**
 * Bring the specified objects to front. Selection goes above all unselected objects
 * while preserving relative z-order among selected objects.
 */
export function bringObjectsToFront(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  const objects = doc.getMap<Y.Map<unknown>>('objects');

  // Find max z of unselected objects
  const idSet = new Set(ids);
  let maxUnselectedZ = 0;

  // Collect all entries
  interface ObjEntry {
    id: string;
    yMap: Y.Map<unknown>;
    z: number;
  }
  const entries: ObjEntry[] = [];
  objects.forEach((obj, id) => {
    entries.push({ id, yMap: obj, z: (obj.get('z') as number) ?? 0 });
  });

  const unselected = entries.filter((e) => !idSet.has(e.id));
  const selected = entries.filter((e) => idSet.has(e.id));

  if (selected.length === 0) return 0;

  for (const u of unselected) {
    if (u.z > maxUnselectedZ) maxUnselectedZ = u.z;
  }

  // Check if already in front (all selected z > maxUnselectedZ and relative order preserved)
  selected.sort((a, b) => a.z - b.z);
  let needsChange = false;
  for (let i = 0; i < selected.length; i++) {
    if (selected[i].z <= maxUnselectedZ) {
      needsChange = true;
      break;
    }
  }
  if (!needsChange) return 0;

  doc.transact(() => {
    for (let i = 0; i < selected.length; i++) {
      selected[i].yMap.set('z', maxUnselectedZ + i + 1);
    }
  }, LOCAL_ORIGIN);
  return selected.length;
}

/**
 * Delete multiple objects. Returns count deleted.
 */
export function deleteObjects(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  const objects = doc.getMap<Y.Map<unknown>>('objects');

  const existing = ids.filter((id) => objects.has(id));
  if (existing.length === 0) return 0;

  doc.transact(() => {
    // Detach connectors attached to deleted objects (before removing them)
    if (_detachFn) _detachFn(doc, existing);
    for (const id of existing) {
      objects.delete(id);
    }
  }, LOCAL_ORIGIN);
  return existing.length;
}

// --- Single-object wrappers (story 2 compatibility) ---

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const note = objects.get(id);
  if (!note) return false;
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (z > maxZ) maxZ = z;
  });
  const currentZ = note.get('z') as number;
  if (currentZ >= maxZ) return false;
  doc.transact(() => {
    note.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!VALID_COLORS.has(color)) return false;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const note = objects.get(id);
  if (!note) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const note = objects.get(id);
  if (!note) return undefined;
  return note.get('text') as Y.Text | undefined;
}

export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const result: ObjectSnapshot[] = [];

  // First pass: collect rects for connector resolution
  const rectsMap = new Map<string, Rect>();
  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (type === 'connector') return;
    const w = (obj.get('width') as number) ?? 200;
    const h = (obj.get('height') as number) ?? 200;
    rectsMap.set(id, {
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      width: w,
      height: h,
    });
  });

  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (type === 'sticky') {
      const entry: StickySnapshot = {
        id,
        type: 'sticky',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        color: obj.get('color') as StickyColor,
        text: (obj.get('text') as Y.Text).toString(),
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
      };
      const w = obj.get('width');
      const h = obj.get('height');
      if (w != null) entry.width = w as number;
      if (h != null) entry.height = h as number;
      result.push(entry);
    } else if (type === 'text') {
      const entry: TextObjectSnapshot = {
        id,
        type: 'text',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: obj.get('width') as number,
        height: obj.get('height') as number,
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
        text: (obj.get('text') as Y.Text).toString(),
        size: (obj.get('size') as string) ?? 'M',
        widthMode: (obj.get('widthMode') as 'auto' | 'fixed') ?? 'auto',
      };
      result.push(entry);
    } else if (type === 'shape') {
      const labelYText = obj.get('label');
      // Skip incomplete shape objects (e.g. test fixtures that lack required fields)
      if (!(labelYText instanceof Y.Text)) {
        return;
      }
      const entry: ShapeSnap = {
        id,
        type: 'shape',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: obj.get('width') as number,
        height: obj.get('height') as number,
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
        createdBy: (obj.get('createdBy') as string) ?? '',
        kind: obj.get('kind') as ShapeKind,
        fill: (obj.get('fill') as FillColor) ?? DEFAULT_SHAPE_FILL,
        stroke: (obj.get('stroke') as StrokeColor) ?? DEFAULT_SHAPE_STROKE,
        label: labelYText.toString(),
      };
      result.push(entry);
    } else if (type === 'connector') {
      const fromMap = obj.get('from') as Y.Map<unknown> | undefined;
      const toMap = obj.get('to') as Y.Map<unknown> | undefined;
      if (!fromMap || !toMap) return; // Skip incomplete connector objects
      const from = readEndpointInline(fromMap);
      const to = readEndpointInline(toMap);
      const resolved = _resolveConnEPs({ from, to }, rectsMap);
      const bbox = _connBBox(resolved.from, resolved.to);
      const entry: ConnectorSnap = {
        id,
        type: 'connector',
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
        z: (obj.get('z') as number) ?? 0,
        createdAt: obj.get('createdAt') as number,
        createdBy: (obj.get('createdBy') as string) ?? '',
        from,
        to,
      };
      result.push(entry);
    } else if (type === 'stroke') {
      const pts = obj.get('points') as readonly number[] | undefined;
      if (!pts || !Array.isArray(pts)) return;
      const entry: StrokeSnap = {
        id,
        type: 'stroke',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: obj.get('width') as number,
        height: obj.get('height') as number,
        z: (obj.get('z') as number) ?? 0,
        createdAt: (obj.get('createdAt') as number) ?? 0,
        createdBy: (obj.get('createdBy') as string) ?? '',
        points: pts,
        baseWidth: obj.get('baseWidth') as number,
        baseHeight: obj.get('baseHeight') as number,
        color: obj.get('color') as StrokeSnap['color'],
        thickness: obj.get('thickness') as StrokeSnap['thickness'],
      };
      result.push(entry);
    }
  });
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return result;
}

// Inline endpoint reader to avoid importing from connector.ts (circular dep avoidance)
function readEndpointInline(epMap: Y.Map<unknown>): { kind: 'attached'; objectId: string; fallback: { x: number; y: number } } | { kind: 'free'; x: number; y: number } {
  const kind = epMap.get('kind') as string;
  if (kind === 'free') {
    return { kind: 'free', x: epMap.get('x') as number, y: epMap.get('y') as number };
  }
  const fb = epMap.get('fallback') as Y.Map<number>;
  return {
    kind: 'attached',
    objectId: epMap.get('objectId') as string,
    fallback: { x: fb.get('x') as number, y: fb.get('y') as number },
  };
}
