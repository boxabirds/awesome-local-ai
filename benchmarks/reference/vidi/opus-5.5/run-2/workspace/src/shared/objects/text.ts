/**
 * Free text objects (anchor: text.model).
 *
 *   objects/<id>: Y.Map { type: 'text', x, y, width, height, z, createdAt, createdBy,
 *                         text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed' }
 *
 * `width`/`height` are the stored box: the client that makes a local change (typing, size
 * change, side-handle drag) measures the text and writes them (see the client's
 * `useTextBoxSync`); other clients only render them. Selection, move, delete and undo are
 * the generic board-model operations.
 *
 * Like board-model, every successful mutation is one LOCAL_ORIGIN transaction; stale ids,
 * unknown sizes, non-finite numbers and no-ops return false/null without a transaction.
 */
import * as Y from 'yjs';
import {
  deleteObjects,
  LOCAL_ORIGIN,
  nextZ,
  registerSnapshotReader,
  type ObjectSnapshot,
} from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_AUTO_WIDTH_PADDING_WORLD,
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
}

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);
}

export function isTextSnapshot(obj: ObjectSnapshot): obj is TextSnapshot {
  return obj.type === TEXT_TYPE;
}

function finite(...values: number[]): boolean {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function textMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
  return obj instanceof Y.Map && obj.get('type') === TEXT_TYPE ? obj : undefined;
}

registerSnapshotReader(TEXT_TYPE, (base, obj): TextSnapshot => {
  const text = obj.get('text');
  const size = obj.get('size');
  return {
    ...base,
    type: TEXT_TYPE,
    text: text instanceof Y.Text ? text.toString() : '',
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
  };
});

/**
 * Creates an empty size-M auto-width text object with its top-left at `at`, above every
 * other object. The initial box (one empty line) gives it bounds before its first measure.
 * Returns the new id, or null (nothing written) for a non-finite point.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!finite(at.x, at.y)) return null;
  const id = crypto.randomUUID();
  const fontPx = TEXT_SIZES[DEFAULT_TEXT_SIZE];
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', TEXT_TYPE);
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', TEXT_AUTO_WIDTH_PADDING_WORLD);
    obj.set('height', fontPx * TEXT_LINE_HEIGHT);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    obj.set('z', nextZ(doc));
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    doc.getMap<Y.Map<unknown>>('objects').set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Changes the size preset; false for an unknown preset, a stale id or the current size. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const obj = textMap(doc, id);
  if (obj === undefined || !isTextSize(size) || obj.get('size') === size) return false;
  doc.transact(() => obj.set('size', size), LOCAL_ORIGIN);
  return true;
}

/** Gives the text a fixed width (clamped to TEXT_MIN_WIDTH_WORLD); its height is remeasured separately. */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const obj = textMap(doc, id);
  if (obj === undefined || !finite(width)) return false;
  const w = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  if (obj.get('widthMode') === 'fixed' && obj.get('width') === w) return false;
  doc.transact(() => {
    obj.set('widthMode', 'fixed');
    obj.set('width', w);
  }, LOCAL_ORIGIN);
  return true;
}

/** Stores the measured box; false when unchanged, non-finite or not positive. */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  const obj = textMap(doc, id);
  if (obj === undefined || !finite(box.width, box.height) || box.width <= 0 || box.height <= 0) return false;
  if (obj.get('width') === box.width && obj.get('height') === box.height) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = textMap(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text object exists and has zero characters (whitespace counts as content). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const obj = textMap(doc, id);
  if (obj === undefined) return false;
  const text = obj.get('text');
  return !(text instanceof Y.Text) || text.length === 0;
}

/** Removes the text object when it has no characters (edit end). */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  return isEmptyText(doc, id) && deleteObjects(doc, [id]) > 0;
}
