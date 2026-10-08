/**
 * Yjs document schema and all board mutations for vidi6.
 *
 * Story 2 keeps the document in memory; story 3 attaches a network provider
 * and story 4 persists the same document, so this module is the single
 * owner of the schema and every mutation. It is framework-free (no React)
 * so story 4's Durable Object can import it for validation/migration.
 *
 * Schema:
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map (key = id, value = Y.Map)
 *     <id>: Y.Map {
 *       type: 'sticky' | 'text'   // 'text' is owned by shared/objects/text.ts
 *       x: number, y: number      // top-left, world units
 *       color: StickyColor        // sticky only
 *       text: Y.Text
 *       z: number                 // stacking; higher is on top
 *       createdAt: number         // epoch ms
 *       width?: number            // story 7: world units, default STICKY_SIZE_WORLD
 *       height?: number           // story 7: world units, default STICKY_SIZE_WORLD
 *       size: TextSize            // text only (story 9)
 *       widthMode: 'auto'|'fixed' // text only (story 9)
 *       createdBy: string         // text only (story 9)
 *     }
 *
 * Story 7 adds the generic object view (`ObjectSnapshot`) and the group
 * operations (moveObjects / resizeObjects / deleteObjects /
 * bringObjectsToFront / objectsInRect / allObjectIds) that multi-selection,
 * marquee, the transform gesture and the keyboard commands all write through.
 * The story 2 single-object functions are thin wrappers over them.
 */

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  TEXT_SIZES,
  type StickyColor,
  type TextSize,
} from './config';
import { type Point, type Rect, rectContains } from './geometry';

/** Transaction origin for all local (non-synced) mutations. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local-origin');

/**
 * Object types this client knows how to select, move, resize, render and
 * delete. Objects of any other type present in the document are ignored by
 * every generic operation (forward compatibility for stories 9-12).
 *
 * The client-side object registry (story 7) adds types here when it
 * registers them; the worker only ever knows 'sticky'.
 */
const knownObjectTypes: Set<string> = new Set(['sticky']);

/** Marks `type` as known to this client (idempotent). */
export function addKnownObjectType(type: string): void {
  knownObjectTypes.add(type);
}

/** True when `type` is known to this client. */
export function isKnownObjectType(type: string): boolean {
  return knownObjectTypes.has(type);
}

/**
 * Immutable view of one board object, as rendered by the client. Type
 * specific fields live on the subtype (StickySnapshot today); generic code
 * (selection, marquee, transform, keyboard) only ever sees this shape.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  /** Top-left of the object in world units. */
  x: number;
  /** Top-left of the object in world units. */
  y: number;
  /** Stacking order; higher is drawn on top. */
  z: number;
  /** Epoch ms. */
  createdAt: number;
  /**
   * World units. Additive (story 7): absent on objects created before the
   * first resize, then defaults to STICKY_SIZE_WORLD for stickies.
   */
  width?: number;
  height?: number;
  /** Sticky-only fields: present when type is 'sticky'. */
  color?: StickyColor;
  /** The object's text content (type 'sticky' or 'text'). */
  text?: string;
  /** Text-only fields (story 9): present when type is 'text'. */
  size?: TextSize;
  widthMode?: 'auto' | 'fixed';
}

/** Immutable view of one sticky note. */
export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

export const SCHEMA_VERSION = 1;

function objectsOf(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects') as Y.Map<any>;
}

/** True when the entry is a Y.Map of a known object type. */
function isKnownObject(entry: unknown): entry is Y.Map<any> {
  return (
    entry instanceof Y.Map &&
    typeof entry.get('type') === 'string' &&
    isKnownObjectType(entry.get('type'))
  );
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function knownColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

/** The highest z among all known objects (0 when there are none). */
export function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsOf(doc).values()) {
    if (!isKnownObject(entry)) {
      continue;
    }
    const z = entry.get('z');
    if (finiteNumber(z) && z > max) {
      max = z;
    }
  }
  return max;
}

/**
 * Sets `meta.schemaVersion` if absent (idempotent).
 *
 * Story 4: the room applies this under its own origin (LOAD_ORIGIN) after a
 * successful load, so `meta` is room-owned and never written by clients.
 * The `origin` parameter keeps local (client-side) init working for the
 * standalone component harness.
 */
export function initDoc(doc: Y.Doc, origin: unknown = LOCAL_ORIGIN): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(
      () => {
        meta.set('schemaVersion', SCHEMA_VERSION);
      },
      origin,
    );
  }
}

/**
 * Creates a sticky note centred on `at` (top-left = at − STICKY_SIZE_WORLD/2)
 * on top of all other notes, and returns its id. Returns `''` (falsy) when
 * the coordinates are not finite; no transaction is opened.
 *
 * Story 7: no width/height are written — the note renders at the default
 * size until the first resize makes its size explicit.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!finiteNumber(at.x) || !finiteNumber(at.y)) {
    return '';
  }
  const id = crypto.randomUUID();
  doc.transact(
    () => {
      const entry = new Y.Map();
      entry.set('type', 'sticky');
      entry.set('x', at.x - STICKY_SIZE_WORLD / 2);
      entry.set('y', at.y - STICKY_SIZE_WORLD / 2);
      entry.set('color', color);
      entry.set('text', new Y.Text());
      // Explicit default size (story 7: width/height are stored model fields;
      // readers may rely on them instead of the STICKY_SIZE_WORLD fallback).
      entry.set('width', STICKY_SIZE_WORLD);
      entry.set('height', STICKY_SIZE_WORLD);
      entry.set('z', maxZ(doc) + 1);
      entry.set('createdAt', Date.now());
      objectsOf(doc).set(id, entry);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/** The object's rect in world units, with the STICKY_SIZE_WORLD fallback. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/**
 * Ids of the snapshot objects fully inside `rect` (marquee containment
 * rule). Ids outside the snapshot — deleted remotely, unknown types — are
 * never returned.
 */
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  return snapshot
    .filter((obj) => rectContains(rect, objectBounds(obj)))
    .map((obj) => obj.id);
}

/**
 * Ids of every known object in the snapshot (select all). Unknown types are
 * absent from the snapshot by construction, so this is all selectable
 * objects on the board.
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

function allFinitePositions(positions: ReadonlyMap<string, Point>): boolean {
  for (const p of positions.values()) {
    if (!finiteNumber(p.x) || !finiteNumber(p.y)) {
      return false;
    }
  }
  return true;
}

function allFiniteRects(rects: ReadonlyMap<string, Rect>): boolean {
  for (const r of rects.values()) {
    if (
      !finiteNumber(r.x) ||
      !finiteNumber(r.y) ||
      !finiteNumber(r.width) ||
      !finiteNumber(r.height) ||
      !(r.width > 0) ||
      !(r.height > 0)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Moves every (id, position) to absolute world coordinates in one
 * LOCAL_ORIGIN transaction. Missing ids are skipped; non-finite positions
 * or an empty map reject the whole call with 0 and no transaction.
 *
 * Returns the number of objects changed. Used by the transform gesture
 * (absolute writes from gesture start) and by arrow-key nudges.
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, Point>,
): number {
  if (positions.size === 0 || !allFinitePositions(positions)) {
    return 0;
  }
  const objects = objectsOf(doc);
  let applied = 0;
  doc.transact(
    () => {
      for (const [id, p] of positions) {
        const entry = objects.get(id);
        if (!isKnownObject(entry)) {
          continue;
        }
        entry.set('x', p.x);
        entry.set('y', p.y);
        applied += 1;
      }
    },
    LOCAL_ORIGIN,
  );
  return applied;
}

/**
 * Writes every (id, rect) as absolute x/y plus explicit width/height in one
 * LOCAL_ORIGIN transaction. The first resize turns an implicit-size sticky
 * explicit; both fields are always written together. Missing ids are
 * skipped; non-finite or non-positive rects or an empty map reject the whole
 * call with 0 and no transaction.
 *
 * Returns the number of objects changed.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0 || !allFiniteRects(rects)) {
    return 0;
  }
  const objects = objectsOf(doc);
  let applied = 0;
  doc.transact(
    () => {
      for (const [id, r] of rects) {
        const entry = objects.get(id);
        if (!isKnownObject(entry)) {
          continue;
        }
        entry.set('x', r.x);
        entry.set('y', r.y);
        entry.set('width', r.width);
        entry.set('height', r.height);
        applied += 1;
      }
    },
    LOCAL_ORIGIN,
  );
  return applied;
}

/**
 * Raises the whole selection above every unselected object while preserving
 * the relative stacking among the selected ones (z = maxUnselectedZ + rank).
 * Unknown or missing ids are skipped. Returns the number of objects changed;
 * an empty id list returns 0 with no transaction.
 */
export function bringObjectsToFront(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  if (ids.length === 0) {
    return 0;
  }
  const selectedIds = new Set(ids);
  const objects = objectsOf(doc);
  let maxUnselected = 0;
  const selected: { id: string; z: number }[] = [];
  for (const [id, entry] of objects) {
    if (!isKnownObject(entry)) {
      continue;
    }
    const z = entry.get('z');
    if (!finiteNumber(z)) {
      continue;
    }
    if (selectedIds.has(id)) {
      selected.push({ id, z });
    } else if (z > maxUnselected) {
      maxUnselected = z;
    }
  }
  if (selected.length === 0) {
    return 0;
  }
  // Rank by current stacking (ties by id) so the relative order is kept.
  selected.sort((a, b) =>
    a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  // Only objects whose z actually changes are written; when the selection
  // is already stacked above the unselected objects this is a no-op (story 2
  // bringToFront contract: already-topmost → false, no transaction).
  const changes: { id: string; z: number }[] = [];
  selected.forEach(({ id, z }, rank) => {
    const newZ = maxUnselected + 1 + rank;
    if (newZ !== z) {
      changes.push({ id, z: newZ });
    }
  });
  if (changes.length === 0) {
    return 0;
  }
  doc.transact(
    () => {
      for (const { id, z } of changes) {
        (objects.get(id) as Y.Map<any>).set('z', z);
      }
    },
    LOCAL_ORIGIN,
  );
  return changes.length;
}

/**
 * Deletes every known object in `ids` in one LOCAL_ORIGIN transaction.
 * Missing ids are skipped. Returns the number of objects deleted; an empty
 * id list returns 0 with no transaction.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) {
    return 0;
  }
  const objects = objectsOf(doc);
  let applied = 0;
  doc.transact(
    () => {
      for (const id of ids) {
        const entry = objects.get(id);
        if (!isKnownObject(entry)) {
          continue;
        }
        objects.delete(id);
        applied += 1;
      }
    },
    LOCAL_ORIGIN,
  );
  return applied;
}

// --- Story 2 single-object operations (wrappers over the group versions) ----

/**
 * Moves an object to a world position. Returns false (no transaction) for
 * stale ids or non-finite coordinates.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/**
 * Raises an object's z to maxZ + 1 so it is drawn on top of everything.
 * Returns false (no transaction) for stale ids or when the object is
 * already topmost.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Removes an object from the board. Returns false for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/**
 * Sets a sticky note's colour by preset name. Returns false (no
 * transaction) for unknown colour names, stale ids, or when the note
 * already has that colour.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const entry = objectsOf(doc).get(id);
  if (!isKnownObject(entry) || entry.get('type') !== 'sticky' || !knownColor(color)) {
    return false;
  }
  if (entry.get('color') === color) {
    return false; // no-op
  }
  doc.transact(
    () => {
      entry.set('color', color);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** The Y.Text of a sticky note, or undefined for stale/unknown ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = objectsOf(doc).get(id);
  if (!isKnownObject(entry) || entry.get('type') !== 'sticky') {
    return undefined;
  }
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Stable render order: (createdAt, id). The board renders objects in this
 * order so the DOM never reorders while a drag is in flight — a DOM move
 * releases pointer capture and kills the drag. Stacking is expressed purely
 * through CSS z-index (the snapshot's z), which can change freely.
 */
export function renderOrder(
  objects: readonly ObjectSnapshot[],
): readonly ObjectSnapshot[] {
  return [...objects].sort((a, b) =>
    a.createdAt !== b.createdAt
      ? a.createdAt - b.createdAt
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0,
  );
}

/**
 * Immutable snapshots of every known object (any registered type), sorted
 * by (z, id) so concurrent equal z values give every client the same order.
 * Malformed entries are skipped (forward compatibility for later stories).
 *
 * The board renders through this view + the object registry; sticky-only
 * consumers (tests, the e2e hooks) use `snapshot` instead.
 */
export function snapshotAll(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  for (const [id, entry] of objectsOf(doc)) {
    if (!isKnownObject(entry)) {
      continue;
    }
    const type = entry.get('type');
    const x = entry.get('x');
    const y = entry.get('y');
    const z = entry.get('z');
    const createdAt = entry.get('createdAt');
    if (typeof type !== 'string' || !finiteNumber(x) || !finiteNumber(y) || !finiteNumber(z)) {
      continue;
    }
    const width = entry.get('width');
    const height = entry.get('height');
    const color = type === 'sticky' ? entry.get('color') : undefined;
    const textType = type === 'sticky' || type === 'text' ? entry.get('text') : undefined;
    const size = type === 'text' ? entry.get('size') : undefined;
    const widthMode = type === 'text' ? entry.get('widthMode') : undefined;
    out.push({
      id,
      type,
      x,
      y,
      z,
      createdAt: finiteNumber(createdAt) ? createdAt : 0,
      width: finiteNumber(width) ? width : undefined,
      height: finiteNumber(height) ? height : undefined,
      color: typeof color === 'string' ? (color as StickyColor) : undefined,
      text: textType instanceof Y.Text ? textType.toString() : undefined,
      size:
        typeof size === 'string' && size in TEXT_SIZES ? (size as TextSize) : undefined,
      widthMode:
        widthMode === 'auto' || widthMode === 'fixed' ? widthMode : undefined,
    });
  }
  out.sort((a, b) => {
    if (a.z !== b.z) {
      return a.z - b.z;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/**
 * Immutable snapshots of all sticky notes, sorted by (z, id) so concurrent
 * equal z values give every client the same order. Unknown object types and
 * malformed entries are skipped (forward compatibility for later stories).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  for (const [id, entry] of objectsOf(doc)) {
    if (!isKnownObject(entry) || entry.get('type') !== 'sticky') {
      continue;
    }
    const x = entry.get('x');
    const y = entry.get('y');
    const z = entry.get('z');
    const color = entry.get('color');
    const createdAt = entry.get('createdAt');
    if (!finiteNumber(x) || !finiteNumber(y) || !finiteNumber(z) || !knownColor(color)) {
      continue;
    }
    const width = entry.get('width');
    const height = entry.get('height');
    const text = entry.get('text');
    out.push({
      id,
      type: 'sticky',
      x,
      y,
      color,
      text: text instanceof Y.Text ? text.toString() : '',
      z,
      createdAt: finiteNumber(createdAt) ? createdAt : 0,
      width: finiteNumber(width) ? width : undefined,
      height: finiteNumber(height) ? height : undefined,
    });
  }
  out.sort((a, b) => {
    if (a.z !== b.z) {
      return a.z - b.z;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}
