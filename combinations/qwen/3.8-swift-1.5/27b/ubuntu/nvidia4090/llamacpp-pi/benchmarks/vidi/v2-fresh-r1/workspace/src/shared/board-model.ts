// Board document model: Yjs schema + all mutations.
// Framework-free; shared by the client now and the Durable Object in story 4.

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';
import { rectContains, type Point, type Rect } from './geometry';
import { detachConnectorsTo } from './objects/connector';

/** Origin marker for local edits (used by story 8 undo and story 3 echo suppression). */
export const LOCAL_ORIGIN: unique symbol = Symbol('LOCAL_ORIGIN');

/**
 * A read-only view of a single object on the board. `type` distinguishes
 * object kinds; per-type fields (width/height/color/text) are optional and
 * populated when the type provides them. Unknown types are excluded from
 * snapshots (forward compatibility: old clients ignore new object kinds).
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
  color?: StickyColor;
  text?: string;
  /** Present on text snapshots (story 9). */
  size?: string;
  /** Present on text snapshots (story 9). */
  widthMode?: 'auto' | 'fixed';
}

/** A sticky-note object snapshot (story 2+). */
export type StickySnapshot = ObjectSnapshot & {
  type: 'sticky';
  color: StickyColor;
  text: string;
};

/**
 * Initialise the document schema. Sets meta.schemaVersion if absent.
 * Safe to call multiple times (idempotent).
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
  // Ensure objects map exists
  doc.getMap('objects');
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

export function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  return maxZ;
}

/**
 * Create a new sticky note centred at the given world point.
 * Returns the new note's id. Returns an empty string if coordinates are non-finite.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: StickyColor): string {
  if (!isFiniteNum(at.x) || !isFiniteNum(at.y)) return '';
  const id = crypto.randomUUID();
  const c = color ?? DEFAULT_STICKY_COLOR;
  const text = new Y.Text();

  doc.transact(() => {
    const objects = getObjects(doc);
    const note = new Y.Map();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', c);
    note.set('text', text);
    note.set('z', getMaxZ(doc) + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move an object to new world coordinates.
 * Returns true if the move was applied, false if the id is stale or coords are non-finite.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/**
 * Move several objects at once (story 7).
 * A single Yjs transaction → one update.
 * Returns the number of objects updated. Non-finite positions → 0 updates.
 * Stale ids are skipped without failing the rest.
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, Point>,
): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!isFiniteNum(p.x) || !isFiniteNum(p.y)) return 0;
  }
  const objects = getObjects(doc);
  const targets: { obj: Y.Map<unknown>; p: Point }[] = [];
  for (const [id, p] of positions) {
    const obj = objects.get(id);
    if (!obj) continue; // stale id: skip
    targets.push({ obj, p });
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const t of targets) {
      t.obj.set('x', t.p.x);
      t.obj.set('y', t.p.y);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Bring an object to the front (highest z).
 * Returns true if z was changed, false if already topmost or id is stale.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) === 1;
}

/**
 * Bring a group of objects to the front while preserving their relative
 * order (story 7). Selected objects receive z values just above the
 * highest non-selected z, in their current relative order.
 * Returns the number of objects whose z changed (0 if nothing to do).
 * Stale ids are skipped.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const selected = new Set(ids);
  const objects = getObjects(doc);
  const picked: { id: string; z: number }[] = [];
  let maxUnselected = 0;
  objects.forEach((obj, id) => {
    const z = obj.get('z');
    const zn = typeof z === 'number' ? z : 0;
    if (selected.has(id)) {
      picked.push({ id, z: zn });
    } else if (zn > maxUnselected) {
      maxUnselected = zn;
    }
  });
  if (picked.length === 0) return 0;
  picked.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const newZ = new Map<string, number>();
  picked.forEach((p, i) => newZ.set(p.id, maxUnselected + i + 1));
  const changed = picked.filter((p) => newZ.get(p.id) !== p.z);
  if (changed.length === 0) return 0;
  doc.transact(() => {
    for (const p of changed) {
      (objects.get(p.id) as Y.Map<unknown>).set('z', newZ.get(p.id)!);
    }
  }, LOCAL_ORIGIN);
  return changed.length;
}

/**
 * Set a sticky note's colour.
 * Returns true if the colour was applied, false if the id is stale or colour is unknown.
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
 * Delete an object from the board.
 * Returns true if the object was removed, false if the id is stale.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

/**
 * Delete several objects at once (story 7).
 * A single Yjs transaction → one update.
 * Returns the number of objects deleted. Stale ids are skipped.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjects(doc);
  const present = ids.filter((id) => objects.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Detach connectors to deleted objects before removing them (story 10).
    detachConnectorsTo(doc, present);
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/**
 * Resize several objects at once (story 7).
 * `rects` maps object id → target rect (x, y, width, height in world units).
 * A single Yjs transaction → one update.
 * Returns the number of objects updated. Non-finite rects → 0 updates.
 * Stale ids are skipped without failing the rest.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (
      !isFiniteNum(r.x) || !isFiniteNum(r.y) ||
      !isFiniteNum(r.width) || !isFiniteNum(r.height)
    ) {
      return 0;
    }
  }
  const objects = getObjects(doc);
  const targets: { obj: Y.Map<unknown>; r: Rect }[] = [];
  for (const [id, r] of rects) {
    const obj = objects.get(id);
    if (!obj) continue; // stale id: skip
    targets.push({ obj, r });
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const t of targets) {
      t.obj.set('x', t.r.x);
      t.obj.set('y', t.r.y);
      t.obj.set('width', t.r.width);
      t.obj.set('height', t.r.height);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Get the Y.Text for a sticky note, or undefined if the id is stale.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  const text = obj.get('text');
  if (text instanceof Y.Text) return text;
  return undefined;
}

/**
 * Read a connector endpoint from a Y.Map stored in the doc.
 */
function readEndpoint(map: Y.Map<unknown> | undefined): { kind: string; objectId?: string; fallback?: { x: number; y: number }; x?: number; y?: number } | undefined {
  if (!map) return undefined;
  const kind = map.get('kind') as string;
  if (kind === 'free') {
    return { kind: 'free', x: map.get('x') as number, y: map.get('y') as number };
  }
  if (kind === 'attached') {
    const fb = map.get('fallback') as Y.Map<unknown> | undefined;
    return {
      kind: 'attached',
      objectId: map.get('objectId') as string,
      fallback: fb ? { x: fb.get('x') as number, y: fb.get('y') as number } : undefined,
    };
  }
  return undefined;
}

/**
 * Return an immutable snapshot of all known objects, sorted by (z, id).
 * Unknown object types are skipped (forward compatibility).
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects = getObjects(doc);
  const result: ObjectSnapshot[] = [];

  objects.forEach((obj, id) => {
    const type = obj.get('type');
    if (type === 'text') {
      const text = obj.get('text');
      result.push({
        id,
        type: 'text',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        text: text instanceof Y.Text ? text.toString() : '',
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
        width: obj.get('width') as number | undefined,
        height: obj.get('height') as number | undefined,
        size: (obj.get('size') as string) ?? 'M',
        widthMode: (obj.get('widthMode') as 'auto' | 'fixed') ?? 'auto',
      });
      return;
    }
    if (type === 'shape') {
      const label = obj.get('label');
      result.push({
        id,
        type: 'shape',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
        width: obj.get('width') as number | undefined,
        height: obj.get('height') as number | undefined,
        kind: obj.get('kind') as string,
        fill: obj.get('fill') as string,
        stroke: obj.get('stroke') as string,
        label: label instanceof Y.Text ? label.toString() : '',
      } as ObjectSnapshot);
      return;
    }
    if (type === 'connector') {
      // Read endpoints from Y.Map storage
      const fromMap = obj.get('from') as Y.Map<unknown> | undefined;
      const toMap = obj.get('to') as Y.Map<unknown> | undefined;
      const from = readEndpoint(fromMap);
      const to = readEndpoint(toMap);
      let fx = 0, fy = 0, tx = 0, ty = 0;
      if (from?.kind === 'free') { fx = from.x!; fy = from.y!; }
      else if (from?.kind === 'attached' && from.fallback) { fx = from.fallback.x; fy = from.fallback.y; }
      if (to?.kind === 'free') { tx = to.x!; ty = to.y!; }
      else if (to?.kind === 'attached' && to.fallback) { tx = to.fallback.x; ty = to.fallback.y; }
      const minX = Math.min(fx, tx);
      const minY = Math.min(fy, ty);
      result.push({
        id,
        type: 'connector',
        x: minX,
        y: minY,
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
        width: Math.abs(tx - fx),
        height: Math.abs(ty - fy),
        from: from as any,
        to: to as any,
      } as ObjectSnapshot);
      return;
    }
    if (type !== 'sticky') return; // other types included as they are introduced

    const text = obj.get('text');
    result.push({
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: obj.get('color') as StickyColor,
      text: text instanceof Y.Text ? text.toString() : '',
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
      width: obj.get('width') as number | undefined,
      height: obj.get('height') as number | undefined,
    });
  });

  // Sort by (z, id) for stable render order
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return result;
}

// --- Selection geometry (story 7) ---

/**
 * The bounding rect of an object in world units.
 * Objects without explicit width/height use the sticky note size.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/**
 * Ids of objects fully contained in `rect` (marquee selection, story 7).
 */
export function objectsInRect(
  objects: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const ids: string[] = [];
  for (const o of objects) {
    if (rectContains(rect, objectBounds(o))) ids.push(o.id);
  }
  return ids;
}

/**
 * All object ids in the snapshot (Ctrl/Cmd+A, story 7).
 * Unknown types are already excluded by `snapshot()`.
 */
export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  return objects.map((o) => o.id);
}
