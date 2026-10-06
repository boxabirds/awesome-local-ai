import * as Y from "yjs";
import {
  DEFAULT_STICKY_COLOR,
  MAX_OBJECT_SIZE_WORLD,
  STICKY_COLORS,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "./config";
import type { Point, Rect } from "./geometry";
import { rectContains } from "./geometry";

/**
 * Board document model (`board.model`).
 *
 * The Y.Doc schema and *every* mutation of board content. Framework-free (no
 * React, no DOM) so the client (story 2) and the Durable Object (story 4)
 * share one source of truth, and so the same document can be synced over the
 * wire in story 3 without changing anything here.
 *
 * Schema — story 3's wire format and story 4's persisted format:
 *
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map>
 *     <id>: Y.Map { type: 'sticky', x, y, width?, height?, color, text: Y.Text, z, createdAt }
 *
 * Story 7 adds the *group* operations (`moveObjects`, `resizeObjects`,
 * `deleteObjects`, `bringObjectsToFront`, `objectsInRect`, `allObjectIds`,
 * `objectBounds`) that every object type shares; story 2's single-object
 * functions are thin wrappers over them. `width`/`height` are additive:
 * a note created before story 7 has neither and renders at `STICKY_SIZE_WORLD`,
 * and the first resize writes both.
 *
 * Rules enforced here:
 * - ids are `crypto.randomUUID()`;
 * - `z = maxZ + 1`, and the render order is `(z, id)` so peers that end up
 *   with equal `z` values still agree on the order;
 * - one `doc.transact(fn, LOCAL_ORIGIN)` per successful mutation; rejected or
 *   pointless calls return `false` *before* a transaction is opened, so they
 *   never emit an update (no useless sync traffic);
 * - unknown object types are ignored by `snapshot` (forward compatibility for
 *   stories 9-12).
 */

/** Origin tag for local mutations: story 8 uses it for undo, story 3 to avoid echoes. */
export const LOCAL_ORIGIN: unique symbol = Symbol("vidi6-local");

/** Bumped when the schema changes; persisted in `meta.schemaVersion`. */
export const SCHEMA_VERSION = 1;

const META_KEY = "meta";
const OBJECTS_KEY = "objects";
const SCHEMA_VERSION_KEY = "schemaVersion";

/**
 * Any board object the model can read: position, size (optional, see
 * `objectBounds`), stacking and creation time, plus whatever the type itself
 * carries (`color` and `text` for sticky notes).
 *
 * Stories 9-12 add their own members here as their types arrive; the group
 * operations work on all of them.
 */
export interface ObjectSnapshot {
  readonly id: string;
  readonly type: string;
  /** Top-left corner, world units. */
  readonly x: number;
  readonly y: number;
  /** Persisted size. Absent on an object created before story 7. */
  readonly width?: number;
  readonly height?: number;
  /** Stacking order; a higher z draws on top. */
  readonly z: number;
  readonly createdAt: number;
  /** Sticky notes only. */
  readonly color?: StickyColor;
  readonly text?: string;
}

/** A sticky note: an `ObjectSnapshot` that always has its colour and text. */
export interface StickySnapshot extends ObjectSnapshot {
  readonly type: "sticky";
  readonly color: StickyColor;
  readonly text: string;
}

/** Creates `meta` and stamps the schema version, once, if absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>(META_KEY);
  if (meta.get(SCHEMA_VERSION_KEY) === undefined) {
    doc.transact(() => {
      meta.set(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Creates a sticky note centred on `at` (the stored `x`/`y` is the top-left,
 * i.e. `at` minus half a note) with the highest z, so it draws above every
 * other note.
 *
 * @returns the new id, or `false` when the point or colour is unusable.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!isFiniteNumber(at?.x) || !isFiniteNumber(at?.y)) return false;
  if (!isStickyColor(color)) return false;

  const objects = objectsMap(doc);
  const id = newId();
  const z = maxZ(objects) + 1;
  const createdAt = Date.now();

  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set("type", "sticky");
    note.set("x", at.x - STICKY_SIZE_WORLD / 2);
    note.set("y", at.y - STICKY_SIZE_WORLD / 2);
    note.set("color", color);
    note.set("text", new Y.Text());
    note.set("z", z);
    note.set("createdAt", createdAt);
    objects.set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Sets a note's top-left to (x, y) in world units.
 *
 * @returns false for a stale id, a non-finite coordinate or a move to where
 *          the note already is. Wrapper over `moveObjects` (story 7).
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/**
 * Raises a note above every other note. A no-op (and no update) when the note
 * is already topmost in the render order.
 *
 * Wrapper over `bringObjectsToFront` (story 7).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/**
 * Changes only the `color` field. Position, text, stacking and z are never
 * touched, so the note stays exactly where it was.
 *
 * @returns false for a stale id, an unknown colour name or the colour it
 *          already has.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;

  const note = stickyEntry(doc, id);
  if (!note) return false;
  if (note.get("color") === color) return false;

  doc.transact(() => {
    note.set("color", color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes the object from `objects`. Wrapper over `deleteObjects` (story 7). */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** The note's shared text, for the editor to diff into. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = stickyEntry(doc, id)?.get("text");
  return text instanceof Y.Text ? text : undefined;
}

/**
 * An immutable view of every object on the board with a usable shape, sorted by
 * `(z, id)` — the order the client renders them in. Story 7 broadened it from
 * sticky notes to all object types: an object of a type this client does not know
 * is still reported (forward compatibility) and is left where it is.
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  for (const [id, value] of objectsMap(doc)) {
    const object = asObject(id, value);
    if (object) objects.push(object);
  }
  objects.sort(compareNotes);
  return objects;
}

/**
 * Only the sticky notes, for code that deals with sticky notes alone (the
 * persistence tests, for example). `snapshot` is the board's view; this is a
 * filter over it.
 */
export function stickySnapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc).filter((entry): entry is StickySnapshot => entry.type === "sticky");
}

// ---- group operations (story 7) -----------------------------------------

/**
 * The box an object occupies: its position plus its persisted size, or
 * `STICKY_SIZE_WORLD` for an object created before sizes were persisted.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = isFiniteNumber(obj?.width) && obj.width > 0 ? obj.width : STICKY_SIZE_WORLD;
  const height = isFiniteNumber(obj?.height) && obj.height > 0 ? obj.height : STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width, height };
}

/** Ids the client may select: an optional list of type names it knows. */
export type KnownTypes = readonly string[] | ReadonlySet<string>;

function isSelectableType(type: string, knownTypes?: KnownTypes): boolean {
  if (knownTypes === undefined) return true;
  if (Array.isArray(knownTypes)) return knownTypes.includes(type);
  return (knownTypes as ReadonlySet<string>).has(type);
}

/**
 * Every object lying **entirely** inside `rect` — the marquee rule.
 *
 * An object that is partly inside, or that only touches the rectangle's edge
 * from outside, is not selected. Types the client has not registered are
 * skipped, so a type from a newer client is never selected (TC-08).
 */
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
  knownTypes?: KnownTypes,
): string[] {
  const ids: string[] = [];
  for (const object of snapshot) {
    if (!isSelectableType(object.type, knownTypes)) continue;
    if (rectContains(rect, objectBounds(object))) ids.push(object.id);
  }
  return ids;
}

/**
 * Every object a select-all can pick. `knownTypes` is what the client's object
 * registry knows: without it, every object the model can read is returned.
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[], knownTypes?: KnownTypes): string[] {
  return snapshot
    .filter((object) => isSelectableType(object.type, knownTypes))
    .map((object) => object.id);
}

/**
 * Moves objects to absolute positions (world units).
 *
 * Absolute, not incremental: a drag gesture rewrites the same target every
 * frame, so a concurrent remote move converges to the last writer and every
 * screen ends up in the same place.
 *
 * @returns how many objects actually changed (missing ids are skipped).
 *          A non-finite coordinate rejects the whole call with 0 and no update.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (!(positions instanceof Map) || positions.size === 0) return 0;

  const writes: Array<{ entry: Y.Map<unknown>; x: number; y: number }> = [];
  for (const [id, point] of positions) {
    if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return 0;
    const entry = objectEntry(doc, id);
    if (!entry) continue;
    if (entry.get("x") === point.x && entry.get("y") === point.y) continue;
    writes.push({ entry, x: point.x, y: point.y });
  }

  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const write of writes) {
      write.entry.set("x", write.x);
      write.entry.set("y", write.y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Writes each object's position *and* size, turning an implicit-size object
 * into an explicit one (story 7's only schema change).
 *
 * The model enforces the same size limits the gesture does, so a resize can
 * only land inside them: a rect under its type's minimum or over
 * `MAX_OBJECT_SIZE_WORLD` rejects the whole call with 0 and no update.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (!(rects instanceof Map) || rects.size === 0) return 0;

  const writes: Array<{ entry: Y.Map<unknown>; rect: Rect }> = [];
  for (const [id, rect] of rects) {
    const entry = objectEntry(doc, id);
    if (!entry) continue;
    if (!isUsableRect(rect, entry.get("type"))) return 0;
    // Compared against the box the object *has*, which for an object created
    // before story 7 is its type's default size rather than stored fields: a
    // resize to where it already is writes nothing, and size only becomes
    // explicit in the document when it actually changes.
    const current = asObject(id, entry);
    if (current) {
      const box = objectBounds(current);
      if (box.x === rect.x && box.y === rect.y && box.width === rect.width && box.height === rect.height) {
        continue;
      }
    }
    writes.push({ entry, rect });
  }

  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const write of writes) {
      write.entry.set("x", write.rect.x);
      write.entry.set("y", write.rect.y);
      write.entry.set("width", write.rect.width);
      write.entry.set("height", write.rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Draws the whole selection above every object outside it, keeping the
 * selection's own stacking order (`z = maxUnselectedZ + rank`, never lowered).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (!Array.isArray(ids) || ids.length === 0) return 0;

  const objects = objectsMap(doc);
  const selected = new Map<string, { entry: Y.Map<unknown>; z: number; id: string }>();
  for (const id of ids) {
    const entry = objectEntry(doc, id);
    if (!entry) continue;
    const z = entry.get("z");
    selected.set(id, { entry, z: isFiniteNumber(z) ? z : 0, id });
  }
  if (selected.size === 0) return 0;

  let maxUnselected = 0;
  for (const [id, value] of objects) {
    if (selected.has(id)) continue;
    if (!(value instanceof Y.Map) || typeof value.get("type") !== "string") continue;
    const z = value.get("z");
    if (isFiniteNumber(z) && z > maxUnselected) maxUnselected = z;
  }

  // Rank in the order the board already draws them in, so the selection's
  // internal stacking is preserved.
  const ranked = Array.from(selected.values()).sort((a, b) =>
    a.z !== b.z ? a.z - b.z : compareId(a.id, b.id),
  );

  const writes: Array<{ entry: Y.Map<unknown>; z: number }> = [];
  ranked.forEach((object, index) => {
    const target = maxUnselected + index + 1;
    // Only ever raise: an object already above the rest stays where it is.
    const z = Math.max(object.z, target);
    if (z === object.z) return;
    writes.push({ entry: object.entry, z });
  });

  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const write of writes) write.entry.set("z", write.z);
  }, LOCAL_ORIGIN);
  return writes.length;
}

/** Removes every listed object, in one transaction. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (!Array.isArray(ids) || ids.length === 0) return 0;

  const objects = objectsMap(doc);
  const present = ids.filter((id) => typeof id === "string" && id.length > 0 && objects.has(id));
  if (present.length === 0) return 0;

  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

// ---- internals ------------------------------------------------------------

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/**
 * An editable object entry: anything under `objects` that declares a type.
 *
 * Group operations are generic on purpose — stories 9-12 add types without
 * adding move/resize/delete code. What a *newer* client wrote and this one
 * cannot render is never handed to these functions: `snapshot`, `objectsInRect`
 * and `allObjectIds` skip types this model cannot read, so they can never be
 * selected.
 */
function objectEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== "string" || id.length === 0) return undefined;
  const entry = objectsMap(doc).get(id);
  if (!(entry instanceof Y.Map)) return undefined;
  return typeof entry.get("type") === "string" ? entry : undefined;
}

/** The smallest side a type may have, as far as the model itself knows. */
function modelMinSize(type: unknown): number {
  return type === "sticky" ? STICKY_MIN_SIZE_WORLD : 1;
}

/** A rect the model is allowed to write: finite, and inside both size limits. */
function isUsableRect(rect: Rect | undefined, type: unknown): rect is Rect {
  if (!rect) return false;
  if (!isFiniteNumber(rect.x) || !isFiniteNumber(rect.y)) return false;
  if (!isFiniteNumber(rect.width) || !isFiniteNumber(rect.height)) return false;
  const min = modelMinSize(type);
  return rect.width >= min && rect.height >= min && rect.width <= MAX_OBJECT_SIZE_WORLD && rect.height <= MAX_OBJECT_SIZE_WORLD;
}

function stickyEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== "string" || id.length === 0) return undefined;
  const note = objectsMap(doc).get(id);
  return note instanceof Y.Map && note.get("type") === "sticky" ? note : undefined;
}

function asObject(id: string, value: unknown): ObjectSnapshot | undefined {
  if (!(value instanceof Y.Map)) return undefined;
  const type = value.get("type");
  if (typeof type !== "string" || type.length === 0) return undefined;

  const x = value.get("x");
  const y = value.get("y");
  const width = value.get("width");
  const height = value.get("height");
  const color = value.get("color");
  const text = value.get("text");
  const z = value.get("z");
  const createdAt = value.get("createdAt");

  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;

  return {
    id,
    type,
    x,
    y,
    ...(isFiniteNumber(width) && width > 0 ? { width } : {}),
    ...(isFiniteNumber(height) && height > 0 ? { height } : {}),
    ...(type === "sticky"
      ? {
          color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
          text: text instanceof Y.Text ? text.toString() : "",
        }
      : {}),
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
}

function compareNotes(a: ObjectSnapshot, b: ObjectSnapshot): number {
  return a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Highest z over *every* object, whatever its type: a new object lands on top. */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const value of objects.values()) {
    if (!(value instanceof Y.Map)) continue;
    const z = value.get("z");
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function newId(): string {
  // `crypto` exists in every environment this module runs in (browser, workerd,
  // Node), but how it is *typed* depends on which lib set a project compiles
  // against, so it is reached through the narrow shape this needs.
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (old Node, jsdom).
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
