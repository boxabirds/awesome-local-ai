/**
 * The board document: Yjs schema and every mutation on it.
 *
 * Framework-free so the Durable Object (story 4) can import it for validation and migration.
 * This schema is the future persisted format (story 4) and wire format (story 3):
 *
 *   Y.Doc
 *     meta:    Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<id, Y.Map { type: 'sticky', x, y, width?, height?, color, text: Y.Text, z, createdAt }>
 *
 * Story 9 adds `type: 'text'` objects (text: Y.Text, size, widthMode, createdBy; see
 * objects/text.ts). Clients that do not know a type skip it.
 *
 * Story 10 adds `type: 'shape'` (kind, fill, stroke, label: Y.Text; see objects/shape.ts) and
 * `type: 'connector'` (from, to: Endpoint; x, y, width, height stored as 0 and derived here from
 * the ends; see objects/connector.ts). Deleting an object turns the arrow ends attached to it
 * into free ends at the same point, inside the delete's transaction.
 *
 * Story 7: every object type shares x, y, width, height, z and createdAt. `width`/`height` are
 * additive: stickies saved before story 7 have neither and are STICKY_SIZE_WORLD square; the
 * first resize writes both. Group operations (move, resize, stack, delete) are type-agnostic.
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`. Rejected calls
 * (stale id, unknown colour, non-finite numbers, no-ops) return false before opening a
 * transaction, so they emit no update. Nothing here throws for user-driven input.
 */
import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  DEFAULT_STICKY_COLOR,
  DEFAULT_TEXT_SIZE,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_STROKE_COLORS,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
  type FillColor,
  type PenColor,
  type PenThickness,
  type StickyColor,
  type StrokeColor,
  type TextSize,
} from './config';
import { rectContains, type Point, type Rect } from './geometry';
import { connectorBBox, readEndpoint, resolveEndpoints, type Endpoint } from './geometry/connector-geometry';

/** Transaction origin for changes made by this client (story 3 uses it to avoid echo, story 8 for undo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

export const SCHEMA_VERSION = 1;
const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const STICKY_TYPE = 'sticky';
/** Free text (story 9); created and changed by objects/text.ts. */
export const TEXT_TYPE = 'text';
/** Rectangles, ellipses and diamonds (story 10); created and changed by objects/shape.ts. */
export const SHAPE_TYPE = 'shape';
/** Arrows (story 10); created and changed by objects/connector.ts. */
export const CONNECTOR_TYPE = 'connector';
/** Freehand pen strokes (story 11); created by objects/stroke.ts. */
export const STROKE_TYPE = 'stroke';
const HALF = 2;
/** z of the first object on an empty board is FIRST_Z. */
const FIRST_Z = 1;

/** Object types this module knows how to read and create (the client registry may add more). */
export const KNOWN_OBJECT_TYPES: ReadonlySet<string> = new Set([STICKY_TYPE, TEXT_TYPE, SHAPE_TYPE, CONNECTOR_TYPE, STROKE_TYPE]);

/** Any object on the board. `width`/`height` are present only once written (see objectBounds). */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
  createdAt: number;
  /** Who created it (story 9 onwards), when recorded. */
  createdBy?: string;
  /** Sticky notes (StickyColor) and pen strokes (PenColor, story 11). */
  color?: StickyColor | PenColor;
  /** Sticky notes and text objects. */
  text?: string;
  /** Text objects only (story 9). */
  size?: TextSize;
  /** Text objects only (story 9). */
  widthMode?: TextWidthMode;
  /** Shapes only (story 10). */
  kind?: ShapeKind;
  fill?: FillColor;
  stroke?: StrokeColor;
  label?: string;
  /** Connectors only (story 10): the stored ends and where they are drawn right now. */
  from?: Endpoint;
  to?: Endpoint;
  fromPoint?: Point;
  toPoint?: Point;
  /**
   * Pen strokes only (story 11): flattened [x0, y0, x1, y1, ...] relative to the box's top-left
   * at creation size, the box size at creation, and the pen thickness.
   */
  points?: readonly number[];
  baseWidth?: number;
  baseHeight?: number;
  thickness?: PenThickness;
}

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** 'auto': as wide as the longest line up to TEXT_MAX_AUTO_WIDTH_WORLD; 'fixed': set by a side handle. */
export type TextWidthMode = 'auto' | 'fixed';

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

export function isSticky(obj: ObjectSnapshot): obj is StickySnapshot {
  return obj.type === STICKY_TYPE;
}

type ObjectMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap<ObjectMap>(OBJECTS_KEY);
}

/** The Y.Map of one object, or undefined for stale ids (for the per-type modules in objects/). */
export function objectOf(doc: Y.Doc, id: string): ObjectMap | undefined {
  const value: unknown = objectsOf(doc).get(id);
  return value instanceof Y.Map ? (value as ObjectMap) : undefined;
}

function isStickyColor(color: string): color is StickyColor {
  return Object.prototype.hasOwnProperty.call(STICKY_COLORS, color);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Highest z among all objects, or FIRST_Z - 1 when the board is empty. */
export function maxZ(doc: Y.Doc): number {
  let max = FIRST_Z - 1;
  objectsOf(doc).forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const z = finiteNumber(value.get('z'));
    if (z !== undefined && z > max) max = z;
  });
  return max;
}

/** Sets meta.schemaVersion when absent (a no-op on an already initialised doc). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META_KEY);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
}

/**
 * Creates a sticky centred on world point `at`, on top of every other object.
 * Returns the new id, or '' (no transaction) when `at` is not finite.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  const safeColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    objectsOf(doc).set(id, note);
    note.set('type', STICKY_TYPE);
    note.set('x', at.x - STICKY_SIZE_WORLD / HALF);
    note.set('y', at.y - STICKY_SIZE_WORLD / HALF);
    note.set('width', STICKY_SIZE_WORLD);
    note.set('height', STICKY_SIZE_WORLD);
    note.set('color', safeColor);
    note.set('text', new Y.Text());
    note.set('z', maxZ(doc) + 1);
    note.set('createdAt', Date.now());
  }, LOCAL_ORIGIN);
  return id;
}

/** True when an object with this id is on the board. */
export function hasObject(doc: Y.Doc, id: string): boolean {
  return objectOf(doc, id) !== undefined;
}

/** Moves an object's top-left to world (x, y). False for stale ids, non-finite values and no-ops. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/** Puts an object above all others. False (no update) when it is already alone on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Changes a sticky's colour. False for stale ids, unknown colours and the current colour. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = objectOf(doc, id);
  if (!obj || obj.get('type') !== STICKY_TYPE || obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

/** Removes an object. False for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** The shared text of a sticky, or undefined for stale ids and non-sticky objects. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objectOf(doc, id);
  if (!obj || obj.get('type') !== STICKY_TYPE) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const n = finiteNumber(value);
  return n !== undefined && n > 0 ? n : undefined;
}

/** Fields every object type shares; undefined for malformed entries. */
function readBase(id: string, value: unknown): ObjectSnapshot | undefined {
  if (!(value instanceof Y.Map)) return undefined;
  const type = value.get('type');
  const x = finiteNumber(value.get('x'));
  const y = finiteNumber(value.get('y'));
  if (typeof type !== 'string' || x === undefined || y === undefined) return undefined;
  const base: ObjectSnapshot = {
    id,
    type,
    x,
    y,
    z: finiteNumber(value.get('z')) ?? FIRST_Z - 1,
    createdAt: finiteNumber(value.get('createdAt')) ?? 0,
  };
  const createdBy = value.get('createdBy');
  if (typeof createdBy === 'string') base.createdBy = createdBy;
  const width = positiveNumber(value.get('width'));
  const height = positiveNumber(value.get('height'));
  if (width !== undefined) base.width = width;
  if (height !== undefined) base.height = height;
  return base;
}

export function isTextSize(size: string): size is TextSize {
  return Object.prototype.hasOwnProperty.call(TEXT_SIZES, size);
}

function readText(base: ObjectSnapshot, value: Y.Map<unknown>): ObjectSnapshot {
  const text = value.get('text');
  const rawSize = value.get('size');
  const size = typeof rawSize === 'string' && isTextSize(rawSize) ? rawSize : DEFAULT_TEXT_SIZE;
  return {
    ...base,
    // Always written by createText; a malformed entry falls back to one empty line.
    width: base.width ?? TEXT_AUTO_WIDTH_PADDING_WORLD,
    height: base.height ?? TEXT_SIZES[size] * TEXT_LINE_HEIGHT,
    text: text instanceof Y.Text ? text.toString() : '',
    size,
    widthMode: value.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
  };
}

export function isShapeKind(kind: unknown): kind is ShapeKind {
  return typeof kind === 'string' && (SHAPE_KINDS as readonly string[]).includes(kind);
}

export function isFillColor(c: unknown): c is FillColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, c);
}

export function isStrokeColor(c: unknown): c is StrokeColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, c);
}

function readShape(base: ObjectSnapshot, value: Y.Map<unknown>): ObjectSnapshot | undefined {
  const kind = value.get('kind');
  // A kind this client does not know (a later version's) is skipped rather than misdrawn.
  if (!isShapeKind(kind)) return undefined;
  const fill = value.get('fill');
  const stroke = value.get('stroke');
  const label = value.get('label');
  return {
    ...base,
    kind,
    fill: isFillColor(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
  };
}

/** A connector's stored ends, or undefined when either is malformed. */
function readEnds(value: Y.Map<unknown>): { from: Endpoint; to: Endpoint } | undefined {
  const from = readEndpoint(value.get('from'));
  const to = readEndpoint(value.get('to'));
  return from && to ? { from, to } : undefined;
}

/** A connector with its box and drawn ends derived from the objects' current rects. */
function readConnector(
  base: ObjectSnapshot,
  value: Y.Map<unknown>,
  rects: ReadonlyMap<string, Rect>,
): ObjectSnapshot | undefined {
  const ends = readEnds(value);
  if (!ends) return undefined;
  const points = resolveEndpoints(ends, rects);
  const box = connectorBBox(points.from, points.to);
  return { ...base, ...box, ...ends, fromPoint: points.from, toPoint: points.to };
}

export function isPenColor(c: unknown): c is PenColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, c);
}

export function isPenThickness(t: unknown): t is PenThickness {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, t);
}

/** A pen stroke; malformed entries (bad points, colour, thickness or base size) are skipped. */
function readStroke(base: ObjectSnapshot, value: Y.Map<unknown>): ObjectSnapshot | undefined {
  const points = value.get('points');
  const color = value.get('color');
  const thickness = value.get('thickness');
  const baseWidth = positiveNumber(value.get('baseWidth'));
  const baseHeight = positiveNumber(value.get('baseHeight'));
  if (!Array.isArray(points) || points.length < HALF || points.length % HALF !== 0) return undefined;
  if (!points.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  if (!isPenColor(color) || !isPenThickness(thickness) || baseWidth === undefined || baseHeight === undefined) {
    return undefined;
  }
  return {
    ...base,
    width: base.width ?? baseWidth,
    height: base.height ?? baseHeight,
    points: points as number[],
    baseWidth,
    baseHeight,
    color,
    thickness,
  };
}

function readObject(id: string, value: unknown): ObjectSnapshot | undefined {
  const base = readBase(id, value);
  if (!base || !(value instanceof Y.Map)) return base;
  if (base.type === TEXT_TYPE) return readText(base, value);
  if (base.type === SHAPE_TYPE) return readShape(base, value);
  if (base.type === STROKE_TYPE) return readStroke(base, value);
  if (base.type !== STICKY_TYPE) return base;
  const rawColor = value.get('color');
  const text = value.get('text');
  const sticky: StickySnapshot = {
    ...base,
    type: STICKY_TYPE,
    color: typeof rawColor === 'string' && isStickyColor(rawColor) ? rawColor : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
  };
  return sticky;
}

function byStack(a: ObjectSnapshot, b: ObjectSnapshot): number {
  return a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Immutable view of the board sorted by (z, id); unknown or malformed objects are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return objectSnapshot(doc).filter(isSticky);
}

/**
 * Every well-formed object of any type (x, y finite; type a string), sorted by (z, id).
 * Types the client does not know are included here; the renderer and selection skip them.
 */
export function objectSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const all: ObjectSnapshot[] = [];
  const connectors: [ObjectSnapshot, Y.Map<unknown>][] = [];
  objectsOf(doc).forEach((value, id) => {
    const obj = readObject(id, value);
    if (!obj) return;
    if (obj.type === CONNECTOR_TYPE) connectors.push([obj, value as Y.Map<unknown>]);
    else all.push(obj);
  });
  // Arrows are drawn from the other objects' current rects (connector.follow).
  const rects = rectsOf(all);
  for (const [base, value] of connectors) {
    const connector = readConnector(base, value, rects);
    if (connector) all.push(connector);
  }
  all.sort(byStack);
  return all;
}

/** Rects of the objects an arrow can attach to (every object but arrows), by id. */
export function rectsOf(objects: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const o of objects) if (o.type !== CONNECTOR_TYPE) rects.set(o.id, objectBounds(o));
  return rects;
}

/** Current rects of every object an arrow can attach to, read straight from the document. */
export function docRects(doc: Y.Doc): Map<string, Rect> {
  const objects: ObjectSnapshot[] = [];
  objectsOf(doc).forEach((value, id) => {
    const obj = readObject(id, value);
    if (obj && obj.type !== CONNECTOR_TYPE) objects.push(obj);
  });
  return rectsOf(objects);
}

/** Where a stored connector's ends are drawn right now, or undefined for stale ids / other types. */
export function connectorPoints(doc: Y.Doc, id: string): { from: Point; to: Point } | undefined {
  const obj = objectOf(doc, id);
  if (!obj || obj.get('type') !== CONNECTOR_TYPE) return undefined;
  const ends = readEnds(obj);
  return ends ? resolveEndpoints(ends, docRects(doc)) : undefined;
}

// ---- Story 7: geometry of objects and generic group operations ----

/** World rect of an object; objects without stored width/height are STICKY_SIZE_WORLD square. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return { x: obj.x, y: obj.y, width: obj.width ?? STICKY_SIZE_WORLD, height: obj.height ?? STICKY_SIZE_WORLD };
}

function knownByDefault(type: string): boolean {
  return KNOWN_OBJECT_TYPES.has(type);
}

/**
 * Ids of the known objects lying entirely inside `rect` (marquee rule: partly inside is not
 * selected), bottom to top. `isKnownType` defaults to the types this module creates.
 */
export function objectsInRect(
  objects: readonly ObjectSnapshot[],
  rect: Rect,
  isKnownType: (type: string) => boolean = knownByDefault,
): string[] {
  return objects.filter((o) => isKnownType(o.type) && rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/** Ids of every known object (select all); unknown types are never selectable. */
export function allObjectIds(
  objects: readonly ObjectSnapshot[],
  isKnownType: (type: string) => boolean = knownByDefault,
): string[] {
  return objects.filter((o) => isKnownType(o.type)).map((o) => o.id);
}

/**
 * Moves each object's top-left to its absolute world position. Missing ids and same-position
 * entries are skipped; any non-finite value rejects the whole call. Returns the number of
 * objects moved; 0 means no transaction was opened.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  for (const p of positions.values()) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  const changes: [ObjectMap, Point][] = [];
  const arrows: [ObjectMap, { from: Endpoint; to: Endpoint }, Point][] = [];
  let rects: Map<string, Rect> | null = null;
  for (const [id, p] of positions) {
    const obj = objectOf(doc, id);
    if (!obj) continue;
    if (obj.get('type') === CONNECTOR_TYPE) {
      // An arrow's position is its derived box: moving it moves its free ends by the same amount.
      const ends = readEnds(obj);
      if (!ends) continue;
      rects ??= docRects(doc);
      const pts = resolveEndpoints(ends, rects);
      const box = connectorBBox(pts.from, pts.to);
      const delta = { x: p.x - box.x, y: p.y - box.y };
      if ((delta.x === 0 && delta.y === 0) || (ends.from.kind !== 'free' && ends.to.kind !== 'free')) continue;
      arrows.push([obj, ends, delta]);
      continue;
    }
    if (obj.get('x') === p.x && obj.get('y') === p.y) continue;
    changes.push([obj, p]);
  }
  if (changes.length === 0 && arrows.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, p] of changes) {
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
    for (const [obj, { from, to }, d] of arrows) {
      if (from.kind === 'free') obj.set('from', { kind: 'free', x: from.x + d.x, y: from.y + d.y });
      if (to.kind === 'free') obj.set('to', { kind: 'free', x: to.x + d.x, y: to.y + d.y });
    }
  }, LOCAL_ORIGIN);
  return changes.length + arrows.length;
}

/**
 * Sets each listed arrow's free ends to `map(end as it was at `start`)`; attached ends stay
 * attached. Used by move and resize gestures, which compute every frame from the gesture's
 * start. Stale ids and non-arrows are skipped; non-finite results reject the call. Returns
 * the number of arrows changed.
 */
export function transformConnectorEnds(
  doc: Y.Doc,
  starts: readonly ObjectSnapshot[],
  map: (p: Point) => Point,
): number {
  const changes: [ObjectMap, 'from' | 'to', Endpoint][] = [];
  for (const start of starts) {
    const obj = objectOf(doc, start.id);
    if (!obj || obj.get('type') !== CONNECTOR_TYPE) continue;
    for (const end of ['from', 'to'] as const) {
      const e = start[end];
      if (e?.kind !== 'free') continue;
      const p = map({ x: e.x, y: e.y });
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
      const current = readEndpoint(obj.get(end));
      if (current?.kind === 'free' && current.x === p.x && current.y === p.y) continue;
      changes.push([obj, end, { kind: 'free', x: p.x, y: p.y }]);
    }
  }
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, end, e] of changes) obj.set(end, e);
  }, LOCAL_ORIGIN);
  return new Set(changes.map(([obj]) => obj)).size;
}

function sameRect(obj: ObjectMap, r: Rect): boolean {
  return obj.get('x') === r.x && obj.get('y') === r.y && obj.get('width') === r.width && obj.get('height') === r.height;
}

/**
 * Sets each object's position and size (writing width and height, which makes implicit-size
 * stickies explicit). Missing ids and unchanged rects are skipped; any non-finite value or
 * non-positive size rejects the whole call. Returns the number of objects changed.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  for (const r of rects.values()) {
    if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return 0;
  }
  const changes: [ObjectMap, Rect][] = [];
  for (const [id, r] of rects) {
    const obj = objectOf(doc, id);
    if (!obj || sameRect(obj, r)) continue;
    changes.push([obj, r]);
  }
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, r] of changes) {
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return changes.length;
}

/**
 * Raises the given objects above every other object, keeping their order among themselves:
 * z = (highest z of the others) + rank. Nothing changes when they are already strictly above
 * all others. Returns the number of objects whose z changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const wanted = new Set(ids);
  const selected: { id: string; obj: ObjectMap; z: number }[] = [];
  let topOther = FIRST_Z - 1;
  objectsOf(doc).forEach((value, id) => {
    if (!(value instanceof Y.Map)) return;
    const z = finiteNumber(value.get('z'));
    if (wanted.has(id)) selected.push({ id, obj: value as ObjectMap, z: z ?? FIRST_Z - 1 });
    else if (z !== undefined && z > topOther) topOther = z;
  });
  if (selected.length === 0) return 0;
  selected.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Already strictly above every other object: nothing to do (and nothing to sync).
  if (selected[0]!.z > topOther) return 0;
  const changes = selected
    .map((s, i) => ({ obj: s.obj, from: s.z, to: topOther + i + 1 }))
    .filter((c) => c.from !== c.to);
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const c of changes) c.obj.set('z', c.to);
  }, LOCAL_ORIGIN);
  return changes.length;
}

/** Removes the given objects in one transaction; missing ids are skipped. Returns the count. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const present = [...new Set(ids)].filter((id) => objectsOf(doc).has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Arrows attached to deleted objects stay, with those ends fixed where they were (story 10).
    detachConnectorsTo(doc, present);
    for (const id of present) objectsOf(doc).delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/**
 * Turns every arrow end attached to one of `deletedIds` into a free end at the point where it
 * is drawn now (connector.target_deleted). Arrows that are themselves being deleted are left
 * alone. Call inside an open transaction, before the objects are removed: it reads their rects.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const deleted = new Set(deletedIds);
  let rects: Map<string, Rect> | null = null;
  objectsOf(doc).forEach((value, id) => {
    if (deleted.has(id) || !(value instanceof Y.Map) || value.get('type') !== CONNECTOR_TYPE) return;
    const ends = readEnds(value);
    if (!ends) return;
    const attachedToDeleted = (e: Endpoint) => e.kind === 'attached' && deleted.has(e.objectId);
    if (!attachedToDeleted(ends.from) && !attachedToDeleted(ends.to)) return;
    rects ??= docRects(doc);
    const pts = resolveEndpoints(ends, rects);
    if (attachedToDeleted(ends.from)) value.set('from', { kind: 'free', x: pts.from.x, y: pts.from.y });
    if (attachedToDeleted(ends.to)) value.set('to', { kind: 'free', x: pts.to.x, y: pts.to.y });
  });
}
