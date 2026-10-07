/**
 * Board document model: the Yjs schema every board object lives in, plus the
 * only functions allowed to change it.
 *
 * The module is framework-free on purpose: the client uses it today, and the
 * server (story 4) imports the same file to validate and migrate the document
 * that stories 3 and 4 sync and persist.
 *
 * Schema (schema version 1):
 *
 *   Y.Doc
 *     meta:    Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<id, Y.Map { type, x, y, color, text: Y.Text, z, createdAt }>
 *
 * Rules enforced here, so no UI ever has to:
 * - one `doc.transact(fn, LOCAL_ORIGIN)` per successful mutation;
 * - a rejected mutation (stale id, unknown colour, non-finite coordinates,
 *   bringing the topmost note forward) opens **no** transaction at all, so it
 *   produces no sync traffic;
 * - `snapshot` is sorted by `(z, id)` and skips object types it does not
 *   understand, so forward-compatible types (stories 9-12) never break the
 *   sticky note renderer.
 */

import * as Y from "yjs";
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "./config";

/** Origin tag for changes this client made locally (story 8 undo, story 3 echo). */
export const LOCAL_ORIGIN: unique symbol = Symbol("vidi6-local-origin");

/** Schema version written to `meta.schemaVersion` (story 4 migrates from it). */
export const BOARD_SCHEMA_VERSION = 1;

export interface StickySnapshot {
  readonly id: string;
  readonly type: "sticky";
  /** Top-left corner, world units. */
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
  /** Stacking order; higher is drawn on top. */
  readonly z: number;
  readonly createdAt: number;
}

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** Registers `meta.schemaVersion` if the document does not have one yet. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>("meta");
  if (meta.get("schemaVersion") !== undefined) return;
  doc.transact(() => {
    meta.set("schemaVersion", BOARD_SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Creates a sticky note **centred** on `at` (the point the user aimed at):
 * the stored position is the top-left, `at` minus half the note size.
 * Returns the new id, or `false` when the point or colour is invalid.
 */
export function createSticky(
  doc: Y.Doc,
  at: WorldPoint,
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!isFinitePoint(at)) return false;
  if (!isStickyColor(color)) return false;

  const id = newId();
  const z = maxZOf(doc) + 1;
  const createdAt = Date.now();
  const half = STICKY_SIZE_WORLD / 2;

  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set("type", "sticky");
    map.set("x", at.x - half);
    map.set("y", at.y - half);
    map.set("color", color);
    map.set("text", new Y.Text());
    map.set("z", z);
    map.set("createdAt", createdAt);
    objectsOf(doc).set(id, map);
  }, LOCAL_ORIGIN);

  return id;
}

/** Moves an object to a new top-left position (world units). */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const map = getObject(doc, id);
  if (!map) return false;

  doc.transact(() => {
    map.set("x", x);
    map.set("y", y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Stacks an object above every other one. No-op (and no update) when it is already on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const map = getObject(doc, id);
  if (!map) return false;

  const entries = objectEntries(doc);
  const top = topmostId(entries);
  if (top === id) return false;

  const z = maxZOf(doc) + 1;
  doc.transact(() => {
    map.set("z", z);
  }, LOCAL_ORIGIN);
  return true;
}

/** Changes a sticky note's colour, leaving text, position and stacking alone. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const map = getStickyMap(doc, id);
  if (!map) return false;
  if (map.get("color") === color) return false;

  doc.transact(() => {
    map.set("color", color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes an object from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (!getObject(doc, id)) return false;

  doc.transact(() => {
    objectsOf(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, for the editor to diff into. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = getStickyMap(doc, id);
  const text = map?.get("text");
  return text instanceof Y.Text ? text : undefined;
}

/** Immutable render snapshot: sticky notes only, sorted by `(z, id)`. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const entry of objectEntries(doc)) {
    const note = readSticky(entry.id, entry.map);
    if (note) notes.push(note);
  }
  notes.sort(compareNotes);
  return notes;
}

// ---- internals -------------------------------------------------------------

interface ObjectEntry {
  readonly id: string;
  readonly map: Y.Map<unknown>;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("objects");
}

function objectEntries(doc: Y.Doc): ObjectEntry[] {
  const entries: ObjectEntry[] = [];
  for (const [id, value] of objectsOf(doc)) {
    if (value instanceof Y.Map) entries.push({ id, map: value });
  }
  return entries;
}

function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const value = objectsOf(doc).get(id);
  return value instanceof Y.Map ? value : undefined;
}

function getStickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const map = getObject(doc, id);
  return map && map.get("type") === "sticky" ? map : undefined;
}

function readSticky(id: string, map: Y.Map<unknown>): StickySnapshot | undefined {
  if (map.get("type") !== "sticky") return undefined;

  const x = map.get("x");
  const y = map.get("y");
  const z = map.get("z");
  const createdAt = map.get("createdAt");
  const text = map.get("text");
  const color = map.get("color");

  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;

  return {
    id,
    type: "sticky",
    x,
    y,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : "",
    z: isFiniteNumber(z) ? z : 0,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
}

function compareNotes(a: StickySnapshot, b: StickySnapshot): number {
  // `z` first; `id` breaks ties so concurrent edits by different clients
  // (story 3) still produce the same order on every machine.
  if (a.z !== b.z) return a.z - b.z;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function maxZOf(doc: Y.Doc): number {
  let max = 0;
  for (const { map } of objectEntries(doc)) {
    const z = map.get("z");
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

function topmostId(entries: ObjectEntry[]): string | null {
  let best: { id: string; z: number } | null = null;
  for (const { id, map } of entries) {
    const rawZ = map.get("z");
    const z = isFiniteNumber(rawZ) ? rawZ : 0;
    if (!best || z > best.z || (z === best.z && id > best.id)) best = { id, z };
  }
  return best?.id ?? null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFinitePoint(point: WorldPoint): boolean {
  return !!point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

/** `crypto.randomUUID()` where available, with a UUID-shaped fallback. */
function newId(): string {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const random = crypto?.getRandomValues
    ? () => {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return bytes;
      }
    : () => new Uint8Array(16).map(() => Math.floor(Math.random() * 256));

  const bytes = random();
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
