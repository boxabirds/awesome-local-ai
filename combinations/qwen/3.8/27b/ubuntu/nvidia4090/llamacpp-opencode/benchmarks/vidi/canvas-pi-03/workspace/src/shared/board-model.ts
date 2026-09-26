import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';
import { rectContains, type Point, type Rect } from './geometry';

/**
 * Board document model (story 2).
 *
 * Yjs schema (the future persisted format, story 4, and wire format, story 3):
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map (id -> Y.Map)
 *     <id>: Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 *
 * - x, y are the note's top-left in world units.
 * - z is stacking order; higher is on top.
 * - Unknown `type` values are skipped by the renderer (forward compatibility).
 *
 * The module is framework-free so the Durable Object (story 4) can import it.
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
 * rejections (stale id, unknown colour, non-finite coordinates, bringToFront
 * on the topmost note) return false before opening a transaction.
 */

export const LOCAL_ORIGIN: unique symbol = Symbol('local-origin');

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  /** Story 7: explicit size (world units); absent on pre-story-7 notes. */
  width?: number;
  height?: number;
}

/**
 * Story 7: type-agnostic object snapshot. `width`/`height` are optional:
 * objects created before story 7 (fixed-size stickies) carry no explicit
 * size and render at the type's default (STICKY_SIZE_WORLD). `color` and
 * `text` are present on stickies and are read through by the renderer.
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
  color?: string;
  text?: string;
}

/**
 * Object types the board knows how to select, move, resize and delete
 * (story 7, sel.all_types). `sticky` is known from story 2; later stories
 * (9-12) declare their types through the client registry, which calls
 * registerKnownObjectType. Unknown types are still persisted but are never
 * selected by select-all and are skipped by the renderer (forward
 * compatibility).
 */
const KNOWN_OBJECT_TYPES: ReadonlySet<string> = new Set(['sticky']);

/** Declares `type` as a known board object type. Idempotent. */
export function registerKnownObjectType(type: string): void {
  (KNOWN_OBJECT_TYPES as Set<string>).add(type);
}

/** True when this build knows the type (selectable, included in allObjectIds). */
export function isKnownObjectType(type: string): boolean {
  return KNOWN_OBJECT_TYPES.has(type);
}

/**
 * World rect of an object. Stickies without an explicit width/height fall
 * back to STICKY_SIZE_WORLD (additive field, no migration); other types
 * without an explicit size are degenerate (0x0).
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  let width: number;
  let height: number;
  if (obj.type === 'sticky') {
    width = obj.width !== undefined && Number.isFinite(obj.width) ? obj.width : STICKY_SIZE_WORLD;
    height = obj.height !== undefined && Number.isFinite(obj.height) ? obj.height : STICKY_SIZE_WORLD;
  } else {
    width = obj.width !== undefined && Number.isFinite(obj.width) ? obj.width : 0;
    height = obj.height !== undefined && Number.isFinite(obj.height) ? obj.height : 0;
  }
  return { x: obj.x, y: obj.y, width, height };
}

/**
 * Immutable snapshot of ALL board objects (any type), sorted by (z, id) so
 * equal z values still order identically on every client.
 */
export function objectSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  objectsMap(doc).forEach((obj, id) => {
    const type = obj.get('type');
    if (typeof type !== 'string') return;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    const createdAt = obj.get('createdAt');
    const width = obj.get('width');
    const height = obj.get('height');
    const color = obj.get('color');
    const text = obj.get('text');
    out.push({
      id,
      type,
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
      z: typeof z === 'number' ? z : 0,
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
      ...(typeof width === 'number' && Number.isFinite(width) ? { width } : {}),
      ...(typeof height === 'number' && Number.isFinite(height) ? { height } : {}),
      ...(typeof color === 'string' ? { color } : {}),
      ...(text instanceof Y.Text ? { text: text.toString() } : typeof text === 'string' ? { text } : {}),
    });
  });
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Ids of objects whose bounds lie entirely inside `rect` (marquee rule,
 * sel.marquee). A rect touching an object without enclosing it selects
 * nothing for that object.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    return [];
  }
  return snapshot.filter((o) => rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/** Ids of objects with a known type only (select-all, sel.all). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.filter((o) => KNOWN_OBJECT_TYPES.has(o.type)).map((o) => o.id);
}

/**
 * Writes absolute world positions for a group of objects (drag, nudge).
 * Missing ids are skipped; non-finite values or an empty map return 0 with
 * no transaction; otherwise exactly one LOCAL_ORIGIN transaction and the
 * count of objects changed.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  }
  const objects = objectsMap(doc);
  const valid: Array<[Y.Map<unknown>, Point]> = [];
  for (const [id, p] of positions) {
    const obj = objects.get(id);
    if (!obj) continue; // missing ids are skipped (deleted remotely)
    valid.push([obj, p]);
  }
  if (valid.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, p] of valid) {
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return valid.length;
}

/**
 * Writes absolute world rects for a group of objects (group resize).
 * Writes both `width` and `height`, turning implicit-size stickies explicit
 * on first resize. Same rejection/skip/transaction rules as moveObjects.
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
  const objects = objectsMap(doc);
  const valid: Array<[Y.Map<unknown>, Rect]> = [];
  for (const [id, r] of rects) {
    const obj = objects.get(id);
    if (!obj) continue;
    valid.push([obj, r]);
  }
  if (valid.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, r] of valid) {
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return valid.length;
}

/**
 * Raises the given ids above every unselected object, preserving their
 * relative stacking order (reassigns z = maxUnselectedZ + rank, rank in the
 * selection's current (z, id) order). Returns the number of objects whose z
 * changed (0 when already on top, no transaction).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const selected: Array<{ id: string; z: number }> = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue; // defensive: duplicate ids
    const obj = objects.get(id);
    if (!obj) continue;
    const z = obj.get('z');
    seen.add(id);
    selected.push({ id, z: typeof z === 'number' && Number.isFinite(z) ? z : 0 });
  }
  if (selected.length === 0) return 0;
  selected.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let maxUnselected = 0;
  objects.forEach((obj, id) => {
    if (seen.has(id)) return;
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > maxUnselected) maxUnselected = z;
  });

  let changed = 0;
  const target = new Map<string, number>();
  selected.forEach((s, rank) => {
    const z = maxUnselected + rank + 1;
    target.set(s.id, z);
    if (s.z !== z) changed += 1;
  });
  if (changed === 0) return 0;
  doc.transact(() => {
    target.forEach((z, id) => {
      objects.get(id)?.set('z', z);
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Removes a group of objects. Missing ids are skipped; an empty or all-missing
 * list returns 0 with no transaction; otherwise one LOCAL_ORIGIN transaction
 * and the count removed.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const present: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (objects.has(id)) present.push(id);
  }
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const SCHEMA_VERSION = 1;

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY);
}

function stickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  return obj;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/**
 * Materialises the board's top-level types and stamps the schema version.
 * Setting meta.schemaVersion emits exactly one update; creating the named
 * types (getMap) does not. Idempotent: a second call on the same doc is a
 * no-op (schemaVersion is already present).
 *
 * The worker room does not use this: its load target is a pristine doc with
 * no meta (see BoardRoom.freshDoc), because persisted rows already carry the
 * top-level types. The room stamps meta lazily via ensureMeta instead.
 */
export function initDoc(doc: Y.Doc): void {
  doc.getMap(OBJECTS_KEY);
  ensureMeta(doc);
}

/**
 * Sets meta.schemaVersion exactly once (no-op when already present). Called
 * inside the first content transaction so the first persisted update carries
 * meta alongside the content.
 */
export function ensureMeta(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (!meta.has('schemaVersion')) {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }
}

/**
 * Creates a sticky note centred on `at` (world point), on top of everything.
 * Returns the new id, or '' when the coordinates are not finite.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  if (!isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  const text = new Y.Text();
  doc.transact(() => {
    ensureMeta(doc); // first content writes meta.schemaVersion (idempotent)
    const objects = objectsMap(doc);
    const obj = new Y.Map();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', text);
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves a note's top-left to world (x, y). */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raises a note above all others. No-op (false) if it is already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  const objects = objectsMap(doc);
  const z = obj.get('z');
  const top = maxZ(objects);
  if (typeof z === 'number' && z >= top) return false;
  doc.transact(() => {
    obj.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Changes a note's colour. Unknown colour names or stale ids are rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes a note from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  doc.transact(() => {
    objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The Y.Text of a sticky note, or undefined for unknown/non-sticky ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = stickyMap(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Sticky-note views of a set of object snapshots (the sticky subset with
 * colour/text defaults applied). Pure, so tests and the renderer can reuse it.
 */
export function stickyNotes(objects: readonly ObjectSnapshot[]): readonly StickySnapshot[] {
  return objects
    .filter((o): o is ObjectSnapshot & { type: 'sticky' } => o.type === 'sticky')
    .map((o) => ({
      id: o.id,
      type: 'sticky',
      x: o.x,
      y: o.y,
      color: isStickyColor(o.color) ? o.color : DEFAULT_STICKY_COLOR,
      text: typeof o.text === 'string' ? o.text : '',
      z: o.z,
      createdAt: o.createdAt,
      ...(o.width !== undefined ? { width: o.width } : {}),
      ...(o.height !== undefined ? { height: o.height } : {}),
    }));
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so concurrent
 * equal z values still order identically on every client. Unknown object
 * types are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return stickyNotes(objectSnapshot(doc));
}
