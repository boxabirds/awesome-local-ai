import * as Y from 'yjs';
import {
  deleteObjects,
  LOCAL_ORIGIN,
  newObjectId,
  topZ,
  type ObjectSnapshotBase,
} from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import type { Point } from '../geometry';

// The size of a text is one of the settings' keys, and the type that says so belongs with
// the text: everything that reads `size` off a text object takes it from here.
export type { TextSize };

/**
 * The `text` object type (story 9): plain text with no background, placed anywhere on the
 * board, in one of four sizes, either as wide as its longest line or fixed to a width a
 * side handle set.
 *
 * Schema — the same entry of `objects` every other type has, plus:
 *
 *     text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed', createdBy, createdAt
 *
 * `width` and `height` are stored rather than measured on every screen: the client that
 * made a local change measures it and writes the box in the same undo window, and every
 * other client draws the stored box (design key decision 1). Nothing here measures or
 * renders — the client's `textLayout.ts` does — so this module stays usable from the
 * Worker and from a plain Node test.
 *
 * A stale id never throws: the setters return false and `createText` returns null.
 */

/** The object type this module owns. */
export const TEXT_TYPE = 'text';

/** Automatic: as wide as its longest line, up to `TEXT_MAX_AUTO_WIDTH_WORLD`. */
export type TextWidthMode = 'auto' | 'fixed';

/**
 * A text object read out of the document. It extends the same base every object has
 * (`ObjectSnapshot` in board-model is a union of the per-type snapshots, and a text object
 * is one more of them).
 */
export interface TextSnapshot extends ObjectSnapshotBase {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: TextWidthMode;
  /** The device that typed it first (story 6 hands out the id; today it is this tab's). */
  createdBy: string;
  createdAt: number;
  known: true;
}

/** Is this one of ours? `type` is any string once a document has been synced. */
export function isTextSnapshot(object: ObjectSnapshotBase): object is TextSnapshot {
  return object.type === TEXT_TYPE;
}

/** Every size the toolbar offers, in the order it offers them. */
export const TEXT_SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];

/** Is `key` one of the four sizes? Anything out of a synced document has to be checked. */
export function isTextSize(key: unknown): key is TextSize {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, key);
}

/** Font size of `size`, in board units. */
export function textSizePx(size: TextSize): number {
  return TEXT_SIZES[size];
}

/** How tall one line of `size` is, in board units. */
export function textLineHeight(size: TextSize): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}

type YObject = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>('objects');
}

function objectOf(doc: Y.Doc, id: string): YObject | undefined {
  if (!id) return undefined;
  const item = objectsOf(doc).get(id);
  return item instanceof Y.Map ? item : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(point: Point | undefined): point is Point {
  return !!point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function numberOf(item: YObject, key: string, fallback: number): number {
  const value = item.get(key);
  return isFiniteNumber(value) ? value : fallback;
}

function textOf(item: YObject): Y.Text | undefined {
  const value = item.get('text');
  return value instanceof Y.Text ? value : undefined;
}

function sizeOf(item: YObject): TextSize {
  const size = item.get('size');
  return isTextSize(size) ? size : DEFAULT_TEXT_SIZE;
}

function widthModeOf(item: YObject): TextWidthMode {
  return item.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
}

/**
 * The text object `id`, with its text, size, width mode and box. Undefined for a stale id
 * or for an object that is not text. A field that arrived wrong from another client falls
 * back to the default rather than drawing nothing.
 */
export function readText(doc: Y.Doc, id: string): TextSnapshot | undefined {
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== TEXT_TYPE) return undefined;
  const ytext = textOf(item);
  const createdBy = item.get('createdBy');
  return {
    id,
    type: 'text',
    x: numberOf(item, 'x', 0),
    y: numberOf(item, 'y', 0),
    z: numberOf(item, 'z', 0),
    width: Math.max(numberOf(item, 'width', TEXT_MIN_WIDTH_WORLD), TEXT_MIN_WIDTH_WORLD),
    height: Math.max(numberOf(item, 'height', textLineHeight(sizeOf(item))), 0),
    known: true,
    text: ytext ? ytext.toString() : '',
    size: sizeOf(item),
    widthMode: widthModeOf(item),
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    createdAt: numberOf(item, 'createdAt', 0),
  };
}

/**
 * Creates a text object with its top-left at `at` (world units), empty, at
 * `DEFAULT_TEXT_SIZE` and in automatic width, at `z = maxZ + 1` so the newest text is on
 * top of everything on the board. Returns the new id, or null for a non-finite point: the
 * caller's transaction is not even opened.
 *
 * The starting box is one line of the default size at the narrowest width — a text object
 * always has bounds, so it can be selected and have handles before anyone has typed.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!isPoint(at)) return null;
  const id = newObjectId();
  const size = DEFAULT_TEXT_SIZE;
  doc.transact(() => {
    const objects = objectsOf(doc);
    const item = new Y.Map<unknown>();
    item.set('type', TEXT_TYPE);
    item.set('x', at.x);
    item.set('y', at.y);
    item.set('width', TEXT_MIN_WIDTH_WORLD);
    item.set('height', textLineHeight(size));
    item.set('z', topZ(doc) + 1);
    item.set('createdAt', Date.now());
    item.set('createdBy', typeof createdBy === 'string' ? createdBy : '');
    item.set('text', new Y.Text(''));
    item.set('size', size);
    item.set('widthMode', 'auto' satisfies TextWidthMode);
    objects.set(id, item);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The text object's shared text, so an editor can bind to it and type into it. Undefined
 * for a stale id, or for an object that is not text.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== TEXT_TYPE) return undefined;
  return textOf(item);
}

/**
 * Sets the text's size (S/M/L/XL), leaving position, box and text untouched — the client
 * that asked re-measures and writes the new box afterwards. False for a stale id, an
 * object that is not text, an unknown size, or the size it already has.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== TEXT_TYPE) return false;
  if (sizeOf(item) === size) return false;
  doc.transact(() => {
    item.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Pins the text to `width` board units and switches it to fixed width, so its lines wrap
 * at that width until the box is measured again. Anything narrower is the minimum: a side
 * handle dragged past it stops there instead of turning the text into a tall thin strip.
 * False for a stale id, an object that is not text, a non-finite width, or a box that is
 * already exactly that. Height is left alone for the same reason as `setTextSize`.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== TEXT_TYPE) return false;
  const next = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  if (widthModeOf(item) === 'fixed' && numberOf(item, 'width', 0) === next) return false;
  doc.transact(() => {
    item.set('width', next);
    item.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Stores the box a client measured (design key decision 1). Only width and height: the box
 * is not a move. False for a stale id, an object that is not text, a non-finite size, or a
 * box that already matches.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== TEXT_TYPE) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  if (numberOf(item, 'width', 0) === box.width && numberOf(item, 'height', 0) === box.height) {
    return false;
  }
  doc.transact(() => {
    item.set('width', box.width);
    item.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Has this text got no characters at all? Whitespace-only is text like any other, so a
 * space someone typed keeps the object (edge_cases.empty_text). False for a stale id.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  return !!ytext && ytext.toString().length === 0;
}

/**
 * Remove the text object when it holds nothing, through the generic deletion every type
 * uses, so the shared `Y.Text` goes with it. True when it removed something.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
