/**
 * Text object model (story 9): schema helpers for `type: 'text'` objects.
 *
 * Schema (Y.Map per object under the `objects` map):
 *   type: 'text', x, y, width, height, z, createdAt, createdBy,
 *   text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
 *
 * All setters reject stale ids and non-finite numbers without a transaction.
 * All writes use LOCAL_ORIGIN so story 8's undo captures them.
 */
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_X_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import { LOCAL_ORIGIN, deleteObjects } from '../board-model';
import type { Point } from '../geometry';

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return getObjects(doc).get(id) as Y.Map<unknown> | undefined;
}

/**
 * Create a new text object whose top-left is `at`, size M, auto width,
 * empty Y.Text, z above every other object. Returns the new id, or null
 * when the point is non-finite (no transaction).
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;

  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  // Initial box from the empty-text estimate so bounds exist before the
  // client's first measure.
  const initialHeight = TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT;

  const id = crypto.randomUUID();
  const note = new Y.Map<unknown>();
  note.set('type', 'text');
  note.set('x', at.x);
  note.set('y', at.y);
  note.set('width', TEXT_PADDING_X_WORLD);
  note.set('height', initialHeight);
  note.set('z', maxZ + 1);
  note.set('createdAt', Date.now());
  note.set('createdBy', createdBy);
  note.set('size', DEFAULT_TEXT_SIZE);
  note.set('widthMode', 'auto');
  note.set('text', new Y.Text());

  doc.transact(() => {
    objects.set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set the text size preset. Unknown size keys → false, no transaction.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!(size in TEXT_SIZES)) return false;
  const obj = getObject(doc, id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('size', size as TextSize);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width (clamped to at least TEXT_MIN_WIDTH_WORLD) and switch
 * widthMode to 'fixed'. Non-finite width → false, no transaction.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const obj = getObject(doc, id);
  if (!obj) return false;

  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  doc.transact(() => {
    obj.set('width', clamped);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set the measured width/height box. Non-finite numbers → false, no
 * transaction. Does not change widthMode.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  const obj = getObject(doc, id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Get the Y.Text of a text object, or undefined if the id is unknown.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getObject(doc, id);
  if (!obj) return undefined;
  return obj.get('text') as Y.Text | undefined;
}

/**
 * True only when the text object contains zero characters (whitespace-only
 * text is kept). Stale ids are not empty.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const obj = getObject(doc, id);
  if (!obj) return false;
  const ytext = obj.get('text') as Y.Text | undefined;
  return ytext ? ytext.length === 0 : true;
}

/**
 * Delete the text object if it contains no characters. Returns true when it
 * was deleted. Runs in the same capture window as the caller (story 8: one
 * undo restores the text).
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  const count = deleteObjects(doc, [id]);
  return count > 0;
}
