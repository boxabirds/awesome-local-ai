// Yjs board document model. See the board.model contract.
//
// The document is the single source of truth for board objects. It is stored in
// a Y.Doc from day one so story 3 only attaches a network provider and story 4
// only persists the same document. This module is framework-free so the Durable
// Object (story 4) can import it for validation/migration.
//
// Schema:
//   meta:    Y.Map { schemaVersion: 1 }
//   objects: Y.Map<string, Y.Map> where each value is
//            { type:'sticky', x, y, color, text: Y.Text, z, createdAt }
//
// Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)` so
// story 8's undo manager sees one reversible operation per user action and
// story 3's provider can skip echoing local changes. Every rejection (stale id,
// unknown colour, non-finite coordinates, pointless bring-to-front) returns
// false *before* opening a transaction, so it emits no `update` event.

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  DEFAULT_TEXT_SIZE,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_MAX_CHARS,
  type StickyColor,
  type TextSize,
} from './config';
import { clampToLimit } from './text-edit';
import {
  rectContains,
  type Point,
  type Rect,
} from './geometry';

/**
 * Transaction origin for local (this client's) mutations. Story 8's undo manager
 * and story 3's provider use it to distinguish local changes from remote ones
 * and avoid echo.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Current persisted/wire schema version. */
const SCHEMA_VERSION = 1;

const META = 'meta';
const OBJECTS = 'objects';

/**
 * Object types the *model* understands. `snapshot` only returns these, and
 * `allObjectIds` / `objectsInRect` never select past them, so a board carrying a
 * type from a later story (shape, text, image …) is inert until that story adds
 * it here. Stories 9-12 append their type names; the mutation functions below
 * stay type-agnostic so a test-only type can be exercised before it is real.
 */
const KNOWN_TYPES: ReadonlySet<string> = new Set(['sticky', 'text']);

/**
 * The type-agnostic render model every generic operation (selection, marquee,
 * transform gesture) works against. Per-type fields live on the narrower
 * interfaces (`StickySnapshot` below); `width` / `height` are optional because a
 * sticky created before story 7 has neither and renders at STICKY_SIZE_WORLD.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
  createdAt: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

/**
 * A free text object (story 9). Its box is always explicit (width / height are
 * written by the client that changed the text), so a text object always carries
 * them; `widthMode` says whether the width is content-driven ('auto') or a fixed
 * value the user dragged. `TextSnapshot` re-declares width/height as required so
 * renderers do not have to re-narrow them.
 */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  width: number;
  height: number;
  createdBy: string;
}

type ObjectMap = Y.Map<unknown>;
type Objects = Y.Map<Y.Map<unknown>>;

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META);
}

function objects(doc: Y.Doc): Objects {
  return doc.getMap<Y.Map<unknown>>(OBJECTS);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

/** Return the object's Y.Map only when `id` is an existing object. */
function getSticky(doc: Y.Doc, id: string): ObjectMap | undefined {
  const map = objects(doc).get(id);
  if (!map || map.get('type') !== 'sticky') return undefined;
  return map;
}

/**
 * Return the object's Y.Map when `id` names any object present in the document.
 * The generic group operations are type-agnostic: they touch whatever is there
 * (a later story's type, or a test-only type) and simply skip an id that is gone.
 */
function getObject(doc: Y.Doc, id: string): ObjectMap | undefined {
  return objects(doc).get(id);
}

/** Highest `z` across all objects that carry a finite numeric z (0 if none). */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/**
 * Ensure the document's meta map carries a schemaVersion (the format becomes
 * the persisted/wire contract in stories 3-4, so version it from the start).
 * Idempotent: does nothing (and emits nothing) when already present.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a sticky note centred on `at` (top-left = at - size/2), on top of all
 * other notes (z = maxZ + 1). Returns the new id, or `''` when `at` is not a
 * finite point (nothing is written in that case).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return '';

  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `id-${Math.random().toString(36).slice(2)}`;

  const half = STICKY_SIZE_WORLD / 2;
  const x = at.x - half;
  const y = at.y - half;

  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', x);
    note.set('y', y);
    note.set('color', isStickyColor(color) ? color : DEFAULT_STICKY_COLOR);
    note.set('text', new Y.Text(''));
    note.set('z', maxZ(doc) + 1);
    note.set('createdAt', Date.now());
    objects(doc).set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move a sticky note to world (x, y). Thin wrapper over `moveObjects` so story 7's
 * group move and this single move share one write rule. False for a stale id or
 * non-finite input (no transaction).
 */
export function moveObject(
  doc: Y.Doc,
  id: string,
  x: number,
  y: number,
): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/**
 * Raise a note above every other one. Thin wrapper over `bringObjectsToFront`
 * (which is a no-op, hence false, when the note is already topmost).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Recolour a note. False for a stale id or a colour name not in STICKY_COLORS. */
export function setStickyColor(
  doc: Y.Doc,
  id: string,
  color: string,
): boolean {
  if (!isStickyColor(color)) return false;
  const note = getSticky(doc, id);
  if (!note) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Remove an object. Thin wrapper over `deleteObjects`; false for a stale id.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** The note's Y.Text for live editing, or undefined for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = getSticky(doc, id);
  if (!note) return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * The full render model: every object of a type the model knows (sticky, text),
 * as a generic `ObjectSnapshot` carrying that type's own fields. This is what the
 * board renders and the generic selection / marquee / transform machinery walks,
 * so a text object selects, moves and resizes exactly like a sticky (text.consistent).
 * Unknown types are skipped for forward compatibility with stories 10-12. Sorted by
 * (z, id) so every client that ever syncs this document renders the same stacking.
 */
export function objectSnapshots(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    const type = obj.get('type');
    if (type === 'sticky') {
      const text = obj.get('text');
      const color = obj.get('color');
      const snap: StickySnapshot = {
        id,
        type: 'sticky',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
        text: clampToLimit(text instanceof Y.Text ? text.toString() : '', STICKY_TEXT_MAX_CHARS),
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
      };
      const width = obj.get('width');
      const height = obj.get('height');
      if (isFiniteNumber(width)) snap.width = width;
      if (isFiniteNumber(height)) snap.height = height;
      out.push(snap);
    } else if (type === 'text') {
      const text = obj.get('text');
      const size = obj.get('size');
      const widthMode = obj.get('widthMode');
      const width = obj.get('width');
      const height = obj.get('height');
      const createdBy = obj.get('createdBy');
      const snap: TextSnapshot = {
        id,
        type: 'text',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        text: clampToLimit(text instanceof Y.Text ? text.toString() : '', TEXT_MAX_CHARS),
        size: typeof size === 'string' && size in TEXT_SIZES ? (size as TextSize) : DEFAULT_TEXT_SIZE,
        widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
        // A text object always carries a finite box; a malformed one falls back to
        // the minimum width and a single line so it still renders (never vanishes).
        width: isFiniteNumber(width) ? width : TEXT_MIN_WIDTH_WORLD,
        height:
          isFiniteNumber(height)
            ? height
            : Math.round(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT),
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
        createdBy: typeof createdBy === 'string' ? createdBy : '',
      };
      out.push(snap);
    }
    // any other known-but-unhandled type, and unknown types, are skipped.
  });
  out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Immutable render model: sticky objects only (text and other types skipped),
 * sorted by (z, id) so every client that ever syncs this document renders the
 * same stacking even if two notes share a z. Retained for the story 2 sticky
 * tests and the sticky-only test handle; the board itself renders via
 * `objectSnapshots`.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    if (obj.get('type') !== 'sticky') return; // skip unknown / future types
    const text = obj.get('text');
    const color = obj.get('color');
    const width = obj.get('width');
    const height = obj.get('height');
    const snap: StickySnapshot = {
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    };
    // A sticky resized since story 7 carries explicit width/height; one created
    // before it (or never resized) carries neither and renders at STICKY_SIZE_WORLD
    // via objectBounds' fallback, so we leave the fields off rather than fake one.
    if (isFiniteNumber(width)) snap.width = width;
    if (isFiniteNumber(height)) snap.height = height;
    out.push(snap);
  });
  out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// --- Generic group operations (story 7) ------------------------------------
//
// The selection, marquee and transform gesture act on many objects at once. Each
// mutating call below rejects bad input *before* opening a transaction (so it
// emits no `update`), skips ids that are no longer in the document, and otherwise
// performs exactly one LOCAL_ORIGIN transaction and returns how many objects it
// changed. The single-object functions above are thin wrappers over these.

/** The world rectangle an object occupies. Absent width/height fall back to
 *  STICKY_SIZE_WORLD (a sticky created before story 7 has neither field). */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: isFiniteNumber(obj.width) ? obj.width : STICKY_SIZE_WORLD,
    height: isFiniteNumber(obj.height) ? obj.height : STICKY_SIZE_WORLD,
  };
}

/**
 * Ids lying *entirely* inside `rect` (the marquee's rule): an object that is only
 * partly inside, or merely touches the edge from outside, is not returned. Unknown
 * types are skipped, matching the marquee never selecting what it cannot render.
 */
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const out: string[] = [];
  for (const obj of snapshot) {
    if (!KNOWN_TYPES.has(obj.type)) continue;
    if (rectContains(rect, objectBounds(obj))) out.push(obj.id);
  }
  return out;
}

/** Ids of every selectable object (for Ctrl/Cmd+A), unknown types excluded. */
export function allObjectIds(
  snapshot: readonly ObjectSnapshot[],
): string[] {
  const out: string[] = [];
  for (const obj of snapshot) {
    if (KNOWN_TYPES.has(obj.type)) out.push(obj.id);
  }
  return out;
}

/**
 * Move every object in `positions` to its absolute world point (the gesture
 * writes `start + delta` every frame so a concurrent remote move cannot drift the
 * result). Non-finite points and ids that are gone are skipped; the rest land in
 * one transaction. Returns the count moved (0 and no transaction if none).
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, Point>,
): number {
  if (positions.size === 0) return 0;
  const writes: { map: ObjectMap; x: number; y: number }[] = [];
  for (const [id, p] of positions) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) continue;
    const map = getObject(doc, id);
    if (!map) continue;
    writes.push({ map, x: p.x, y: p.y });
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const w of writes) {
      w.map.set('x', w.x);
      w.map.set('y', w.y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Resize every object in `rects` to an absolute world rect, writing both `width`
 * and `height` (this is what turns an implicit-size sticky into an explicit one —
 * no migration). Rects with a non-finite field or a non-positive size, and ids
 * that are gone, are skipped. Returns the count resized.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;
  const writes: { map: ObjectMap; rect: Rect }[] = [];
  for (const [id, r] of rects) {
    if (
      !isFiniteNumber(r.x) ||
      !isFiniteNumber(r.y) ||
      !isFiniteNumber(r.width) ||
      !isFiniteNumber(r.height) ||
      r.width <= 0 ||
      r.height <= 0
    ) {
      continue;
    }
    const map = getObject(doc, id);
    if (!map) continue;
    writes.push({ map, rect: r });
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const w of writes) {
      w.map.set('x', w.rect.x);
      w.map.set('y', w.rect.y);
      w.map.set('width', w.rect.width);
      w.map.set('height', w.rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Raise `ids` above every unselected object while preserving their relative
 * stacking: each is given `z = maxUnselectedZ + rank`, ranked by its current z.
 * Returns how many actually changed (0 and no transaction if the selection is
 * already topmost in the same order), so a plain click never emits a pointless
 * update.
 */
export function bringObjectsToFront(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  const selected = new Set(ids);
  let maxUnselectedZ = 0;
  const movable: { id: string; z: number }[] = [];
  objects(doc).forEach((obj, id) => {
    const zRaw = obj.get('z');
    const z = typeof zRaw === 'number' && Number.isFinite(zRaw) ? zRaw : 0;
    if (selected.has(id)) movable.push({ id, z });
    else if (z > maxUnselectedZ) maxUnselectedZ = z;
  });
  if (movable.length === 0) return 0; // nothing here to raise
  // Preserve relative stacking; ties broken by id for a deterministic order.
  movable.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : 1));
  const assign = movable.map((m, i) => ({
    map: objects(doc).get(m.id)!,
    z: maxUnselectedZ + 1 + i,
  }));
  // Already exactly there? Then no write, no update (a no-op raise).
  let unchanged = true;
  for (let i = 0; i < movable.length; i++) {
    if (movable[i]!.z !== assign[i]!.z) {
      unchanged = false;
      break;
    }
  }
  if (unchanged) return 0;
  doc.transact(() => {
    for (const a of assign) a.map.set('z', a.z);
  }, LOCAL_ORIGIN);
  return assign.length;
}

/**
 * Delete every id present in the document, in one transaction. Ids already gone
 * are skipped; an empty list or an all-gone list changes nothing (returns 0).
 */
export function deleteObjects(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  const present: string[] = [];
  for (const id of ids) if (objects(doc).has(id)) present.push(id);
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects(doc).delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
