import * as Y from "yjs";
import {
  LOCAL_ORIGIN,
  deleteObjects,
  snapshot,
  type ObjectSnapshot,
} from "../board-model";
import {
  DEFAULT_TEXT_SIZE,
  TEXT_INITIAL_HEIGHT_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from "../config";
import type { Point } from "../geometry";

/**
 * Text objects (`text.model`) — story 9.
 *
 * A text object is a plain object on the board: a Y.Map in `objects` with the
 * object keys the board already knows (`id, type, x, y, width, height, z,
 * createdAt`) plus `text: Y.Text`, `size`, `widthMode` and `createdBy`. Its
 * height always follows its content, its width follows its content until a
 * handle fixes it, and nothing here measures anything: sizing is the client's
 * job (`src/client/objects/textLayout.ts`), the schema is this file's job, so
 * the Durable Object can validate a text object with the same code the client
 * writes with.
 *
 * Every mutation returns `true` when it opened a LOCAL_ORIGIN transaction and
 * `false` when it was rejected or pointless - rejected calls never touch the
 * document. A rejected call is one that would put an unusable value in the
 * schema, and `isValid` in `board-model.ts` is what keeps a document that
 * already holds such a value readable.
 */

export interface TextSnapshot extends ObjectSnapshot {
  readonly type: "text";
  readonly text: string;
  readonly size: TextSize;
  readonly widthMode: "auto" | "fixed";
}

export interface TextBox {
  readonly width: number;
  readonly height: number;
}

const TEXT_TYPE = "text";

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);
}

/** Every size preset this build accepts, for the toolbar and the tests. */
export const TEXT_SIZE_PRESETS: readonly TextSize[] = Object.keys(TEXT_SIZES) as TextSize[];

function entryOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== "string") return undefined;
  const entry = doc.getMap<Y.Map<unknown>>("objects").get(id);
  if (!entry || entry.get("type") !== TEXT_TYPE) return undefined;
  return entry;
}

function ytextOf(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = entryOf(doc, id)?.get("text");
  return text instanceof Y.Text ? text : undefined;
}

/**
 * `createText(doc, at, createdBy) -> id | null`
 *
 * Creates a text object whose top-left corner is `at`, above every other
 * object in z, with the default size, automatic width and no content. The
 * box is an estimate (`TEXT_MIN_WIDTH_WORLD` x `TEXT_INITIAL_HEIGHT_WORLD`)
 * so the object has bounds before the first measurement - the client that
 * created it immediately replaces the estimate with a measured box.
 *
 * `createdBy` is recorded when the caller has an identity to give it; the
 * client gets one from story 6, which is not part of this build (see NOTES).
 */
export function createText(doc: Y.Doc, at: Point, createdBy?: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;

  const g = globalThis as { crypto?: { randomUUID?(): string } };
  const id =
    typeof g.crypto?.randomUUID === "function"
      ? g.crypto.randomUUID()
      : `t_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const objects = doc.getMap<Y.Map<unknown>>("objects");

  let maxZ = 0;
  objects.forEach((entry) => {
    const z = entry.get("z");
    if (typeof z === "number" && Number.isFinite(z) && z > maxZ) maxZ = z;
  });

  const entry = new Y.Map<unknown>();
  doc.transact(() => {
    entry.set("id", id);
    entry.set("type", TEXT_TYPE);
    entry.set("x", at.x);
    entry.set("y", at.y);
    entry.set("width", TEXT_MIN_WIDTH_WORLD);
    entry.set("height", TEXT_INITIAL_HEIGHT_WORLD);
    entry.set("z", maxZ + 1);
    entry.set("createdAt", Date.now());
    if (typeof createdBy === "string" && createdBy !== "") entry.set("createdBy", createdBy);
    entry.set("size", DEFAULT_TEXT_SIZE);
    entry.set("widthMode", "auto");
    entry.set("text", new Y.Text());
    objects.set(id, entry);
  }, LOCAL_ORIGIN);

  return id;
}

/** `setTextSize(doc, id, size) -> applied` — never touches position or content. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const entry = entryOf(doc, id);
  if (!entry || !isTextSize(size)) return false;
  if (entry.get("size") === size) return false;

  doc.transact(() => {
    entry.set("size", size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * `setTextWidthFixed(doc, id, width) -> applied`
 *
 * Fixes the width (what dragging a side handle does), clamped to at least
 * `TEXT_MIN_WIDTH_WORLD`. The height is left alone on purpose: it follows the
 * content the client has just re-wrapped.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const entry = entryOf(doc, id);
  if (!entry || !Number.isFinite(width)) return false;

  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  const mode = entry.get("widthMode");
  const current = entry.get("width");
  if (mode === "fixed" && current === clamped) return false;

  doc.transact(() => {
    entry.set("widthMode", "fixed");
    entry.set("width", clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * `setTextBox(doc, id, box) -> applied`
 *
 * The only way a client stores a measured box. It writes nothing when the box
 * is already the same, which is what keeps the box write from echoing.
 */
export function setTextBox(doc: Y.Doc, id: string, box: TextBox): boolean {
  const entry = entryOf(doc, id);
  if (!entry) return false;
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  if (entry.get("width") === box.width && entry.get("height") === box.height) return false;

  doc.transact(() => {
    entry.set("width", box.width);
    entry.set("height", box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** `getTextContent(doc, id)` — the object's Y.Text, or `undefined` for a stale id. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  return ytextOf(doc, id);
}

/** `isEmptyText(doc, id)` — empty means zero characters; whitespace counts as content. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = ytextOf(doc, id);
  return text !== undefined && text.length === 0;
}

/** `deleteIfEmpty(doc, id) -> deleted` — removes the object only when it holds nothing. */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

/** The text objects of a board, z-ordered, as snapshots. */
export function textSnapshot(doc: Y.Doc): readonly TextSnapshot[] {
  return snapshot(doc).filter(
    (object): object is TextSnapshot => object.type === TEXT_TYPE,
  );
}
