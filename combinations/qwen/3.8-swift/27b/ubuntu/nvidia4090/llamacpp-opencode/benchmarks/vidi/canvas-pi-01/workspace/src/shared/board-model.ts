// Board document model (see spec: board.model, sel.geometry_ops).
//
// All board objects live in a Yjs Y.Doc:
//   meta: Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map>
//     <id>: { type, x, y, color, text: Y.Text, z, createdAt, width?, height? }
//
// Framework-free: this module owns the schema and every mutation so the same
// code can later run in the Durable Object (story 4) and validate/migrate
// documents. Story 3 attaches a network provider; story 4 persists the same
// document. Every successful mutation is exactly one doc.transact(_, LOCAL_ORIGIN);
// rejections return 0/false before opening a transaction.
//
// Story 7: objects become type-agnostic (ObjectSnapshot). Group operations
// (moveObjects, resizeObjects, bringObjectsToFront, deleteObjects, objectsInRect,
// allObjectIds) implement the generic multi-select behaviour; the story 2
// single-object functions are thin wrappers over them. Sticky notes without
// width/height render at STICKY_SIZE_WORLD; the first resize writes both
// fields (additive, no migration).

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_STROKE_COLORS,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  TEXT_SIZES,
  type StickyColor,
  type TextSize,
} from './config';
import type { Point, Rect } from './geometry';
import type { FillColor, ShapeKind, StrokeColor } from './objects/shape';
import type { PenColor, PenThickness } from './objects/stroke';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from './config';
import {
  connectorBBox,
  parseEndpoint,
  resolveEndpoints,
  type Endpoint,
} from './geometry/connector-geometry';
import { detachConnectorsTo } from './objects/connector';

/** Transaction origin for all local mutations (story 8 undo, story 3 echo filter). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Immutable, renderable view of one board object of a registered type. */
export interface ObjectSnapshot {
  id: string;
  /** Object type name (e.g. 'sticky'); the renderer looks it up in the registry. */
  type: string;
  /** Top-left of the object in world units. */
  x: number;
  y: number;
  /** Explicit size (world units); absent for stickies created before story 7. */
  width?: number;
  height?: number;
  /** Sticky notes (sticky colour name) and strokes (pen colour name). */
  color?: StickyColor | PenColor;
  text?: string;
  /** Stroke objects only (story 11): flattened [x0, y0, ...] relative to
   *  (x, y), at the base size. */
  points?: readonly number[];
  /** Stroke objects only (story 11): bbox size at creation. */
  baseWidth?: number;
  baseHeight?: number;
  /** Stroke objects only (story 11): thickness preset key. */
  thickness?: PenThickness;
  /** Text objects only (story 9): size preset key. */
  size?: TextSize;
  /** Text objects only (story 9): auto or fixed width mode. */
  widthMode?: 'auto' | 'fixed';
  /** Shape objects only (story 10). */
  kind?: ShapeKind;
  fill?: FillColor;
  stroke?: StrokeColor;
  label?: string;
  /** Connector objects only (story 10); x/y/width/height are the derived bbox. */
  from?: Endpoint;
  to?: Endpoint;
  /** Stacking order; higher is on top. */
  z: number;
  /** Epoch ms. */
  createdAt: number;
}

/** A sticky note object (ObjectSnapshot with the sticky fields present). */
export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

const META = 'meta';
const OBJECTS = 'objects';
const SCHEMA_VERSION = 1;

// ---- registered type names ---------------------------------------------
// The client object registry (src/client/objects/registry.tsx) calls
// registerObjectTypeName when a type is registered; board-model only needs
// the names (which objects snapshot(), which ids are selectable) while the
// client registry owns the components and resize rules.

// 'shape' and 'connector' are known to the document model without the
// client registry loading (worker, unit tests); the client registry's
// registerObjectType re-asserts them (idempotent). 'connector' cannot call
// registerObjectTypeName from its own module top level: board-model imports
// connector.ts (detachConnectorsTo) and connector.ts imports board-model, so
// its module body must not touch this set during that circular evaluation.
const knownTypes = new Set<string>(['sticky', 'shape', 'connector', 'stroke']);

/** Mark a type name as known to the document model (idempotent). */
export function registerObjectTypeName(type: string): void {
  knownTypes.add(type);
}

/** True for object types the model knows (registered by the client). */
export function isKnownObjectType(type: string): boolean {
  return knownTypes.has(type);
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS);
}

/** Set meta.schemaVersion if absent (never overwrites an existing value). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META);
  if (meta.get('schemaVersion') === undefined) {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

/** Highest z among all objects (0 when the board is empty). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const object of objects(doc).values()) {
    const z = object.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

/** Create a sticky (default colour) centred on `at`; returns the new id. */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  const id = crypto.randomUUID();
  doc.transact(() => {
    const object = new Y.Map();
    object.set('type', 'sticky');
    object.set('x', at.x - STICKY_SIZE_WORLD / 2);
    object.set('y', at.y - STICKY_SIZE_WORLD / 2);
    object.set('color', color);
    object.set('text', new Y.Text());
    object.set('z', maxZ(doc) + 1);
    object.set('createdAt', Date.now());
    objects(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

// ---- generic group operations (story 7) ----------------------------------

/**
 * The object's bounds in world units. Stickies created before story 7 have no
 * width/height and use STICKY_SIZE_WORLD (key decision 5: width/height are
 * additive; the first resize writes both fields).
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
 * Ids of objects lying entirely inside `rect` (the marquee rule: touching the
 * edge does not count as inside). Unknown types are never selectable.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snapshot
    .filter((o) => isKnownObjectType(o.type) && rectContainsRect(rect, objectBounds(o)))
    .map((o) => o.id);
}

/** Ids of every known object on the board (select-all). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.filter((o) => isKnownObjectType(o.type)).map((o) => o.id);
}

function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function finitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function finiteRect(r: Rect): boolean {
  return [r.x, r.y, r.width, r.height].every(Number.isFinite);
}

/**
 * Move objects to absolute top-left positions (world units). Used by the drag
 * gesture (absolute writes from gesture start) and by arrow-key nudging.
 * Returns the number of objects moved; skips missing ids; rejects the whole
 * call (0, no transaction) on any non-finite value or empty input.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!finitePoint(p)) return 0;
  }
  const valid: { object: Y.Map<unknown>; p: Point }[] = [];
  for (const [id, p] of positions) {
    const object = objects(doc).get(id);
    if (object === undefined) continue; // deleted remotely: skipped
    valid.push({ object, p });
  }
  if (valid.length === 0) return 0;
  doc.transact(() => {
    for (const { object, p } of valid) {
      object.set('x', p.x);
      object.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return valid.length;
}

/**
 * Resize objects to absolute world-unit rects, writing x, y, width and height
 * (turns implicit-size stickies explicit). Same validation rules as
 * moveObjects; returns the number of objects resized.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (!finiteRect(r)) return 0;
  }
  const valid: { object: Y.Map<unknown>; r: Rect }[] = [];
  for (const [id, r] of rects) {
    const object = objects(doc).get(id);
    if (object === undefined) continue;
    valid.push({ object, r });
  }
  if (valid.length === 0) return 0;
  doc.transact(() => {
    for (const { object, r } of valid) {
      object.set('x', r.x);
      object.set('y', r.y);
      object.set('width', r.width);
      object.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return valid.length;
}

/**
 * Raise every given object above all unselected objects while preserving the
 * relative stacking order among the selected ones (z = maxUnselectedZ + rank,
 * rank by current z, ties by id). Returns the number of objects re-assigned;
 * 0 (no transaction) when the order already satisfies the rule or all ids are
 * missing.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const idSet = new Set(ids);
  const map = objects(doc);
  const selected: { id: string; object: Y.Map<unknown>; z: number }[] = [];
  for (const id of ids) {
    const object = map.get(id);
    if (object === undefined) continue; // missing ids skipped
    const z = object.get('z');
    if (typeof z !== 'number') continue;
    selected.push({ id, object, z });
  }
  if (selected.length === 0) return 0;
  selected.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : 1) : a.z - b.z));
  let maxUnselected = 0;
  for (const [id, object] of map) {
    if (idSet.has(id)) continue;
    const z = object.get('z');
    if (typeof z === 'number' && z > maxUnselected) maxUnselected = z;
  }
  let changed = 0;
  for (let i = 0; i < selected.length; i += 1) {
    if (selected[i]!.z !== maxUnselected + i + 1) changed += 1;
  }
  if (changed === 0) return 0;
  doc.transact(() => {
    selected.forEach(({ object }, i) => {
      object.set('z', maxUnselected + i + 1);
    });
  }, LOCAL_ORIGIN);
  return selected.length;
}

/**
 * Remove the given objects. Returns the number removed; skips missing ids;
 * 0 (no transaction) when nothing is removed.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const existing = ids.filter((id) => objects(doc).get(id) !== undefined);
  if (existing.length === 0) return 0;
  doc.transact(() => {
    // Connector ends attached to deleted objects stay as arrows: each is
    // fixed free at its current anchor (connector.target_deleted), in this
    // same transaction (one update, one undo step).
    detachConnectorsTo(doc, existing);
    for (const id of existing) {
      objects(doc).delete(id);
    }
  }, LOCAL_ORIGIN);
  return existing.length;
}

// ---- story 2 single-object wrappers ---------------------------------------

/** Move a note's top-left to world (x, y). False when unknown id or non-finite input. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/** Raise a note above all others (z = maxZ + 1). False when unknown or already top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Remove a note. False when the id is unknown. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** Change a note's colour by name. False for unknown colours or ids. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const object = objects(doc).get(id);
  if (object === undefined || !isStickyColor(color)) return false;
  doc.transact(() => {
    object.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's editable Y.Text, if the note exists. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = objects(doc).get(id);
  if (object === undefined) return undefined;
  const text = object.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function isFiniteNumberArray(value: unknown): value is readonly number[] {
  if (!Array.isArray(value)) return false;
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  return true;
}

function isValidObject(
  x: unknown,
  y: unknown,
  z: unknown,
  createdAt: unknown,
  width: unknown,
  height: unknown,
): boolean {
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof createdAt !== 'number') return false;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (width !== undefined && (typeof width !== 'number' || !Number.isFinite(width) || width <= 0)) return false;
  if (height !== undefined && (typeof height !== 'number' || !Number.isFinite(height) || height <= 0)) return false;
  return true;
}

/**
 * All known board objects, sorted by (z, id) — equal z (possible once story 3
 * syncs concurrent edits) breaks ties by id so every client renders the same
 * order. Objects of unknown `type` are skipped (forward compatibility,
 * stories 9-12; they never reach the renderer or the selection).
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  const connectorEntries: { id: string; object: Y.Map<unknown>; z: number; createdAt: number }[] = [];
  for (const [id, object] of objects(doc)) {
    const type = object.get('type');
    const x = object.get('x');
    const y = object.get('y');
    const z = object.get('z');
    const createdAt = object.get('createdAt');
    const width = object.get('width');
    const height = object.get('height');
    if (typeof type !== 'string' || !isKnownObjectType(type)) continue;
    if (type === 'connector') {
      // x/y/width/height are derived below from the live object rects;
      // the stored values (0) need no size validation.
      if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof createdAt !== 'number') continue;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      connectorEntries.push({ id, object, z: z as number, createdAt: createdAt as number });
      continue;
    }
    if (!isValidObject(x, y, z, createdAt, width, height)) continue;
    const color = object.get('color');
    const text = object.get('text');
    if (type === 'sticky') {
      if (!isStickyColor(color) || !(text instanceof Y.Text)) continue;
      out.push({
        id,
        type,
        x: x as number,
        y: y as number,
        width: width === undefined ? undefined : (width as number),
        height: height === undefined ? undefined : (height as number),
        color,
        text: text.toString(),
        z: z as number,
        createdAt: createdAt as number,
      });
      continue;
    }
    if (type === 'shape') {
      const kind = object.get('kind');
      const fill = object.get('fill');
      const stroke = object.get('stroke');
      const label = object.get('label');
      if (
        typeof kind !== 'string' ||
        !(SHAPE_KINDS as readonly string[]).includes(kind) ||
        typeof fill !== 'string' ||
        !(fill in SHAPE_FILL_COLORS) ||
        typeof stroke !== 'string' ||
        !(stroke in SHAPE_STROKE_COLORS) ||
        !(label instanceof Y.Text)
      ) {
        continue;
      }
      out.push({
        id,
        type,
        x: x as number,
        y: y as number,
        width: width === undefined ? undefined : (width as number),
        height: height === undefined ? undefined : (height as number),
        kind: kind as ShapeKind,
        fill: fill as FillColor,
        stroke: stroke as StrokeColor,
        label: label.toString(),
        z: z as number,
        createdAt: createdAt as number,
      });
      continue;
    }
    if (type === 'stroke') {
      const points = object.get('points');
      const baseWidth = object.get('baseWidth');
      const baseHeight = object.get('baseHeight');
      const thickness = object.get('thickness');
      if (
        !isFiniteNumberArray(points) ||
        typeof baseWidth !== 'number' || !Number.isFinite(baseWidth) || baseWidth <= 0 ||
        typeof baseHeight !== 'number' || !Number.isFinite(baseHeight) || baseHeight <= 0 ||
        typeof color !== 'string' || !(color in PEN_COLORS) ||
        typeof thickness !== 'string' || !(thickness in PEN_THICKNESS_WORLD)
      ) {
        continue;
      }
      out.push({
        id,
        type,
        x: x as number,
        y: y as number,
        width: width as number,
        height: height as number,
        points: points as readonly number[],
        baseWidth: baseWidth as number,
        baseHeight: baseHeight as number,
        color: color as PenColor,
        thickness: thickness as PenThickness,
        z: z as number,
        createdAt: createdAt as number,
      });
      continue;
    }
    if (type === 'text') {
      const size = object.get('size');
      const widthMode = object.get('widthMode');
      if (typeof size !== 'string' || !(size in TEXT_SIZES)) continue;
      if (widthMode !== 'auto' && widthMode !== 'fixed') continue;
      if (!(text instanceof Y.Text)) continue;
      out.push({
        id,
        type,
        x: x as number,
        y: y as number,
        width: width === undefined ? undefined : (width as number),
        height: height === undefined ? undefined : (height as number),
        text: text.toString(),
        size: size as TextSize,
        widthMode: widthMode as 'auto' | 'fixed',
        z: z as number,
        createdAt: createdAt as number,
      });
      continue;
    }
    out.push({
      id,
      type,
      x: x as number,
      y: y as number,
      width: width === undefined ? undefined : (width as number),
      height: height === undefined ? undefined : (height as number),
      z: z as number,
      createdAt: createdAt as number,
    });
  }
  // Connectors: endpoints resolve against the live rects of every other
  // object, so local or remote moves and resizes redraw arrows without
  // writes (connector.follow); missing targets fall back to their stored
  // anchor (connector.target_deleted race). x/y/width/height are the
  // derived bounding box of the two anchor points.
  if (connectorEntries.length > 0) {
    const rects = new Map<string, Rect>();
    for (const o of out) rects.set(o.id, objectBounds(o));
    for (const { id, object, z, createdAt } of connectorEntries) {
      const from = parseEndpoint(object.get('from'));
      const to = parseEndpoint(object.get('to'));
      if (from === null || to === null) continue;
      const resolved = resolveEndpoints({ from, to }, rects);
      const box = connectorBBox(resolved.from, resolved.to);
      out.push({
        id,
        type: 'connector',
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        from,
        to,
        z,
        createdAt,
      });
    }
  }
  out.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : 1) : a.z - b.z));
  return out;
}
