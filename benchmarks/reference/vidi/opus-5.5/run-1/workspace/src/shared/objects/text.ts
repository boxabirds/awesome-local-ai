/**
 * Free text objects (story 9): schema helpers on the board document.
 *
 *   objects/<id>: Y.Map {
 *     type: 'text', x, y, width, height, z, createdAt, createdBy,
 *     text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
 *   }
 *
 * `width`/`height` are the stored box, written by the client that made a local change (typing,
 * size change, side-handle drag) after measuring; other clients render it as stored. Selection,
 * moving, deleting and stacking use the generic operations in board-model.ts (text.consistent).
 *
 * Like board-model.ts: every successful change is one `LOCAL_ORIGIN` transaction; stale ids,
 * non-text objects, unknown sizes, non-finite numbers and no-ops return false (or null) before
 * any transaction is opened.
 */
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import {
  deleteObjects,
  isTextSize,
  LOCAL_ORIGIN,
  maxZ,
  objectOf,
  TEXT_TYPE,
  type ObjectSnapshot,
  type TextWidthMode,
} from '../board-model';
import type { Point } from '../geometry';

export { TEXT_TYPE };

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  width: number;
  height: number;
  text: string;
  size: TextSize;
  widthMode: TextWidthMode;
}

export function isText(obj: ObjectSnapshot): obj is TextSnapshot {
  return obj.type === TEXT_TYPE;
}

/** The Y.Map of a text object, or undefined for stale ids and other types. */
function textMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectOf(doc, id);
  return obj && obj.get('type') === TEXT_TYPE ? obj : undefined;
}

function finite(...values: number[]): boolean {
  return values.every(Number.isFinite);
}

/**
 * Creates an empty, auto-width, DEFAULT_TEXT_SIZE text object with its top-left at world point
 * `at`, above every other object. Its initial box is that of empty text (one line, padding
 * wide) so it has bounds before the first measurement. Null (no transaction) when `at` is not
 * finite.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!finite(at.x, at.y)) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    const z = maxZ(doc) + 1;
    doc.getMap<Y.Map<unknown>>('objects').set(id, obj);
    obj.set('type', TEXT_TYPE);
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', TEXT_AUTO_WIDTH_PADDING_WORLD);
    obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto' satisfies TextWidthMode);
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
  }, LOCAL_ORIGIN);
  return id;
}

/** Changes the size preset (S, M, L, XL). False for unknown keys, stale ids and the current size. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const obj = textMap(doc, id);
  if (!obj || obj.get('size') === size) return false;
  doc.transact(() => obj.set('size', size), LOCAL_ORIGIN);
  return true;
}

/**
 * Makes the width fixed at `width`, clamped to at least TEXT_MIN_WIDTH_WORLD. The height is not
 * touched here: the caller re-measures it (useTextBoxSync). False for stale ids, non-finite
 * widths and no-ops.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!finite(width)) return false;
  const obj = textMap(doc, id);
  if (!obj) return false;
  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  if (obj.get('widthMode') === 'fixed' && obj.get('width') === clamped) return false;
  doc.transact(() => {
    obj.set('widthMode', 'fixed' satisfies TextWidthMode);
    obj.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/** Stores the measured box. False for stale ids, non-finite or non-positive sizes and an unchanged box. */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!finite(box.width, box.height) || box.width <= 0 || box.height <= 0) return false;
  const obj = textMap(doc, id);
  if (!obj || (obj.get('width') === box.width && obj.get('height') === box.height)) return false;
  doc.transact(() => {
    if (obj.get('width') !== box.width) obj.set('width', box.width);
    if (obj.get('height') !== box.height) obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shared text of a text object, or undefined for stale ids and other types. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = textMap(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text object has zero characters (whitespace counts as content). False for stale ids. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/** Removes the text object when it has no characters (text.empty_removed). True when removed. */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

/** Everything the layout needs from a stored text object, or undefined for stale ids. */
export function readTextLayoutInput(
  doc: Y.Doc,
  id: string,
): { text: string; size: TextSize; widthMode: TextWidthMode; width: number } | undefined {
  const obj = textMap(doc, id);
  if (!obj) return undefined;
  const size = obj.get('size');
  const width = obj.get('width');
  return {
    text: getTextContent(doc, id)?.toString() ?? '',
    size: typeof size === 'string' && isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
    width: typeof width === 'number' && Number.isFinite(width) ? width : TEXT_MIN_WIDTH_WORLD,
  };
}
