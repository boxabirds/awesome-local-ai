/**
 * Story 9 (text.model): the text object schema helpers.
 *
 * A text object is a board object of type 'text' whose content is a Y.Text
 * (so concurrent typing merges, story 3), with a size preset, a width mode
 * (auto: as wide as the longest line up to TEXT_MAX_AUTO_WIDTH_WORLD; fixed:
 * set by a side-handle drag) and a stored width/height box measured by the
 * client that made the change (text.layout).
 *
 * Document schema:
 *   objects/<id>: Y.Map {
 *     type: 'text', x, y, width, height, z, createdAt, createdBy,
 *     text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
 *   }
 *
 * Every mutation is one LOCAL_ORIGIN transaction; stale ids and invalid
 * values are rejected without a transaction (false / null).
 */
import * as Y from 'yjs';
import {
  deleteObjects,
  LOCAL_ORIGIN,
  type ObjectSnapshot,
} from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import type { Point } from '../geometry';

/** A text object snapshot (the type-specific view of ObjectSnapshot). */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

/** The object's Y.Map when `id` is an existing text object. */
function textItem(doc: Y.Doc, id: string): Y.Map<any> | undefined {
  const item = doc.getMap('objects').get(id);
  if (!(item instanceof Y.Map) || item.get('type') !== 'text') return undefined;
  return item;
}

/**
 * Create a text object whose top-left corner is `at`: size M (DEFAULT_TEXT_SIZE),
 * auto width, empty Y.Text, z above every other object, `createdBy` from the
 * caller's identity. The initial box is the estimate of the (empty) content,
 * so bounds exist before the first measure. Returns the new id, or null for a
 * non-finite point (no transaction).
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const obj = doc.getMap('objects');
  let max = 0;
  obj.forEach((item) => {
    if (!(item instanceof Y.Map)) return;
    const z = (item.get('z') as number) ?? 0;
    if (z > max) max = z;
  });
  const id = crypto.randomUUID();
  const item = new Y.Map<any>();
  item.set('type', 'text');
  item.set('x', at.x);
  item.set('y', at.y);
  // Empty content has zero bounds; the editor's first input re-measures.
  item.set('width', 0);
  item.set('height', 0);
  item.set('text', new Y.Text());
  item.set('size', DEFAULT_TEXT_SIZE);
  item.set('widthMode', 'auto');
  item.set('z', max + 1);
  item.set('createdAt', Date.now());
  item.set('createdBy', createdBy);
  doc.transact(() => {
    obj.set(id, item);
  }, LOCAL_ORIGIN);
  return id;
}

/** Change a text object's size preset. Unknown keys or stale ids → false (no update). */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!(size in TEXT_SIZES)) return false;
  const item = textItem(doc, id);
  if (!item) return false;
  doc.transact(() => {
    item.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width (side-handle drag): clamped to at least
 * TEXT_MIN_WIDTH_WORLD, widthMode becomes 'fixed'. Stale ids and
 * non-finite widths → false (no update).
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const item = textItem(doc, id);
  if (!item) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    item.set('width', clamped);
    item.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the measured box. Non-finite values, stale ids or a non-text object →
 * false. A box that is already stored as-is is a no-op (no transaction): an
 * unchanged measure must not pollute sync or the undo stack.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  const item = textItem(doc, id);
  if (!item) return false;
  if (item.get('width') === box.width && item.get('height') === box.height) return true;
  doc.transact(() => {
    item.set('width', box.width);
    item.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The object's Y.Text, or undefined for a stale (or non-text) id. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const item = textItem(doc, id);
  if (!item) return undefined;
  return item.get('text') as Y.Text | undefined;
}

/** True when the object exists, is a text object and contains zero characters. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const item = textItem(doc, id);
  if (!item) return false;
  const t = item.get('text');
  return !(t instanceof Y.Text) || t.length === 0;
}

/** Delete the object if and only if it is empty; returns whether it was removed. */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
