/**
 * Yjs-based board document model.
 *
 * Framework-free so the Durable Object (story 4) can import it for validation/migration.
 * All mutations go through `doc.transact(fn, LOCAL_ORIGIN)`.
 *
 * Story 7 adds the *generic* group operations (moveObjects, resizeObjects,
 * bringObjectsToFront, deleteObjects) and the read helpers (objectBounds,
 * objectsInRect, allObjectIds). Story 2's single-object functions are thin
 * wrappers over the group versions.
 */
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type PenColor,
  type PenThickness,
  type StickyColor,
} from './config';
import { rectContains, type Point, type Rect } from './geometry';
import { detachConnectorsTo, endpointFromPlain, type Endpoint } from './objects/connector';
import { resolveEndpoints, connectorBBox } from './geometry/connector-geometry';

/** Transaction origin marking local user actions. */
export const LOCAL_ORIGIN: unique symbol = Symbol('local');

export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
  /** Explicit size (story 7). Absent for objects created before this story. */
  width?: number;
  height?: number;
  /** Sticky-specific or stroke-specific colour; present for those types. */
  color?: string;
  text?: string;
  /** Text-object-specific (story 9). */
  size?: string;
  widthMode?: 'auto' | 'fixed';
  createdBy?: string;
  /** Shape-specific (story 10). */
  kind?: string;
  fill?: string;
  stroke?: string;
  label?: string;
  /** Connector-specific (story 10). */
  from?: Endpoint;
  to?: Endpoint;
  /** Stroke-specific (story 11). */
  points?: readonly number[];
  baseWidth?: number;
  baseHeight?: number;
  thickness?: PenThickness;
}

export interface StickySnapshot extends Omit<ObjectSnapshot, 'type' | 'color' | 'text'> {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

const VALID_COLORS: ReadonlySet<string> = new Set(Object.keys(STICKY_COLORS));

/** Initialise the document schema if not already done. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (z > max) max = z;
  });
  return max;
}

/**
 * Create a sticky note centred at (at.x, at.y) in world coordinates.
 * The stored x,y is the top-left corner: at minus half the note size.
 * z = maxZ + 1 (new notes go on top).
 * Returns the new id.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const objects = getObjects(doc);
  const id = crypto.randomUUID();
  const z = maxZ(objects) + 1;
  doc.transact(() => {
    if (objects.has(id)) return; // id collision (should never happen)
    const yMap = new Y.Map();
    objects.set(id, yMap);
    yMap.set('type', 'sticky');
    yMap.set('x', at.x - STICKY_SIZE_WORLD / 2);
    yMap.set('y', at.y - STICKY_SIZE_WORLD / 2);
    yMap.set('color', color);
    yMap.set('z', z);
    yMap.set('createdAt', Date.now());
    const yText = new Y.Text();
    yMap.set('text', yText);
  }, LOCAL_ORIGIN);
  return id;
}

// ----------------------------------------------------------- generic group ops

/**
 * The rectangle a snapshot occupies. Reads explicit width/height when present,
 * otherwise falls back to the historical sticky-note size. Objects created
 * before story 7 therefore keep their current size and become resizable on the
 * first resize (which writes both fields).
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width, height };
}

/**
 * Ids of every snapshot lying *entirely* inside `rect` (used by the marquee).
 * An object only touching the rectangle's edge is excluded.
 */
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) ids.push(obj.id);
  }
  return ids;
}

/**
 * Ids of every selectable object on the board (used by select-all). Unknown
 * types never appear in a snapshot, so they are naturally excluded.
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height)
  );
}

/**
 * Move objects to absolute world positions. Every value must be finite or the
 * whole call is rejected (returns 0, no transaction). Missing ids are skipped.
 * One transaction is emitted per successful call; returns the number moved.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  }
  const objects = getObjects(doc);
  const targets: Array<[string, Y.Map<unknown>, Point]> = [];
  positions.forEach((p, id) => {
    const obj = objects.get(id);
    if (obj) targets.push([id, obj, p]);
  });
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const [, obj, p] of targets) {
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Resize/move objects to absolute rects, persisting width and height (which
 * turns an implicit-size sticky note into an explicit-size one). Non-finite
 * rects reject the whole call; missing ids are skipped. Returns the number
 * changed.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (!isFiniteRect(r)) return 0;
  }
  const objects = getObjects(doc);
  const targets: Array<[Y.Map<unknown>, Rect]> = [];
  rects.forEach((r, id) => {
    const obj = objects.get(id);
    if (obj) targets.push([obj, r]);
  });
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, r] of targets) {
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Raise every selected object above all unselected objects while preserving
 * their relative z-order: `z = max(maxUnselectedZ + rank, currentZ)`. Objects
 * already in front are left untouched. Returns the number of objects whose z
 * actually changed (0 → no transaction).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjects(doc);
  const idSet = new Set(ids);
  let maxUnselected = 0;
  objects.forEach((obj, id) => {
    if (idSet.has(id)) return;
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxUnselected) maxUnselected = z;
  });
  // Stable ascending order by (z, id) so relative stacking among the selected
  // objects is preserved when we reassign.
  const selected: Array<{ id: string; obj: Y.Map<unknown>; z: number }> = [];
  idSet.forEach((id) => {
    const obj = objects.get(id);
    if (!obj) return;
    const z = obj.get('z') as number;
    selected.push({ id, obj, z: typeof z === 'number' ? z : 0 });
  });
  if (selected.length === 0) return 0;
  selected.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const base = maxUnselected + 1;
  const assigns: Array<[Y.Map<unknown>, number]> = [];
  selected.forEach((s, i) => {
    const target = Math.max(s.z, base + i);
    if (target !== s.z) assigns.push([s.obj, target]);
  });
  if (assigns.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, z] of assigns) obj.set('z', z);
  }, LOCAL_ORIGIN);
  return assigns.length;
}

/**
 * Delete objects. Missing ids are skipped. Empty list → 0 with no transaction.
 * One transaction per successful call; returns the number deleted.
 * Story 10: connectors attached to deleted objects have their ends detached
 * (converted to `free` at the current anchor) inside the same transaction.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjects(doc);
  const present = ids.filter((id) => objects.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    detachConnectorsTo(doc, present);
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

// ----------------------------------------------------------- story 2 single-object wrappers

/** Move a sticky note to world position (x, y). Returns false if id not found or coords not finite. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/** Bring a sticky note to the front (highest z). Returns false if already top or id not found. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) === 1;
}

/** Set the colour of a sticky note. Returns false for invalid colour or missing id. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!VALID_COLORS.has(color)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Delete a sticky note. Returns false if id not found. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

/** Get the Y.Text of a sticky note, or undefined if not found. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  return obj.get('text') as Y.Text;
}

/** Return a snapshot of all sticky notes, sorted by (z, id), skipping unknown types. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjects(doc);
  const result: StickySnapshot[] = [];
  objects.forEach((obj, id) => {
    const type = obj.get('type');
    if (type !== 'sticky') return; // skip unknown types
    const width = obj.get('width') as number | undefined;
    const height = obj.get('height') as number | undefined;
    const snap: StickySnapshot = {
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: obj.get('color') as StickyColor,
      text: (obj.get('text') as Y.Text).toString(),
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    };
    if (typeof width === 'number') snap.width = width;
    if (typeof height === 'number') snap.height = height;
    result.push(snap);
  });
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return result;
}

/**
 * Generic snapshot of every structurally-valid object, whatever its type. Used
 * by the board renderer, which then filters through the registry so an unknown
 * type never renders or becomes selectable (stories 9–12 add real types). Use
 * `snapshot()` when you specifically need sticky notes.
 */
export function snapshotAll(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects = getObjects(doc);
  const result: ObjectSnapshot[] = [];
  objects.forEach((obj, id) => {
    const type = obj.get('type');
    const x = obj.get('x') as number;
    const y = obj.get('y') as number;
    const z = obj.get('z') as number;
    if (typeof type !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const width = obj.get('width') as number | undefined;
    const height = obj.get('height') as number | undefined;
    const snap: ObjectSnapshot = {
      id,
      type,
      x,
      y,
      z: Number.isFinite(z) ? z : 0,
      createdAt: (obj.get('createdAt') as number) ?? 0,
    };
    if (typeof width === 'number') snap.width = width;
    if (typeof height === 'number') snap.height = height;
    if (type === 'sticky') {
      snap.color = obj.get('color') as StickyColor;
      const text = obj.get('text');
      snap.text = text instanceof Y.Text ? text.toString() : ((text as string) ?? '');
    } else if (type === 'text') {
      const text = obj.get('text');
      snap.text = text instanceof Y.Text ? text.toString() : ((text as string) ?? '');
      snap.size = obj.get('size') as string;
      snap.widthMode = obj.get('widthMode') as 'auto' | 'fixed';
      snap.createdBy = obj.get('createdBy') as string | undefined;
    } else if (type === 'shape') {
      snap.kind = obj.get('kind') as string;
      snap.fill = obj.get('fill') as string;
      snap.stroke = obj.get('stroke') as string;
      const label = obj.get('label');
      snap.label = label instanceof Y.Text ? label.toString() : ((label as string) ?? '');
      snap.createdBy = obj.get('createdBy') as string | undefined;
    } else if (type === 'connector') {
      const fromRaw = obj.get('from');
      const toRaw = obj.get('to');
      const fromEp = endpointFromPlain(fromRaw);
      const toEp = endpointFromPlain(toRaw);
      if (fromEp) snap.from = fromEp;
      if (toEp) snap.to = toEp;
      snap.createdBy = obj.get('createdBy') as string | undefined;
    } else if (type === 'stroke') {
      const pts = obj.get('points');
      if (Array.isArray(pts)) snap.points = pts as number[];
      snap.baseWidth = obj.get('baseWidth') as number;
      snap.baseHeight = obj.get('baseHeight') as number;
      snap.color = obj.get('color') as PenColor;
      snap.thickness = obj.get('thickness') as PenThickness;
      snap.createdBy = obj.get('createdBy') as string | undefined;
    }
    result.push(snap);
  });
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Derive connector bboxes from resolved endpoints and other object rects
  const objectRects = new Map<string, Rect>();
  for (const s of result) {
    if (s.type !== 'connector') {
      const w = s.width ?? STICKY_SIZE_WORLD;
      const h = s.height ?? STICKY_SIZE_WORLD;
      objectRects.set(s.id, { x: s.x, y: s.y, width: w, height: h });
    }
  }
  for (const s of result) {
    if (s.type === 'connector' && s.from && s.to) {
      const resolved = resolveEndpoints({ from: s.from, to: s.to }, objectRects);
      const bbox = connectorBBox(resolved.from, resolved.to);
      s.x = bbox.x;
      s.y = bbox.y;
      s.width = bbox.width;
      s.height = bbox.height;
    }
  }

  return result;
}
