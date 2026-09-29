import * as Y from 'yjs';
import { rectContains, type Point, type Rect } from './geometry';
import { resolveEndpoints, connectorBBox, parseEndpoint } from './geometry/connector-geometry';
import { detachConnectorsTo } from './objects/connector';
import {
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';

// Local change origin. Story 8 (undo) uses it to filter the user's own changes
// and story 3 (sync) uses it to avoid echoing local edits back.
export const LOCAL_ORIGIN = Symbol('vidi6-local-origin');
export type LocalOrigin = typeof LOCAL_ORIGIN;

/**
 * Generic board object snapshot (story 7). `width`/`height` are optional:
 * sticky notes created before story 7 carry no explicit size and render at
 * STICKY_SIZE_WORLD (additive field, no migration). Later object types
 * (stories 9–12) plug in here with their own fields.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
  /**
   * Story 10: resolved connector endpoints (world points). Present only on
   * `connector` snapshots, derived from the live object rectangles in
   * `allObjects` — the registry hit test and the selection overlay use it.
   */
  ends?: { from: Point; to: Point };
  /**
   * Story 11: stroke geometry. Present only on `stroke` snapshots — the
   * flattened points (relative to the bbox origin, at the creation size)
   * plus the creation bbox size and the named colour/thickness. The
   * registry's line-distance hit test and StrokeObject use it.
   */
  points?: readonly number[];
  baseWidth?: number;
  baseHeight?: number;
  color?: string;
  thickness?: string;
  /**
   * Story 12: image fields. Present only on `image` snapshots:
   * the immutable R2 asset key (null while uploading), the sniffed content
   * type, the natural size, the upload status, its start clock and the
   * uploader's identity.
   */
  assetKey?: string | null;
  contentType?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  status?: 'uploading' | 'ready' | 'failed';
  uploadStartedAt?: number;
  uploaderId?: string;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
  createdAt: number;
}

/**
 * Object types the client knows how to select, move, resize and delete.
 * `sticky` is built in (board-model creates it natively); client-side types
 * register through `registerKnownObjectType` (the story 7 object registry).
 * Unknown types stay in the doc untouched: never selectable, never mutated.
 */
const KNOWN_TYPES = new Set<string>(['sticky']);

export function registerKnownObjectType(type: string): void {
  KNOWN_TYPES.add(type);
}

const SCHEMA_VERSION = 1;

type ObjectMap = Y.Map<unknown>;

/**
 * The doc's `objects` Y.Map (id → object map). Story 10 exports this so the
 * client can hit-test attach targets directly (connector tools, selection).
 */
export function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap<ObjectMap>('objects');
}

function stickyOf(doc: Y.Doc, id: string): ObjectMap | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

function isValidColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && color in STICKY_COLORS;
}

function isFinitePoint(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isFiniteSize(s: { width?: number; height?: number }): boolean {
  return (
    (s.width === undefined || Number.isFinite(s.width)) &&
    (s.height === undefined || Number.isFinite(s.height))
  );
}

function maxZ(objects: Y.Map<ObjectMap>): number {
  let max = 0;
  objects.forEach((obj) => {
    if (!(obj instanceof Y.Map)) return;
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Sets meta.schemaVersion if absent. Idempotent; safe to call on a doc that
 * already carries the schema (e.g. after story 4 loads persisted state).
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }
}

/**
 * Creates a sticky note centred on `at` (world units, top-left = at - size/2),
 * on top of all other notes, in the given colour (default yellow).
 * Returns the new id, or null for non-finite coordinates / unknown colour.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
  // Optional caller-supplied id (defaults to a random UUID). Tests pass a
  // deterministic id so identically-seeded runs create matching notes.
  id: string = crypto.randomUUID(),
): string | null {
  if (!isFinitePoint(at) || !isValidColor(color)) return null;
  doc.transact(() => {
    const objects = objectsOf(doc);
    const obj = new Y.Map();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Moves a note's top-left to world (x, y). Story 7: thin wrapper over the
 * group operation. Returns true when a change was applied; false for a stale
 * id, non-finite coordinates, or a no-op move.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/**
 * Brings a note to the top of the stacking order (z = maxZ + 1). Story 7:
 * thin wrapper over the group operation. Returns false (no update) for a
 * stale id or a note already on top.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) === 1;
}

/**
 * Changes a note's colour. Returns false (no update) for a stale id, an
 * unknown colour, or the colour the note already has.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isValidColor(color)) return false;
  const obj = stickyOf(doc, id);
  if (!obj) return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Removes a note from the doc. Story 7: thin wrapper over the group
 * operation. Returns false (no update) for a stale id.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

/** Returns the note's Y.Text, or undefined for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = stickyOf(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** Returns the note's colour, or undefined for a stale id. */
export function getStickyColor(doc: Y.Doc, id: string): string | undefined {
  const obj = stickyOf(doc, id);
  if (!obj) return undefined;
  const color = obj.get('color');
  return typeof color === 'string' ? color : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so concurrent
 * equal-z values (possible once story 3 syncs) still order identically on
 * every client. Unknown object types are skipped (forward compatibility).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objectsOf(doc).forEach((obj, key) => {
    if (!(obj instanceof Y.Map)) return;
    if (obj.get('type') !== 'sticky') return;
    const text = obj.get('text');
    const width = obj.get('width');
    const height = obj.get('height');
    out.push({
      id: key as string,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: obj.get('color') as StickyColor,
      text: text instanceof Y.Text ? text.toString() : '',
      z: (obj.get('z') as number) ?? 0,
      createdAt: (obj.get('createdAt') as number) ?? 0,
      ...(typeof width === 'number' && Number.isFinite(width) ? { width } : {}),
      ...(typeof height === 'number' && Number.isFinite(height) ? { height } : {}),
    });
  });
  out.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return out;
}

/**
 * Immutable snapshot of EVERY object on the board (all types), sorted by
 * (z, id) like `snapshot`. Used by the client for rendering through the
 * object registry, multi-selection, marquee and select-all.
 *
 * Story 10: connectors store x/y/width/height = 0; their snapshot box is
 * DERIVED here from the resolved endpoints (which follow object moves by
 * anyone without writes). The resolved endpoints are carried on the snapshot
 * (`ends`) for the registry hit test and the selection overlay.
 */
export function allObjects(doc: Y.Doc): readonly ObjectSnapshot[] {
  const raw: Array<ObjectSnapshot & { type: string }> = [];
  objectsOf(doc).forEach((obj, key) => {
    if (!(obj instanceof Y.Map)) return;
    const type = obj.get('type');
    if (typeof type !== 'string') return;
    const x = obj.get('x');
    const y = obj.get('y');
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const width = obj.get('width');
    const height = obj.get('height');
    const snap: ObjectSnapshot = {
      id: key as string,
      type,
      x,
      y,
      z: (obj.get('z') as number) ?? 0,
      ...(typeof width === 'number' && Number.isFinite(width) ? { width } : {}),
      ...(typeof height === 'number' && Number.isFinite(height) ? { height } : {}),
    };
    // Story 11: carry the stroke's stored geometry on the snapshot so the
    // registry hit test can line-hit-test without a second doc read.
    if (type === 'stroke') {
      const points = obj.get('points');
      const baseWidth = obj.get('baseWidth');
      const baseHeight = obj.get('baseHeight');
      const color = obj.get('color');
      const thickness = obj.get('thickness');
      if (
        Array.isArray(points) &&
        typeof baseWidth === 'number' &&
        typeof baseHeight === 'number' &&
        typeof color === 'string' &&
        typeof thickness === 'string'
      ) {
        snap.points = points;
        snap.baseWidth = baseWidth;
        snap.baseHeight = baseHeight;
        snap.color = color;
        snap.thickness = thickness;
      }
    }
    // Story 12: carry the image's stored fields on the snapshot so the
    // registry component can render upload states without a second read.
    if (type === 'image') {
      const assetKey = obj.get('assetKey');
      const contentType = obj.get('contentType');
      const naturalWidth = obj.get('naturalWidth');
      const naturalHeight = obj.get('naturalHeight');
      const status = obj.get('status');
      const uploadStartedAt = obj.get('uploadStartedAt');
      const uploaderId = obj.get('uploaderId');
      if (
        (assetKey === null || typeof assetKey === 'string') &&
        typeof contentType === 'string' &&
        typeof naturalWidth === 'number' &&
        typeof naturalHeight === 'number' &&
        (status === 'uploading' || status === 'ready' || status === 'failed') &&
        typeof uploadStartedAt === 'number' &&
        typeof uploaderId === 'string'
      ) {
        snap.assetKey = assetKey;
        snap.contentType = contentType;
        snap.naturalWidth = naturalWidth;
        snap.naturalHeight = naturalHeight;
        snap.status = status;
        snap.uploadStartedAt = uploadStartedAt;
        snap.uploaderId = uploaderId;
      }
    }
    raw.push(snap);
  });

  // Rects of the attach targets (non-connector objects) for endpoint
  // resolution.
  const rects = new Map<string, Rect>();
  for (const o of raw) {
    if (o.type === 'connector') continue;
    rects.set(o.id, objectBounds(o));
  }

  const out: ObjectSnapshot[] = [];
  for (const o of raw) {
    if (o.type !== 'connector') {
      out.push(o);
      continue;
    }
    const obj = objectsOf(doc).get(o.id);
    const from = obj instanceof Y.Map ? parseEndpoint(obj.get('from')) : null;
    const to = obj instanceof Y.Map ? parseEndpoint(obj.get('to')) : null;
    if (!from || !to) {
      out.push(o); // malformed connector: render with the stored (zero) box
      continue;
    }
    const { from: fp, to: tp } = resolveEndpoints({ from, to }, rects);
    const box = connectorBBox(fp, tp);
    out.push({ ...o, x: box.x, y: box.y, width: box.width, height: box.height, ends: { from: fp, to: tp } });
  }
  out.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Story 7: generic group operations (sel.geometry_ops).
//
// Every mutating call: non-finite values or an empty id list → 0 and no
// transaction; ids missing from the doc are skipped; otherwise exactly one
// LOCAL_ORIGIN transaction, returning the number of objects changed.
//
// Gestures write ABSOLUTE positions/rects computed from the gesture-start
// snapshot, so concurrent remote moves converge to the last writer with
// identical results on every screen (key decision 1).
// ---------------------------------------------------------------------------

/**
 * An object's world rect. `width`/`height` fall back to STICKY_SIZE_WORLD:
 * pre-story-7 stickies have no explicit size (key decision 5).
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width, height };
}

/**
 * Ids of the objects lying ENTIRELY inside `rect` (marquee rule, sel.marquee:
 * touching-but-not-enclosed objects are not selected).
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snapshot.filter((obj) => rectContains(rect, objectBounds(obj))).map((obj) => obj.id);
}

/**
 * Ids of every object with a registered type (select-all, sel.all). Objects
 * of unregistered types are excluded: they are not selectable or resizable.
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.filter((obj) => KNOWN_TYPES.has(obj.type)).map((obj) => obj.id);
}

/**
 * Moves objects to ABSOLUTE top-left positions (world units). Used by the
 * group-move gesture and arrow-key nudging. Returns the number of objects
 * moved; missing ids are skipped.
 */
/**
 * True when at least one of `ids` is a present object in the doc. The
 * transform gesture uses this to tell "the whole selection was deleted
 * remotely" (stop) from "this frame happened not to move anything" (continue).
 */
export function anyObjectPresent(doc: Y.Doc, ids: Iterable<string>): boolean {
  const objects = objectsOf(doc);
  for (const id of ids) {
    const obj = objects.get(id);
    if (obj instanceof Y.Map) return true;
  }
  return false;
}

export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, { x: number; y: number }>): number {
  if (positions.size === 0) return 0;
  const objects = objectsOf(doc);
  const pending: Array<[ObjectMap, number, number]> = [];
  for (const [id, p] of positions) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0; // whole call rejected
    const obj = objects.get(id);
    if (!(obj instanceof Y.Map)) continue; // missing id: skipped
    pending.push([obj, p.x, p.y]);
  }
  if (pending.length === 0) return 0;
  let changed = 0;
  doc.transact(() => {
    for (const [obj, x, y] of pending) {
      if (obj.get('x') !== x || obj.get('y') !== y) changed += 1;
      obj.set('x', x);
      obj.set('y', y);
    }
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Resizes objects to ABSOLUTE world rects, writing `x`, `y` and BOTH
 * `width` and `height` (a pre-story-7 sticky becomes explicit on its first
 * resize — key decision 5). Returns the number of objects resized.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  const objects = objectsOf(doc);
  const pending: Array<[ObjectMap, Rect]> = [];
  for (const [id, r] of rects) {
    if (!isFiniteSize(r)) return 0; // whole call rejected (non-finite)
    const obj = objects.get(id);
    if (!(obj instanceof Y.Map)) continue; // missing id: skipped
    pending.push([obj, r]);
  }
  if (pending.length === 0) return 0;
  let changed = 0;
  doc.transact(() => {
    for (const [obj, r] of pending) {
      if (
        obj.get('x') !== r.x ||
        obj.get('y') !== r.y ||
        obj.get('width') !== r.width ||
        obj.get('height') !== r.height
      ) {
        changed += 1;
      }
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Raises the whole selection above every unselected object while preserving
 * the relative stacking order among selected objects (key decision 4):
 * selected ids are ranked by their current (z, id) and reassigned
 * z = maxUnselectedZ + rank. Returns the number of objects re-assigned; 0
 * (no transaction) when nothing needs to change.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsOf(doc);
  const selected: Array<{ id: string; obj: ObjectMap; z: number }> = [];
  for (const id of ids) {
    const obj = objects.get(id);
    if (!(obj instanceof Y.Map)) continue; // missing id: skipped
    const z = obj.get('z');
    if (typeof z !== 'number' || !Number.isFinite(z)) continue;
    selected.push({ id, obj, z });
  }
  if (selected.length === 0) return 0;

  const selectedIds = new Set(selected.map((s) => s.id));
  let maxUnselected = 0;
  objects.forEach((obj, key) => {
    if (selectedIds.has(key as string)) return;
    if (!(obj instanceof Y.Map)) return;
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxUnselected) maxUnselected = z;
  });

  selected.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const targets = selected.map((s, i) => ({ obj: s.obj, z: maxUnselected + i + 1 }));
  if (targets.every((t) => t.obj.get('z') === t.z)) return 0; // already in place
  doc.transact(() => {
    for (const t of targets) t.obj.set('z', t.z);
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Removes every selected object at once. Returns the number removed; missing
 * ids are skipped.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsOf(doc);
  const present = ids.filter((id) => objects.get(id) instanceof Y.Map);
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Story 10 (connector.target_deleted): attached connector ends on the
    // deleted objects become free at the CURRENT side anchor BEFORE the
    // objects are removed, so the anchor is still computable. One
    // transaction → one update → one undo step.
    detachConnectorsTo(doc, present);
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
