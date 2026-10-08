import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  STICKY_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_LABEL_MAX_CHARS,
} from './config';
import type { StickyColor } from './config';
import type { Point } from '../client/canvas/camera';
import type { Rect } from './geometry';
import { sideAnchor, nearestSide, resolveEndpoints, connectorBBox } from './geometry/connector-geometry';
import type { Endpoint, AttachedEndpoint } from './geometry/connector-geometry';

/** Unique symbol for local transactions (used by undo / network filtering). */
export const LOCAL_ORIGIN: unique symbol = Symbol('local-origin');

// ─── Types ────────────────────────────────────────────────────────────────

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

export interface ShapeSnapshot {
  id: string;
  type: 'shape';
  kind: 'rect' | 'ellipse' | 'diamond';
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  label: string;
  z: number;
  createdAt: number;
  createdBy?: string;
}

export interface ConnectorSnapshot {
  id: string;
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy?: string;
}

// Legacy alias for backward compatibility with existing code
export type StickySnapshotLegacy = StickySnapshot;
export type ObjectSnap = StickySnapshot | ShapeSnapshot | ConnectorSnapshot;

/** Type guard: narrows an ObjectSnap to StickySnapshot */
export function isStickySnap(obj: ObjectSnap): obj is StickySnapshot {
  return obj.type === 'sticky';
}

/** Type guard: narrows an ObjectSnap to ShapeSnapshot */
export function isShapeSnap(obj: ObjectSnap): obj is ShapeSnapshot {
  return obj.type === 'shape';
}

// ─── Internal helpers ─────────────────────────────────────────────────────

export function getDocObjects(doc: Y.Doc): any {
  return doc.getMap('objects');
}

function getMaxZ(objects: any): number {
  let max = 0;
  for (const val of objects.values()) {
    if (!(val instanceof Y.Map)) continue;
    const z = Number((val as any).get('z') ?? 0);
    if (z > max) max = z;
  }
  return max;
}

function getDataMap(objs: any, id: string): any {
  const val = objs.get(id);
  return val instanceof Y.Map ? val : null;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Initialise the document meta if absent.
 */
export function initDoc(doc: Y.Doc): void {
  if (!doc.getMap('meta').has('schemaVersion')) {
    doc.transact(() => {
      doc.getMap('meta').set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a sticky note at world coordinates `at`, return its id.
 * The note is placed with top-left at `at` minus half the sticky size.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color?: StickyColor,
): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
    return '';
  }

  const objects = getDocObjects(doc);
  const maxZ = getMaxZ(objects);

  const id = crypto.randomUUID();
  const dataMap = new Y.Map();
  dataMap.set('type', 'sticky');
  dataMap.set('x', at.x - STICKY_SIZE_WORLD / 2);
  dataMap.set('y', at.y - STICKY_SIZE_WORLD / 2);
  dataMap.set('color', color ?? DEFAULT_STICKY_COLOR);
  dataMap.set('text', new Y.Text());
  dataMap.set('z', maxZ + 1);
  dataMap.set('createdAt', Date.now());

  doc.transact(() => {
    objects.set(id, dataMap);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move object `id` to world position `(x, y)`. Returns false if stale/invalid.
 * Uses LOCAL_ORIGIN so it enters the undo history.
 */
export function moveObject(
  doc: Y.Doc,
  id: string,
  x: number,
  y: number,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false;
  }

  const objects = getDocObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return false;

  doc.transact(() => {
    dm.set('x', x);
    dm.set('y', y);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Bring `id` to front (z = maxZ + 1). Returns false if stale or already topmost.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getDocObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return false;

  const currentZ = Number(dm.get('z') ?? 0);
  const maxZ = getMaxZ(objects);
  if (currentZ >= maxZ) {
    return false; // already topmost
  }

  dm.set('z', maxZ + 1);

  return true;
}

/**
 * Change sticky colour. Returns false for stale id or unknown colour.
 * Uses LOCAL_ORIGIN so it enters the undo history.
 */
export function setStickyColor(
  doc: Y.Doc,
  id: string,
  color: string,
): boolean {
  if (!(color in STICKY_COLORS)) {
    return false;
  }

  const objects = getDocObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return false;

  doc.transact(() => {
    dm.set('color', color as StickyColor);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Delete object `id`. Returns false if stale.
 * Uses LOCAL_ORIGIN so it enters the undo history.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getDocObjects(doc);
  if (!objects.has(id)) {
    return false;
  }

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Get the Y.Text for a sticky note (for editing).
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getDocObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return undefined;
  const val = dm.get('text');
  return val instanceof Y.Text ? val : undefined;
}

/**
 * Return a memoisable snapshot of all objects sorted by (z, id).
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnap[] {
  const objects = getDocObjects(doc);
  const result: ObjectSnap[] = [];

  for (const [id, val] of objects) {
    if (!(val instanceof Y.Map)) continue;
    const dm = val as any;
    const type = String(dm.get('type') ?? '');

    if (type === 'sticky') {
      const textVal = dm.get('text');
      const textStr = textVal instanceof Y.Text ? textVal.toString() : '';
      result.push({
        id,
        type: 'sticky' as const,
        x: Number(dm.get('x') ?? 0),
        y: Number(dm.get('y') ?? 0),
        color: String(dm.get('color') ?? DEFAULT_STICKY_COLOR),
        text: textStr,
        z: Number(dm.get('z') ?? 0),
        createdAt: Number(dm.get('createdAt') ?? 0),
        width: dm.has('width') ? Number(dm.get('width')) : undefined,
        height: dm.has('height') ? Number(dm.get('height')) : undefined,
      } as StickySnapshot);
    } else if (type === 'shape') {
      const labelVal = dm.get('label');
      const labelStr = labelVal instanceof Y.Text ? labelVal.toString() : '';
      result.push({
        id,
        type: 'shape' as const,
        kind: (dm.get('kind') as 'rect' | 'ellipse' | 'diamond') || 'rect',
        x: Number(dm.get('x') ?? 0),
        y: Number(dm.get('y') ?? 0),
        width: Number(dm.get('width') ?? 0),
        height: Number(dm.get('height') ?? 0),
        fill: String(dm.get('fill') ?? DEFAULT_SHAPE_FILL),
        stroke: String(dm.get('stroke') ?? DEFAULT_SHAPE_STROKE),
        label: labelStr,
        z: Number(dm.get('z') ?? 0),
        createdAt: Number(dm.get('createdAt') ?? 0),
        createdBy: dm.has('createdBy') ? String(dm.get('createdBy')) : undefined,
      } as ShapeSnapshot);
    } else if (type === 'connector') {
      const from: Endpoint = dm.get('from');
      const to: Endpoint = dm.get('to');

      // Build a rect map of known objects (excluding connectors themselves)
      const rectsMap = new Map<string, Rect>();
      for (const [oid, oval] of objects) {
        if (oid === id || !(oval instanceof Y.Map)) continue;
        const odm = oval as any;
        const otype = String(odm.get('type') ?? '');
        if (otype === 'connector') continue;
        rectsMap.set(oid, {
          x: Number(odm.get('x') ?? 0),
          y: Number(odm.get('y') ?? 0),
          width: Number(odm.get('width') ?? 0),
          height: Number(odm.get('height') ?? 0),
        });
      }

      const { from: fromPt, to: toPt } = resolveEndpoints({ from, to }, rectsMap);
      const bbox = connectorBBox(fromPt, toPt);

      result.push({
        id,
        type: 'connector' as const,
        from,
        to,
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
        z: Number(dm.get('z') ?? 0),
        createdAt: Number(dm.get('createdAt') ?? 0),
        createdBy: dm.has('createdBy') ? String(dm.get('createdBy')) : undefined,
      } as ConnectorSnapshot);
    }
    // skip unknown types (forward compatibility)
  }

  // Stable sort by (z, id)
  result.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));

  return Object.freeze(result);
}

// ─── Story 7: Selection geometry & group operations ───────────────
import { rectContains } from './geometry';

/** Return a Rect for an object snapshot. Uses width/height if set;
 *  otherwise falls back to STICKY_SIZE_WORLD for both dimensions.
 */
export function objectBounds(obj: ObjectSnap): Rect {
  if (obj.type === 'sticky') {
    const w = obj.width ?? STICKY_SIZE_WORLD;
    const h = obj.height ?? STICKY_SIZE_WORLD;
    return { x: obj.x, y: obj.y, width: w, height: h };
  }
  if (obj.type === 'shape') {
    return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  }
  if (obj.type === 'connector') {
    return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  }
  return { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
}

/** Return ids of objects whose entire bounds lie inside `rect`. */
export function objectsInRect(
  snapshot: readonly ObjectSnap[],
  rect: Rect,
): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) {
      ids.push(obj.id);
    }
  }
  return ids;
}

/** Return ids of all known-registered objects in the snapshot. */
export function allObjectIds(snapshot: readonly ObjectSnap[]): string[] {
  return snapshot.map((o) => o.id);
}

/** Move multiple objects atomically. Returns count changed. */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, Point>,
): number {
  if (positions.size === 0) return 0;

  const objects = getDocObjects(doc);
  let count = 0;

  try {
    doc.transact(() => {
      for (const [id, pos] of positions) {
        if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
        const dm = getDataMap(objects, id);
        if (!dm) continue;
        dm.set('x', pos.x);
        dm.set('y', pos.y);
        count++;
      }
    }, LOCAL_ORIGIN);
  } catch {
    return 0;
  }

  return count;
}

/** Resize multiple objects atomically (writes width/height). Returns count changed. */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;

  const objects = getDocObjects(doc);
  let count = 0;

  try {
    doc.transact(() => {
      for (const [id, r] of rects) {
        if (
          !Number.isFinite(r.x) ||
          !Number.isFinite(r.y) ||
          !Number.isFinite(r.width) ||
          !Number.isFinite(r.height)
        ) {
          continue;
        }
        const dm = getDataMap(objects, id);
        if (!dm) continue;
        dm.set('x', r.x);
        dm.set('y', r.y);
        dm.set('width', r.width);
        dm.set('height', r.height);
        count++;
      }
    }, LOCAL_ORIGIN);
  } catch {
    return 0;
  }

  return count;
}

/** Delete multiple objects atomically, detaching connectors first. Returns count deleted. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getDocObjects(doc);
  let count = 0;

  try {
    doc.transact(() => {
      // Step 1: detach all connectors pointing to deleted ids
      const deletedSet = new Set(ids);
      for (const [cid, cval] of objects) {
        if (!(cval instanceof Y.Map)) continue;
        const cm = cval as any;
        if (String(cm.get('type') ?? '') !== 'connector') continue;

        const from: Endpoint = cm.get('from');
        const to: Endpoint = cm.get('to');

        let fromChanged = false;
        let toChanged = false;

        if (from.kind === 'attached' && deletedSet.has(from.objectId)) {
          // Compute anchor point: use the target's last known position
          const tx = Number(from.fallback.x ?? 0);
          const ty = Number(from.fallback.y ?? 0);
          cm.set('from', { kind: 'free', x: tx, y: ty });
          fromChanged = true;
        }

        if (to.kind === 'attached' && deletedSet.has(to.objectId)) {
          const tx = Number(to.fallback.x ?? 0);
          const ty = Number(to.fallback.y ?? 0);
          cm.set('to', { kind: 'free', x: tx, y: ty });
          toChanged = true;
        }

        if (fromChanged || toChanged) {
          cm.set('_detachedFrom', fromChanged);
          cm.set('_detachedTo', toChanged);
        }
      }

      // Step 2: delete the objects
      for (const id of ids) {
        if (objects.has(id)) {
          objects.delete(id);
          count++;
        }
      }
    }, LOCAL_ORIGIN);
  } catch {
    return 0;
  }

  return count;
}

/** Bring selected objects to front above unselected; preserve relative z order.
 *  Returns count changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getDocObjects(doc);
  const selectedSet = new Set(ids);

  // Find highest Z among unselected objects
  let highestNonSelectedZ = 0;
  for (const [oid, val] of objects) {
    if (!(val instanceof Y.Map)) continue;
    const dm = val as any;
    const z = Number(dm.get('z') ?? 0);
    if (!selectedSet.has(oid) && z > highestNonSelectedZ) {
      highestNonSelectedZ = z;
    }
  }

  // Collect selected objects with their current z, then sort to preserve relative order
  const selectedWithZ: Array<{ id: string; z: number }> = [];
  for (const [oid, val] of objects) {
    if (!selectedSet.has(oid) || !(val instanceof Y.Map)) continue;
    const dm = val as any;
    const z = Number(dm.get('z') ?? 0);
    selectedWithZ.push({ id: oid, z });
  }
  selectedWithZ.sort((a, b) => a.z - b.z);

  const orderedIds = selectedWithZ.map((o) => o.id);

  try {
    doc.transact(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        const dm = getDataMap(objects, orderedIds[i]);
        if (!dm) continue;
        dm.set('z', highestNonSelectedZ + 1 + i);
      }
    }, LOCAL_ORIGIN);
  } catch {
    return 0;
  }

  return orderedIds.length;
}


