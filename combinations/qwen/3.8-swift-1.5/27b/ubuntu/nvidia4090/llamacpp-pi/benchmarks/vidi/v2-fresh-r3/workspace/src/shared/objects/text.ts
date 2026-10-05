import * as Y from 'yjs';
import { LOCAL_ORIGIN, deleteObjects, type ObjectSnapshot } from '../board-model';
import {
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING_WORLD,
  type TextSize,
} from '../config';
import type { Point } from '../geometry';

/**
 * Text object model (story 9, text.model).
 *
 * Schema: `objects/<id>: Y.Map { type: 'text', x, y, width, height, z,
 * createdAt, createdBy, text: Y.Text, size: TextSize,
 * widthMode: 'auto' | 'fixed' }`.
 *
 * Every setter validates its inputs: stale ids, unknown size keys and
 * non-finite numbers → false/null with no transaction. All writes use
 * LOCAL_ORIGIN (undo + remote-echo rules, stories 3/8). Selection, move and
 * delete stay generic (board-model group ops, story 7).
 */

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

/** True when `value` is one of the TEXT_SIZES preset keys. */
export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && value in TEXT_SIZES;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function textMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'text') return undefined;
  return obj;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Creates a text object whose **top-left is `at`**, size M, auto width,
 * empty Y.Text, z above every other object, `createdBy` set from the caller's
 * identity. One LOCAL_ORIGIN transaction. Returns the new id, or null for a
 * non-finite point (no transaction). The initial stored box is a one-line
 * estimate so selection bounds exist before the first measure.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || typeof createdBy !== 'string') {
    return null;
  }
  const id = crypto.randomUUID();
  const obj = new Y.Map<unknown>();
  obj.set('type', 'text');
  obj.set('x', at.x);
  obj.set('y', at.y);
  obj.set('text', new Y.Text());
  obj.set('size', DEFAULT_TEXT_SIZE);
  obj.set('widthMode', 'auto');
  obj.set('width', TEXT_PADDING_WORLD);
  obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
  obj.set('z', maxZ(doc) + 1);
  obj.set('createdAt', Date.now());
  obj.set('createdBy', createdBy);

  doc.transact(() => {
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Sets the size preset. False (no transaction) for unknown size keys, stale
 * ids, or when the object already has that size.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const obj = textMap(doc, id);
  if (!obj) return false;
  if (obj.get('size') === size) return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets a fixed width (clamped to at least TEXT_MIN_WIDTH_WORLD) and switches
 * `widthMode` to 'fixed'. False (no transaction) for non-finite widths, stale
 * ids, or an unchanged fixed box. Height is left to the box-sync remeasure.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const obj = textMap(doc, id);
  if (!obj) return false;
  const w = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  if (obj.get('widthMode') === 'fixed' && obj.get('width') === w) return false;
  doc.transact(() => {
    obj.set('width', w);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets the stored box, writing only the fields that change. False (no
 * transaction) for non-finite values, stale ids, or an unchanged box.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  const obj = textMap(doc, id);
  if (!obj) return false;
  const dw = obj.get('width') !== box.width;
  const dh = obj.get('height') !== box.height;
  if (!dw && !dh) return false;
  doc.transact(() => {
    if (dw) obj.set('width', box.width);
    if (dh) obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The object's Y.Text, or undefined for stale/unknown ids. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = textMap(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text has zero characters (whitespace-only counts as text). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/** Removes the object when (and only when) it is empty. True when removed. */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

/** A text object snapshot from a generic object snapshot, or null when the type-specific fields are missing/invalid. */
export function toTextSnapshot(obj: ObjectSnapshot): TextSnapshot | null {
  if (obj.type !== 'text') return null;
  if (!isTextSize(obj.size)) return null;
  if (obj.widthMode !== 'auto' && obj.widthMode !== 'fixed') return null;
  return {
    ...obj,
    type: 'text',
    text: obj.text ?? '',
    size: obj.size,
    widthMode: obj.widthMode,
  };
}
