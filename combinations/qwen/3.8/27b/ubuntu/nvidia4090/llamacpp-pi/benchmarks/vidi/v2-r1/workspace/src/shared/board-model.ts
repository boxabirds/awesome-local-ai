// Board document model (story 2, board.model contract).
//
// All board content lives in a Y.Doc from day one so that story 3 only
// attaches a network provider and story 4 only persists the same document.
// This module is framework-free: the Durable Object (story 4) imports it for
// validation/migration.
//
// Document schema (the future persisted and wire contract):
//   Y.Doc
//     meta: Y.Map { schemaVersion: 1 }
//     objects: Y.Map<string /* id */, Y.Map>
//       <id>: Y.Map {
//         type: 'sticky'
//         x: number, y: number     // top-left, world units
//         color: StickyColor
//         text: Y.Text
//         z: number                // stacking; higher is on top
//         createdAt: number        // epoch ms
//       }

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  PEN_THICKNESS_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_STROKE_COLORS,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  TEXT_SIZES,
  type FillColor,
  type ShapeKind,
  type StickyColor,
  type StrokeColor,
} from './config';
import type { PenThickness } from './objects/stroke';
import { rectContains, type Point, type Rect } from './geometry';
import { connectorBBox, resolveEndpoints } from './geometry/connector-geometry';
import {
  detachConnectorsTo,
  endpointToMap,
  parseEndpoint,
  type Endpoint,
} from './objects/connector';

/** Transaction origin for all local mutations (used by story 8 undo and
 *  by story 3 to avoid echo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.localOrigin');

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

/**
 * Generic snapshot of one board object of a known type (story 7).
 *
 * `width`/`height` are persisted fields written by the first group resize;
 * objects created before story 7 (or by other tools) omit them, and readers
 * fall back to the type's default size (STICKY_SIZE_WORLD for stickies — see
 * `objectBounds`).
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  /** Top-left, world units. */
  x: number;
  y: number;
  /** Stacking; higher is on top. */
  z: number;
  width?: number;
  height?: number;
  color?: string;
  /** Size preset (story 9 text objects only). */
  size?: string;
  /** 'auto' | 'fixed' (story 9 text objects only). */
  widthMode?: 'auto' | 'fixed';
  /** Story 10: shape-specific fields (present on type 'shape' objects). */
  kind?: ShapeKind;
  fill?: FillColor;
  stroke?: StrokeColor;
  /** The shape's label text (same value as `text`). */
  label?: string;
  /**
   * Story 10: connector endpoints (present on type 'connector' objects).
   * `x`/`y`/`width`/`height` of a connector snapshot are the bounding box
   * of the RESOLVED endpoints (derived, never persisted).
   */
  from?: Endpoint;
  to?: Endpoint;
  /** The resolved endpoint points (derived with `from`/`to`). */
  fromPoint?: Point;
  toPoint?: Point;
  /**
   * Story 11: stroke-specific fields (present on type 'stroke' objects).
   */
  /** Flattened [x0, y0, x1, y1, ...] relative to the bbox origin. */
  points?: readonly number[];
  /** Bbox size at creation (render scale = width/baseWidth etc.). */
  baseWidth?: number;
  baseHeight?: number;
  /** thin | medium | thick */
  thickness?: PenThickness;
  /**
   * Story 12: image-specific fields (present on type 'image' objects).
   */
  /** R2 key '<boardId>/<assetId>'; null until the upload completes. */
  assetKey?: string | null;
  /** Sniffed image MIME type. */
  contentType?: string;
  /** Decoded natural size in pixels. */
  naturalWidth?: number;
  naturalHeight?: number;
  /** 'uploading' | 'ready' | 'failed' (as stored, never 'unfinished'). */
  status?: 'uploading' | 'ready' | 'failed';
  /** Epoch ms when the current upload attempt started. */
  uploadStartedAt?: number;
  /** The client id that started the upload. */
  uploaderId?: string;
  text: string;
  createdAt?: number;
}

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const SCHEMA_VERSION = 1;
const STICKY_TYPE = 'sticky';

/**
 * Object types this client can render and operate on (story 7 registry).
 * Seeded with the story 2 type; the client-side registry adds more at import
 * time. Unknown types stay in the document but are invisible to selection,
 * rendering and group operations (forward compatibility for stories 9–12).
 */
const knownObjectTypes: Set<string> = new Set([STICKY_TYPE]);

/** Register an object type as known (called by the client registry). */
export function registerKnownObjectType(type: string): void {
  knownObjectTypes.add(type);
}

export function isKnownObjectType(type: string): boolean {
  return knownObjectTypes.has(type);
}

export function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY);
}

/** The raw object map of `id` (any type), or undefined. */
export function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objects(doc).get(id);
}

/** One above the highest z of any object (new objects go on top). */
export function nextZAboveAll(doc: Y.Doc): number {
  let maxZ = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  return maxZ + 1;
}

function isStickyColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && color in STICKY_COLORS;
}

function isValidCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Set `meta.schemaVersion` if absent. Idempotent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (top-left = at − STICKY_SIZE_WORLD/2),
 * on top of all other notes (z = maxZ + 1). Returns the new id, or `null` for
 * non-finite coordinates (no transaction in that case).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | null {
  if (!isValidCoord(at.x) || !isValidCoord(at.y)) return null;

  const map = objects(doc);
  let maxZ = 0;
  map.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const id = randomId();
  const text = new Y.Text();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', STICKY_TYPE);
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', text);
    obj.set('z', maxZ + 1);
    obj.set('createdAt', Date.now());
    map.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move an object's top-left to world (x, y). False for stale ids or
 *  non-finite coordinates (no transaction). Thin wrapper over `moveObjects`. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/**
 * Raise `id` above every other object. False when the note is already
 * topmost (or the id is stale) — a pointless update (no transaction).
 * Thin wrapper over `bringObjectsToFront`.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Change a note's colour. Unknown colours and stale ids return false with
 *  no transaction. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = objects(doc).get(id);
  if (!obj) return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. False for stale ids (no transaction).
 *  Thin wrapper over `deleteObjects`. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** The Y.Text of a sticky note, if it exists. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so that every
 * client renders the same stacking order (equal-z ties, possible once
 * story 3 syncs, break by id). Unknown object types are skipped (forward
 * compatibility for later stories).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    if (obj.get('type') !== STICKY_TYPE) return;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    const color = obj.get('color');
    const createdAt = obj.get('createdAt');
    if (!isValidCoord(x) || !isValidCoord(y)) return;
    if (!isStickyColor(color)) return;
    if (typeof z !== 'number' || typeof createdAt !== 'number') return;
    const text = obj.get('text');
    out.push(
      Object.freeze({
        id,
        type: 'sticky' as const,
        x,
        y,
        color,
        text: text instanceof Y.Text ? text.toString() : '',
        z,
        createdAt,
      }),
    );
  });
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(out);
}

/**
 * Immutable snapshot of every object of a *known* type, sorted by (z, id)
 * (story 7). Unknown types are skipped, so remote objects from later stories
 * can never break selection, rendering or group operations. Well-formedness:
 * finite x/y/z; width/height/color/createdAt are read only when present and
 * finite, so pre-story-7 stickies keep working without them.
 */
export function objectsSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const pending: { snap: ObjectSnapshot; connector: boolean }[] = [];
  objects(doc).forEach((obj, id) => {
    const type = obj.get('type');
    if (typeof type !== 'string' || !knownObjectTypes.has(type)) return;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    if (!isValidCoord(x) || !isValidCoord(y) || !isValidCoord(z)) return;
    const width = obj.get('width');
    const height = obj.get('height');
    const color = obj.get('color');
    const createdAt = obj.get('createdAt');
    const snap: ObjectSnapshot = {
      id,
      type,
      x,
      y,
      z,
      text: obj.get('text') instanceof Y.Text ? (obj.get('text') as Y.Text).toString() : '',
    };
    if (isValidCoord(width)) snap.width = width;
    if (isValidCoord(height)) snap.height = height;
    if (typeof color === 'string') snap.color = color;
    if (typeof createdAt === 'number') snap.createdAt = createdAt;
    // Story 9: text-specific fields, read generically when present and
    // well-formed (readers fall back to defaults otherwise).
    const size = obj.get('size');
    if (typeof size === 'string' && size in TEXT_SIZES) snap.size = size;
    const widthMode = obj.get('widthMode');
    if (widthMode === 'auto' || widthMode === 'fixed') snap.widthMode = widthMode;
    // Story 10: shape-specific fields; malformed shapes are skipped entirely.
    if (type === 'shape') {
      const kind = obj.get('kind');
      const fill = obj.get('fill');
      const stroke = obj.get('stroke');
      const label = obj.get('label');
      if (
        snap.width === undefined ||
        snap.height === undefined ||
        typeof kind !== 'string' ||
        !(SHAPE_KINDS as readonly string[]).includes(kind) ||
        typeof fill !== 'string' ||
        !(fill in SHAPE_FILL_COLORS) ||
        typeof stroke !== 'string' ||
        !(stroke in SHAPE_STROKE_COLORS) ||
        !(label instanceof Y.Text)
      ) {
        return;
      }
      snap.kind = kind as ShapeKind;
      snap.fill = fill as FillColor;
      snap.stroke = stroke as StrokeColor;
      const labelText = label.toString();
      snap.text = labelText;
      snap.label = labelText;
    } else if (type === 'stroke') {
      // Story 11: a stroke's points are stored relative to the bbox origin;
      // malformed strokes (bad points/base sizes/thickness) are skipped
      // entirely, like malformed shapes.
      const pts = obj.get('points');
      const bw = obj.get('baseWidth');
      const bh = obj.get('baseHeight');
      const thick = obj.get('thickness');
      if (
        snap.width === undefined ||
        snap.height === undefined ||
        !Array.isArray(pts) ||
        pts.length < 2 ||
        pts.length % 2 !== 0 ||
        !pts.every((v) => typeof v === 'number' && Number.isFinite(v)) ||
        !isValidCoord(bw) ||
        !isValidCoord(bh) ||
        !(typeof thick === 'string' && thick in PEN_THICKNESS_WORLD)
      ) {
        return;
      }
      snap.points = pts as number[];
      snap.baseWidth = bw;
      snap.baseHeight = bh;
      snap.thickness = thick as PenThickness;
    } else if (type === 'connector') {
      const from = parseEndpoint(obj.get('from'));
      const to = parseEndpoint(obj.get('to'));
      if (!from || !to) return; // malformed connector: invisible
      snap.from = from;
      snap.to = to;
      pending.push({ snap, connector: true });
      return; // bbox derived in the second pass
    } else if (type === 'image') {
      // Story 12: image-specific fields; malformed images are skipped
      // entirely, like malformed shapes and strokes.
      const assetKey = obj.get('assetKey');
      const contentType = obj.get('contentType');
      const naturalWidth = obj.get('naturalWidth');
      const naturalHeight = obj.get('naturalHeight');
      const status = obj.get('status');
      const uploadStartedAt = obj.get('uploadStartedAt');
      const uploaderId = obj.get('uploaderId');
      if (
        snap.width === undefined ||
        snap.height === undefined ||
        (assetKey !== null && typeof assetKey !== 'string') ||
        typeof contentType !== 'string' ||
        typeof naturalWidth !== 'number' || !Number.isFinite(naturalWidth) ||
        typeof naturalHeight !== 'number' || !Number.isFinite(naturalHeight) ||
        (status !== 'uploading' && status !== 'ready' && status !== 'failed') ||
        typeof uploadStartedAt !== 'number' || !Number.isFinite(uploadStartedAt) ||
        typeof uploaderId !== 'string'
      ) {
        return;
      }
      snap.assetKey = assetKey;
      snap.contentType = contentType;
      snap.naturalWidth = naturalWidth;
      snap.naturalHeight = naturalHeight;
      snap.status = status;
      snap.uploadStartedAt = uploadStartedAt;
      snap.uploaderId = uploaderId;
    }
    pending.push({ snap, connector: false });
  });
  // Second pass: a connector's bounds are the bounding box of its RESOLVED
  // endpoints, which need the boxes of every other object (attached
  // endpoints follow their target's live bounds).
  if (pending.some((p) => p.connector)) {
    const rects = new Map<string, Rect>();
    for (const { snap } of pending) rects.set(snap.id, objectBounds(snap));
    for (const { snap } of pending) {
      if (snap.type !== 'connector' || !snap.from || !snap.to) continue;
      const pts = resolveEndpoints({ from: snap.from, to: snap.to }, rects);
      const bb = connectorBBox(pts.from, pts.to);
      snap.x = bb.x;
      snap.y = bb.y;
      snap.width = bb.width;
      snap.height = bb.height;
      // The resolved points back the zoom-aware line hit test (connector.
      // select) and are rendered by the object.
      snap.fromPoint = pts.from;
      snap.toPoint = pts.to;
    }
  }
  const out = pending.map((p) => p.snap);
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(out.map((s) => Object.freeze(s)));
}

/**
 * Bounds of one object in world units. Objects without persisted width and
 * height use the default sticky size (story 7: "width/height read with a
 * STICKY_SIZE_WORLD fallback").
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/** Ids of every object in the snapshot (all known, well-formed objects). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

/**
 * Ids of the objects whose bounds lie *fully* inside `rect` (the marquee's
 * containment rule): an object only partly inside, or merely touching the
 * rectangle from outside, is not selected.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snapshot
    .filter((obj) => rectContains(rect, objectBounds(obj)))
    .map((obj) => obj.id);
}

/**
 * Move many objects' top-left corners in one LOCAL_ORIGIN transaction.
 * Missing ids are skipped; any non-finite coordinate refuses the whole call
 * (0 applied, no transaction). Returns the number of objects changed.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!isValidCoord(p.x) || !isValidCoord(p.y)) return 0;
  }
  const map = objects(doc);
  let changed = 0;
  doc.transact(() => {
    positions.forEach((p, id) => {
      const obj = map.get(id);
      if (!obj) return; // missing (deleted remotely) → skipped
      // Connectors store no box of their own: both endpoints are translated
      // by the pointer delta relative to the arrow's current bbox, so an
      // arrow moves exactly like any other object.
      if (obj.get('type') === 'connector') {
        if (moveConnector(doc, obj, p)) changed += 1;
        return;
      }
      if (obj.get('x') === p.x && obj.get('y') === p.y) return;
      obj.set('x', p.x);
      obj.set('y', p.y);
      changed += 1;
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Resize and reposition many objects in one LOCAL_ORIGIN transaction, writing
 * explicit `width`/`height` (the first resize materialises both fields).
 * Missing ids are skipped; any non-finite value refuses the whole call
 * (0 applied, no transaction). Returns the number of objects changed.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (
      !isValidCoord(r.x) ||
      !isValidCoord(r.y) ||
      !isValidCoord(r.width) ||
      !isValidCoord(r.height)
    ) {
      return 0;
    }
  }
  const map = objects(doc);
  let changed = 0;
  doc.transact(() => {
    rects.forEach((r, id) => {
      const obj = map.get(id);
      if (!obj) return; // missing (deleted remotely) → skipped
      // A connector's "resize" is a translation (arrows have no scale):
      // both endpoints move by the delta of the arrow's current bbox.
      if (obj.get('type') === 'connector') {
        if (moveConnector(doc, obj, { x: r.x, y: r.y })) changed += 1;
        return;
      }
      if (
        obj.get('x') === r.x &&
        obj.get('y') === r.y &&
        obj.get('width') === r.width &&
        obj.get('height') === r.height
      ) {
        return;
      }
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
      changed += 1;
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Raise every id in `ids` above all unselected objects in one transaction,
 * preserving the selected objects' relative stacking order (they are ranked
 * by their current (z, id) order and re-assigned z = maxUnselectedZ + rank,
 * but never lowered). Returns the number of objects whose z changed (0 when
 * the selection is already topmost).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const map = objects(doc);
  const selected: { id: string; z: number }[] = [];
  let maxUnselectedZ = 0;
  map.forEach((obj, id) => {
    const rawZ = obj.get('z');
    const z = typeof rawZ === 'number' && Number.isFinite(rawZ) ? rawZ : 0;
    if (ids.includes(id)) {
      selected.push({ id, z });
    } else if (z > maxUnselectedZ) {
      maxUnselectedZ = z;
    }
  });
  if (selected.length === 0) return 0;
  selected.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const targets = new Map<string, number>();
  let changed = 0;
  selected.forEach((s, i) => {
    const target = maxUnselectedZ + i + 1;
    if (target > s.z) {
      targets.set(s.id, target);
      changed += 1;
    }
  });
  if (changed === 0) return 0;
  doc.transact(() => {
    targets.forEach((z, id) => {
      const obj = map.get(id);
      if (obj) obj.set('z', z);
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Delete every existing id in `ids` in one LOCAL_ORIGIN transaction.
 * Missing ids are skipped. Returns the number of objects deleted.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const map = objects(doc);
  const existing = ids.filter((id) => map.has(id));
  if (existing.length === 0) return 0;
  doc.transact(() => {
    // Re-home connectors pointing at the deleted objects FIRST (same
    // transaction): the endpoint becomes a free point at the object's
    // current anchor, so arrows neither dangle nor vanish (connector.
    // delete_rehome).
    detachConnectorsTo(doc, existing);
    for (const id of existing) map.delete(id);
  }, LOCAL_ORIGIN);
  return existing.length;
}

function randomId(): string {
  // Ids are crypto.randomUUID(); the fallback keeps non-secure contexts working.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Public id generator (the shape/connector models create their own ids). */
export function newObjectId(): string {
  return randomId();
}

/**
 * World-unit rects of every non-connector object with a readable position
 * (width/height fall back to STICKY_SIZE_WORLD, as in `objectBounds`).
 * Connectors are skipped: an endpoint attached to an arrow uses its stored
 * fallback. Malformed objects are skipped too.
 */
export function objectRectsMap(doc: Y.Doc): ReadonlyMap<string, Rect> {
  const rects = new Map<string, Rect>();
  objects(doc).forEach((obj, id) => {
    if (obj.get('type') === 'connector') return;
    const x = obj.get('x');
    const y = obj.get('y');
    if (!isValidCoord(x) || !isValidCoord(y)) return;
    const width = obj.get('width');
    const height = obj.get('height');
    rects.set(id, {
      x: x as number,
      y: y as number,
      width: isValidCoord(width) ? (width as number) : STICKY_SIZE_WORLD,
      height: isValidCoord(height) ? (height as number) : STICKY_SIZE_WORLD,
    });
  });
  return rects;
}

/** Translate an endpoint by (dx, dy), keeping its kind/attachment. */
function translateEndpoint(e: Endpoint, dx: number, dy: number): Endpoint {
  return e.kind === 'free'
    ? { kind: 'free', x: e.x + dx, y: e.y + dy }
    : {
        kind: 'attached',
        objectId: e.objectId,
        fallback: { x: e.fallback.x + dx, y: e.fallback.y + dy },
      };
}

/**
 * A connector's current bounding box from its stored endpoints (0x0 when
 * malformed). Moving/resizing a connector translates both endpoints by the
 * pointer delta relative to this box.
 */
function connectorBBoxOf(doc: Y.Doc, obj: Y.Map<unknown>): Rect {
  const from = parseEndpoint(obj.get('from'));
  const to = parseEndpoint(obj.get('to'));
  if (!from || !to) return { x: 0, y: 0, width: 0, height: 0 };
  const pts = resolveEndpoints({ from, to }, objectRectsMap(doc));
  return connectorBBox(pts.from, pts.to);
}

function moveConnector(doc: Y.Doc, obj: Y.Map<unknown>, target: Point): boolean {
  const from = parseEndpoint(obj.get('from'));
  const to = parseEndpoint(obj.get('to'));
  if (!from || !to) return false;
  const bb = connectorBBoxOf(doc, obj);
  const dx = target.x - bb.x;
  const dy = target.y - bb.y;
  if (dx === 0 && dy === 0) return false;
  obj.set('from', endpointToMap(translateEndpoint(from, dx, dy)));
  obj.set('to', endpointToMap(translateEndpoint(to, dx, dy)));
  return true;
}
