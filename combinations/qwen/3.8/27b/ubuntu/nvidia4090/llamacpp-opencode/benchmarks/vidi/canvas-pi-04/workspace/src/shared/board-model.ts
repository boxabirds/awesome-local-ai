// Story 2: the Yjs board document model (anchor: board.model).
//
// This module owns the document schema and every mutation. It is
// framework-free (no React) so the Durable Object of story 3 can import it.
// Selection and editing state are deliberately NOT here: they are per-client
// UI state (see useSelection) and must not be stored in the shared document.
//
// Story 3: the Durable Object relays raw Yjs updates; it does not call these
// mutations, but the schema documented here is the wire contract.

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  TEXT_SIZES,
  type StickyColor,
} from './config';
import { rectContains } from './geometry';
import type { Point, Rect } from './geometry';
import type { TextSnapshot } from './objects/text';

/**
 * Transaction origin for all local (this client's user) mutations.
 * Story 8 (undo) and story 3 (echo avoidance) key off this symbol.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local-origin');

/**
 * Immutable view of a board object, as rendered by React. The base shape
 * every object type shares; type-specific fields (a sticky's colour/text) live
 * on the concrete snapshots. `width`/`height` are absent for stickies created
 * before story 7 (they render at STICKY_SIZE_WORLD) and are written by the
 * first resize (additive, no migration).
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  /** Top-left corner in world units. */
  x: number;
  /** Top-left corner in world units. */
  y: number;
  /** Stacking order; higher draws on top. */
  z: number;
  /** Explicit width in world units (sticky: its side). */
  width?: number;
  /** Explicit height in world units (sticky: its side). */
  height?: number;
}

/** Immutable view of one sticky note, as rendered by React. */
export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
  /** Epoch ms. */
  createdAt: number;
}

const OBJECTS_KEY = 'objects';
const META_KEY = 'meta';
const SCHEMA_VERSION = 1;

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>;
}

/**
 * The shared objects map (the `'objects'` top-level type). Exported so the
 * per-type model modules (sticky, text, ...) can read and write their own
 * objects without re-deriving the key.
 */
export function objectMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return objectsMap(doc);
}

/** Set `meta.schemaVersion = 1` when absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(
    () => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    },
    LOCAL_ORIGIN,
  );
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Create a yellow-by-default sticky centred on `at`, on top of everything,
 * and return its new id. Returns '' (no object, no update) when the
 * coordinates or colour are invalid.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
  if (!isStickyColor(color)) return '';

  // z = maxZ + 1 (0 when the board is empty, so the first note gets z 1).
  let z = 1;
  for (const obj of objectsMap(doc).values()) {
    const existing = asNumber(obj.get('z'), 0);
    if (existing >= z) z = existing + 1;
  }

  const id = crypto.randomUUID();
  const text = new Y.Text();
  const obj = new Y.Map();
  obj.set('type', 'sticky');
  obj.set('x', x);
  obj.set('y', y);
  obj.set('color', color);
  obj.set('text', text);
  obj.set('z', z);
  obj.set('createdAt', Date.now());
  doc.transact(
    () => {
      objectsMap(doc).set(id, obj);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/** Move an object's top-left to world (x, y); false (no update) when rejected. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/**
 * Raise an object above all others. No-op (false, no update) when the object
 * is already topmost or the id is unknown. Story 7: a thin wrapper over the
 * group re-stacking so a single object and a selection share one rule.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Set a sticky's colour to a preset colour name; false (no update) when rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = objectsMap(doc).get(id);
  if (obj === undefined) return false;
  if (obj.get('color') === color) return false; // no-op: no update

  doc.transact(
    () => {
      obj.set('color', color);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/**
 * Create a sticky note at an explicit world position. The client UI uses
 * createSticky (which derives the position from the viewport); the
 * worker-side integration tests use createStickyAt to script precise
 * positions.
 */
export function createStickyAt(
  doc: Y.Doc,
  x: number,
  y: number,
  color: string = DEFAULT_STICKY_COLOR,
): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`createStickyAt: non-finite position (${x}, ${y})`);
  }
  if (!isStickyColor(color)) {
    throw new Error(`createStickyAt: unknown colour ${String(color)}`);
  }
  const id = crypto.randomUUID();
  doc.transact(
    () => {
      const map = objectsMap(doc);
      const obj = new Y.Map<unknown>();
      let maxZ = 0;
      for (const other of map.values()) {
        const oz = asNumber(other.get('z'), 0);
        if (oz > maxZ) maxZ = oz;
      }
      obj.set('id', id);
      obj.set('type', 'sticky');
      obj.set('x', x);
      obj.set('y', y);
      obj.set('color', color);
      obj.set('text', new Y.Text());
      obj.set('z', maxZ + 1);
      obj.set('createdAt', Date.now());
      map.set(id, obj);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/** Remove an object by id; false (no update) when the id is unknown. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

// --- Story 7: generic group operations (anchor: sel.geometry_ops) ----------
//
// Every group op follows the same contract: an empty id/rect list or any
// non-finite value is rejected with 0 and NO transaction; ids that no longer
// exist (deleted remotely meanwhile) are skipped; otherwise exactly one
// LOCAL_ORIGIN transaction is applied and the count of objects actually
// changed is returned.

/**
 * World-space bounds of an object. Stickies created before this story have no
 * explicit width/height and fall back to STICKY_SIZE_WORLD (additive, no
 * migration); the first resize writes both fields.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width, height };
}

/**
 * The ids of every object lying entirely inside `rect` (the marquee's
 * fully-inside rule). Partly-inside and outside objects are not returned.
 */
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const out: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) out.push(obj.id);
  }
  return out;
}

/**
 * Every object id in the snapshot (for select-all). Unknown types never appear
 * in a snapshot, so select-all can only ever select renderable objects.
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

/**
 * Move objects to absolute world positions (id → new top-left). Used by the
 * drag and by arrow-key nudging. Non-finite values reject the whole call (0,
 * no transaction); missing ids are skipped. Returns the count moved.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  }
  const map = objectsMap(doc);
  let changed = 0;
  doc.transact(
    () => {
      for (const [id, p] of positions) {
        const obj = map.get(id);
        if (obj === undefined) continue; // missing id skipped
        obj.set('x', p.x);
        obj.set('y', p.y);
        changed += 1;
      }
    },
    LOCAL_ORIGIN,
  );
  return changed;
}

/**
 * Resize objects to absolute world rects (id → new rect). Writes x, y, width
 * and height, so the first resize turns an implicit-size sticky explicit.
 * Non-finite values reject the whole call (0, no transaction); missing ids are
 * skipped. Returns the count resized.
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
  const map = objectsMap(doc);
  let changed = 0;
  doc.transact(
    () => {
      for (const [id, r] of rects) {
        const obj = map.get(id);
        if (obj === undefined) continue; // missing id skipped
        obj.set('x', r.x);
        obj.set('y', r.y);
        obj.set('width', r.width);
        obj.set('height', r.height);
        changed += 1;
      }
    },
    LOCAL_ORIGIN,
  );
  return changed;
}

/**
 * Raise `ids` above every other object while preserving their relative
 * stacking order (Key decision 4): each selected object's z becomes
 * maxUnselectedZ + rank, rank being its position in the selection ordered by
 * its current z. Missing ids are skipped. Returns the count re-stacked.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const idSet = new Set(ids);
  const map = objectsMap(doc);

  let maxUnselectedZ = 0;
  for (const [id, obj] of map.entries()) {
    if (idSet.has(id)) continue;
    const z = asNumber(obj.get('z'), 0);
    if (z > maxUnselectedZ) maxUnselectedZ = z;
  }

  const selected: { id: string; z: number }[] = [];
  for (const id of ids) {
    const obj = map.get(id);
    if (obj === undefined) continue; // missing id skipped
    selected.push({ id, z: asNumber(obj.get('z'), 0) });
  }
  selected.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (selected.length === 0) return 0;

  let changed = 0;
  doc.transact(
    () => {
      selected.forEach((s, rank) => {
        const newZ = maxUnselectedZ + 1 + rank;
        if (newZ === s.z) return; // already in place: no pointless update
        const obj = map.get(s.id);
        if (obj === undefined) return;
        obj.set('z', newZ);
        changed += 1;
      });
    },
    LOCAL_ORIGIN,
  );
  return changed;
}

/**
 * Delete every id in `ids`. Missing ids are skipped. Returns the count
 * deleted.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const map = objectsMap(doc);
  let changed = 0;
  doc.transact(
    () => {
      for (const id of ids) {
        if (map.get(id) === undefined) continue; // missing id skipped
        map.delete(id);
        changed += 1;
      }
    },
    LOCAL_ORIGIN,
  );
  return changed;
}

/** The live Y.Text of a sticky, or undefined for unknown ids / other types. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objectsMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'sticky') return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id); objects with an
 * unknown `type` are skipped (forward compatibility with stories 9-12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  for (const [id, obj] of objectsMap(doc).entries()) {
    if (obj.get('type') !== 'sticky') continue;
    const text = obj.get('text');
    const color = obj.get('color');
    const snap: StickySnapshot = {
      id,
      type: 'sticky',
      x: asNumber(obj.get('x'), 0),
      y: asNumber(obj.get('y'), 0),
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: asNumber(obj.get('z'), 0),
      createdAt: asNumber(obj.get('createdAt'), 0),
    };
    const width = obj.get('width');
    if (typeof width === 'number' && Number.isFinite(width)) snap.width = width;
    const height = obj.get('height');
    if (typeof height === 'number' && Number.isFinite(height)) snap.height = height;
    out.push(snap);
  }
  out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Immutable snapshot of every board object, of any type, sorted by (z, id).
 * This is the generic list the client renders through the object-type
 * registry (story 7): each object carries the shared base fields (id, type,
 * x, y, z, and width/height when present). For stickies the type-specific
 * fields (color, text, createdAt) are also present at runtime; components
 * narrow `obj` to `StickySnapshot` to read them. Objects of a type with no
 * registered spec are still returned here — the client skips rendering them
 * (forward compatibility with stories 9-12). Unknown/missing `type` is
 * skipped (corrupt data).
 */
export function objectSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  for (const [id, obj] of objectsMap(doc).entries()) {
    const type = obj.get('type');
    if (typeof type !== 'string' || type === '') continue; // corrupt / untyped
    const snap: ObjectSnapshot = {
      id,
      type,
      x: asNumber(obj.get('x'), 0),
      y: asNumber(obj.get('y'), 0),
      z: asNumber(obj.get('z'), 0),
    };
    const width = obj.get('width');
    if (typeof width === 'number' && Number.isFinite(width)) snap.width = width;
    const height = obj.get('height');
    if (typeof height === 'number' && Number.isFinite(height)) snap.height = height;
    if (type === 'sticky') {
      const sticky = snap as StickySnapshot;
      const color = obj.get('color');
      const text = obj.get('text');
      sticky.color = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
      sticky.text = text instanceof Y.Text ? text.toString() : '';
      sticky.createdAt = asNumber(obj.get('createdAt'), 0);
    } else if (type === 'text') {
      const text = snap as TextSnapshot;
      const content = obj.get('text');
      text.text = content instanceof Y.Text ? content.toString() : '';
      const size = obj.get('size');
      text.size = typeof size === 'string' && size in TEXT_SIZES ? (size as TextSnapshot['size']) : 'M';
      text.widthMode = obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
      text.createdAt = asNumber(obj.get('createdAt'), 0);
      const createdBy = obj.get('createdBy');
      text.createdBy = typeof createdBy === 'string' ? createdBy : '';
    }
    out.push(snap);
  }
  out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
