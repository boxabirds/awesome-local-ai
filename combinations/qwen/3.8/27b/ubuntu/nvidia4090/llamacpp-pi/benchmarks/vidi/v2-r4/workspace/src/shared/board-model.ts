/**
 * Board document model (story 2): the Yjs schema and every mutation.
 *
 * The board document is the future persisted and wire contract: story 3
 * attaches a network provider to the same `Y.Doc` and story 4 persists it,
 * so the schema (including `meta.schemaVersion`) is defined here, in a
 * framework-free module that the Durable Object can import.
 *
 * Schema:
 * ```
 * Y.Doc
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map (id -> Y.Map)
 *     <id>: Y.Map {
 *       type: 'sticky'
 *       x: number, y: number        // top-left, world units
 *       color: StickyColor
 *       text: Y.Text
 *       z: number                   // stacking; higher is on top
 *       createdAt: number           // epoch ms
 *     }
 * ```
 *
 * All mutation functions return `true` when a change was applied, `false`
 * when the input was rejected or the call was a no-op, and they open a
 * single `doc.transact(fn, LOCAL_ORIGIN)` per successful call. Rejections
 * (stale ids, unknown colours, non-finite coordinates, bringToFront on the
 * topmost note) happen before any transaction, so they emit no `update`
 * event. The module never throws for user-driven input.
 */
import * as Y from "yjs";
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "./config";

/**
 * Transaction origin for local (this page's) edits. Story 8 uses it for
 * undo scoping and story 3 uses it to avoid echoing remote updates.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol("vidi6.local-origin");

/** Immutable read of one sticky note, as rendered. */
export interface StickySnapshot {
  id: string;
  type: "sticky";
  /** Top-left corner in world units. */
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher is on top. Ties break by id (see snapshot). */
  z: number;
  /** Creation time, epoch ms. */
  createdAt: number;
}

const META_KEY = "meta";
const OBJECTS_KEY = "objects";
const SCHEMA_VERSION = 1;

function objectsMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(OBJECTS_KEY);
}

/** True for a well-formed sticky note object map. */
function isSticky(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map && value.get("type") === "sticky";
}

/** The highest z among all sticky notes (0 when the board is empty). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  objectsMap(doc).forEach((value) => {
    if (!isSticky(value)) return;
    const z = value.get("z");
    if (typeof z === "number" && Number.isFinite(z) && z > top) top = z;
  });
  return top;
}

/**
 * Ensure `meta.schemaVersion` exists. Sets it once (1) and is a no-op when
 * already present, so repeated initialisation (or a later migration in
 * story 4) never rewrites it.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (meta.get("schemaVersion") !== SCHEMA_VERSION) {
    doc.transact(() => {
      meta.set("schemaVersion", SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a sticky note centred on `at` (world units) with `z = maxZ + 1`,
 * so it appears on top of all other notes. Returns the new id, or `""`
 * when the point is not finite (nothing is written in that case).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return "";
  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  const createdAt = Date.now();
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;
  doc.transact(() => {
    const sticky = new Y.Map();
    sticky.set("type", "sticky");
    sticky.set("x", x);
    sticky.set("y", y);
    sticky.set("color", color);
    sticky.set("text", new Y.Text());
    sticky.set("z", z);
    sticky.set("createdAt", createdAt);
    objectsMap(doc).set(id, sticky);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move a note's top-left corner to world `(x, y)`. Returns false (no
 * transaction) for stale ids, non-finite coordinates or a no-op move.
 */
export function moveObject(
  doc: Y.Doc,
  id: string,
  x: number,
  y: number,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const object = objectsMap(doc).get(id);
  if (!isSticky(object)) return false;
  if (object.get("x") === x && object.get("y") === y) return false;
  doc.transact(() => {
    object.set("x", x);
    object.set("y", y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raise the note to the next stacking level (`maxZ + 1`) so it is drawn
 * above every other note. Returns false (no transaction) for stale ids or
 * when the note is already topmost.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const object = objectsMap(doc).get(id);
  if (!isSticky(object)) return false;
  const z = object.get("z");
  const top = maxZ(doc);
  if (typeof z === "number" && z === top) return false;
  doc.transact(() => {
    object.set("z", top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Change a note's colour to one of STICKY_COLORS. Only the `color` field is
 * written: text, position and stacking are untouched. Returns false (no
 * transaction) for unknown colour names, stale ids or the current colour.
 */
export function setStickyColor(
  doc: Y.Doc,
  id: string,
  color: string,
): boolean {
  if (typeof color !== "string" || !(color in STICKY_COLORS)) return false;
  const object = objectsMap(doc).get(id);
  if (!isSticky(object)) return false;
  if (object.get("color") === color) return false;
  doc.transact(() => {
    object.set("color", color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note from the board. Returns false (no transaction) for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const object = objects.get(id);
  if (!isSticky(object)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's Y.Text, or undefined for stale/unknown ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = objectsMap(doc).get(id);
  if (!isSticky(object)) return undefined;
  const text = object.get("text");
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshots of all sticky notes, sorted by `(z, id)` so every
 * client renders the same order even with concurrent equal `z` values
 * (possible once story 3 syncs documents). Objects with an unknown `type`
 * are skipped (forward compatibility for stories 9-12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectsMap(doc).forEach((value, id) => {
    if (!isSticky(value)) return;
    const x = value.get("x");
    const y = value.get("y");
    const z = value.get("z");
    const color = value.get("color");
    const text = value.get("text");
    const createdAt = value.get("createdAt");
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      typeof color !== "string" ||
      !(color in STICKY_COLORS) ||
      !(text instanceof Y.Text) ||
      typeof createdAt !== "number"
    ) {
      return;
    }
    notes.push({
      id: String(id),
      type: "sticky",
      x,
      y,
      color: color as StickyColor,
      text: text.toString(),
      z,
      createdAt,
    });
  });
  notes.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : 1));
  return notes;
}
