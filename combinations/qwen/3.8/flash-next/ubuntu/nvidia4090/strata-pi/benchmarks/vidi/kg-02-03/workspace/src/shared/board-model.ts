import * as Y from "yjs";
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "./config";

/**
 * The board document model: the Yjs schema plus every mutation the board can
 * make.
 *
 * Framework-free on purpose — the client uses it now, and the Durable Object
 * (story 4) imports this same module for validation and migration. Every
 * successful mutation happens inside a single `doc.transact(fn, LOCAL_ORIGIN)`
 * so story 3 can ignore its own echoes and story 8 can undo only local work.
 *
 * Schema (also the future persisted and wire format):
 *
 *   meta:    Y.Map { schemaVersion: number }
 *   objects: Y.Map<id, Y.Map {
 *              type: "sticky", x: number, y: number,
 *              color: StickyColor, text: Y.Text, z: number, createdAt: number
 *            }>
 */

/** Origin tag for changes this client made itself. */
export const LOCAL_ORIGIN: unique symbol = Symbol("vidi6-local");

/** Name of the shared map that holds board objects. */
export const OBJECTS_MAP = "objects";
/** Name of the shared map that holds document metadata. */
export const META_MAP = "meta";
/** The only object type story 2 knows about; unknown types are skipped. */
export const STICKY_TYPE = "sticky";

export interface StickySnapshot {
  id: string;
  type: "sticky";
  /** Top-left corner in world units. */
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher is drawn on top. */
  z: number;
  createdAt: number;
}

export interface PointLike {
  x: number;
  y: number;
}

/** Sets `meta.schemaVersion` if it is absent. Safe to call on every load. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META_MAP);
  if (meta.get("schemaVersion") !== undefined) return;
  doc.transact(() => {
    meta.set("schemaVersion", BOARD_SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (the stored `x`/`y` is the top-left,
 * i.e. the point minus half the note size) on top of every other object.
 * Returns the new id, or `""` when the input was rejected.
 */
export function createSticky(
  doc: Y.Doc,
  at: PointLike,
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isPoint(at)) return "";
  if (!isStickyColor(color)) return "";

  const id = newId();
  const z = maxZ(objects(doc)) + 1;
  const text = new Y.Text();
  const createdAt = Date.now();

  doc.transact(() => {
    const object = new Y.Map<unknown>();
    object.set("type", STICKY_TYPE);
    object.set("x", at.x - STICKY_SIZE_WORLD / 2);
    object.set("y", at.y - STICKY_SIZE_WORLD / 2);
    object.set("color", color);
    object.set("text", text);
    object.set("z", z);
    object.set("createdAt", createdAt);
    objects(doc).set(id, object);
  }, LOCAL_ORIGIN);

  return id;
}

/** Moves an object to a new world position. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const object = getObject(doc, id);
  if (!object) return false;
  if (object.get("x") === x && object.get("y") === y) return false;

  doc.transact(() => {
    object.set("x", x);
    object.set("y", y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Gives an object the highest `z`. No-op (false) when it is already on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const object = getObject(doc, id);
  if (!object) return false;

  const z = object.get("z");
  if (!isFiniteNumber(z)) return false;
  const top = maxZ(objects(doc));
  if (z === top) return false;

  doc.transact(() => {
    object.set("z", top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Changes only the colour of a sticky note. Unknown colours and stale ids are rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const object = getObject(doc, id);
  if (!object || object.get("type") !== STICKY_TYPE) return false;
  if (object.get("color") === color) return false;

  doc.transact(() => {
    object.set("color", color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes an object from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const map = objects(doc);
  if (!map.has(id)) return false;

  doc.transact(() => {
    map.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The `Y.Text` of a note, so the text editor can diff into it. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = getObject(doc, id);
  if (!object) return undefined;
  const text = object.get("text");
  return text instanceof Y.Text ? text : undefined;
}

/** Whether an object is still in the document (interaction guard). */
export function objectExists(doc: Y.Doc, id: string): boolean {
  return getObject(doc, id) !== undefined;
}

/**
 * An immutable render model: every known object, sorted by `(z, id)` so all
 * clients agree on the stacking order even when concurrent edits produce equal
 * `z` values. Objects of unknown types (stories 9-12) are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];

  for (const [id, object] of objects(doc)) {
    if (!object || typeof object.get !== "function") continue;
    if (object.get("type") !== STICKY_TYPE) continue;

    const x = object.get("x");
    const y = object.get("y");
    const z = object.get("z");
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) continue;

    const color = object.get("color");
    const createdAt = object.get("createdAt");
    const text = object.get("text");

    notes.push(
      Object.freeze({
        id,
        type: "sticky" as const,
        x,
        y,
        color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
        text: text instanceof Y.Text ? text.toString() : typeof text === "string" ? text : "",
        z,
        createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      }),
    );
  }

  notes.sort((a, b) => a.z - b.z || compareIds(a.id, b.id));
  return Object.freeze(notes);
}

/** All objects currently in the document, unordered. */
export function sortedObjectIds(doc: Y.Doc): string[] {
  return snapshot(doc).map((note) => note.id);
}

// ---- internals ------------------------------------------------------------

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== "string" || id.length === 0) return undefined;
  const object = objects(doc).get(id);
  return object && typeof object.get === "function" ? object : undefined;
}

function maxZ(map: Y.Map<Y.Map<unknown>>): number {
  let top = 0;
  for (const object of map.values()) {
    const z = object?.get?.("z");
    if (isFiniteNumber(z) && z > top) top = z;
  }
  return top;
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPoint(point: PointLike | null | undefined): point is PointLike {
  return !!point && typeof point === "object" && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `crypto.randomUUID()` needs a secure context; the board is served from
 * localhost or HTTPS, and the fallback keeps it working anywhere else.
 */
function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
