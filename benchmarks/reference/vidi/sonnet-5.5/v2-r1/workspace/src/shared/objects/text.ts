import * as Y from 'yjs';
import { LOCAL_ORIGIN, deleteObjects, maxZ, objectsOf } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_CARET_ROOM_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../config';
import type { TextSize } from '../config';
import type { Point } from '../geometry';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

function isSize(size: string): size is TextSize {
  return Object.prototype.hasOwnProperty.call(TEXT_SIZES, size);
}

function textObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj && obj.get('type') === 'text' ? obj : undefined;
}

/** Creates an empty size M, automatic-width text whose top-left is `at`. Null (and no transaction) for a non-finite point. */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    objectsOf(doc).set(id, obj);
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    // Provisional box so bounds exist before the first measure.
    obj.set('width', TEXT_CARET_ROOM_WORLD);
    obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
  }, LOCAL_ORIGIN);
  return id;
}

export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const obj = textObj(doc, id);
  if (!obj || !isSize(size) || obj.get('size') === size) return false;
  doc.transact(() => obj.set('size', size), LOCAL_ORIGIN);
  return true;
}

/** Fixes the width (clamped to the minimum). `x` optionally moves the left edge in the same transaction. */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number, x?: number): boolean {
  const obj = textObj(doc, id);
  if (!obj || !Number.isFinite(width) || (x !== undefined && !Number.isFinite(x))) return false;
  const next = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  if (obj.get('widthMode') === 'fixed' && obj.get('width') === next && (x === undefined || obj.get('x') === x)) {
    return false;
  }
  doc.transact(() => {
    if (x !== undefined) obj.set('x', x);
    obj.set('width', next);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  const obj = textObj(doc, id);
  if (!obj || !Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) {
    return false;
  }
  if (obj.get('width') === box.width && obj.get('height') === box.height) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = textObj(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** Only zero characters counts as empty; whitespace-only text is kept. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  return isEmptyText(doc, id) && deleteObjects(doc, [id]) > 0;
}
