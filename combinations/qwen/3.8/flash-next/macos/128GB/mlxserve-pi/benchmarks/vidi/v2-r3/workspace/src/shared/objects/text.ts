// The free text object's document schema, and every mutation of the fields that
// belong to it alone.
//
// Position, stacking and deletion are deliberately absent: a text object is
// moved, raised, marquee-selected and deleted through story 7's generic
// `moveObjects`, `bringObjectsToFront` and `deleteObjects`, exactly like a sticky
// note. Only `size`, `widthMode` and the measured box are text's own business.
//
// The *reading* of a text object lives next to the reading of every other object
// (`snapshotAll`/`readObject` in ../board-model), so that this module and the
// board model do not import each other at runtime; `TextSnapshot` is declared
// here because it is this object's shape.
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
  type TextWidthMode,
} from '../config';
import {
  LOCAL_ORIGIN,
  deleteObjects,
  getObjects,
  isFiniteNumber,
  isTextSize,
  maxZ,
  newId,
  readObject,
} from '../board-model';
import type { Point } from '../geometry';

/** How a text object decides its width. Named here because this is the module
 * that writes it; the type itself is a product setting, next to the sizes. */
export type { TextWidthMode };

/** A fixed width may be as wide as four lines of auto text, and no wider. */
export const MAX_TEXT_WIDTH_WORLD = TEXT_MAX_AUTO_WIDTH_WORLD * 4;

/**
 * The width a text object is allowed to be held at, which is a rule of the model
 * rather than of the pointer: `setTextWidthFixed` applies it, and a drag that
 * wants to know where the other edge of the box ends up asks it here, so the two
 * can never disagree about what a width the object has actually got.
 */
export function clampTextWidth(width: number): number {
  return Math.max(TEXT_MIN_WIDTH_WORLD, Math.min(width, MAX_TEXT_WIDTH_WORLD));
}

/**
 * What the board knows about one text object. Like every other snapshot it
 * carries an explicit box, which is what makes it usable by selection, marquee
 * and export without anybody having to measure a font.
 */
export interface TextSnapshot {
  id: string;
  type: 'text';
  /** Board units, top-left. */
  x: number;
  /** Board units. */
  y: number;
  /** Board units: the box the text is laid out in, written by whoever changed it. */
  width: number;
  /** Board units: as many lines as the text needs at `size`. */
  height: number;
  /** Draw order. */
  z: number;
  createdAt: number;
  /** Plain text content of the object's Y.Text. */
  text: string;
  /** One of TEXT_SIZES, stored as its key and never as a pixel number. */
  size: TextSize;
  widthMode: TextWidthMode;
}

/** The box an empty text object starts with: one line, as narrow as a box may be. */
const initialBox = (): { width: number; height: number } => ({
  width: TEXT_MIN_WIDTH_WORLD,
  height: TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT,
});

/** The text object under `id`, or undefined for a stale id or another kind of object. */
export function getTextObject(doc: Y.Doc, id: string): TextSnapshot | undefined {
  const obj = readObject(getObjects(doc).get(id), id);
  return obj !== null && obj.type === 'text' ? obj : undefined;
}

/**
 * Create a text object whose top-left is `at` (world units): size M, auto width,
 * no characters, stacked above every other object.
 *
 * `createdBy` is stored only when a caller has an identity to record; nothing in
 * the board reads it, and a document written without it is the same document.
 *
 * Returns the new id, or null — with nothing written and no transaction opened —
 * when the point is not a pair of finite numbers.
 */
export function createText(doc: Y.Doc, at: Point, createdBy?: string): string | null {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;
  const objects = getObjects(doc);
  const id = newId();
  const box = initialBox();
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', 'text');
    map.set('x', at.x);
    map.set('y', at.y);
    map.set('width', box.width);
    map.set('height', box.height);
    map.set('text', new Y.Text(''));
    map.set('size', DEFAULT_TEXT_SIZE);
    map.set('widthMode', 'auto');
    map.set('z', maxZ(objects) + 1);
    map.set('createdAt', Date.now());
    if (createdBy !== undefined) map.set('createdBy', createdBy);
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change the text object's size, which changes its font size and so the box its
 * words wrap in — the caller remeasures afterwards. An unknown size key or a
 * stale id returns false and writes nothing.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const map = getObjects(doc).get(id);
  if (map === undefined || map.get('type') !== 'text') return false;
  if (map.get('size') === size) return true;
  doc.transact(() => {
    map.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Give the text object a fixed width: its words wrap inside it and its height
 * follows the number of lines. A width narrower than TEXT_MIN_WIDTH_WORLD is
 * clamped to it rather than refused, so a handle dragged past the end of the
 * text still leaves a usable box; a non-finite width writes nothing.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const map = getObjects(doc).get(id);
  if (map === undefined || map.get('type') !== 'text') return false;
  const clamped = clampTextWidth(width);
  // Only what is actually different is written. A Yjs map records a key set to
  // the value it already held as a change, and a sync message about a box that
  // did not move is a message five people receive about nothing — which is the
  // one thing this document's box writes have to be careful about.
  doc.transact(() => {
    if (map.get('widthMode') !== 'fixed') map.set('widthMode', 'fixed');
    if (map.get('width') !== clamped) map.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Hand a text object's width back to its text: the box will be as wide as its
 * longest line again, which is what the width button does on its second press.
 * The width it currently has is left in the document — it is the number the text
 * was laid out in, and the next measurement replaces it — so a mode that is
 * already 'auto' writes nothing.
 */
export function setTextWidthAuto(doc: Y.Doc, id: string): boolean {
  const map = getObjects(doc).get(id);
  if (map === undefined || map.get('type') !== 'text') return false;
  if (map.get('widthMode') === 'auto') return true;
  doc.transact(() => {
    map.set('widthMode', 'auto');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the box the text object's text was measured into. This is the only write
 * a client makes on behalf of a text object it did not move: whoever changed the
 * text or the size measures the result and stores it here, so every other client
 * — and any future export — can lay the text out without a font.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  const map = getObjects(doc).get(id);
  if (map === undefined || map.get('type') !== 'text') return false;
  if (map.get('width') === box.width && map.get('height') === box.height) return true;
  doc.transact(() => {
    map.set('width', Math.max(TEXT_MIN_WIDTH_WORLD, box.width));
    map.set('height', Math.max(0, box.height));
  }, LOCAL_ORIGIN);
  return true;
}

/** The object's shared text, or undefined for a stale id or another kind of object. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = getObjects(doc).get(id);
  if (map === undefined || map.get('type') !== 'text') return undefined;
  const text = map.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Does this text object hold no characters at all?
 *
 * Whitespace counts as content: a text object containing a single space is a
 * person's text, and is kept. A stale id is not empty, it is absent, and the
 * answer is false.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/**
 * Remove the text object if, and only if, it holds no characters.
 *
 * This is what an abandoned text object — made with the Text tool and never
 * typed into — comes down to when editing ends, so an empty object is never left
 * invisible on the board. Returns false when there was something to keep, when
 * the id is stale, or when it is not a text object.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
