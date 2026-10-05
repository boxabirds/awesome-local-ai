import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
  type TextSize,
} from './config';
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

/** Union of all board object snapshots. */
export type AnySnapshot = StickySnapshot | BoardTextSnapshot;

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
  for (const [id, at] of targets) {
    const note = objects.get(id);
    if (!note) continue;
    if (note.get('x') === at.x && note.get('y') === at.y) continue;
    moves.push([note, at]);
  }
  if (moves.length === 0) return 0;
  doc.transact(() => {
    for (const [note, at] of moves) {
      note.set('x', at.x);
      note.set('y', at.y);
    }
  }, LOCAL_ORIGIN);
  return moves.length;
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
    }
    // Unknown types are skipped.
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
