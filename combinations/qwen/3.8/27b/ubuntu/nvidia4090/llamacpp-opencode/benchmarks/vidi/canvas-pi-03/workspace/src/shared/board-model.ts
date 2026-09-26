import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';
import { rectContains, type Point, type Rect } from './geometry';
import { connectorBBox, resolveEndpoints } from './geometry/connector-geometry';
import { isKnownObjectType, registerKnownObjectType } from './known-object-types';
import { detachConnectorsTo } from './objects/connector';
import type { Endpoint } from './objects/connector';

/** Re-exported from the dependency-free module (see known-object-types.ts). */
export { registerKnownObjectType, isKnownObjectType };

/**
 * Type-only re-export (erased at compile time — no runtime edge, so the
 * board-model <-> objects/connector cycle stays exactly as analysed).
 */
export type { Endpoint } from './objects/connector';

/**
 * Board document model (story 2).
 *
 * Yjs schema (the future persisted format, story 4, and wire format, story 3):
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map (id -> Y.Map)
 *     <id>: Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 *
 * - x, y are the note's top-left in world units.
 * - z is stacking order; higher is on top.
 * - Unknown `type` values are skipped by the renderer (forward compatibility).
 *
 * The module is framework-free so the Durable Object (story 4) can import it.
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
 * rejections (stale id, unknown colour, non-finite coordinates, bringToFront
 * on the topmost note) return false before opening a transaction.
 */

export const LOCAL_ORIGIN: unique symbol = Symbol('local-origin');

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  /** Story 7: explicit size (world units); absent on pre-story-7 notes. */
  width?: number;
  height?: number;
}

/**
 * Story 7: type-agnostic object snapshot. `width`/`height` are optional:
 * objects created before story 7 (fixed-size stickies) carry no explicit
 * size and render at the type's default (STICKY_SIZE_WORLD). `color` and
 * `text` are present on stickies and are read through by the renderer.
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
  color?: string;
  text?: string;
  /** Story 9: text size key (S/M/L/XL); text objects only. */
  size?: string;
  /** Story 9: 'auto' (grow with content, capped) or 'fixed' (width handle); text objects only. */
  widthMode?: 'auto' | 'fixed';
  /** Story 9: per-tab client id of the creator (string 6 identity is excluded from this milestone). */
  createdBy?: string;
  /** Story 10: shape kind ('rect' | 'ellipse' | 'diamond' | ...); shape objects only. */
  kind?: string;
  /** Story 10: fill colour NAME (key of SHAPE_FILL_COLORS); shape objects only. */
  fill?: string;
  /** Story 10: stroke colour NAME (key of SHAPE_STROKE_COLORS); shape objects only. */
  stroke?: string;
  /** Story 10: label text; shape objects only. */
  label?: string;
  /** Story 10: connector endpoints; connector objects only. */
  from?: Endpoint;
  to?: Endpoint;
  /**
   * Story 11: flattened [x0, y0, x1, y1, ...] points RELATIVE to the bbox
   * origin at the creation size; stroke objects only. Immutably replaced as
   * a whole (strokes are never edited point-by-point).
   */
  points?: readonly number[];
  /** Story 11: bbox size at creation; stroke objects only. */
  baseWidth?: number;
  /** Story 11: bbox size at creation; stroke objects only. */
  baseHeight?: number;
  /** Story 11: pen thickness NAME (key of PEN_THICKNESS_WORLD); stroke objects only. */
  thickness?: string;
  /**
   * Story 10: connector endpoint positions RESOLVED against the current
   * object positions (attached -> side anchor, free -> stored point;
   * orphaned attached -> fallback). Set for every connector snapshot.
   */
  fromPoint?: Point;
  toPoint?: Point;
}

/**
 * Reads a connector endpoint from its stored form (story 10). Fresh writes
 * store a plain object; after Yjs deep-converts it on set (and across the
 * wire) the value is a Y.Map — both shapes are handled here. Returns
 * undefined for a malformed/non-finite endpoint.
 */
export function readEndpoint(value: unknown): Endpoint | undefined {
  const get = (key: string): unknown => {
    if (value instanceof Y.Map) return value.get(key);
    if (value !== null && typeof value === 'object') {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  };
  const kind = get('kind');
  if (kind === 'free') {
    const x = get('x');
    const y = get('y');
    if (typeof x !== 'number' || typeof y !== 'number') return undefined;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    return { kind: 'free', x, y };
  }
  if (kind === 'attached') {
    const objectId = get('objectId');
    const fb = get('fallback');
    const fbX = fb instanceof Y.Map ? fb.get('x') : fb !== null && typeof fb === 'object' ? (fb as Record<string, unknown>).x : undefined;
    const fbY = fb instanceof Y.Map ? fb.get('y') : fb !== null && typeof fb === 'object' ? (fb as Record<string, unknown>).y : undefined;
    if (typeof objectId !== 'string' || objectId.length === 0) return undefined;
    if (typeof fbX !== 'number' || typeof fbY !== 'number') return undefined;
    if (!Number.isFinite(fbX) || !Number.isFinite(fbY)) return undefined;
    return { kind: 'attached', objectId, fallback: { x: fbX, y: fbY } };
  }
  return undefined;
}

/**
 * World rect of an object. Stickies without an explicit width/height fall
 * back to STICKY_SIZE_WORLD (additive field, no migration); other types
 * without an explicit size are degenerate (0x0).
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  let width: number;
  let height: number;
  if (obj.type === 'sticky') {
    width = obj.width !== undefined && Number.isFinite(obj.width) ? obj.width : STICKY_SIZE_WORLD;
    height = obj.height !== undefined && Number.isFinite(obj.height) ? obj.height : STICKY_SIZE_WORLD;
  } else {
    width = obj.width !== undefined && Number.isFinite(obj.width) ? obj.width : 0;
    height = obj.height !== undefined && Number.isFinite(obj.height) ? obj.height : 0;
  }
  return { x: obj.x, y: obj.y, width, height };
}

/**
 * Immutable snapshot of ALL board objects (any type), sorted by (z, id) so
 * equal z values still order identically on every client.
 */
export function objectSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  // Story 10 first pass: non-connector objects, plus a rect map the second
  // pass uses to resolve connector endpoints against LIVE object positions
  // (connector.follow: attached ends re-anchor to the side facing the
  // other end every time anything moves).
  const rects = new Map<string, Rect>();
  const connectors: Array<[string, Y.Map<unknown>]> = [];
  objectsMap(doc).forEach((obj, id) => {
    const type = obj.get('type');
    if (typeof type !== 'string') return;
    if (type === 'connector') {
      connectors.push([id, obj]);
      return;
    }
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    const createdAt = obj.get('createdAt');
    const width = obj.get('width');
    const height = obj.get('height');
    const color = obj.get('color');
    const text = obj.get('text');
    const size = obj.get('size');
    const widthMode = obj.get('widthMode');
    const createdBy = obj.get('createdBy');
    out.push({
      id,
      type,
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
      z: typeof z === 'number' ? z : 0,
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
      ...(typeof width === 'number' && Number.isFinite(width) ? { width } : {}),
      ...(typeof height === 'number' && Number.isFinite(height) ? { height } : {}),
      ...(typeof color === 'string' ? { color } : {}),
      ...(text instanceof Y.Text ? { text: text.toString() } : typeof text === 'string' ? { text } : {}),
      ...(typeof size === 'string' ? { size } : {}),
      ...(widthMode === 'auto' || widthMode === 'fixed' ? { widthMode } : {}),
      ...(typeof createdBy === 'string' ? { createdBy } : {}),
      ...(typeof obj.get('kind') === 'string' ? { kind: obj.get('kind') as string } : {}),
      ...(typeof obj.get('fill') === 'string' ? { fill: obj.get('fill') as string } : {}),
      ...(typeof obj.get('stroke') === 'string' ? { stroke: obj.get('stroke') as string } : {}),
      // Story 11: stroke fields (points are stored as a plain number array).
      ...(Array.isArray(obj.get('points'))
        ? { points: obj.get('points') as readonly number[] }
        : {}),
      ...(typeof obj.get('baseWidth') === 'number' && Number.isFinite(obj.get('baseWidth'))
        ? { baseWidth: obj.get('baseWidth') as number }
        : {}),
      ...(typeof obj.get('baseHeight') === 'number' && Number.isFinite(obj.get('baseHeight'))
        ? { baseHeight: obj.get('baseHeight') as number }
        : {}),
      ...(typeof obj.get('thickness') === 'string' ? { thickness: obj.get('thickness') as string } : {}),
      ...(obj.get('label') instanceof Y.Text
        ? { label: (obj.get('label') as Y.Text).toString() }
        : typeof obj.get('label') === 'string'
          ? { label: obj.get('label') as string }
          : {}),
    });
    rects.set(id, objectBounds(out[out.length - 1]));
  });
  // Story 10 second pass: connectors. The stored x/y is derived (bbox of the
  // resolved endpoints) so selection/marquee treats an arrow like any other
  // object; the endpoints themselves stay authoritative.
  for (const [id, obj] of connectors) {
    const z = obj.get('z');
    const createdAt = obj.get('createdAt');
    const from = readEndpoint(obj.get('from'));
    const to = readEndpoint(obj.get('to'));
    const snap: ObjectSnapshot = {
      id,
      type: 'connector',
      x: 0,
      y: 0,
      z: typeof z === 'number' && Number.isFinite(z) ? z : 0,
      createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
      ...(typeof obj.get('createdBy') === 'string' ? { createdBy: obj.get('createdBy') as string } : {}),
    };
    if (from !== undefined && to !== undefined) {
      const resolved = resolveEndpoints({ from, to }, rects);
      const bbox = connectorBBox(resolved.from, resolved.to);
      snap.x = bbox.x;
      snap.y = bbox.y;
      snap.width = bbox.width;
      snap.height = bbox.height;
      snap.from = from;
      snap.to = to;
      snap.fromPoint = resolved.from;
      snap.toPoint = resolved.to;
    }
    out.push(snap);
  }
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Ids of objects whose bounds lie entirely inside `rect` (marquee rule,
 * sel.marquee). A rect touching an object without enclosing it selects
 * nothing for that object.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    return [];
  }
  return snapshot.filter((o) => rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/** Ids of objects with a known type only (select-all, sel.all). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.filter((o) => isKnownObjectType(o.type)).map((o) => o.id);
}

/**
 * Writes absolute world positions for a group of objects (drag, nudge).
 * Missing ids are skipped; non-finite values or an empty map return 0 with
 * no transaction; otherwise exactly one LOCAL_ORIGIN transaction and the
 * count of objects changed.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  }
  const objects = objectsMap(doc);
  const valid: Array<[Y.Map<unknown>, Point]> = [];
  for (const [id, p] of positions) {
    const obj = objects.get(id);
    if (!obj) continue; // missing ids are skipped (deleted remotely)
    valid.push([obj, p]);
  }
  if (valid.length === 0) return 0;
  doc.transact(() => {
    const rects = liveObjectRects(objects);
    for (const [obj, p] of valid) {
      if (obj.get('type') === 'connector') {
        // Story 10 (connector.follow): move the arrow by the bbox delta;
        // only FREE ends move, attached ends stay on their objects.
        const from = readEndpoint(obj.get('from'));
        const to = readEndpoint(obj.get('to'));
        if (from === undefined || to === undefined) continue;
        const resolved = resolveEndpoints({ from, to }, rects);
        const bbox = connectorBBox(resolved.from, resolved.to);
        const dx = p.x - bbox.x;
        const dy = p.y - bbox.y;
        if (dx === 0 && dy === 0) continue;
        if (from.kind === 'free') obj.set('from', { kind: 'free', x: from.x + dx, y: from.y + dy });
        if (to.kind === 'free') obj.set('to', { kind: 'free', x: to.x + dx, y: to.y + dy });
        continue;
      }
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return valid.length;
}

/**
 * Writes absolute world rects for a group of objects (group resize).
 * Writes both `width` and `height`, turning implicit-size stickies explicit
 * on first resize. Same rejection/skip/transaction rules as moveObjects.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
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
  const objects = objectsMap(doc);
  const valid: Array<[Y.Map<unknown>, Rect]> = [];
  for (const [id, r] of rects) {
    const obj = objects.get(id);
    if (!obj) continue;
    valid.push([obj, r]);
  }
  if (valid.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, r] of valid) {
      // Story 10: connectors are not box-resizable; their ends move by
      // dragging (setConnectorEndpoint). Skip without writing.
      if (obj.get('type') === 'connector') continue;
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return valid.length;
}

/**
 * Raises the given ids above every unselected object, preserving their
 * relative stacking order (reassigns z = maxUnselectedZ + rank, rank in the
 * selection's current (z, id) order). Returns the number of objects whose z
 * changed (0 when already on top, no transaction).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const selected: Array<{ id: string; z: number }> = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue; // defensive: duplicate ids
    const obj = objects.get(id);
    if (!obj) continue;
    const z = obj.get('z');
    seen.add(id);
    selected.push({ id, z: typeof z === 'number' && Number.isFinite(z) ? z : 0 });
  }
  if (selected.length === 0) return 0;
  selected.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let maxUnselected = 0;
  objects.forEach((obj, id) => {
    if (seen.has(id)) return;
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > maxUnselected) maxUnselected = z;
  });

  let changed = 0;
  const target = new Map<string, number>();
  selected.forEach((s, rank) => {
    const z = maxUnselected + rank + 1;
    target.set(s.id, z);
    if (s.z !== z) changed += 1;
  });
  if (changed === 0) return 0;
  doc.transact(() => {
    target.forEach((z, id) => {
      objects.get(id)?.set('z', z);
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Removes a group of objects. Missing ids are skipped; an empty or all-missing
 * list returns 0 with no transaction; otherwise one LOCAL_ORIGIN transaction
 * and the count removed.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const present: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (objects.has(id)) present.push(id);
  }
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Story 10 (connector.target_deleted): ends attached to a deleted object
    // become FREE at their current anchor inside this same transaction, so
    // every client converges to the orphaned-at-fallback state without an
    // extra round-trip.
    detachConnectorsTo(doc, present);
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const SCHEMA_VERSION = 1;

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY);
}

function stickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  return obj;
}

/**
 * Story 10: id -> world rect of every live non-connector object (stickies
 * fall back to STICKY_SIZE_WORLD). Used to resolve connector endpoints
 * against current positions.
 */
function liveObjectRects(objects: Y.Map<Y.Map<unknown>>): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  objects.forEach((obj, id) => {
    const type = obj.get('type');
    if (type === 'connector' || typeof type !== 'string') return;
    const x = obj.get('x');
    const y = obj.get('y');
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const rawWidth = obj.get('width');
    const rawHeight = obj.get('height');
    const width =
      typeof rawWidth === 'number' && Number.isFinite(rawWidth) ? rawWidth : type === 'sticky' ? STICKY_SIZE_WORLD : 0;
    const height =
      typeof rawHeight === 'number' && Number.isFinite(rawHeight) ? rawHeight : type === 'sticky' ? STICKY_SIZE_WORLD : 0;
    rects.set(id, { x, y, width, height });
  });
  return rects;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/**
 * Materialises the board's top-level types and stamps the schema version.
 * Setting meta.schemaVersion emits exactly one update; creating the named
 * types (getMap) does not. Idempotent: a second call on the same doc is a
 * no-op (schemaVersion is already present).
 *
 * The worker room does not use this: its load target is a pristine doc with
 * no meta (see BoardRoom.freshDoc), because persisted rows already carry the
 * top-level types. The room stamps meta lazily via ensureMeta instead.
 */
export function initDoc(doc: Y.Doc): void {
  doc.getMap(OBJECTS_KEY);
  ensureMeta(doc);
}

/**
 * Sets meta.schemaVersion exactly once (no-op when already present). Called
 * inside the first content transaction so the first persisted update carries
 * meta alongside the content.
 */
export function ensureMeta(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (!meta.has('schemaVersion')) {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }
}

/**
 * Creates a sticky note centred on `at` (world point), on top of everything.
 * Returns the new id, or '' when the coordinates are not finite.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  if (!isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  const text = new Y.Text();
  doc.transact(() => {
    ensureMeta(doc); // first content writes meta.schemaVersion (idempotent)
    const objects = objectsMap(doc);
    const obj = new Y.Map();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', text);
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves a note's top-left to world (x, y). */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raises a note above all others. No-op (false) if it is already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  const objects = objectsMap(doc);
  const z = obj.get('z');
  const top = maxZ(objects);
  if (typeof z === 'number' && z >= top) return false;
  doc.transact(() => {
    obj.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Changes a note's colour. Unknown colour names or stale ids are rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes a note from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  doc.transact(() => {
    objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The Y.Text of a sticky note, or undefined for unknown/non-sticky ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = stickyMap(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Sticky-note views of a set of object snapshots (the sticky subset with
 * colour/text defaults applied). Pure, so tests and the renderer can reuse it.
 */
export function stickyNotes(objects: readonly ObjectSnapshot[]): readonly StickySnapshot[] {
  return objects
    .filter((o): o is ObjectSnapshot & { type: 'sticky' } => o.type === 'sticky')
    .map((o) => ({
      id: o.id,
      type: 'sticky',
      x: o.x,
      y: o.y,
      color: isStickyColor(o.color) ? o.color : DEFAULT_STICKY_COLOR,
      text: typeof o.text === 'string' ? o.text : '',
      z: o.z,
      createdAt: o.createdAt,
      ...(o.width !== undefined ? { width: o.width } : {}),
      ...(o.height !== undefined ? { height: o.height } : {}),
    }));
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so concurrent
 * equal z values still order identically on every client. Unknown object
 * types are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return stickyNotes(objectSnapshot(doc));
}
