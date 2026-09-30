/**
 * Story 9: free text object model.
 *
 * Schema (per object id in the `objects` Y.Map):
 * ```
 * Y.Map {
 *   type: 'text', x, y, width, height, z, createdAt, createdBy,
 *   text: Y.Text,
 *   size: TextSize,           // 'S' | 'M' | 'L' | 'XL'
 *   widthMode: 'auto' | 'fixed'
 * }
 * ```
 *
 * All mutations are LOCAL_ORIGIN transactions. Setters reject stale ids and
 * non-finite numbers without opening a transaction (return false / null).
 *
 * Selection, move, nudge, delete and undo are the generic story 7/8
 * operations (`moveObjects`, `deleteObjects`, ...); nothing text-specific is
 * added to them (PRD text.consistent).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import { deleteObjects } from '../board-model';
import {
  TEXT_SIZES, TEXT_MIN_WIDTH_WORLD, TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_SIZE, type TextSize,
} from '../config';
import type { ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

/** Cast a generic snapshot to its text flavour. */
export function asText(snap: ObjectSnapshot): TextSnapshot {
  return snap as TextSnapshot;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** The object record if `id` exists and is a `text` object; else undefined. */
export function getTextObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj) return undefined;
  if (obj.get('type') !== 'text') return undefined;
  return obj as Y.Map<unknown>;
}

function getMaxZ(doc: Y.Doc): number {
  let maxZ = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  return maxZ;
}

/**
 * Create a text object whose top-left corner is `at` (PRD text.create):
 * size M, auto width, empty Y.Text, z above every other object, in one
 * LOCAL_ORIGIN transaction. The initial box is an estimate (empty content:
 * zero width, one line of height) so bounds exist before the first measure.
 * Non-finite points → null, no transaction.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  if (typeof createdBy !== 'string' || createdBy.length === 0) return null;

  const id = crypto.randomUUID();
  const text = new Y.Text();
  const obj = new Y.Map();
  obj.set('type', 'text');
  obj.set('x', at.x);
  obj.set('y', at.y);
  // Estimate for empty content: no width, one line tall.
  obj.set('width', 0);
  obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
  obj.set('z', getMaxZ(doc) + 1);
  obj.set('createdAt', Date.now());
  obj.set('createdBy', createdBy);
  obj.set('text', text);
  obj.set('size', DEFAULT_TEXT_SIZE);
  obj.set('widthMode', 'auto');

  doc.transact(() => {
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change the size preset. Unknown size keys → false, no transaction
 * (PRD text.size). The top-left position is untouched.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!(size in TEXT_SIZES)) return false;
  const obj = getTextObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width (PRD text.fixed_width): clamped to at least
 * TEXT_MIN_WIDTH_WORLD, widthMode becomes 'fixed'. Non-finite width →
 * false, no transaction.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const obj = getTextObj(doc, id);
  if (!obj) return false;
  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  doc.transact(() => {
    obj.set('width', clamped);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the measured box (PRD text.height / text.auto_width). Called only by
 * the client that made the local change; non-finite or non-positive values
 * → false, no transaction.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  if (box.width < 0 || box.height < 0) return false;
  const obj = getTextObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The Y.Text of a text object; undefined for stale ids and other types. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getTextObj(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * True only when the text object exists and contains ZERO characters.
 * Whitespace-only text is NOT empty (it renders a visible box). Non-text
 * objects are never empty text.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  if (!text) return false;
  return text.length === 0;
}

/**
 * Remove the text object if (and only if) it is empty. Used when editing
 * ends so an abandoned text never becomes an invisible object (PRD
 * text.empty_removed). Returns true when the object was removed.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) === 1;
}
