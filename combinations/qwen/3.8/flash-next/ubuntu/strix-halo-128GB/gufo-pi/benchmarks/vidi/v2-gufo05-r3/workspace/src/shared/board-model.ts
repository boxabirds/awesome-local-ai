import * as Y from 'yjs';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  DEFAULT_STICKY_COLOR,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_STROKE_COLORS,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type FillColor,
  type PenColor,
  type PenThickness,
  type ShapeKind,
  type StickyColor,
  type StrokeColor,
  type TextSize,
} from './config';
import {
  connectorBoxOf,
  detachConnectorsTo,
  readConnector,
  translateConnector,
  type ConnectorSnap,
  type Endpoint,
} from './objects/connector';
import {
  connectorBBox,
  isResolvable,
  resolveEndpoints,
} from './geometry/connector-geometry';
import { rectContains, type Point, type Rect } from './geometry';

/**
 * vidi6 board document model (Yjs).
 *
 * This module owns the document schema and every mutation of board objects. It
 * is framework-free so the Durable Object (story 4) can import it for
 * validation and migration, and so story 3 can attach a network provider to the
 * same document.
 *
 * Schema (the future persisted and wire contract):
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string, Y.Map>
 *       <id>: Y.Map {
 *         type: 'sticky'
 *         x: number, y: number   // top-left, world units
 *         width?: number         // world units; absent = the type's default size
 *         height?: number        // (both written by the first resize)
 *         color: StickyColor
 *         text: Y.Text
 *         z: number              // stacking; higher is on top
 *         createdAt: number      // epoch ms
 *       }
 *
 * Rules:
 * - Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`.
 * - Invalid or pointless input (stale id, unknown colour, non-finite numbers,
 *   bringing the topmost note forward) returns `false` *before* opening a
 *   transaction, so no update — and therefore no sync traffic in story 3 — is
 *   produced. The module never throws for user-driven input.
 * - Unknown `type` values are skipped by {@link snapshot} so notes from later
 *   stories (shapes, text, pen) cannot crash the renderer.
 */

/** Transaction origin for local user edits (used by story 8 undo, story 3 echo-avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Written to `meta.schemaVersion` by {@link initDoc}; story 4 migrates from it. */
export const SCHEMA_VERSION = 1;

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';

/**
 * Everything a board object has in common, in the shape the renderer reads.
 *
 * `width` and `height` are optional: an object created before story 7 carries
 * neither and renders at its type's default size (for sticky notes,
 * `STICKY_SIZE_WORLD`). The first resize writes both fields.
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
  /**
   * The object's text content, spelled the same on every type: a sticky note's
   * or text object's body, a shape's label (story 10). Every type the model
   * writes fills it, so generic readers do not have to narrow by type to get
   * an object's text.
   */
  text?: string;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

export interface BoardTextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  createdBy?: string;
}

/**
 * A shape (story 10). `shared/objects/shape.ts` calls this snapshot `ShapeSnap`.
 */
export interface ShapeObjectSnapshot extends ObjectSnapshot {
  type: 'shape';
  /** The label, spelled like every other object's text. */
  text: string;
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
  createdBy?: string;
}

/**
 * A connector (arrow, story 10). Its `x`/`y`/`width`/`height` are *derived* from
 * the objects its ends point at, so the box a selection frame or a marquee works
 * with is always the box the arrow is drawn in. The record keeps the common
 * position fields so that generic readers find them, but they are always zero. `shared/objects/connector.ts` calls this snapshot `ConnectorSnap`.
 */
export interface ConnectorObjectSnapshot extends ObjectSnapshot {
  type: 'connector';
  /** An arrow has no text of its own. */
  text: '';
  from: Endpoint;
  to: Endpoint;
  /**
   * Where the two ends actually are, resolved against the objects they point at.
   *
   * The snapshot carries them so the renderer draws exactly the line the hit test
   * measures: one resolution per board read, not one per object.
   */
  ends: { from: Point; to: Point };
  createdBy?: string;
}

/**
 * A stroke (story 11, the Pen tool). `points` is the flattened
 * `[x0, y0, x1, y1, ...]` array stored relative to the bbox origin at creation
 * size; `shared/objects/stroke.ts` scales it with `scaledPoints` for both the
 * renderer and the line-distance hit test. `shared/objects/stroke.ts` calls
 * this snapshot `StrokeSnap`.
 */
export interface StrokeObjectSnapshot extends ObjectSnapshot {
  type: 'stroke';
  /** A drawing has no text of its own. */
  text: '';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  createdBy?: string;
}

/** Union of all board object snapshots. */
export type AnySnapshot =
  | StickySnapshot
  | BoardTextSnapshot
  | ShapeObjectSnapshot
  | ConnectorSnap
  | StrokeObjectSnapshot;

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META_KEY);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY) as unknown as Y.Map<Y.Map<unknown>>;
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOr(value: unknown, fallback: number): number {
  return finite(value) ? value : fallback;
}

/** Highest `z` in the document (0 when it holds no objects). */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const m of objects.values()) {
    const z = m.get('z');
    if (finite(z) && z > max) max = z;
  }
  return max;
}

/**
 * True when nothing renders above `id`: the render order is `(z, id)`, so an
 * equal `z` with a larger id (possible once story 3 syncs concurrent creates)
 * still counts as being on top.
 */
function isTopmost(objects: Y.Map<Y.Map<unknown>>, id: string): boolean {
  const self = objects.get(id);
  if (!self) return false;
  const z = numberOr(self.get('z'), 0);
  for (const [otherId, other] of objects) {
    if (otherId === id) continue;
    const otherZ = numberOr(other.get('z'), 0);
    if (otherZ > z) return false;
    if (otherZ === z && otherId > id) return false;
  }
  return true;
}

/**
 * The object types this build knows about.
 *
 * `allObjectIds` and `objectsInRect` only ever offer these, so an object written
 * by a future version cannot be selected, moved or deleted by this one. The
 * client registry (`client/objects/registry.tsx`) adds a type here when it
 * registers the matching component, which keeps "select all" in step with what
 * can actually be drawn without the model importing any UI code.
 */
const KNOWN_OBJECT_TYPES = new Set<string>(['sticky']);

/** Declare an object type known to selection and group operations. */
export function registerKnownObjectType(type: string): void {
  KNOWN_OBJECT_TYPES.add(type);
}

/** Is this object type one this build can select and transform? */
export function isKnownObjectType(type: string): boolean {
  return KNOWN_OBJECT_TYPES.has(type);
}

/**
 * Ensure the document carries the current schema. Sets `meta.schemaVersion`
 * only when absent, so re-running it (and future migrations) is idempotent.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Add a sticky note centred on the world point `at` (so its top-left is
 * `at − STICKY_SIZE_WORLD / 2`) on top of all other notes.
 *
 * Returns the new id, or `''` (falsy) when the point is not finite or the
 * colour is not one of the six presets — nothing is written in that case.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!at || !finite(at.x) || !finite(at.y)) return '';
  if (!isStickyColor(color)) return '';

  let id = '';
  doc.transact(() => {
    const objects = objectsMap(doc);
    id = crypto.randomUUID();
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ(objects) + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move one object to world coordinates (top-left). */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/**
 * Move several objects to absolute world coordinates (top-left) in one
 * transaction — the write behind a group drag and behind arrow-key nudging.
 *
 * Absolute positions (rather than deltas) are what makes a group move converge:
 * two people dragging the same objects both end with the last writer's numbers,
 * identically on every screen.
 *
 * Returns the number of objects that moved. Nothing is written when the list is
 * empty, when any position is not a finite number, or when every object is
 * already exactly where it is asked to be; objects that are no longer in the
 * document (deleted by somebody else mid-gesture) are simply skipped.
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, Point>,
): number {
  if (positions.size === 0) return 0;
  const targets: [string, Point][] = [];
  for (const [id, at] of positions) {
    if (!at || !finite(at.x) || !finite(at.y)) return 0;
    targets.push([id, at]);
  }
  const objects = objectsMap(doc);
  const moves: [Y.Map<unknown>, Point][] = [];
  // An arrow has no position of its own: dragging one moves the ends that are
  // not attached to something, which is a no-op for a fully attached arrow.
  const arrows: [string, Point][] = [];
  for (const [id, at] of targets) {
    const note = objects.get(id);
    if (!note) continue;
    if (note.get('type') === 'connector') {
      arrows.push([id, at]);
      continue;
    }
    if (note.get('x') === at.x && note.get('y') === at.y) continue;
    moves.push([note, at]);
  }
  if (moves.length === 0 && arrows.length === 0) return 0;
  let shifted = 0;
  doc.transact(() => {
    for (const [note, at] of moves) {
      note.set('x', at.x);
      note.set('y', at.y);
    }
    for (const [id, at] of arrows) {
      const box = connectorBoxOf(doc, id);
      if (!box) continue;
      if (translateConnector(doc, id, at.x - box.x, at.y - box.y)) shifted++;
    }
  }, LOCAL_ORIGIN);
  return moves.length + shifted;
}

/**
 * Resize and reposition several objects in one transaction.
 *
 * Writing `width` and `height` turns an implicit-size object (a sticky note from
 * before story 7) into an explicit-size one; there is no migration step. Values
 * that are not finite, a size at or below zero, an empty list or an object that
 * has disappeared all mean "nothing is written", and the return value is the
 * number of objects that actually changed.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;
  const entries: [string, Rect][] = [];
  for (const [id, rect] of rects) {
    if (
      !rect ||
      !finite(rect.x) ||
      !finite(rect.y) ||
      !finite(rect.width) ||
      !finite(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return 0;
    }
    entries.push([id, rect]);
  }
  const objects = objectsMap(doc);
  const writes: [Y.Map<unknown>, Rect][] = [];
  for (const [id, rect] of entries) {
    const note = objects.get(id);
    if (!note) continue;
    // An arrow is as big as the distance between its ends; there is no box to
    // write. The client never offers one a resize handle either.
    if (note.get('type') === 'connector') continue;
    if (
      note.get('x') === rect.x &&
      note.get('y') === rect.y &&
      note.get('width') === rect.width &&
      note.get('height') === rect.height
    ) {
      continue;
    }
    writes.push([note, rect]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [note, rect] of writes) {
      note.set('x', rect.x);
      note.set('y', rect.y);
      note.set('width', rect.width);
      note.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Raise a set of objects above every object that is not in the set, keeping the
 * objects' relative stacking order among themselves.
 *
 * Selected objects are ranked by their current `(z, id)` and then given the
 * `z` values straight above the highest unselected object, so a group drag
 * lifts a cluster without shuffling it.
 *
 * Returns the number of objects whose `z` changed; `0` when the set is empty or
 * already in front (no transaction, so no sync traffic).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsMap(doc);
  const selected = new Set(ids.filter((id) => objects.has(id)));
  if (selected.size === 0) return 0;

  let highestUnselected = 0;
  for (const [id, note] of objects) {
    if (selected.has(id)) continue;
    const z = numberOr(note.get('z'), 0);
    if (z > highestUnselected) highestUnselected = z;
  }

  const ranked = [...selected].sort((a, b) => {
    const za = numberOr(objects.get(a)!.get('z'), 0);
    const zb = numberOr(objects.get(b)!.get('z'), 0);
    if (za !== zb) return za - zb;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const writes: [Y.Map<unknown>, number][] = [];
  ranked.forEach((id, rank) => {
    const note = objects.get(id)!;
    const z = highestUnselected + rank + 1;
    if (note.get('z') !== z) writes.push([note, z]);
  });
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [note, z] of writes) note.set('z', z);
  }, LOCAL_ORIGIN);
  return writes.length;
}

/** Raise a note above every other object. No-op when it is already on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;
  if (isTopmost(objects, id)) return false;
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Change a note's colour. Unknown colour names and stale ids are rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const note = objectsMap(doc).get(id);
  if (!note) return false;
  if (note.get('color') === color) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove one object from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

/**
 * Remove several objects in one transaction — the write behind Delete, the
 * selection bar's bin button and the note toolbar.
 *
 * Ids that are already gone are skipped; an empty list, or a list holding only
 * stale ids, writes nothing and returns 0.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const present = [...new Set(ids)].filter((id) => objects.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Free the arrow ends that point at these objects first, in the same
    // transaction: no screen can observe a connector pointing at a missing
    // object, and undo brings the object and its re-attached end back together.
    detachConnectorsTo(doc, present);
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/** The note's shared text, or `undefined` for a stale id or other object type. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objectsMap(doc).get(id);
  if (!note) return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** The rectangle an object covers, in world units. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: finite(obj.width) ? obj.width : STICKY_SIZE_WORLD,
    height: finite(obj.height) ? obj.height : STICKY_SIZE_WORLD,
  };
}

/**
 * The ids lying **entirely** inside `rect`, in render order (the marquee rule).
 *
 * An object that is partly inside, or that only touches the edge from outside,
 * is not selected. Objects of unknown types are never offered.
 */
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const out: string[] = [];
  for (const obj of snapshot) {
    if (!isKnownObjectType(obj.type)) continue;
    if (rectContains(rect, objectBounds(obj))) out.push(obj.id);
  }
  return out;
}

/** Every selectable id on the board, in render order ("select all"). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  const out: string[] = [];
  for (const obj of snapshot) {
    if (!isKnownObjectType(obj.type)) continue;
    if (!finite(obj.x) || !finite(obj.y)) continue;
    out.push(obj.id);
  }
  return out;
}

/**
 * Immutable view of the board for rendering, sorted by `(z, id)` — bottom first.
 * Objects whose `type` this build does not know are skipped.
 */
export function snapshot(doc: Y.Doc): readonly AnySnapshot[] {
  const out: AnySnapshot[] = [];
  // Connectors are decoded in a second pass, once everything else has a
  // rectangle; see below.
  const connectors: [string, Y.Map<unknown>][] = [];
  for (const [id, note] of objectsMap(doc)) {
    const type = note.get('type');
    if (type === 'sticky') {
      const color = note.get('color');
      const text = note.get('text');
      out.push({
        id,
        type: 'sticky' as const,
        x: numberOr(note.get('x'), 0),
        y: numberOr(note.get('y'), 0),
        color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
        text: text instanceof Y.Text ? text.toString() : '',
        z: numberOr(note.get('z'), 0),
        createdAt: numberOr(note.get('createdAt'), 0),
        ...(finite(note.get('width')) ? { width: note.get('width') as number } : {}),
        ...(finite(note.get('height')) ? { height: note.get('height') as number } : {}),
      });
    } else if (type === 'shape') {
      const kind = note.get('kind');
      const fill = note.get('fill');
      const stroke = note.get('stroke');
      const label = note.get('label');
      const createdBy = note.get('createdBy');
      const labelText = label instanceof Y.Text ? label.toString() : '';
      out.push({
        id,
        type: 'shape' as const,
        text: labelText,
        x: numberOr(note.get('x'), 0),
        y: numberOr(note.get('y'), 0),
        kind: (typeof kind === 'string' && (SHAPE_KINDS as readonly string[]).includes(kind))
          ? kind as ShapeKind
          : 'rect',
        fill: (typeof fill === 'string' && Object.hasOwn(SHAPE_FILL_COLORS, fill))
          ? fill as FillColor
          : DEFAULT_SHAPE_FILL,
        stroke: (typeof stroke === 'string' && Object.hasOwn(SHAPE_STROKE_COLORS, stroke))
          ? stroke as StrokeColor
          : DEFAULT_SHAPE_STROKE,
        label: labelText,
        z: numberOr(note.get('z'), 0),
        createdAt: numberOr(note.get('createdAt'), 0),
        ...(finite(note.get('width')) ? { width: note.get('width') as number } : {}),
        ...(finite(note.get('height')) ? { height: note.get('height') as number } : {}),
        ...(typeof createdBy === 'string' ? { createdBy } : {}),
      });
    } else if (type === 'text') {
      const text = note.get('text');
      const size = note.get('size');
      const widthMode = note.get('widthMode');
      const createdBy = note.get('createdBy');
      out.push({
        id,
        type: 'text' as const,
        x: numberOr(note.get('x'), 0),
        y: numberOr(note.get('y'), 0),
        text: text instanceof Y.Text ? text.toString() : '',
        size: (typeof size === 'string' && Object.hasOwn({ S: 1, M: 1, L: 1, XL: 1 }, size))
          ? size as TextSize
          : 'M',
        widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
        z: numberOr(note.get('z'), 0),
        createdAt: numberOr(note.get('createdAt'), 0),
        ...(finite(note.get('width')) ? { width: note.get('width') as number } : {}),
        ...(finite(note.get('height')) ? { height: note.get('height') as number } : {}),
        ...(typeof createdBy === 'string' ? { createdBy } : {}),
      });
    } else if (type === 'stroke') {
      const color = note.get('color');
      const thickness = note.get('thickness');
      const points = note.get('points');
      const createdBy = note.get('createdBy');
      const baseWidth = numberOr(note.get('baseWidth'), 0);
      const baseHeight = numberOr(note.get('baseHeight'), 0);
      out.push({
        id,
        type: 'stroke' as const,
        text: '' as const,
        x: numberOr(note.get('x'), 0),
        y: numberOr(note.get('y'), 0),
        // A stroke always carries its box (the pen writes it at creation).
        width: numberOr(note.get('width'), 0),
        height: numberOr(note.get('height'), 0),
        points: Array.isArray(points) ? (points.filter(finite) as number[]) : [],
        baseWidth,
        baseHeight,
        color: (typeof color === 'string' && Object.hasOwn(PEN_COLORS, color))
          ? color as PenColor
          : DEFAULT_PEN_COLOR,
        thickness: (typeof thickness === 'string' && Object.hasOwn(PEN_THICKNESS_WORLD, thickness))
          ? thickness as PenThickness
          : DEFAULT_PEN_THICKNESS,
        z: numberOr(note.get('z'), 0),
        createdAt: numberOr(note.get('createdAt'), 0),
        ...(typeof createdBy === 'string' ? { createdBy } : {}),
      });
    } else if (type === 'connector') {
      // An arrow's box comes from the objects it joins, so it waits for the
      // first pass to finish.
      connectors.push([id, note]);
    }
    // Unknown types are skipped.
  }
  if (connectors.length > 0) {
    const rects = new Map<string, Rect>();
    for (const obj of out) {
      if (obj.type === 'connector') continue;
      rects.set(obj.id, objectBounds(obj));
    }
    for (const [id, note] of connectors) {
      const stored = readConnector(id, note);
      if (!stored) continue;
      const ends = resolveEndpoints(stored, rects);
      // No usable geometry (an end with unreadable coordinates): there is no
      // line to draw and nothing to select, so it stays out of the snapshot.
      if (!isResolvable(ends)) continue;
      const box = connectorBBox(ends.from, ends.to);
      out.push({
        id,
        type: 'connector' as const,
        text: '' as const,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        from: stored.from,
        to: stored.to,
        ends,
        z: stored.z,
        createdAt: stored.createdAt,
        ...(stored.createdBy !== undefined ? { createdBy: stored.createdBy } : {}),
      });
    }
  }
  out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Sticky notes only (backward-compatible helper for code that only handles stickies).
 */
export function stickies(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc).filter((s): s is StickySnapshot => s.type === 'sticky');
}
