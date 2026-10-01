import * as Y from 'yjs';
import {
  TEXT_SIZES,
  TEXT_MIN_WIDTH_WORLD,
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  type TextSize,
} from '../config';
import { LOCAL_ORIGIN, deleteObjects, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function getMaxZ(doc: Y.Doc): number {
  let maxZ = 0;
  getObjects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (isFiniteNumber(z) && z > maxZ) maxZ = z;
  });
  return maxZ;
}

function getObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = getObjects(doc).get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

function isValidSize(size: string): size is TextSize {
  return size in TEXT_SIZES;
}

/**
 * Creates a `text` object whose top-left corner is `at`, size M, auto width,
 * empty Y.Text and z above every other object, in one LOCAL_ORIGIN
 * transaction. Returns the new id, or null for non-finite points (no
 * transaction).
 *
 * The initial box is a small estimate (one line of the default size) so
 * selection bounds exist before the first real measurement.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;

  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;
  const lineH = TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT;

  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', TEXT_MIN_WIDTH_WORLD);
    obj.set('height', lineH);
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    getObjects(doc).set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Changes the text size preset. Unknown keys → false, no transaction.
 * The top-left position (x, y) is never touched (text.size).
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isValidSize(size)) return false;
  const obj = getObj(doc, id);
  if (!obj || obj.get('type') !== 'text') return false;

  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets a fixed width (side handle drag), clamped to at least
 * TEXT_MIN_WIDTH_WORLD. Non-finite widths → false, no transaction.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const obj = getObj(doc, id);
  if (!obj || obj.get('type') !== 'text') return false;

  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  doc.transact(() => {
    obj.set('width', clamped);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Stores the measured width/height box. Non-finite values → false, no
 * transaction.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  const obj = getObj(doc, id);
  if (!obj || obj.get('type') !== 'text') return false;

  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The object's Y.Text, if the id exists and is a text object. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getObj(doc, id);
  if (!obj || obj.get('type') !== 'text') return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True only for zero characters (whitespace-only text is NOT empty). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/**
 * Removes the object if (and only if) it contains zero characters.
 * Uses the generic story 7 deleteObjects so undo/redo and live sync are
 * identical to every other object type (text.consistent).
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
