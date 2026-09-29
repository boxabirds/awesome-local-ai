// Board document model: the Yjs schema and every mutation. Framework-free so the
// client uses it now and the Durable Object (story 4) can import it unchanged.
// See design "Board document model" contract.
//
// Schema:
//   meta: Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map{ type, x, y, color, text: Y.Text, z, createdAt }>

import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  DEFAULT_TEXT_SIZE,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type ShapeKind,
  type StickyColor,
  type StrokeColor,
} from './config.ts';
import type { Endpoint } from './objects/connector.ts';
import { MIN_DERIVED_EXTENT, decodeEndpoint, detachConnectorsTo } from './objects/connector.ts';
import { connectorBBox, resolveEndpoints } from './geometry/connector-geometry.ts';
import {
  rectContains,
  type Point,
  type Rect,
} from './geometry.ts';

/** Transaction origin for local mutations (story 8 undo / story 3 echo-avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

const SCHEMA_VERSION = 1;

/**
 * One board object as the client renders it. Every object type shares this
 * shape (position, stacking, and an optional persisted size), so the generic
 * selection / move / resize / delete machinery works for types that do not
 * exist yet (stories 9-12) without touching this file.
 *
 * `width`/`height` are absent for objects created before story 7; the size they
 * render at comes from `objectBounds`, which falls back to STICKY_SIZE_WORLD.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
  color?: StickyColor;
  text?: string;
  createdAt?: number;
  createdBy?: string;
  /** Story 9 text objects: the size preset key and the width mode. */
  size?: string;
  widthMode?: 'auto' | 'fixed';
  /** Story 10 shape fields, present only for `shape` objects. Colours are the
   * setting *names*; a name the palette does not know reads as undefined. */
  kind?: ShapeKind;
  fill?: FillColor;
  stroke?: StrokeColor;
  /** A shape's label as plain text, for rendering. The editable `Y.Text` is
   * story 10's `getShapeLabel`. */
  label?: string;
  /** Story 10 connector ends, present only for `connector` objects. Their boxes are
   * derived from these, so an arrow follows a shape nobody wrote to. */
  from?: Endpoint;
  to?: Endpoint;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
  createdAt: number;
}

/**
 * The object types this module's schema knows. `allObjectIds` uses it as the
 * default "selectable" set, so an object of a type nobody has registered is
 * never chosen by Ctrl/Cmd+A; callers pass their wider registry when they have
 * one (the client passes `registeredTypes()`).
 */
export const BOARD_MODEL_TYPES: ReadonlySet<string> = new Set(['sticky']);

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}
function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>('meta');
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);
}

function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value);
}

function finite(n: number): boolean {
  return Number.isFinite(n);
}

/** A stored size only counts when it is a usable positive number. */
function positiveSize(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function asNumber(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/** The highest z across all objects (sticky or not), or 0 when none. */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let m = 0;
  for (const o of objects.values()) {
    const z = o.get('z');
    if (typeof z === 'number' && z > m) m = z;
  }
  return m;
}

/** Sets meta.schemaVersion if absent. Idempotent; opens no transaction if present. */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a yellow sticky note centred on `at` (top-left = at - size/2), on top of
 * all other notes. Returns the new id.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const id = crypto.randomUUID();
  const objects = objectsMap(doc);
  const z = maxZ(objects) + 1;
  const text = new Y.Text('');
  const o = new Y.Map<unknown>();
  doc.transact(() => {
    o.set('type', 'sticky');
    o.set('x', at.x - STICKY_SIZE_WORLD / 2);
    o.set('y', at.y - STICKY_SIZE_WORLD / 2);
    o.set('color', isStickyColor(color) ? color : DEFAULT_STICKY_COLOR);
    o.set('text', text);
    o.set('z', z);
    o.set('createdAt', Date.now());
    objects.set(id, o);
  }, LOCAL_ORIGIN);
  return id;
}

function getSticky(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  const o = objects.get(id);
  if (o && o.get('type') === 'sticky') return o;
  return undefined;
}

/**
 * Create an object of an arbitrary type: the generic creator behind every later
 * object type (stories 9-12) and behind the test-only type. `size` writes an
 * explicit width/height; leaving it out gives an implicit-size object, which
 * renders at its type's default size until its first resize (design "Width/
 * height additive").
 */
export function createObject(
  doc: Y.Doc,
  type: string,
  at: Point,
  size?: { width: number; height: number },
): string {
  const id = crypto.randomUUID();
  const objects = objectsMap(doc);
  const z = maxZ(objects) + 1;
  const o = new Y.Map<unknown>();
  doc.transact(() => {
    o.set('type', type);
    o.set('x', at.x);
    o.set('y', at.y);
    o.set('z', z);
    o.set('createdAt', Date.now());
    if (size && finite(size.width) && finite(size.height) && size.width > 0 && size.height > 0) {
      o.set('width', size.width);
      o.set('height', size.height);
    }
    objects.set(id, o);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The rect an object occupies in world units. A stored size is used only when
 * it is a positive finite number; otherwise the object renders at the historical
 * sticky-note size (STICKY_SIZE_WORLD), which is what keeps notes created before
 * story 7 the same size they always were.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: finite(obj.x) ? obj.x : 0,
    y: finite(obj.y) ? obj.y : 0,
    width: positiveSize(obj.width) ?? STICKY_SIZE_WORLD,
    height: positiveSize(obj.height) ?? STICKY_SIZE_WORLD,
  };
}

/**
 * Every object lying *entirely inside* `rect` — the marquee's rule (an object
 * the rectangle only touches is not selected). Any type qualifies; whether an
 * object can actually be selected is the registry's decision downstream.
 */
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const out: string[] = [];
  for (const o of snapshot) {
    if (rectContains(rect, objectBounds(o))) out.push(o.id);
  }
  return out;
}

/**
 * Every selectable object id — Ctrl/Cmd+A's list. Objects whose type is not
 * `knownTypes` are excluded, so an object nobody has registered can never be
 * pulled into a selection it cannot be rendered or moved with.
 */
export function allObjectIds(
  snapshot: readonly ObjectSnapshot[],
  knownTypes: ReadonlySet<string> = BOARD_MODEL_TYPES,
): string[] {
  const out: string[] = [];
  for (const o of snapshot) {
    if (!knownTypes.has(o.type)) continue;
    if (!finite(o.x) || !finite(o.y)) continue;
    out.push(o.id);
  }
  return out;
}

/** Move a note to world (x, y). Returns false for stale id or non-finite coords. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/**
 * Move many objects to absolute world positions in one transaction — the write
 * behind both group dragging and arrow-key nudging.
 *
 * A single non-finite position rejects the whole call (nothing is written), and
 * ids that are not in the document (deleted by someone else mid-gesture) are
 * skipped. Returns how many objects were written.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  const objects = objectsMap(doc);
  const targets: [string, Y.Map<unknown>, number, number][] = [];
  for (const [id, p] of positions) {
    if (!p || !finite(p.x) || !finite(p.y)) return 0; // refuse the whole write
    const o = objects.get(id);
    if (!o) continue; // vanished remotely
    targets.push([id, o, p.x, p.y]);
  }
  if (targets.length === 0) return 0;
  let n = 0;
  doc.transact(() => {
    for (const [, o, x, y] of targets) {
      o.set('x', x);
      o.set('y', y);
      n++;
    }
  }, LOCAL_ORIGIN);
  return n;
}

/**
 * Resize many objects in one transaction: writes x, y, width and height, which
 * is also what turns an implicit-size sticky note into an explicit-size one
 * (design "Width/height additive" — no migration, the first resize persists it).
 *
 * One non-finite rect rejects the whole call; missing ids are skipped.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  const objects = objectsMap(doc);
  const targets: [string, Y.Map<unknown>, Rect][] = [];
  for (const [id, r] of rects) {
    if (!r || !finite(r.x) || !finite(r.y) || !finite(r.width) || !finite(r.height)) return 0;
    if (r.width <= 0 || r.height <= 0) return 0; // no zero-area or flipped objects
    const o = objects.get(id);
    if (!o) continue;
    targets.push([id, o, r]);
  }
  if (targets.length === 0) return 0;
  let n = 0;
  doc.transact(() => {
    for (const [, o, r] of targets) {
      o.set('x', r.x);
      o.set('y', r.y);
      o.set('width', r.width);
      o.set('height', r.height);
      n++;
    }
  }, LOCAL_ORIGIN);
  return n;
}

/** Raise a note to the top (z = maxZ + 1). No-op/false when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) === 1;
}

/**
 * Raise a whole selection above every object that is *not* in it, keeping the
 * selection's own stacking order among its members (design Key decision 4):
 * `z = maxUnselectedZ + rank`, ranks following the current (z, id) order.
 *
 * Returns how many objects were rewritten; 0 (and no transaction) when the
 * selection is already in front.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsMap(doc);
  const inSelection = new Set(ids);
  const selected: [string, Y.Map<unknown>][] = [];
  let maxUnselectedZ = 0;
  for (const [id, o] of objects) {
    if (inSelection.has(id)) selected.push([id, o]);
    else {
      const z = o.get('z');
      if (typeof z === 'number' && finite(z) && z > maxUnselectedZ) maxUnselectedZ = z;
    }
  }
  if (selected.length === 0) return 0;
  // Current stacking order of the selection: (z, id) ascending, the same order
  // the renderer sorts snapshots by.
  selected.sort((a, b) => {
    const za = asNumber(a[1].get('z'));
    const zb = asNumber(b[1].get('z'));
    return za - zb || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  });
  // Already entirely in front? Then there is nothing to raise.
  let alreadyFront = true;
  for (const [, o] of selected) {
    const z = o.get('z');
    if (!(typeof z === 'number' && finite(z) && z > maxUnselectedZ)) {
      alreadyFront = false;
      break;
    }
  }
  if (alreadyFront) return 0;
  let n = 0;
  doc.transact(() => {
    selected.forEach(([, o], rank) => {
      const z = maxUnselectedZ + rank + 1;
      if (o.get('z') === z) return;
      o.set('z', z);
      n++;
    });
  }, LOCAL_ORIGIN);
  return n;
}

/** Remove an object by id. Returns false for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

/**
 * Remove many objects in one transaction (the group delete). Ids that are not
 * in the document are skipped; an empty list writes nothing. Returns how many
 * objects were removed.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const present = ids.filter((id) => objects.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Story 10 (connector.target_deleted): arrows that pointed at one of these keep
    // existing, with the end that was welded to it pinned where it was. Done in this
    // same transaction, so the detach and the delete are one update and one undo step.
    detachConnectorsTo(doc, present);
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/** Change a note's colour. Rejects unknown colour names and stale ids. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const objects = objectsMap(doc);
  const o = getSticky(objects, id);
  if (!o) return false;
  doc.transact(() => {
    o.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's Y.Text, or undefined when the id is stale / not a sticky. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const o = getSticky(objectsMap(doc), id);
  const t = o?.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so every client
 * renders a stable stacking order even with concurrent equal z values. Objects
 * with an unknown `type` are skipped (forward compatibility for later stories).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = objectsMap(doc);
  const out: StickySnapshot[] = [];
  for (const [id, o] of objects.entries()) {
    if (o.get('type') !== 'sticky') continue;
    const colorVal = o.get('color');
    const textVal = o.get('text');
    const width = positiveSize(o.get('width'));
    const height = positiveSize(o.get('height'));
    out.push({
      id,
      type: 'sticky',
      x: asNumber(o.get('x')),
      y: asNumber(o.get('y')),
      color: isStickyColor(colorVal) ? colorVal : DEFAULT_STICKY_COLOR,
      text: textVal instanceof Y.Text ? textVal.toString() : '',
      z: asNumber(o.get('z')),
      createdAt: asNumber(o.get('createdAt')),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    });
  }
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Snapshot of *every* object in the document, whatever its type, sorted by
 * (z, id) — what the board renders and what the generic selection operations
 * work on. Unknown types arrive with their position, stacking order and size
 * only; the client's object registry decides whether to render them (an
 * unregistered type is skipped, never guessed at).
 */
export function objectSnapshots(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects = objectsMap(doc);
  const out: ObjectSnapshot[] = [];
  // Arrows are resolved in a second pass, once every other object's box is known.
  const arrows: { base: ObjectSnapshot; from: Endpoint; to: Endpoint }[] = [];
  for (const [id, o] of objects.entries()) {
    const type = o.get('type');
    const width = positiveSize(o.get('width'));
    const height = positiveSize(o.get('height'));
    const colorVal = o.get('color');
    const textVal = o.get('text');
    const labelVal = o.get('label');
    const kindVal = o.get('kind');
    const fillVal = o.get('fill');
    const strokeVal = o.get('stroke');
    const author = typeof o.get('createdBy') === 'string' ? (o.get('createdBy') as string) : '';
    const base: ObjectSnapshot = {
      id,
      type: typeof type === 'string' ? type : '',
      x: asNumber(o.get('x')),
      y: asNumber(o.get('y')),
      z: asNumber(o.get('z')),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    };
    if (base.type === 'sticky') {
      base.color = isStickyColor(colorVal) ? colorVal : DEFAULT_STICKY_COLOR;
      base.text = textVal instanceof Y.Text ? textVal.toString() : '';
      base.createdAt = asNumber(o.get('createdAt'));
    } else if (base.type === 'text') {
      base.text = textVal instanceof Y.Text ? textVal.toString() : '';
      base.size = typeof o.get('size') === 'string' ? (o.get('size') as string) : DEFAULT_TEXT_SIZE;
      base.widthMode = o.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
      base.createdBy = author;
      base.createdAt = asNumber(o.get('createdAt'));
    } else if (base.type === 'shape') {
      // Story 10: the shape's own fields. An unknown kind or colour name is left
      // undefined rather than guessed at, so the renderer decides what to draw.
      if (isShapeKind(kindVal)) base.kind = kindVal;
      if (isFillColor(fillVal)) base.fill = fillVal;
      if (isStrokeColor(strokeVal)) base.stroke = strokeVal;
      base.label = labelVal instanceof Y.Text ? labelVal.toString() : '';
      base.createdBy = author;
      base.createdAt = asNumber(o.get('createdAt'));
    } else if (base.type === 'connector') {
      // Story 10: an arrow stores its two ends and no box of its own; the box below
      // is derived from the objects it joins, every time the board is read.
      base.createdBy = author;
      base.createdAt = asNumber(o.get('createdAt'));
      const from = decodeEndpoint(o.get('from'));
      const to = decodeEndpoint(o.get('to'));
      if (from && to) {
        base.from = from;
        base.to = to;
        arrows.push({ base, from, to });
      }
    } else if (textVal instanceof Y.Text) {
      base.text = textVal.toString();
    }
    out.push(base);
  }
  // Derive every arrow's box from the rectangles of what it joins. Because this runs
  // on read, an object moved by anyone — locally or remotely — moves the arrow on
  // every screen without a single write to the arrow itself (connector.follow), and
  // an end whose object is missing keeps the fallback point it was attached at.
  if (arrows.length > 0) {
    const rects = new Map<string, Rect>();
    for (const base of out) {
      if (base.type === 'connector') continue;
      rects.set(base.id, objectBounds(base));
    }
    for (const arrow of arrows) {
      const ends = resolveEndpoints({ from: arrow.from, to: arrow.to }, rects);
      const box = connectorBBox(ends.from, ends.to);
      arrow.base.x = box.x;
      arrow.base.y = box.y;
      arrow.base.width = Math.max(box.width, MIN_DERIVED_EXTENT);
      arrow.base.height = Math.max(box.height, MIN_DERIVED_EXTENT);
    }
  }
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
