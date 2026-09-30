// Text objects (story 9): plain text with a size preset and an automatic or fixed width.
//
// objects/<id>: Y.Map {
//   type: 'text', x, y, width, height, z, createdAt, createdBy,
//   text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
// }
// `x`/`y` is the top-left. `width`/`height` are the measured box, written by the
// client that made the local change (typing, size change, width drag).
import * as Y from 'yjs';
import {
  type ObjectSnapshot,
  LOCAL_ORIGIN,
  deleteObjects,
  getObject,
  isTextSize,
  maxZ,
  objectsMap,
} from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import type { Point } from '../geometry';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

export function isText(obj: ObjectSnapshot): obj is TextSnapshot {
  return obj.type === 'text';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getTextObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = getObject(doc, id);
  return obj && obj.get('type') === 'text' ? obj : undefined;
}

/**
 * Creates an empty, size M, auto-width text object whose top-left is `at`,
 * above every other object. Its box starts as an estimate (one empty line,
 * TEXT_MIN_WIDTH_WORLD wide) until the first measurement. Null for non-finite points.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', TEXT_MIN_WIDTH_WORLD);
    obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Changes the size preset. False for stale ids, unknown sizes or no change. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const obj = getTextObject(doc, id);
  if (!obj || obj.get('size') === size) return false;
  doc.transact(() => obj.set('size', size), LOCAL_ORIGIN);
  return true;
}

/**
 * Gives the text a fixed width, clamped to [TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD].
 * False for stale ids, non-finite widths or no change.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const obj = getTextObject(doc, id);
  if (!obj) return false;
  const clamped = Math.min(MAX_OBJECT_SIZE_WORLD, Math.max(TEXT_MIN_WIDTH_WORLD, width));
  if (obj.get('widthMode') === 'fixed' && obj.get('width') === clamped) return false;
  doc.transact(() => {
    obj.set('widthMode', 'fixed');
    obj.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/** Stores the measured box. False for stale ids, non-finite or non-positive sizes, or no change. */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height) || box.width <= 0 || box.height <= 0) return false;
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

/** Removes the text object when it has no characters. True when removed. */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
