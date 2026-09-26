import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
  type TextSize,
} from './config';
import { rectContains, type Point, type Rect } from './geometry';
import type { TextSnapshot } from './objects/text';
import { shapeSnapshotFrom, type ShapeSnapshot } from './objects/shape';
import {
  connectorSnapshotFrom,
  detachConnectorsTo,
  objectRects,
  type ConnectorSnapshot,
} from './objects/connector';
import { strokeSnapshotFrom, type StrokeSnap } from './objects/stroke';

/**
 * Board document model: owns the Yjs schema and all mutations.
 * Framework-free so the Durable Object (story 4) can import it.
 */

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

/**
 * The fields shared by every renderable object. Story 7 introduces a generic
 * object model; per-type fields (colour, text, ...) live on the specific
 * snapshot subtypes. `width`/`height` are optional: objects created before
 * story 7 omit them and fall back to STICKY_SIZE_WORLD in `objectBounds`.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

const VALID_COLORS = new Set<string>(Object.keys(STICKY_COLORS));

/**
 * The set of object types the model knows how to serialise. `snapshot()` and
 * `allObjectIds()` restrict themselves to these. Framework-free: the client
 * object registry calls `registerBoardObjectType` for any type it can render
 * so this set stays in sync without board-model importing React.
 */
const KNOWN_OBJECT_TYPES = new Set<string>(['sticky']);

/** Teach the model about a renderable object type (idempotent). */
export function registerBoardObjectType(type: string): void {
  KNOWN_OBJECT_TYPES.add(type);
}

function getObjectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function getMaxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number | undefined;
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta') as Y.Map<unknown>;
  if (meta.get('schemaVersion') === undefined) {
    meta.set('schemaVersion', 1);
  }
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const objects = getObjectsMap(doc);
  const id = crypto.randomUUID();
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;

  doc.transact(() => {
    const z = getMaxZ(objects) + 1;
    const map = new Y.Map<unknown>();
    map.set('type', 'sticky');
    map.set('x', x);
    map.set('y', y);
    map.set('color', color);
    map.set('text', new Y.Text(''));
    map.set('z', z);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);

  return id;
}

/** Move a single object. Thin wrapper over {@link moveObjects}. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/** Raise a single object. Thin wrapper over {@link bringObjectsToFront}. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) === 1;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!VALID_COLORS.has(color)) return false;
  const objects = getObjectsMap(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);

  return true;
}

/** Delete a single object. Thin wrapper over {@link deleteObjects}. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjectsMap(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  const text = obj.get('text');
  if (text instanceof Y.Text) return text;
  return undefined;
}

/**
 * Every renderable object: stickies (story 2), text (story 9), shapes and
 * connectors (story 10), sorted by z then id. `snapshot()` stays sticky-only
 * for the story 1–8 callers.
 */
export type BoardSnapshot =
  | StickySnapshot
  | TextSnapshot
  | ShapeSnapshot
  | ConnectorSnapshot
  | StrokeSnap;

export function objectSnapshots(doc: Y.Doc): readonly BoardSnapshot[] {
  const objects = getObjectsMap(doc);
  const result: BoardSnapshot[] = [];
  // Arrows are drawn from the objects they hang off, so their rectangles are
  // read lazily (and only once) as soon as the board contains a connector.
  let rects: Map<string, Rect> | null = null;
  const rectsOnce = (): Map<string, Rect> => {
    if (rects === null) rects = objectRects(doc);
    return rects;
  };

  objects.forEach((obj, id) => {
    const type = obj.get('type');
    if (type === 'sticky') {
      const text = obj.get('text');
      const entry: StickySnapshot = {
        id,
        type: 'sticky',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        color: obj.get('color') as StickyColor,
        text: text instanceof Y.Text ? text.toString() : '',
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
      };
      const width = obj.get('width') as number | undefined;
      const height = obj.get('height') as number | undefined;
      if (typeof width === 'number' && Number.isFinite(width)) entry.width = width;
      if (typeof height === 'number' && Number.isFinite(height)) entry.height = height;
      result.push(entry);
      return;
    }
    if (type === 'text' && KNOWN_OBJECT_TYPES.has('text')) {
      const text = obj.get('text');
      const width = obj.get('width');
      const height = obj.get('height');
      const size = obj.get('size');
      const entry: TextSnapshot = {
        id,
        type: 'text',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        text: text instanceof Y.Text ? text.toString() : '',
        size: (typeof size === 'string' ? size : 'M') as TextSize,
        widthMode: obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
        z: obj.get('z') as number,
        width: typeof width === 'number' && Number.isFinite(width) ? width : 0,
        height: typeof height === 'number' && Number.isFinite(height) ? height : 0,
      };
      result.push(entry);
      return;
    }
    if (type === 'shape' && KNOWN_OBJECT_TYPES.has('shape')) {
      const snap = shapeSnapshotFrom(id, obj.get('z') as number, obj);
      if (snap !== null) result.push(snap);
      return;
    }
    if (type === 'connector' && KNOWN_OBJECT_TYPES.has('connector')) {
      const snap = connectorSnapshotFrom(id, obj.get('z') as number, obj, rectsOnce());
      if (snap !== null) result.push(snap);
      return;
    }
    if (type === 'stroke' && KNOWN_OBJECT_TYPES.has('stroke')) {
      const snap = strokeSnapshotFrom(id, obj.get('z') as number, obj);
      if (snap !== null) result.push(snap);
    }
  });

  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : a.id === b.id ? 0 : 1;
  });

  return result;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjectsMap(doc);
  const result: StickySnapshot[] = [];

  objects.forEach((obj, id) => {
    const type = obj.get('type');
    if (type !== 'sticky') return;
    const text = obj.get('text');
    const entry: StickySnapshot = {
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: obj.get('color') as StickyColor,
      text: text instanceof Y.Text ? text.toString() : '',
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    };
    // `width`/`height` are additive (story 7). Only emit them when persisted,
    // so pre-story-7 stickies keep relying on the objectBounds fallback.
    const width = obj.get('width') as number | undefined;
    const height = obj.get('height') as number | undefined;
    if (typeof width === 'number' && Number.isFinite(width)) entry.width = width;
    if (typeof height === 'number' && Number.isFinite(height)) entry.height = height;
    result.push(entry);
  });

  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Generic object geometry + group operations (story 7)
// ---------------------------------------------------------------------------

/**
 * The world-space rectangle of an object. Objects without persisted
 * `width`/`height` (stickies created before story 7) fall back to
 * STICKY_SIZE_WORLD.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width =
    typeof obj.width === 'number' && Number.isFinite(obj.width)
      ? obj.width
      : STICKY_SIZE_WORLD;
  const height =
    typeof obj.height === 'number' && Number.isFinite(obj.height)
      ? obj.height
      : STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width, height };
}

/**
 * Ids of every object whose bounds lie entirely inside `rect` (the marquee
 * rule: touching an edge counts as inside, being clipped does not).
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
 * Ids of every object of a registered type (used by select-all). Unknown
 * types are excluded so a type the client cannot render is never selected.
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (KNOWN_OBJECT_TYPES.has(obj.type)) ids.push(obj.id);
  }
  return ids;
}

/**
 * Move objects to absolute positions. Rejects the whole call (returns 0, no
 * transaction) when the map is empty or any position is non-finite; ids that
 * no longer exist are skipped. Exactly one transaction is written.
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, Point>,
): number {
  if (positions.size === 0) return 0;
  const objects = getObjectsMap(doc);
  const targets: Array<{ obj: Y.Map<unknown>; x: number; y: number }> = [];
  for (const [id, point] of positions) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return 0;
    const obj = objects.get(id);
    if (obj) targets.push({ obj, x: point.x, y: point.y });
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const { obj, x, y } of targets) {
      obj.set('x', x);
      obj.set('y', y);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Resize objects to absolute rects, persisting `x`, `y`, `width` and `height`
 * (turning implicit-size stickies explicit). Rejects the whole call (returns
 * 0, no transaction) on an empty map or any non-finite rect field; missing ids
 * are skipped. Exactly one transaction is written.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;
  const objects = getObjectsMap(doc);
  const targets: Array<{ obj: Y.Map<unknown>; rect: Rect }> = [];
  for (const [id, rect] of rects) {
    if (
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height)
    ) {
      return 0;
    }
    const obj = objects.get(id);
    if (obj) targets.push({ obj, rect });
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const { obj, rect } of targets) {
      obj.set('x', rect.x);
      obj.set('y', rect.y);
      obj.set('width', rect.width);
      obj.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Raise every object in `ids` above all unselected objects, preserving the
 * relative z order among the selected ones (reassign `z = maxUnselectedZ +
 * rank`). Returns the number of objects whose z actually changed; 0 (no
 * transaction) when the list is empty, all ids are missing, or nothing moves.
 */
export function bringObjectsToFront(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return 0;
  const objects = getObjectsMap(doc);
  const selected = new Set(unique);

  let maxUnselectedZ = 0;

  // Compute max z among unselected objects, collect the selected ones.
  const selectedObjs: Array<{ id: string; obj: Y.Map<unknown>; z: number }> = [];
  objects.forEach((obj, id) => {
    const z = (obj.get('z') as number) ?? 0;
    if (selected.has(id)) {
      selectedObjs.push({ id, obj, z });
    } else if (z > maxUnselectedZ) {
      maxUnselectedZ = z;
    }
  });
  if (selectedObjs.length === 0) return 0;

  selectedObjs.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const writes: Array<{ obj: Y.Map<unknown>; z: number }> = [];
  selectedObjs.forEach((entry, rank) => {
    const targetZ = maxUnselectedZ + 1 + rank;
    if (entry.z !== targetZ) writes.push({ obj: entry.obj, z: targetZ });
  });
  if (writes.length === 0) return 0;

  doc.transact(() => {
    for (const { obj, z } of writes) obj.set('z', z);
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Delete every object in `ids` that still exists. Returns the number removed;
 * 0 (no transaction) when the list is empty or nothing matched.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return 0;
  const objects = getObjectsMap(doc);
  const present = unique.filter((id) => objects.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Story 10 (`connector.target_deleted`): arrows attached to a deleted object
    // survive with their end pinned where it was attached. Detaching inside this
    // same transaction means the anchors are still resolvable and the whole
    // delete is one update and one undo step.
    detachConnectorsTo(doc, present);
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
