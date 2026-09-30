// Board document schema and every mutation on it. Framework-free: the client
// uses it now; the Durable Object (story 4) will import it for validation.
//
// Y.Doc
//   meta:    Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map { type, x, y, width?, height?, color, text: Y.Text, z, createdAt }>
//   (`width`/`height` are written by the first resize; absent means STICKY_SIZE_WORLD.)
//   Text objects (story 9): see src/shared/objects/text.ts.
//   Shapes and connectors (story 10): see src/shared/objects/shape.ts and connector.ts.
import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  DEFAULT_STICKY_COLOR,
  DEFAULT_TEXT_SIZE,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_STROKE_COLORS,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  TEXT_SIZES,
  type FillColor,
  type StickyColor,
  type StrokeColor,
  type TextSize,
} from './config';
import { type Point, type Rect, isFiniteRect, rectContains } from './geometry';
import { type Endpoint, connectorBBox, resolveEndpoints } from './geometry/connector-geometry';
import { connectorEnds, detachConnectorsTo, translateConnector } from './objects/connector';

/** Current document schema version, stored in `meta.schemaVersion`. */
export const SCHEMA_VERSION = 1;

/** Transaction origin for changes made by this client (story 3 echo filter, story 8 undo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Any board object of a known type. Type-specific fields are optional here. */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  color?: StickyColor;
  text?: string;
  /** Text objects (story 9). */
  size?: TextSize;
  widthMode?: 'auto' | 'fixed';
  /** Shapes (story 10). */
  kind?: (typeof SHAPE_KINDS)[number];
  fill?: FillColor;
  stroke?: StrokeColor;
  label?: string;
  /** Connectors (story 10): stored ends and their resolved points; x/y/width/height are derived. */
  from?: Endpoint;
  to?: Endpoint;
  ends?: { from: Point; to: Point };
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

export function isSticky(obj: ObjectSnapshot): obj is StickySnapshot {
  return obj.type === 'sticky';
}

/**
 * Object types the board understands. `sticky`, `text`, `shape` and `connector` are built in; the client object
 * registry adds the others. Objects of any other type are kept in the document
 * but never shown, selected or changed by group operations.
 */
const knownTypes = new Set<string>(['sticky', 'text', 'shape', 'connector']);

export function markObjectTypeKnown(type: string): void {
  knownTypes.add(type);
}

export function isKnownObjectType(type: string): boolean {
  return knownTypes.has(type);
}

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

export function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);
}

export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

export function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

function zOf(obj: Y.Map<unknown>): number {
  const z = obj.get('z');
  return isFiniteNumber(z) ? z : 0;
}

export function maxZ(doc: Y.Doc, exceptId?: string): number {
  let max = 0;
  for (const [id, obj] of objectsMap(doc)) {
    if (id === exceptId || !(obj instanceof Y.Map)) continue;
    max = Math.max(max, zOf(obj));
  }
  return max;
}

/** Sets `meta.schemaVersion` if absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (world units), above every other object.
 * Returns the new id, or `false` for non-finite coordinates or an unknown colour.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y) || !isStickyColor(color)) return false;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ(doc) + 1);
    note.set('createdAt', Date.now());
    objectsMap(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves an object's top-left to (x, y). False for stale ids, non-finite values or no change. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/** Puts an object above all others. False for stale ids or when it is already strictly topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Changes a sticky note's colour. False for stale ids, non-stickies, unknown colours or no change. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = getObject(doc, id);
  if (!obj || obj.get('type') !== 'sticky' || obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

/** Removes an object. False for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getObject(doc, id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function compareByStacking(a: { z: number; id: string }, b: { z: number; id: string }): number {
  if (a.z !== b.z) return a.z - b.z;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sizeOf(obj: Y.Map<unknown>, key: 'width' | 'height'): number {
  const value = obj.get(key);
  return isFiniteNumber(value) && value > 0 ? value : STICKY_SIZE_WORLD;
}

function isShapeKindValue(value: unknown): value is (typeof SHAPE_KINDS)[number] {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

function hasKey(obj: object, key: unknown): boolean {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
}

/** Snapshot of one object of a known type other than connector; undefined when unusable. */
function plainSnapshot(id: string, obj: Y.Map<unknown>, type: string): ObjectSnapshot | undefined {
  const x = obj.get('x');
  const y = obj.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;
  const createdAt = obj.get('createdAt');
  const base: ObjectSnapshot = {
    id,
    type,
    x,
    y,
    width: sizeOf(obj, 'width'),
    height: sizeOf(obj, 'height'),
    z: zOf(obj),
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
  if (type === 'sticky') {
    const color = obj.get('color');
    const text = obj.get('text');
    base.color = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
    base.text = text instanceof Y.Text ? text.toString() : '';
  } else if (type === 'text') {
    const text = obj.get('text');
    const size = obj.get('size');
    base.text = text instanceof Y.Text ? text.toString() : '';
    base.size = isTextSize(size) ? size : DEFAULT_TEXT_SIZE;
    base.widthMode = obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  } else if (type === 'shape') {
    const kind = obj.get('kind');
    const fill = obj.get('fill');
    const stroke = obj.get('stroke');
    const label = obj.get('label');
    base.kind = isShapeKindValue(kind) ? kind : 'rect';
    base.fill = hasKey(SHAPE_FILL_COLORS, fill) ? (fill as FillColor) : DEFAULT_SHAPE_FILL;
    base.stroke = hasKey(SHAPE_STROKE_COLORS, stroke) ? (stroke as StrokeColor) : DEFAULT_SHAPE_STROKE;
    base.label = label instanceof Y.Text ? label.toString() : '';
  }
  return base;
}

/**
 * Rects of every object an arrow can attach to (known types except connectors), by id.
 */
export function objectRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [id, obj] of objectsMap(doc)) {
    if (!(obj instanceof Y.Map)) continue;
    const type = obj.get('type');
    if (typeof type !== 'string' || type === 'connector' || !knownTypes.has(type)) continue;
    const x = obj.get('x');
    const y = obj.get('y');
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;
    rects.set(id, { x, y, width: sizeOf(obj, 'width'), height: sizeOf(obj, 'height') });
  }
  return rects;
}

/**
 * Immutable view of all objects of known types, sorted by (z, id). Unknown object types are skipped.
 * A connector's box is derived from its resolved ends (attached ends follow their objects).
 */
export function objectsSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  const connectors: [string, Y.Map<unknown>][] = [];
  const rects = new Map<string, Rect>();
  for (const [id, obj] of objectsMap(doc)) {
    if (!(obj instanceof Y.Map)) continue;
    const type = obj.get('type');
    if (typeof type !== 'string' || !knownTypes.has(type)) continue;
    if (type === 'connector') {
      connectors.push([id, obj]);
      continue;
    }
    const snap = plainSnapshot(id, obj, type);
    if (!snap) continue;
    rects.set(id, objectBounds(snap));
    objects.push(Object.freeze(snap));
  }
  for (const [id, obj] of connectors) {
    const stored = connectorEnds(obj);
    if (!stored) continue;
    const ends = resolveEndpoints(stored, rects);
    const box = connectorBBox(ends.from, ends.to);
    const createdAt = obj.get('createdAt');
    objects.push(
      Object.freeze({
        id,
        type: 'connector',
        ...box,
        z: zOf(obj),
        createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
        from: stored.from,
        to: stored.to,
        ends,
      }),
    );
  }
  return Object.freeze(objects.sort(compareByStacking));
}

/** Immutable view of all sticky notes, sorted by (z, id). Other object types are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return Object.freeze(objectsSnapshot(doc).filter(isSticky));
}

// ---- Story 7: generic group operations ------------------------------------

/** An object's rectangle in world units (stickies without a size are STICKY_SIZE_WORLD square). */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}

/** Ids of known-type objects lying entirely inside `rect` (marquee selection). */
export function objectsInRect(objects: readonly ObjectSnapshot[], rect: Rect): string[] {
  return objects.filter((o) => knownTypes.has(o.type) && rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/** Ids of every known-type object (select all). */
export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  return objects.filter((o) => knownTypes.has(o.type)).map((o) => o.id);
}

/**
 * Moves each object's top-left to its absolute position. Missing ids are skipped;
 * any non-finite value rejects the whole call. Returns the number of objects changed,
 * in one LOCAL_ORIGIN transaction (none when nothing changes).
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  for (const p of positions.values()) if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return 0;
  const changes: [Y.Map<unknown>, Point][] = [];
  const arrows: [Y.Map<unknown>, ObjectSnapshot, Point][] = [];
  let current: Map<string, ObjectSnapshot> | null = null;
  for (const [id, p] of positions) {
    const obj = getObject(doc, id);
    if (!obj) continue;
    if (obj.get('type') === 'connector') {
      // An arrow's box is derived: its free ends move by the difference to the current box.
      current ??= new Map(objectsSnapshot(doc).map((o) => [o.id, o]));
      const snap = current.get(id);
      if (snap && (snap.x !== p.x || snap.y !== p.y)) arrows.push([obj, snap, { x: p.x - snap.x, y: p.y - snap.y }]);
    } else if (obj.get('x') !== p.x || obj.get('y') !== p.y) changes.push([obj, p]);
  }
  if (changes.length === 0 && arrows.length === 0) return 0;
  let count = changes.length;
  doc.transact(() => {
    for (const [obj, p] of changes) {
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
    for (const [obj, snap, delta] of arrows) {
      if (snap.from && snap.to && translateConnector(obj, { from: snap.from, to: snap.to }, delta)) count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Moves objects by `delta` from their state in `starts` (a snapshot taken when
 * a drag began, or the current one for a nudge): top-left = start + delta;
 * arrows move their free ends. Objects that are gone are skipped. One
 * LOCAL_ORIGIN transaction; returns the number of objects changed.
 */
export function translateObjects(doc: Y.Doc, starts: readonly ObjectSnapshot[], delta: Point): number {
  if (!isFiniteNumber(delta.x) || !isFiniteNumber(delta.y)) return 0;
  const positions = new Map<string, Point>();
  const arrows: [Y.Map<unknown>, ObjectSnapshot][] = [];
  for (const s of starts) {
    if (s.type === 'connector') {
      const obj = getObject(doc, s.id);
      if (obj && s.from && s.to) arrows.push([obj, s]);
    } else positions.set(s.id, { x: s.x + delta.x, y: s.y + delta.y });
  }
  let count = 0;
  doc.transact(() => {
    count = moveObjects(doc, positions);
    for (const [obj, s] of arrows) if (translateConnector(obj, { from: s.from!, to: s.to! }, delta)) count++;
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Sets each object's rect (position and size; stickies become explicitly sized).
 * Missing ids are skipped; any non-finite value or non-positive size rejects the call.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  for (const r of rects.values()) if (!isFiniteRect(r) || r.width <= 0 || r.height <= 0) return 0;
  const changes: [Y.Map<unknown>, Rect][] = [];
  for (const [id, r] of rects) {
    const obj = getObject(doc, id);
    if (!obj) continue;
    const same =
      obj.get('x') === r.x && obj.get('y') === r.y && obj.get('width') === r.width && obj.get('height') === r.height;
    if (!same) changes.push([obj, r]);
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
 * Raises the objects above every other object, keeping their order among
 * themselves (z = highest other z + rank). Returns 0 when they are already
 * strictly above everything else.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const wanted = new Set(ids);
  const selected: { id: string; z: number; obj: Y.Map<unknown> }[] = [];
  let others = 0;
  for (const [id, obj] of objectsMap(doc)) {
    if (!(obj instanceof Y.Map)) continue;
    if (wanted.has(id)) selected.push({ id, z: zOf(obj), obj });
    else others = Math.max(others, zOf(obj));
  }
  if (selected.length === 0) return 0;
  if (selected.every((s) => s.z > others)) return 0;
  selected.sort(compareByStacking);
  doc.transact(() => {
    selected.forEach((s, rank) => s.obj.set('z', others + rank + 1));
  }, LOCAL_ORIGIN);
  return selected.length;
}

/**
 * Removes the objects; missing ids are skipped. Returns the number removed.
 * Arrows attached to a removed object stay, their end freed where it was
 * attached, in the same transaction (one update, one undo step).
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const map = objectsMap(doc);
  const present = [...new Set(ids)].filter((id) => map.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    detachConnectorsTo(doc, present);
    for (const id of present) map.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/** Only the sticky notes of an objects snapshot. */
export function stickiesOf(objects: readonly ObjectSnapshot[]): StickySnapshot[] {
  return objects.filter(isSticky);
}
