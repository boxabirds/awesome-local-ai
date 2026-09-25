import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, PEN_THICKNESS_WORLD, STICKY_COLORS, STICKY_SIZE_WORLD, TEXT_SIZES } from './config';
import type { StickyColor, TextSize, ShapeKind, FillColor, StrokeColor, PenThickness } from './config';

import type { Point } from '../client/canvas/camera';
import { rectContains, isValidRect, type Rect } from './geometry';
import { resolveEndpoints, connectorBBox } from './geometry/connector-geometry';
import type { Endpoint } from './objects/connector';
import { detachConnectorsTo } from './objects/connector';

/**
 * Board document model (story 2).
 *
 * All board content lives in a Yjs `Y.Doc` from day one: stories 3-4 will
 * attach a network provider and persistence to this same document. This
 * module owns the schema and every mutation; it is framework-free so the
 * Durable Object (story 4) can import it for validation and migration.
 *
 * Schema:
 * ```
 * Y.Doc
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map keyed by id; each value is a Y.Map with:
 *     type: 'sticky'
 *     x: number, y: number        // top-left, world units
 *     color: StickyColor
 *     text: Y.Text
 *     z: number                   // stacking; higher is on top
 *     createdAt: number           // epoch ms
 * ```
 *
 * Contract errors (stale id, unknown colour, non-finite coordinates) are
 * rejected with `false` (or `''` for createSticky) before opening a
 * transaction, so they emit no Yjs update and never throw.
 */

/** Transaction origin for all local mutations (story 8 undo / story 3 echo-avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.localOrigin');

/** Immutable view of one sticky note, as rendered by the client. */
export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  /** Set once a group resize (story 7) changes the note's size. */
  width?: number;
  height?: number;
}

/**
 * A generic board object (story 7). `sticky` is the first registered type;
 * `width`/`height` are optional because the sticky default
 * (STICKY_SIZE_WORLD) predates them. Objects of unregistered types keep
 * their raw record in `data` so nothing is lost before their code arrives.
 *
 * Story 9 adds `size` and `widthMode` for text objects.
 */
export interface ObjectSnapshot {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly createdAt: number;
  readonly text?: string;
  readonly color?: string;
  readonly width?: number;
  readonly height?: number;
  /** Text size (story 9): 'S' | 'M' | 'L' | 'XL'. */
  readonly size?: TextSize;
  /** Text width mode (story 9): 'auto' | 'fixed'. */
  readonly widthMode?: 'auto' | 'fixed';
  /** Shape kind (story 10). */
  readonly kind?: ShapeKind;
  /** Shape fill colour (story 10). */
  readonly fill?: FillColor;
  /** Shape stroke colour (story 10). */
  readonly stroke?: StrokeColor;
  /** Shape label text (story 10). */
  readonly label?: string;
  /** Connector from-endpoint (story 10). */
  readonly from?: Endpoint;
  /** Connector to-endpoint (story 10). */
  readonly to?: Endpoint;
  /** Stroke point list (story 11): flattened [x0, y0, ...], relative to the
   *  bbox origin at base size. */
  readonly points?: readonly number[];
  /** Stroke creation-time size (story 11): proportional-resize anchor. */
  readonly baseWidth?: number;
  readonly baseHeight?: number;
  /** Stroke pen thickness name (story 11): 'thin' | 'medium' | 'thick'. */
  readonly thickness?: PenThickness;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** A read-only view of the whole board, sorted for rendering. */
export type Snapshot = readonly ObjectSnapshot[];

/**
 * Object types this build renders and can reason about (selection, marquee,
 * Ctrl+A). Objects of other types remain in the doc untouched, but generic
 * operations skip them (the registry keeps them out of the renderer too).
 */
export const KNOWN_OBJECT_TYPES: readonly string[] = ['sticky', 'text', 'shape', 'connector', 'stroke'];

/** Top-left of an object's world-space bounding box (default sticky size when unset). */
export function objectBounds(o: ObjectSnapshot): Rect {
  return {
    x: o.x,
    y: o.y,
    width: o.width ?? STICKY_SIZE_WORLD,
    height: o.height ?? STICKY_SIZE_WORLD,
  };
}

/** Current schema version (the persisted and wire contract). */
const SCHEMA_VERSION = 1;

const META_KEY = 'meta';
const SCHEMA_VERSION_KEY = 'schemaVersion';
const OBJECTS_KEY = 'objects';

const TYPE_KEY = 'type';
const X_KEY = 'x';
const Y_KEY = 'y';
const COLOR_KEY = 'color';
const TEXT_KEY = 'text';
const Z_KEY = 'z';
const WIDTH_KEY = 'width';
const HEIGHT_KEY = 'height';
const CREATED_AT_KEY = 'createdAt';
const SIZE_KEY = 'size';
const WIDTH_MODE_KEY = 'widthMode';
const CONTENT_KEY = 'content';
const CREATED_BY_KEY = 'createdBy';
const KIND_KEY = 'kind';
const FILL_KEY = 'fill';
const STROKE_KEY = 'stroke';
const LABEL_KEY = 'label';
const FROM_KEY = 'from';
const TO_KEY = 'to';

const STICKY_TYPE = 'sticky';
const TEXT_TYPE = 'text';
const SHAPE_TYPE = 'shape';
const CONNECTOR_TYPE = 'connector';
const STROKE_TYPE = 'stroke';
const POINTS_KEY = 'points';
const BASE_WIDTH_KEY = 'baseWidth';
const BASE_HEIGHT_KEY = 'baseHeight';
const THICKNESS_KEY = 'thickness';

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

function objects(doc: Y.Doc): Y.Map<Y.Map<any>> {
  return doc.getMap(OBJECTS_KEY);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get(Z_KEY);
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/** Ensure the document's meta exists with `schemaVersion` set (once). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (meta.has(SCHEMA_VERSION_KEY)) return;
  doc.transact(() => {
    meta.set(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (top-left is `at - STICKY_SIZE_WORLD/2`),
 * on top of all existing objects. Returns the new id, or `''` when the
 * inputs are invalid (no transaction opened).
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: StickyColor): string {
  const chosen = color ?? DEFAULT_STICKY_COLOR;
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !isStickyColor(chosen)) return '';
  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set(TYPE_KEY, STICKY_TYPE);
  obj.set(X_KEY, at.x - STICKY_SIZE_WORLD / 2);
  obj.set(Y_KEY, at.y - STICKY_SIZE_WORLD / 2);
  obj.set(COLOR_KEY, chosen);
  obj.set(TEXT_KEY, new Y.Text());
  obj.set(Z_KEY, maxZ(doc) + 1);
  obj.set(CREATED_AT_KEY, Date.now());
  doc.transact(() => {
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move a note's top-left to (x, y). Returns false for a stale id or
 * non-finite coordinates (no transaction opened). Story 7: a thin wrapper
 * over the generic moveObjects.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/** True when the object exists in the board doc. */
export function hasObject(doc: Y.Doc, id: string): boolean {
  return objects(doc).get(id) !== undefined;
}

/**
 * Raise a note above every other object. Returns false for a stale id or
 * when the note is already on top (no transaction opened).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc).get(id);
  if (!obj) return false;
  const top = maxZ(doc);
  const current = typeof obj.get(Z_KEY) === 'number' ? (obj.get(Z_KEY) as number) : 0;
  if (current >= top) return false; // already on top: no pointless sync traffic
  doc.transact(() => {
    obj.set(Z_KEY, top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Change a note's colour. Returns false for a stale id or a colour name
 * that is not one of STICKY_COLORS (no transaction opened).
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = objects(doc).get(id);
  if (!obj) return false;
  if (obj.get(COLOR_KEY) === color) return false; // no-op
  doc.transact(() => {
    obj.set(COLOR_KEY, color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note from the board. Returns false for a stale id. Story 7: a thin wrapper over deleteObjects. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

/** The note's Y.Text, if the note exists; undefined for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  if (!obj) return undefined;
  const text = obj.get(TEXT_KEY);
  return text instanceof Y.Text ? text : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Immutable snapshots of every board object (story 7: any registered type),
 * sorted by (z, id) so concurrent equal z values (possible once story 3
 * syncs) give every client the same render order.
 *
 * Optional fields appear only when the object stores them: `width`/`height`
 * (written by the first group resize, Key decision 5), `color`/`text`
 * (sticky). Objects of unknown types keep their generic fields so the
 * renderer can skip them without data loss in the doc.
 */
export function snapshot(doc: Y.Doc): Snapshot {
  const out: ObjectSnapshot[] = [];
  const rects = new Map<string, Rect>();

  // First pass: collect rects for all objects (needed for connector resolution).
  objects(doc).forEach((obj, id) => {
    const x = asNumber(obj.get(X_KEY), 0);
    const y = asNumber(obj.get(Y_KEY), 0);
    const w = obj.get(WIDTH_KEY);
    const h = obj.get(HEIGHT_KEY);
    const width = Number.isFinite(w) ? (w as number) : STICKY_SIZE_WORLD;
    const height = Number.isFinite(h) ? (h as number) : STICKY_SIZE_WORLD;
    rects.set(id, { x, y, width, height });
  });

  objects(doc).forEach((obj, id) => {
    const type = obj.get(TYPE_KEY);
    if (typeof type !== 'string') return;
    const width = obj.get(WIDTH_KEY);
    const height = obj.get(HEIGHT_KEY);
    const color = obj.get(COLOR_KEY);
    const text = obj.get(TEXT_KEY);
    const size = obj.get(SIZE_KEY);
    const widthMode = obj.get(WIDTH_MODE_KEY);
    const content = obj.get(CONTENT_KEY);

    // Compute all fields first (ObjectSnapshot has readonly properties).
    let x = asNumber(obj.get(X_KEY), 0);
    let y = asNumber(obj.get(Y_KEY), 0);
    let w: number | undefined = Number.isFinite(width) ? (width as number) : undefined;
    let h: number | undefined = Number.isFinite(height) ? (height as number) : undefined;
    let textVal: string | undefined = text instanceof Y.Text ? text.toString() : undefined;
    let kind: ShapeKind | undefined;
    let fill: FillColor | undefined;
    let stroke: StrokeColor | undefined;
    let label: string | undefined;
    let from: Endpoint | undefined;
    let to: Endpoint | undefined;

    if (type === TEXT_TYPE && content instanceof Y.Text) {
      textVal = content.toString();
    }

    // Shape-specific fields (story 10).
    if (type === SHAPE_TYPE) {
      const k = obj.get(KIND_KEY);
      const f = obj.get(FILL_KEY);
      const s = obj.get(STROKE_KEY);
      const l = obj.get(LABEL_KEY);
      kind = typeof k === 'string' ? (k as ShapeKind) : undefined;
      fill = typeof f === 'string' ? (f as FillColor) : undefined;
      stroke = typeof s === 'string' ? (s as StrokeColor) : undefined;
      label = l instanceof Y.Text ? l.toString() : '';
    }

    // Stroke-specific fields (story 11): flattened point list, base size and
    // pen thickness. Malformed records yield undefined fields (the renderer
    // skips them) while the raw record stays intact in the doc.
    let strokePoints: readonly number[] | undefined;
    let baseWidthVal: number | undefined;
    let baseHeightVal: number | undefined;
    let thicknessVal: PenThickness | undefined;
    if (type === STROKE_TYPE) {
      const pv = obj.get(POINTS_KEY);
      if (Array.isArray(pv) && pv.length > 0 && pv.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        strokePoints = pv as number[];
      }
      const bw = obj.get(BASE_WIDTH_KEY);
      if (typeof bw === 'number' && Number.isFinite(bw)) baseWidthVal = bw;
      const bh = obj.get(BASE_HEIGHT_KEY);
      if (typeof bh === 'number' && Number.isFinite(bh)) baseHeightVal = bh;
      const th = obj.get(THICKNESS_KEY);
      if (typeof th === 'string' && th in PEN_THICKNESS_WORLD) thicknessVal = th as PenThickness;
    }

    // Connector-specific fields (story 10): resolve endpoints and derive bbox.
    if (type === CONNECTOR_TYPE) {
      const fv = obj.get(FROM_KEY);
      const tv = obj.get(TO_KEY);
      if (fv && tv) {
        const fromEp = readEndpointValue(fv);
        const toEp = readEndpointValue(tv);
        if (fromEp && toEp) {
          from = fromEp;
          to = toEp;
          const resolved = resolveEndpoints({ from: fromEp, to: toEp }, rects);
          const bbox = connectorBBox(resolved.from, resolved.to);
          x = bbox.x;
          y = bbox.y;
          w = bbox.width;
          h = bbox.height;
        }
      }
    }

    out.push({
      id,
      type,
      x,
      y,
      z: asNumber(obj.get(Z_KEY), 0),
      createdAt: asNumber(obj.get(CREATED_AT_KEY), 0),
      width: w,
      height: h,
      color: typeof color === 'string' ? color : undefined,
      text: textVal,
      size: typeof size === 'string' && size in TEXT_SIZES ? (size as TextSize) : undefined,
      widthMode: widthMode === 'auto' || widthMode === 'fixed' ? widthMode : undefined,
      ...(strokePoints !== undefined ? { points: strokePoints } : {}),
      ...(baseWidthVal !== undefined ? { baseWidth: baseWidthVal } : {}),
      ...(baseHeightVal !== undefined ? { baseHeight: baseHeightVal } : {}),
      ...(thicknessVal !== undefined ? { thickness: thicknessVal } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(fill !== undefined ? { fill } : {}),
      ...(stroke !== undefined ? { stroke } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    });
  });
  // (z, id) gives every client the same order even with concurrent equal z values.
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Read an endpoint from a Y.Map embedded value. */
function readEndpointValue(value: unknown): Endpoint | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.kind === 'free' && typeof v.x === 'number' && typeof v.y === 'number') {
    return { kind: 'free', x: v.x, y: v.y };
  }
  if (v.kind === 'attached' && typeof v.objectId === 'string') {
    const fb = v.fallback as Point | undefined;
    if (fb && typeof fb.x === 'number' && typeof fb.y === 'number') {
      return { kind: 'attached', objectId: v.objectId, fallback: fb };
    }
    return null;
  }
  return null;
}

// --- Generic group operations (story 7) -------------------------------------

/**
 * Move several objects' top-left corners. Stale ids and non-finite positions
 * are skipped. Returns the number of objects actually moved (0 = no
 * transaction opened, so no update is emitted).
 */
export function moveObjects(doc: Y.Doc, positions: Map<string, Point>): number {
  const map = objects(doc);
  const entries: Array<[Y.Map<any>, number, number]> = [];
  positions.forEach((p, id) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const obj = map.get(id);
    if (!obj) return;
    entries.push([obj, p.x, p.y]);
  });
  if (entries.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, x, y] of entries) {
      obj.set(X_KEY, x);
      obj.set(Y_KEY, y);
    }
  }, LOCAL_ORIGIN);
  return entries.length;
}

/**
 * Place several objects at explicit world-space rects. Stale ids and
 * non-finite rects are skipped. Returns the number of objects actually
 * changed (0 = no transaction opened, so no update is emitted).
 */
export function resizeObjects(doc: Y.Doc, rects: Map<string, Rect>): number {
  const map = objects(doc);
  const entries: Array<[Y.Map<any>, Rect]> = [];
  rects.forEach((r, id) => {
    if (!isValidRect(r)) return;
    const obj = map.get(id);
    if (!obj) return;
    entries.push([obj, r]);
  });
  if (entries.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, r] of entries) {
      obj.set(X_KEY, r.x);
      obj.set(Y_KEY, r.y);
      obj.set(WIDTH_KEY, r.width);
      obj.set(HEIGHT_KEY, r.height);
    }
  }, LOCAL_ORIGIN);
  return entries.length;
}

/**
 * Raise the given ids above every other object, in the given order (the last
 * id ends on top). Stale ids are skipped. Returns the number raised
 * (0 = no transaction opened).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const live = ids.filter((id) => objects(doc).get(id) !== undefined);
  if (live.length === 0) return 0;
  const top = maxZ(doc);
  doc.transact(() => {
    live.forEach((id, i) => {
      objects(doc).get(id)!.set(Z_KEY, top + i + 1);
    });
  }, LOCAL_ORIGIN);
  return live.length;
}

/**
 * Delete several objects in one transaction. Stale ids are skipped. Returns
 * the number actually deleted (0 = no transaction opened).
 *
 * Story 10: connector ends attached to deleted objects are detached (set to
 * free at the current anchor) inside the same transaction, so the whole
 * operation is one undo step.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const map = objects(doc);
  const live = ids.filter((id) => map.get(id) !== undefined);
  if (live.length === 0) return 0;
  doc.transact(() => {
    // Detach connector ends attached to the deleted objects BEFORE removing
    // them, so the rects are still available for anchor computation.
    detachConnectorsTo(doc, live);
    for (const id of live) map.delete(id);
  }, LOCAL_ORIGIN);
  return live.length;
}

// --- Selection queries over a snapshot (story 7) ----------------------------

/** The ids of every known object in the snapshot (Ctrl+A). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  const out: string[] = [];
  for (const o of snapshot) {
    if (KNOWN_OBJECT_TYPES.includes(o.type)) out.push(o.id);
  }
  return out;
}

/** Ids of known objects whose bounds lie fully inside `rect` (marquee). */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const out: string[] = [];
  for (const o of snapshot) {
    if (!KNOWN_OBJECT_TYPES.includes(o.type)) continue;
    if (rectContains(rect, objectBounds(o))) out.push(o.id);
  }
  return out;
}
