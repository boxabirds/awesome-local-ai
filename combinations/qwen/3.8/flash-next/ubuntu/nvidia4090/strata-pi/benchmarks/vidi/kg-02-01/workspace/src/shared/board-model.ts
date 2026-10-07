import * as Y from "yjs";
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "./config";

/**
 * Board document model (story 2).
 *
 * The whole board lives in one `Y.Doc`:
 *
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map> where each object is
 *            { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 *
 * This module owns every mutation, so story 3 only has to attach a network
 * provider to the same document and story 4 only has to persist it. It is
 * framework-free (no React, no DOM) so the Durable Object can import it
 * unchanged for validation and migration.
 *
 * Rules every caller relies on:
 * - one `doc.transact(fn, LOCAL_ORIGIN)` per successful call, so story 8 can
 *   undo exactly the local changes and story 3 can skip echoes;
 * - rejected input (stale id, unknown colour, non-finite coordinates, a
 *   pointless `bringToFront`) returns `false` *before* a transaction opens, so
 *   it produces zero sync traffic;
 * - it never throws for user-driven input.
 */

/** Origin tag for mutations made by this client (story 8 undo, story 3 echo). */
export const LOCAL_ORIGIN: unique symbol = Symbol("vidi6-local");

/** Y.Doc shared type names, part of the persisted/wire contract. */
export const META_MAP = "meta";
export const OBJECTS_MAP = "objects";

export const STICKY_TYPE = "sticky";

type YMap = Y.Map<unknown>;

export interface StickySnapshot {
  readonly id: string;
  readonly type: "sticky";
  /** Top-left of the note, world units. */
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
  /** Stacking order: higher is drawn on top. */
  readonly z: number;
  readonly createdAt: number;
}

// ---- document lifecycle ---------------------------------------------------

/** Ensures the document's meta map exists and is versioned. Idempotent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>(META_MAP);
  if (meta.get("schemaVersion") === undefined) {
    meta.set("schemaVersion", BOARD_SCHEMA_VERSION);
  }
}

/** The `objects` map, created on first use. */
export function getObjectsMap(doc: Y.Doc): Y.Map<YMap> {
  return doc.getMap<YMap>(OBJECTS_MAP);
}

// ---- reads ----------------------------------------------------------------

/** True when the doc holds `id` as a sticky note. */
export function hasSticky(doc: Y.Doc, id: string): boolean {
  return isSticky(getObjectsMap(doc).get(id));
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = getObjectsMap(doc).get(id);
  if (!isSticky(entry)) return undefined;
  const text = entry!.get("text");
  return text instanceof Y.Text ? text : undefined;
}

/**
 * An immutable view of the board for React to render: sticky notes only
 * (unknown `type` values are skipped for forward compatibility with stories
 * 9-12), sorted by `(z, id)` so every client computes the same paint order
 * even when two clients produce the same `z`.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, entry] of getObjectsMap(doc)) {
    const note = toSticky(id, entry);
    if (note) notes.push(note);
  }
  notes.sort(compareNotes);
  return notes;
}

// ---- mutations ------------------------------------------------------------

/**
 * Create a sticky note centred on `at` (world units): the stored `x, y` is the
 * top-left, i.e. `at - STICKY_SIZE_WORLD / 2`, and `z = max z + 1` so a new
 * note is always on top of everything already on the board.
 *
 * Returns the new id, or `""` when the point is not finite (nothing is
 * written). An unknown colour name falls back to the default colour.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFiniteNumber(at?.x) || !isFiniteNumber(at?.y)) return "";

  const fill: StickyColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
  const id = newId();
  const z = maxZ(doc) + 1;
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;

  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set("type", STICKY_TYPE);
    entry.set("x", x);
    entry.set("y", y);
    entry.set("color", fill);
    entry.set("text", new Y.Text());
    entry.set("z", z);
    entry.set("createdAt", Date.now());
    getObjectsMap(doc).set(id, entry);
  }, LOCAL_ORIGIN);

  return id;
}

/** Move a note to a new top-left `(x, y)` in world units. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const entry = getObjectsMap(doc).get(id);
  if (!isSticky(entry)) return false;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;

  doc.transact(() => {
    entry!.set("x", x);
    entry!.set("y", y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Give `id` the highest `z`. A no-op (and no update) when it is already top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const entry = getObjectsMap(doc).get(id);
  if (!isSticky(entry)) return false;

  const top = maxZ(doc);
  const current = numberOr(entry!.get("z"), 0);
  if (current >= top) return false;

  doc.transact(() => {
    entry!.set("z", top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Set the note colour. Unknown colour names and stale ids are rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const entry = getObjectsMap(doc).get(id);
  if (!isSticky(entry)) return false;
  if (!isStickyColor(color)) return false;

  doc.transact(() => {
    entry!.set("color", color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getObjectsMap(doc);
  if (!objects.has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

// ---- internals ------------------------------------------------------------

function isSticky(entry: unknown): entry is YMap {
  return entry instanceof Y.Map && entry.get("type") === STICKY_TYPE;
}

function toSticky(id: string, entry: unknown): StickySnapshot | null {
  if (!isSticky(entry)) return null;
  const text = entry.get("text");
  const color = entry.get("color");
  return {
    id,
    type: STICKY_TYPE,
    x: numberOr(entry.get("x"), 0),
    y: numberOr(entry.get("y"), 0),
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : typeof text === "string" ? text : "",
    z: numberOr(entry.get("z"), 0),
    createdAt: numberOr(entry.get("createdAt"), 0),
  };
}

/** Stacking order: `z` ascending, `id` as a stable tie-break. */
function compareNotes(a: StickySnapshot, b: StickySnapshot): number {
  if (a.z !== b.z) return a.z - b.z;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of getObjectsMap(doc).values()) {
    if (!isSticky(entry)) continue;
    const z = entry.get("z");
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOr(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

/**
 * Ids are `crypto.randomUUID()`; environments without it (older jsdom) fall
 * back to an equivalent v4 UUID so the model works everywhere it is imported.
 */
function newId(): string {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (crypto && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
