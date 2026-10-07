import * as Y from "yjs";
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "./config";

/**
 * The board document model: the Yjs schema plus every mutation the board
 * performs.
 *
 * Framework-free on purpose: the client uses it now, the Durable Object (story
 * 4) imports the same module for validation and migration, and the wire format
 * (story 3) is this document.
 *
 * Document schema (`meta.schemaVersion` = 1):
 *
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map>
 *     <id>: Y.Map {
 *       type: 'sticky'
 *       x: number, y: number   // top-left corner, world units
 *       color: StickyColor
 *       text: Y.Text
 *       z: number              // stacking order, higher is on top
 *       createdAt: number      // epoch ms
 *     }
 *
 * Errors are values, never exceptions: a stale id, an unknown colour or a
 * non-finite coordinate returns `false` and opens no transaction, so a buggy or
 * malicious client can never corrupt the document.
 */

/** Transaction origin for every local mutation (story 8 undo, story 3 echo). */
export const LOCAL_ORIGIN: unique symbol = Symbol("vidi6-local");

/** Schema version of the document this module understands. */
export const SCHEMA_VERSION = 1;
/** Shared type names, part of the persisted/wire contract. */
export const META_MAP = "meta";
export const OBJECTS_MAP = "objects";

export interface StickySnapshot {
  readonly id: string;
  readonly type: "sticky";
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
  readonly z: number;
  readonly createdAt: number;
}

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** The `objects` map: id -> object body. */
export function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

/** Creates `meta` and stamps the schema version when it is absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>(META_MAP);
  if (meta.get("schemaVersion") === SCHEMA_VERSION) return;
  doc.transact(() => {
    meta.set("schemaVersion", SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (its top-left is
 * `at - STICKY_SIZE_WORLD / 2`) with `z = maxZ + 1`, i.e. on top of every other
 * object. Returns the new id, or `null` when the input was rejected.
 */
export function createSticky(
  doc: Y.Doc,
  at: WorldPoint,
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | null {
  if (!isFinitePoint(at)) return null;
  if (!isStickyColor(color)) return null;

  const objects = objectsMap(doc);
  const id = newId();
  const z = maxZ(objects) + 1;
  const createdAt = Date.now();
  const left = at.x - STICKY_SIZE_WORLD / 2;
  const top = at.y - STICKY_SIZE_WORLD / 2;

  doc.transact(() => {
    const body = new Y.Map<unknown>();
    body.set("type", "sticky");
    body.set("x", left);
    body.set("y", top);
    body.set("color", color);
    body.set("text", new Y.Text(""));
    body.set("z", z);
    body.set("createdAt", createdAt);
    objects.set(id, body);
  }, LOCAL_ORIGIN);

  return id;
}

/** Moves an object by absolute world coordinates (its top-left corner). */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const body = stickyBody(doc, id);
  if (!body) return false;

  doc.transact(() => {
    body.set("x", x);
    body.set("y", y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Re-stacks an object above every other one. False when it is already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const body = objects.get(id);
  if (!asSticky(body)) return false;

  const z = numberOf(body.get("z"));
  const top = maxZ(objects);
  if (z >= top) return false;

  doc.transact(() => {
    body.set("z", top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Changes only the colour field. Unknown colours and no-ops are rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const body = stickyBody(doc, id);
  if (!body) return false;
  if (body.get("color") === color) return false;

  doc.transact(() => {
    body.set("color", color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes an object from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!asSticky(objects.get(id))) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's `Y.Text` handle, for the minimal-diff editor (sticky.text). */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const body = stickyBody(doc, id);
  if (!body) return undefined;
  const text = body.get("text");
  return text instanceof Y.Text ? text : undefined;
}

/**
 * An immutable view of the board, sorted by `(z, id)` so every client — and
 * every re-render — sees the same stacking even when two objects share a `z`
 * (possible once story 3 syncs concurrent edits). Objects of a type this
 * version does not know are skipped instead of throwing.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectsMap(doc).forEach((body, id) => {
    const note = readSticky(id, body);
    if (note) notes.push(note);
  });
  notes.sort(compareNotes);
  return notes;
}

// ---- internals ------------------------------------------------------------

function compareNotes(a: StickySnapshot, b: StickySnapshot): number {
  if (a.z !== b.z) return a.z - b.z;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for runtimes without WebCrypto ids (never expected in the browser
  // or in Node 19+, but the model must never throw).
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFinitePoint(point: WorldPoint | undefined): point is WorldPoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** An object body this version of the model understands as a sticky note. */
function asSticky(body: Y.Map<unknown> | undefined): body is Y.Map<unknown> {
  return body instanceof Y.Map && body.get("type") === "sticky";
}

function stickyBody(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const body = objectsMap(doc).get(id);
  return asSticky(body) ? body : null;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((body) => {
    if (!asSticky(body)) return;
    const z = numberOf(body.get("z"));
    if (z > max) max = z;
  });
  return max;
}

/** Copies one object body into an immutable snapshot entry, or null to skip it. */
function readSticky(id: string, body: Y.Map<unknown> | undefined): StickySnapshot | null {
  if (!asSticky(body)) return null;

  const x = body.get("x");
  const y = body.get("y");
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const storedColor = body.get("color");
  const text = body.get("text");

  return {
    id,
    type: "sticky",
    x: x as number,
    y: y as number,
    color: isStickyColor(storedColor) ? storedColor : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : "",
    z: numberOf(body.get("z")),
    createdAt: numberOf(body.get("createdAt")),
  };
}
