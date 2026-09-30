// Free text objects (story 9, text.model). Framework-free like board-model.
//
// objects/<id>: Y.Map {
//   type: 'text', x, y, width, height, z, createdAt, createdBy,
//   text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
// }
//
// width/height are the box measured by the client that made the last local
// change (typing, size change, width drag); other clients render it as stored.
import * as Y from 'yjs';
import {
  deleteObjects,
  getObject,
  getObjectsMap,
  isFiniteNumber,
  LOCAL_ORIGIN,
  maxZ,
  registerModelType,
  type ObjectSnapshot,
} from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_CARET_ALLOWANCE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import type { Point } from '../geometry';

export const TEXT_TYPE = 'text';

export type TextWidthMode = 'auto' | 'fixed';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: TextWidthMode;
  createdBy: string;
}

export function isTextSize(size: unknown): size is TextSize {
  return typeof size === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, size);
}

export function isText(obj: ObjectSnapshot): obj is TextSnapshot {
  return obj.type === TEXT_TYPE;
}

function getTextObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = getObject(doc, id);
  return obj?.get('type') === TEXT_TYPE ? obj : undefined;
}

function readText(base: ObjectSnapshot, obj: Y.Map<unknown>): TextSnapshot {
  const text = obj.get('text');
  const size = obj.get('size');
  const createdBy = obj.get('createdBy');
  return {
    ...base,
    type: 'text',
    text: text instanceof Y.Text ? text.toString() : '',
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}

registerModelType(TEXT_TYPE, readText);

/**
 * Creates an empty size-M auto-width text object whose top-left is `at`, on
 * top of every other object. Returns the new id, or null (nothing written)
 * when `at` is not finite.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', TEXT_TYPE);
    obj.set('x', at.x);
    obj.set('y', at.y);
    // The box of an empty line, so bounds exist before the first measurement.
    obj.set('width', TEXT_CARET_ALLOWANCE_WORLD);
    obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    getObjectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Changes the size preset; false (no write) for an unknown key, stale id or the current size. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const obj = getTextObject(doc, id);
  if (!obj || obj.get('size') === size) return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/** Fixes the width (clamped to [TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD]). */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const obj = getTextObject(doc, id);
  if (!obj) return false;
  const w = Math.min(MAX_OBJECT_SIZE_WORLD, Math.max(TEXT_MIN_WIDTH_WORLD, width));
  if (obj.get('widthMode') === 'fixed' && obj.get('width') === w) return false;
  doc.transact(() => {
    obj.set('widthMode', 'fixed');
    obj.set('width', w);
  }, LOCAL_ORIGIN);
  return true;
}

/** Stores the measured box; false (no write) when unchanged or invalid. */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height) || !(box.width > 0) || !(box.height > 0)) {
    return false;
  }
  const obj = getTextObject(doc, id);
  if (!obj || (obj.get('width') === box.width && obj.get('height') === box.height)) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = getTextObject(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text object exists and has zero characters (whitespace counts as content). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/** Removes the text object when it has no characters (text.empty_removed). */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

/** The fields layout needs, read straight from the document. */
export function readTextLayoutInput(
  doc: Y.Doc,
  id: string,
): { text: string; size: TextSize; widthMode: TextWidthMode; width: number } | null {
  const obj = getTextObject(doc, id);
  const text = obj?.get('text');
  if (!obj || !(text instanceof Y.Text)) return null;
  const size = obj.get('size');
  const width = obj.get('width');
  return {
    text: text.toString(),
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
    width: isFiniteNumber(width) ? width : TEXT_MIN_WIDTH_WORLD,
  };
}
