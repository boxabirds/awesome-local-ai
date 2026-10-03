/**
 * Yjs board document model — all mutations for the whiteboard.
 *
 * Framework-free: the Durable Object (story 4) will import this module.
 * Every successful mutation is one `doc.transact(fn, LOCAL_ORIGIN)`.
 * Rejections (stale id, unknown colour, non-finite coords, topmost
 * bringToFront) return false before opening a transaction.
 */

import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';
import { isRegisteredObjectType } from './object-types';
import { rectContains, type Rect } from './geometry';
import { connectorBBox, resolveEndpoints } from './geometry/connector-geometry';
import { detachConnectorsTo, type Endpoint } from './objects/connector';

/** Unique origin symbol for local (this-client) transactions. */
export const LOCAL_ORIGIN: unique symbol = Symbol('LOCAL_ORIGIN');

/**
 * Immutable snapshot of a single board object of any type (story 7).
 * `width`/`height` are explicit sizes written by the first resize;
 * sticky notes without them render at STICKY_SIZE_WORLD (no migration).
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
  width?: number;
  height?: number;
}

/** Immutable snapshot of a single sticky note. */
export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

/**
 * Initialise the document schema. Sets `meta.schemaVersion` to 1 if absent.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    meta.set('schemaVersion', 1);
  }
  // Ensure objects map exists
  doc.getMap('objects');
}

/** Get the objects Y.Map from the doc. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getObjects(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects');
}

/** Check if a coordinate is finite. */
function isFiniteCoord(n: number): boolean {
  return Number.isFinite(n);
}

/**
 * Create a new sticky note centred at the given world point.
 * Returns the new note's id.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFiniteCoord(at.x) || !isFiniteCoord(at.y)) {
    throw new RangeError('createSticky: coordinates must be finite');
  }

  const id = crypto.randomUUID();
  const objects = getObjects(doc);

  // Compute max z
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const text = new Y.Text();
  const obj = new Y.Map();
  obj.set('type', 'sticky');
  obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
  obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
  obj.set('color', color);
  obj.set('text', text);
  obj.set('z', maxZ + 1);
  obj.set('createdAt', Date.now());

  doc.transact(() => {
    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move an object to a new world position. Returns true on success.
 * Thin wrapper over the story 7 group operation.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/**
 * Bring an object to the front (highest z). Returns true on success.
 * Thin wrapper over the story 7 group operation.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) === 1;
}

/**
 * Set a sticky note's colour. Returns true on success.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  // Validate colour
  if (!(color in STICKY_COLORS)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Delete an object from the board. Returns true on success.
 * Thin wrapper over the story 7 group operation.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

/**
 * Get the Y.Text for a sticky note, or undefined if not found.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  return obj.get('text') as Y.Text | undefined;
}

/**
 * Get an immutable snapshot of all objects, sorted by (z, id).
 * Unknown types are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjects(doc);
  const result: StickySnapshot[] = [];

  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (type !== 'sticky') return; // skip unknown types

    const text = obj.get('text');
    result.push({
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: obj.get('color') as StickyColor,
      text: text ? (text as Y.Text).toString() : '',
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    });
  });

  // Sort by (z, id)
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id.localeCompare(b.id);
  });

  return result;
}

/**
 * Get an immutable snapshot of ALL objects (every type), sorted by (z, id).
 * Unlike `snapshot` (sticky-only, story 2) this includes unknown types as
 * generic entries so group operations can reason about them; `allObjectIds`
 * is what excludes unregistered types.
 */
export function objects(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objectsMap = getObjects(doc);
  const result: ObjectSnapshot[] = [];

  objectsMap.forEach((obj, id) => {
    const type = obj.get('type') as string;
    // Connectors are derived in a second pass (bbox from resolved endpoints).
    if (type === 'connector') return;
    const x = obj.get('x') as number;
    const y = obj.get('y') as number;
    if (!isFiniteCoord(x) || !isFiniteCoord(y)) return;

    const entry: ObjectSnapshot = {
      id,
      type,
      x,
      y,
      z: (obj.get('z') as number) ?? 0,
      createdAt: (obj.get('createdAt') as number) ?? 0,
    };
    const w = obj.get('width') as number | undefined;
    const h = obj.get('height') as number | undefined;
    if (typeof w === 'number' && isFiniteCoord(w) && w > 0) entry.width = w;
    if (typeof h === 'number' && isFiniteCoord(h) && h > 0) entry.height = h;

    if (type === 'sticky') {
      const text = obj.get('text');
      (entry as StickySnapshot).color = (obj.get('color') as StickyColor) ?? DEFAULT_STICKY_COLOR;
      (entry as StickySnapshot).text = text ? (text as Y.Text).toString() : '';
    }
    if (type === 'shape') {
      const label = obj.get('label');
      (entry as { kind?: string; fill?: string; stroke?: string; label?: string }).kind =
        (obj.get('kind') as string) ?? 'rect';
      (entry as { kind?: string; fill?: string; stroke?: string; label?: string }).fill =
        (obj.get('fill') as string) ?? 'white';
      (entry as { kind?: string; fill?: string; stroke?: string; label?: string }).stroke =
        (obj.get('stroke') as string) ?? 'dark';
      (entry as { kind?: string; fill?: string; stroke?: string; label?: string }).label = label
        ? (label as Y.Text).toString()
        : '';
    }
    result.push(entry);
  });

  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id.localeCompare(b.id);
  });

  // Connectors (story 10): x/y/width/height are stored 0 and derived from
  // the resolved endpoints. Non-connector rects are known after the first
  // pass; connectors resolve against them (a connector attached to a
  // connector resolves against the fallback when the other is not derived
  // yet — deterministic, and the fallback is the attach-time anchor).
  const rects = new Map<string, Rect>();
  for (const e of result) rects.set(e.id, objectBounds(e));

  const connectors: ObjectSnapshot[] = [];
  objectsMap.forEach((obj, id) => {
    if (obj.get('type') !== 'connector') return;
    const from = readEndpointField(obj.get('from'));
    const to = readEndpointField(obj.get('to'));
    if (!from || !to) return;
    const ends = resolveEndpoints({ from, to }, rects);
    const bbox = connectorBBox(ends.from, ends.to);
    const entry: ObjectSnapshot & { from: Endpoint; to: Endpoint } = {
      id,
      type: 'connector',
      x: bbox.x,
      y: bbox.y,
      z: (obj.get('z') as number) ?? 0,
      createdAt: (obj.get('createdAt') as number) ?? 0,
      width: bbox.width,
      height: bbox.height,
      from,
      to,
    };
    connectors.push(entry);
    rects.set(id, bbox);
  });

  if (connectors.length > 0) {
    result.push(...connectors);
    result.sort((a, b) => {
      if (a.z !== b.z) return a.z - b.z;
      return a.id.localeCompare(b.id);
    });
  }

  return result;
}

/**
 * Read a connector endpoint from its Y.Map storage form (shared with the
 * connector model; kept local to avoid a deeper import cycle).
 */
function readEndpointField(m: unknown): Endpoint | undefined {
  if (!(m instanceof Y.Map)) return undefined;
  const kind = m.get('kind') as string;
  if (kind === 'attached') {
    const objectId = m.get('objectId');
    const fx = m.get('fx') as number;
    const fy = m.get('fy') as number;
    if (typeof objectId !== 'string' || !Number.isFinite(fx) || !Number.isFinite(fy)) return undefined;
    return { kind: 'attached', objectId, fallback: { x: fx, y: fy } };
  }
  if (kind === 'free') {
    const x = m.get('x') as number;
    const y = m.get('y') as number;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    return { kind: 'free', x, y };
  }
  return undefined;
}

/**
 * Insert an object of an arbitrary type at an exact top-left position and
 * size (test fixtures and later object stories). The type is not validated
 * here; unregistered types are excluded from selection by `allObjectIds`.
 */
export function insertRawObject(
  doc: Y.Doc,
  type: string,
  at: { x: number; y: number },
  size?: { width: number; height: number },
): string {
  if (!isFiniteCoord(at.x) || !isFiniteCoord(at.y)) throw new Error('insertRawObject: non-finite position');
  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set('type', type);
  obj.set('x', at.x);
  obj.set('y', at.y);
  if (size) {
    if (!isFiniteCoord(size.width) || !isFiniteCoord(size.height) || size.width <= 0 || size.height <= 0) {
      throw new Error('insertRawObject: invalid size');
    }
    obj.set('width', size.width);
    obj.set('height', size.height);
  }
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((o) => {
    const z = o.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  obj.set('z', maxZ + 1);
  obj.set('createdAt', Date.now());
  doc.transact(() => {
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

// ---------------------------------------------------------------------------
// Story 7: generic group operations (sel.geometry_ops)
// ---------------------------------------------------------------------------

/**
 * The world-space bounds of an object. Sticky notes without explicit
 * width/height use STICKY_SIZE_WORLD (compatibility constraint).
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width, height };
}

/**
 * Ids of registered-type objects lying ENTIRELY inside `rect` (marquee
 * containment, sel.marquee). Partially-inside objects are not returned.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const result: string[] = [];
  for (const obj of snapshot) {
    if (!isRegisteredObjectType(obj.type)) continue;
    if (!isFiniteCoord(obj.x) || !isFiniteCoord(obj.y)) continue;
    if (rectContains(rect, objectBounds(obj))) result.push(obj.id);
  }
  return result;
}

/**
 * Ids of every registered-type object (select-all, sel.all). Unregistered
 * (unknown) types are excluded.
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot
    .filter((obj) => isRegisteredObjectType(obj.type) && isFiniteCoord(obj.x) && isFiniteCoord(obj.y))
    .map((obj) => obj.id);
}

/**
 * Move objects to absolute world positions (drag and nudge). One LOCAL_ORIGIN
 * transaction. Non-finite positions → 0, no transaction; missing ids are
 * skipped; empty map → 0. Returns the number of objects moved.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, { x: number; y: number }>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!isFiniteCoord(p.x) || !isFiniteCoord(p.y)) return 0;
  }
  const objectsMap = getObjects(doc);
  const entries: Array<[string, { x: number; y: number }]> = [];
  for (const [id, p] of positions) {
    if (objectsMap.has(id)) entries.push([id, p]);
  }
  if (entries.length === 0) return 0;

  doc.transact(() => {
    for (const [id, p] of entries) {
      const obj = objectsMap.get(id);
      if (!obj) continue;
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
  }, LOCAL_ORIGIN);

  return entries.length;
}

/**
 * Resize objects to absolute world rects (writes x, y, width, height, turning
 * implicit-size stickies explicit). One LOCAL_ORIGIN transaction.
 * Non-finite or non-positive dims → 0, no transaction; missing ids skipped;
 * empty map → 0. Returns the number of objects resized.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (
      !isFiniteCoord(r.x) ||
      !isFiniteCoord(r.y) ||
      !isFiniteCoord(r.width) ||
      !isFiniteCoord(r.height) ||
      r.width <= 0 ||
      r.height <= 0
    ) {
      return 0;
    }
  }
  const objectsMap = getObjects(doc);
  const entries: Array<[string, Rect]> = [];
  for (const [id, r] of rects) {
    if (objectsMap.has(id)) entries.push([id, r]);
  }
  if (entries.length === 0) return 0;

  doc.transact(() => {
    for (const [id, r] of entries) {
      const obj = objectsMap.get(id);
      if (!obj) continue;
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);

  return entries.length;
}

/**
 * Raise every id in `ids` above all unselected objects, preserving the
 * relative stacking order among the selected ones (z = maxUnselectedZ + rank).
 * One LOCAL_ORIGIN transaction. Missing ids skipped; empty list → 0.
 * Returns the number of objects whose z changed (0 when already on top).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objectsMap = getObjects(doc);
  const selected = [...new Set(ids)].filter((id) => objectsMap.has(id));
  if (selected.length === 0) return 0;

  const selectedSet = new Set(selected);
  let maxUnselectedZ = 0;
  objectsMap.forEach((obj, id) => {
    if (selectedSet.has(id as string)) return;
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxUnselectedZ) maxUnselectedZ = z;
  });

  const ranked = selected
    .map((id) => ({ id, z: (objectsMap.get(id).get('z') as number) ?? 0 }))
    .sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));

  const nextZ = new Map<string, number>();
  let changed = 0;
  ranked.forEach((e, i) => {
    const z = maxUnselectedZ + i + 1;
    nextZ.set(e.id, z);
    if (e.z !== z) changed++;
  });
  if (changed === 0) return 0;

  doc.transact(() => {
    for (const [id, z] of nextZ) {
      const obj = objectsMap.get(id);
      if (!obj) continue;
      obj.set('z', z);
    }
  }, LOCAL_ORIGIN);

  return changed;
}

/**
 * Delete every id in `ids`. One LOCAL_ORIGIN transaction.
 * Missing ids skipped; empty list → 0. Returns the number deleted.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objectsMap = getObjects(doc);
  const toDelete = [...new Set(ids)].filter((id) => objectsMap.has(id));
  if (toDelete.length === 0) return 0;

  doc.transact(() => {
    // Story 10: ends attached to deleted objects become free at their
    // current anchor in the SAME transaction (one update, one undo step).
    detachConnectorsTo(doc, toDelete);
    for (const id of toDelete) objectsMap.delete(id);
  }, LOCAL_ORIGIN);

  return toDelete.length;
}
