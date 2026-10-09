/**
 * Board document model: the Yjs schema plus every board mutation.
 *
 * Framework free on purpose: the client uses it today, and the Durable Object
 * (story 4) imports the same module for validation and migration. Story 3 only
 * has to attach a network provider to the same document.
 *
 * Schema (schemaVersion 1):
 *
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map { type, x, y, color, text: Y.Text, z, createdAt }>
 *
 * Every successful mutation is exactly one `doc.transact(..., LOCAL_ORIGIN)`;
 * rejected or pointless calls return `false` before a transaction is opened, so
 * they emit no update at all (story 3 never syncs junk traffic).
 */
import * as Y from "yjs";
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "./config";

/** Origin tag for local mutations (story 8 undo, story 3 echo suppression). */
export const LOCAL_ORIGIN: unique symbol = Symbol("vidi6-local-origin");

export const SCHEMA_VERSION = 1;
export const META_KEY = "meta";
export const OBJECTS_KEY = "objects";
export const STICKY_OBJECT_TYPE = "sticky";

export interface StickySnapshot {
  id: string;
  type: "sticky";
  /** Top-left corner, world units. */
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher is drawn on top. */
  z: number;
  createdAt: number;
}

export interface Point {
  x: number;
  y: number;
}

// ---- document access -------------------------------------------------------

function metaOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(META_KEY);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/** The raw object map for `id`, or null when it does not exist. */
function objectMapOf(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  if (typeof id !== "string" || id.length === 0) return null;
  const value = objectsOf(doc).get(id);
  return value instanceof Y.Map ? value : null;
}

/** The object map for `id` when it is a usable sticky note. */
function stickyMapOf(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const map = objectMapOf(doc, id);
  if (!map || map.get("type") !== STICKY_OBJECT_TYPE) return null;
  return map;
}

// ---- API -------------------------------------------------------------------

/** Records the schema version if absent. Idempotent: never rewrites, never emits. */
export function initDoc(doc: Y.Doc): void {
  const meta = metaOf(doc);
  if (meta.get("schemaVersion") === undefined) {
    doc.transact(() => {
      meta.set("schemaVersion", SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
  objectsOf(doc);
}

/**
 * Adds a sticky note whose centre is `at` (world units), on top of every other
 * object. Returns the new id, or false for non-finite coordinates or an unknown
 * colour.
 */
export function createSticky(
  doc: Y.Doc,
  at: Point,
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return false;
  if (!isStickyColor(color)) return false;

  const id = newObjectId();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const note = new Y.Map<unknown>();
    note.set("type", STICKY_OBJECT_TYPE);
    note.set("x", at.x - STICKY_SIZE_WORLD / 2);
    note.set("y", at.y - STICKY_SIZE_WORLD / 2);
    note.set("color", color);
    note.set("z", maxZ(objects) + 1);
    note.set("createdAt", Date.now());
    note.set("text", new Y.Text());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves the object to a new top-left (world units). False when rejected or unchanged. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const map = objectMapOf(doc, id);
  if (!map) return false;
  if (map.get("x") === x && map.get("y") === y) return false;

  doc.transact(() => {
    map.set("x", x);
    map.set("y", y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Gives the object a z above every other object. False when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const map = objectMapOf(doc, id);
  if (!map) return false;

  const objects = objectsOf(doc);
  if (topmostId(objects) === id) return false;

  doc.transact(() => {
    map.set("z", maxZ(objects) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Sets the note colour. False for an unknown colour name, a stale id, or no change. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const map = stickyMapOf(doc, id);
  if (!map) return false;
  if (map.get("color") === color) return false;

  doc.transact(() => {
    map.set("color", color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes the object. False when it does not exist. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const map = objectMapOf(doc, id);
  if (!map) return false;

  const objects = objectsOf(doc);
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared Y.Text, or undefined when the note does not exist. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = stickyMapOf(doc, id);
  if (!map) return undefined;
  const text = map.get("text");
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable render model: sticky notes sorted by (z, id) so every client picks
 * the same order even when synced documents hold equal z values. Unknown object
 * types are skipped, which keeps stories 9-12 forward compatible.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectsOf(doc).forEach((value, id) => {
    const note = readSticky(id, value);
    if (note) notes.push(note);
  });
  notes.sort(compareNotes);
  return notes;
}

// ---- internals -------------------------------------------------------------

function readSticky(id: string, value: unknown): StickySnapshot | null {
  if (!(value instanceof Y.Map)) return null;
  if (value.get("type") !== STICKY_OBJECT_TYPE) return null;

  const x = finiteNumberOf(value.get("x"));
  const y = finiteNumberOf(value.get("y"));
  const z = finiteNumberOf(value.get("z"));
  if (x === null || y === null || z === null) return null;

  const rawText = value.get("text");
  let text: string | null = null;
  if (rawText instanceof Y.Text) text = rawText.toString();
  else if (typeof rawText === "string") text = rawText;
  if (text === null) return null;

  const rawColor = value.get("color");
  const color = isStickyColor(rawColor) ? rawColor : DEFAULT_STICKY_COLOR;
  const createdAt = finiteNumberOf(value.get("createdAt")) ?? 0;

  return { id, type: STICKY_OBJECT_TYPE, x, y, color, text, z, createdAt };
}

function compareNotes(a: StickySnapshot, b: StickySnapshot): number {
  if (a.z !== b.z) return a.z - b.z;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Highest z in the document (0 when there are no objects). */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let top = 0;
  objects.forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const z = finiteNumberOf(value.get("z"));
    if (z !== null && z > top) top = z;
  });
  return top;
}

/** The id drawn last under the (z, id) ordering. */
function topmostId(objects: Y.Map<Y.Map<unknown>>): string | null {
  let bestId: string | null = null;
  let bestZ = Number.NEGATIVE_INFINITY;
  objects.forEach((value, id) => {
    if (!(value instanceof Y.Map)) return;
    const z = finiteNumberOf(value.get("z"));
    if (z === null) return;
    if (z > bestZ || (z === bestZ && bestId !== null && id > bestId)) {
      bestZ = z;
      bestId = id;
    }
  });
  return bestId;
}

function finiteNumberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function newObjectId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without WebCrypto ids (never expected here).
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}
