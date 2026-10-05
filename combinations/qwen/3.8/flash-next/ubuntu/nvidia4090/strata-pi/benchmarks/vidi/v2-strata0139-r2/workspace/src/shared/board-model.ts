import * as Y from "yjs";
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "./config";

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
 *     <id>: Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
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

export interface StickySnapshot {
  readonly id: string;
  readonly type: "sticky";
  /** Top-left corner, world units. */
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
  /** Stacking order; a higher z draws on top. */
  readonly z: number;
  readonly createdAt: number;
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
 *          the note already is.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;

  const note = stickyEntry(doc, id);
  if (!note) return false;
  if (note.get("x") === x && note.get("y") === y) return false;

  doc.transact(() => {
    note.set("x", x);
    note.set("y", y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raises a note above every other note. A no-op (and no update) when the note
 * is already topmost in the render order.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const note = stickyEntry(doc, id);
  if (!note) return false;

  const top = topmostEntry(objects);
  if (top && top.id === id) return false;

  const z = maxZ(objects) + 1;
  doc.transact(() => {
    note.set("z", z);
  }, LOCAL_ORIGIN);
  return true;
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

/** Removes the object from `objects`. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, for the editor to diff into. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = stickyEntry(doc, id)?.get("text");
  return text instanceof Y.Text ? text : undefined;
}

/**
 * An immutable view of all notes, sorted by `(z, id)` — the order the client
 * renders them in. Unknown object types are skipped rather than throwing.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, value] of objectsMap(doc)) {
    const note = asSticky(id, value);
    if (note) notes.push(note);
  }
  notes.sort(compareNotes);
  return notes;
}

// ---- internals ------------------------------------------------------------

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

function stickyEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== "string" || id.length === 0) return undefined;
  const note = objectsMap(doc).get(id);
  return note instanceof Y.Map && note.get("type") === "sticky" ? note : undefined;
}

function asSticky(id: string, value: unknown): StickySnapshot | undefined {
  if (!(value instanceof Y.Map)) return undefined;
  if (value.get("type") !== "sticky") return undefined;

  const x = value.get("x");
  const y = value.get("y");
  const color = value.get("color");
  const text = value.get("text");
  const z = value.get("z");
  const createdAt = value.get("createdAt");

  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;

  return {
    id,
    type: "sticky",
    x,
    y,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : "",
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
}

function compareNotes(a: StickySnapshot, b: StickySnapshot): number {
  return a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const value of objects.values()) {
    if (!(value instanceof Y.Map) || value.get("type") !== "sticky") continue;
    const z = value.get("z");
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

/** The note drawn last, i.e. the last of the `(z, id)` order. */
function topmostEntry(objects: Y.Map<Y.Map<unknown>>): { id: string; z: number } | undefined {
  let best: { id: string; z: number } | undefined;
  for (const [id, value] of objects) {
    if (!(value instanceof Y.Map) || value.get("type") !== "sticky") continue;
    const z = value.get("z");
    if (!isFiniteNumber(z)) continue;
    if (
      !best ||
      z > best.z ||
      (z === best.z && compareId(id, best.id) > 0)
    ) {
      best = { id, z };
    }
  }
  return best;
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
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (old Node, jsdom).
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
