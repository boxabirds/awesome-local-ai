/**
 * The `text` object type: plain text anywhere on the board (design anchor
 * `text.model`).
 *
 * Story 9's one new object type. It is an ordinary board object - same
 * `objects` map, same `x`/`y`/`width`/`height`/`z`/`createdAt` fields, same
 * `Y.Text` for its content as a sticky note has - plus three fields of its own:
 *
 *   size: 'S' | 'M' | 'L' | 'XL'   which of the four sizes (text.size)
 *   widthMode: 'auto' | 'fixed'    whether the width follows the words (text.width)
 *   createdBy: string              who made it (story 14's identity; today the
 *                                  id of the tab that clicked)
 *
 * Like every model function here, each mutation is exactly one
 * `doc.transact(fn, LOCAL_ORIGIN)`, every rejection (stale id, unknown size,
 * non-finite number, pointless no-op) returns `false` *before* a transaction is
 * opened, and nothing throws for user-driven input.
 *
 * **The height of a text object is never written by a resize.** It is
 * `lines x font size x TEXT_LINE_HEIGHT`, which only a measurement can know, so
 * the only writer of `height` is {@link setTextBox}, called by
 * `src/client/objects/useTextBoxSync.ts` after a local change. This module does
 * not measure - there is no canvas in a framework-free module - so the box it
 * puts on a new object is an {@link TEXT_GLYPH_WIDTH_RATIO} estimate, good enough
 * to give the object bounds before the client measures it for real.
 *
 * This file imports board-model and nothing from `src/client`. The reverse is
 * allowed: the client registry registers the type, and this module tells
 * board-model about it at load time, which is what makes story 7's group
 * operations, story 8's undo and story 4's persistence carry text objects.
 */

import * as Y from 'yjs';

import {
  LOCAL_ORIGIN,
  OBJECT_FIELDS,
  objectSnapshot,
  registerBoardObjectType,
  registerObjectSnapshotReader,
  type ObjectSnapshot,
  type Point,
} from '../board-model.js';
import {
  DEFAULT_TEXT_SIZE,
  isTextSize,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config.js';

/** The object type name, as stored in `objects.<id>.type`. */
export const TEXT_TYPE = 'text';

/** An immutable view of one text object, as rendered by the client. */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  /** The characters, for drawing. Editing goes through {@link getTextContent}. */
  text: string;
  /** Which of the four sizes; never an unknown name (that object is skipped). */
  size: TextSize;
  /** `auto`: the width follows the words. `fixed`: a handle set it. */
  widthMode: 'auto' | 'fixed';
  /** Who made it; absent for an object created by a client that had no id. */
  createdBy?: string;
}

/** The box a text object occupies, in world units. */
export interface TextBox {
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ the type */

/**
 * Tell board-model and the object renderer about text objects. Registering here
 * rather than in `registry.tsx` means the type is known wherever this module is
 * imported - including in a node test of the model, where nothing React is
 * loaded - and the client registry's own registration is idempotent.
 */
registerBoardObjectType(TEXT_TYPE);
registerObjectSnapshotReader(TEXT_TYPE, readTextSnapshot);

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** The object map of `id`, when it exists and is a text object. */
function readTextMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id.length === 0) return undefined;
  const map = objectsOf(doc).get(id);
  if (!(map instanceof Y.Map)) return undefined;
  if (map.get(OBJECT_FIELDS.type) !== TEXT_TYPE) return undefined;
  return map;
}

/** The size name stored for a text object, or the default for anything else. */
export function getTextSize(doc: Y.Doc, id: string): TextSize {
  const stored = readTextMap(doc, id)?.get('size');
  return isTextSize(stored) ? stored : DEFAULT_TEXT_SIZE;
}

/** How the width of `id` is decided. Anything unreadable counts as `auto`. */
export function getTextWidthMode(doc: Y.Doc, id: string): 'auto' | 'fixed' {
  return readTextMap(doc, id)?.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
}

/** The stored width in world units, or the automatic width's minimum. */
export function getTextWidth(doc: Y.Doc, id: string): number {
  const width = readTextMap(doc, id)?.get(OBJECT_FIELDS.width);
  return isFiniteNumber(width) && width > 0 ? width : TEXT_MIN_WIDTH_WORLD;
}

/** The stored height in world units (always one measurement of the content). */
export function getTextHeight(doc: Y.Doc, id: string): number {
  const height = readTextMap(doc, id)?.get(OBJECT_FIELDS.height);
  return isFiniteNumber(height) && height > 0 ? height : TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT;
}

/** Read one object map into a {@link TextSnapshot}, or skip it. */
function readTextSnapshot(id: string, map: Y.Map<unknown>): TextSnapshot | undefined {
  if (map.get(OBJECT_FIELDS.type) !== TEXT_TYPE) return undefined;

  const x = map.get(OBJECT_FIELDS.x);
  const y = map.get(OBJECT_FIELDS.y);
  const z = map.get(OBJECT_FIELDS.z);
  // A malformed object is skipped rather than rendered, exactly as a malformed
  // sticky note is: one object written by a future version must not take the
  // whole board down.
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;

  const stored = map.get('size');
  if (!isTextSize(stored)) return undefined;
  const width = map.get(OBJECT_FIELDS.width);
  const height = map.get(OBJECT_FIELDS.height);
  const createdAt = map.get(OBJECT_FIELDS.createdAt);
  const createdBy = map.get('createdBy');
  const text = map.get(OBJECT_FIELDS.text);

  const snapshot: TextSnapshot = {
    id,
    type: TEXT_TYPE,
    x,
    y,
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    size: stored,
    widthMode: map.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
    text: text instanceof Y.Text ? text.toString() : '',
  };
  // A text object always carries a box (see the module header); one that lost it
  // is left without one so `objectBounds` supplies the fallback instead.
  if (isFiniteNumber(width) && width > 0) snapshot.width = width;
  if (isFiniteNumber(height) && height > 0) snapshot.height = height;
  if (typeof createdBy === 'string' && createdBy.length > 0) snapshot.createdBy = createdBy;
  return snapshot;
}

/** Every text object on the board, in drawing order. */
export function textSnapshots(doc: Y.Doc): TextSnapshot[] {
  return objectSnapshot(doc).filter((object): object is TextSnapshot => object.type === TEXT_TYPE);
}

/* ------------------------------------------------------------------- create */

/** Highest z in the document (0 when there is nothing on it). */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((map) => {
    if (!(map instanceof Y.Map)) return;
    const z = map.get(OBJECT_FIELDS.z);
    if (isFiniteNumber(z) && z > max) max = z;
  });
  return max;
}

/**
 * The box of text that has not been measured yet, from
 * {@link TEXT_GLYPH_WIDTH_RATIO}. It exists so a text object has bounds the
 * moment it is created - the selection overlay, the marquee and the shared
 * document all need a rectangle before any canvas has seen the words - and so a
 * board created on a server is the right *shape*, if not the right size.
 */
export function estimatedBox(text: string, size: TextSize = DEFAULT_TEXT_SIZE): TextBox {
  const fontPx = TEXT_SIZES[size];
  const lines = text.length === 0 ? [''] : text.split('\n');
  // Each line takes as many wrapped lines as its estimated width needs; the
  // estimate cannot know about word boundaries, so it is the arithmetic.
  let wrapped = 0;
  let widest = 0;
  for (const line of lines) {
    const width = line.length * fontPx * TEXT_GLYPH_WIDTH_RATIO;
    if (width > widest) widest = width;
    wrapped += Math.max(1, Math.ceil(width / TEXT_MAX_AUTO_WIDTH_WORLD));
  }
  return {
    width: Math.max(
      TEXT_MIN_WIDTH_WORLD,
      Math.min(TEXT_MAX_AUTO_WIDTH_WORLD, widest + TEXT_AUTO_WIDTH_PADDING_WORLD),
    ),
    height: Math.max(1, wrapped) * fontPx * TEXT_LINE_HEIGHT,
  };
}

/**
 * Create a text object whose top-left is `at` - the click point, so the text
 * starts where it was asked for (unlike `createSticky`, which centres the note
 * on the point) - on top of everything, at {@link DEFAULT_TEXT_SIZE} and with
 * automatic width.
 *
 * The object and its `Y.Text` go on the board in one transaction, so no peer can
 * ever see a text object without its text and try to delete it.
 *
 * Returns the new id, or `null` when `at` is not a place on the board. A
 * `createdBy` that is not a usable name is left out rather than refused: the
 * text was still asked for, and an object without attribution is a smaller lie
 * than a click that produced nothing.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;

  const objects = objectsOf(doc);
  const z = maxZ(objects) + 1;
  const id = nextId();
  const box = estimatedBox('');
  const creator = typeof createdBy === 'string' && createdBy.trim().length > 0 ? createdBy : null;

  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set(OBJECT_FIELDS.type, TEXT_TYPE);
    map.set(OBJECT_FIELDS.x, at.x);
    map.set(OBJECT_FIELDS.y, at.y);
    map.set(OBJECT_FIELDS.width, box.width);
    map.set(OBJECT_FIELDS.height, box.height);
    map.set(OBJECT_FIELDS.text, new Y.Text());
    map.set('size', DEFAULT_TEXT_SIZE);
    map.set('widthMode', 'auto');
    if (creator !== null) map.set('createdBy', creator);
    map.set(OBJECT_FIELDS.z, z);
    map.set(OBJECT_FIELDS.createdAt, Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);

  return id;
}

/** A unique object id; the same helper board-model uses for its own objects. */
function nextId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/* ------------------------------------------------------------------- the text */

/**
 * The shared text of a text object, for editing (`applyTextDiff` writes the
 * minimal change into it, and undo scopes to it). `undefined` when there is no
 * such text object.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = readTextMap(doc, id)?.get(OBJECT_FIELDS.text);
  return text instanceof Y.Text ? text : undefined;
}

/** Zero characters. Whitespace is content: a line with three spaces is not empty. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  if (!text) return false;
  return text.toString().length === 0;
}

/**
 * Remove `id` when it is a text object holding zero characters, so a text that
 * was started and then emptied leaves no invisible object on the board
 * (`text.empty_remove`). `false` for anything else - including a text object with
 * a space in it, which is content the user put there.
 *
 * The removal goes through board-model's `deleteObjects`, so it is one
 * `LOCAL_ORIGIN` transaction and story 8's undo can put the object back.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  const map = readTextMap(doc, id);
  if (!map) return false;
  const text = map.get(OBJECT_FIELDS.text);
  if (!(text instanceof Y.Text) || text.toString().length > 0) return false;
  return deleteObjectText(doc, id);
}

/**
 * Deleting the object is board-model's job (`deleteObjects`), but it takes any
 * known type; this is the seam that keeps {@link deleteIfEmpty} from ever
 * removing something it has not just checked is empty text.
 */
function deleteObjectText(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (!(objects.get(id) instanceof Y.Map)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/* ---------------------------------------------------------------- the fields */

/**
 * Set the size of a text object: one field, the position untouched, so text
 * never moves when its size changes (`text.size`, `text.height`).
 *
 * An unknown size name and a stale id are both `false` with no transaction: the
 * four names are the whole vocabulary, and a size the model did not write would
 * be a size nothing can draw.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const map = readTextMap(doc, id);
  if (!map) return false;
  if (map.get('size') === size) return false;

  doc.transact(() => {
    map.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Give a text object a width the user chose by dragging a side handle, and
 * remember that the width is now fixed - from here on the words wrap inside it
 * instead of pushing the box wider (`text.width`, `text.handle`).
 *
 * The width is clamped into [`TEXT_MIN_WIDTH_WORLD`, {@link MAX_OBJECT_SIZE_WORLD}]
 * rather than refused: a drag that overshoots the minimum means "as narrow as it
 * goes", not "do nothing". A height is not accepted here, because the height of
 * text is what its content measures to.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const map = readTextMap(doc, id);
  if (!map) return false;

  const clamped = Math.min(MAX_OBJECT_SIZE_WORLD, Math.max(TEXT_MIN_WIDTH_WORLD, width));
  const wasFixed = map.get('widthMode') === 'fixed';
  if (wasFixed && map.get(OBJECT_FIELDS.width) === clamped) return false;

  doc.transact(() => {
    map.set(OBJECT_FIELDS.width, clamped);
    map.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the measured box of a text object. This is the only writer of `height`,
 * and the only writer of `width` that does not mean "the user fixed the width" -
 * which is why it leaves `widthMode` alone: measuring an automatic-width object
 * must not turn it into a fixed-width one.
 *
 * A box that is already exactly this is a no-op returning `false`, so a client
 * that measured and found nothing to say costs no sync traffic
 * (`text.no_redundant_write`).
 */
export function setTextBox(doc: Y.Doc, id: string, box: TextBox): boolean {
  if (!box) return false;
  const { width, height } = box;
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) return false;
  const map = readTextMap(doc, id);
  if (!map) return false;
  if (map.get(OBJECT_FIELDS.width) === width && map.get(OBJECT_FIELDS.height) === height) {
    return false;
  }

  doc.transact(() => {
    map.set(OBJECT_FIELDS.width, width);
    map.set(OBJECT_FIELDS.height, height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Back to width that follows the words: `auto`, and re-measured by the caller.
 * Exposed for the object type's own resize path, which is the only place that
 * knows whether an object was fixed by a handle or has never been.
 */
export function setTextWidthAuto(doc: Y.Doc, id: string): boolean {
  const map = readTextMap(doc, id);
  if (!map) return false;
  if (map.get('widthMode') === 'auto') return false;

  doc.transact(() => {
    map.set('widthMode', 'auto');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Whether a type name is this module's. Exported so the client registry and the
 * selection overlay can ask without repeating the string.
 */
export const isTextType = (type: unknown): boolean => type === TEXT_TYPE;
