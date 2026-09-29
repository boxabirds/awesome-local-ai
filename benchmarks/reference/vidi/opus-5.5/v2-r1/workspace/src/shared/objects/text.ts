// Text objects (story 9): plain text anywhere on the board. Framework-free.
//
// objects/<id>: Y.Map {
//   type: 'text', x, y, width, height, z, createdAt, createdBy,
//   text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
// }
//
// `width`/`height` are the measured box, written by the client that made the local change
// (typing, size change, side-handle drag); other clients render the stored box.
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot, deleteObjects } from '../board-model';
import type { Point } from '../geometry';

export type TextWidthMode = 'auto' | 'fixed';

export interface TextSnapshot extends ObjectSnapshot {
  readonly type: 'text';
  readonly text: string;
  readonly size: TextSize;
  readonly widthMode: TextWidthMode;
}

export function isTextSize(size: unknown): size is TextSize {
  return typeof size === 'string' && Object.hasOwn(TEXT_SIZES, size);
}

export function isText(obj: ObjectSnapshot): obj is TextSnapshot {
  return obj.type === 'text';
}

function textObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = doc.getMap('objects').get(id);
  return obj instanceof Y.Map && obj.get('type') === 'text' ? (obj as Y.Map<unknown>) : undefined;
}

/** The text-specific fields of a stored text object, with defaults for missing or unknown values. */
export function readTextFields(obj: Y.Map<unknown>): Pick<TextSnapshot, 'text' | 'size' | 'widthMode'> {
  const text = obj.get('text');
  const size = obj.get('size');
  return {
    text: text instanceof Y.Text ? text.toString() : '',
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
  };
}

/**
 * Creates an empty size M, auto-width text object whose top-left is `at` (world units), on top of
 * every other object. The box is a first estimate (one empty line) until the editor measures it.
 * Returns the new id, or null for a non-finite point.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = crypto.randomUUID();
  const objects = doc.getMap('objects');
  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((o) => {
      const z = o instanceof Y.Map ? o.get('z') : undefined;
      if (typeof z === 'number' && Number.isFinite(z)) maxZ = Math.max(maxZ, z);
    });
    const obj = new Y.Map<unknown>();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', TEXT_MIN_WIDTH_WORLD);
    obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    obj.set('z', maxZ + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Changes the size preset (the top-left stays). False for a stale id, an unknown size or no change. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const obj = textObject(doc, id);
  if (!obj || obj.get('size') === size) return false;
  doc.transact(() => obj.set('size', size), LOCAL_ORIGIN);
  return true;
}

/**
 * Gives the text a fixed width, clamped to [TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD]. The
 * height is re-measured by the caller. False for a stale id, a non-finite width or no change.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const obj = textObject(doc, id);
  if (!obj) return false;
  const w = Math.min(Math.max(width, TEXT_MIN_WIDTH_WORLD), MAX_OBJECT_SIZE_WORLD);
  if (obj.get('widthMode') === 'fixed' && obj.get('width') === w) return false;
  doc.transact(() => {
    obj.set('widthMode', 'fixed');
    obj.set('width', w);
  }, LOCAL_ORIGIN);
  return true;
}

/** Stores the measured box. False for a stale id, non-finite or non-positive sizes, or no change. */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  const { width, height } = box;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const obj = textObject(doc, id);
  if (!obj || (obj.get('width') === width && obj.get('height') === height)) return false;
  doc.transact(() => {
    if (obj.get('width') !== width) obj.set('width', width);
    if (obj.get('height') !== height) obj.set('height', height);
  }, LOCAL_ORIGIN);
  return true;
}

export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = textObject(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True for an existing text object with zero characters (whitespace counts as content). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/** Removes the text object if it has no characters. True when it was removed. */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  return isEmptyText(doc, id) && deleteObjects(doc, [id]) === 1;
}
