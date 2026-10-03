/**
 * Free text object model (story 9, text.model).
 *
 * A `text` object is a plain-text annotation with no background:
 *
 * ```
 * objects/<id>: Y.Map {
 *   type: 'text', x, y, width, height, z, createdAt, createdBy,
 *   text: Y.Text,
 *   size: TextSize,          // 'S' | 'M' | 'L' | 'XL'
 *   widthMode: 'auto' | 'fixed'
 * }
 * ```
 *
 * The top-left corner is (x, y). `width`/`height` are the measured box,
 * written by the client that made the local change (typing, size change,
 * fixed-width drag) via `setTextBox` — see `useTextBoxSync` (story 9,
 * text.layout). Remote clients render the stored box and never write
 * dimensions.
 *
 * Selection, move, nudge, delete and undo are the generic story 7/8
 * operations (`moveObjects`, `deleteObjects`, …); nothing text-specific is
 * added there (text.consistent).
 */

import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import { LOCAL_ORIGIN, deleteObjects, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

/** Immutable snapshot of a text object. */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getObjects(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects');
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Create a text object whose top-left is `at` (text.create).
 *
 * Size M, auto width, empty Y.Text, z above every other object, `createdBy`
 * from the caller's identity. One LOCAL_ORIGIN transaction. Returns the new
 * id, or null (no transaction) when the point is non-finite.
 *
 * The initial box is an estimate (minimum width, one line at the default
 * size) so bounds exist before the first measurement; the first local edit
 * rewrites it with the measured box.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;

  const id = crypto.randomUUID();
  const objects = getObjects(doc);

  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (isFiniteNumber(z) && z > maxZ) maxZ = z;
  });

  const text = new Y.Text();
  const obj = new Y.Map();
  obj.set('type', 'text');
  obj.set('x', at.x);
  obj.set('y', at.y);
  obj.set('width', TEXT_MIN_WIDTH_WORLD);
  obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
  obj.set('z', maxZ + 1);
  obj.set('createdAt', Date.now());
  obj.set('createdBy', createdBy);
  obj.set('text', text);
  obj.set('size', DEFAULT_TEXT_SIZE);
  obj.set('widthMode', 'auto');

  doc.transact(() => {
    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Change a text object's size preset (text.size).
 * Unknown size keys → false, no transaction.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!(size in TEXT_SIZES)) return false;
  const obj = getObjects(doc).get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('size', size as TextSize);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Set a fixed width from a side-handle drag (text.fixed_width).
 * Clamped to at least TEXT_MIN_WIDTH_WORLD; sets widthMode to 'fixed'.
 * Non-finite widths or stale ids → false, no transaction.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const obj = getObjects(doc).get(id);
  if (!obj) return false;

  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    obj.set('widthMode', 'fixed');
    obj.set('width', clamped);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Write the measured box (text.layout). Non-finite or non-positive
 * dimensions, or a stale id → false, no transaction.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  const obj = getObjects(doc).get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * The Y.Text of a text object, or undefined for a stale id.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getObjects(doc).get(id);
  if (!obj) return undefined;
  return obj.get('text') as Y.Text | undefined;
}

/**
 * True when the text object contains ZERO characters (text.empty_removed).
 * Whitespace-only text is not empty. Stale id → false.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  if (!text) return false;
  return text.length === 0;
}

/**
 * Delete the text object if — and only if — it is empty (text.empty_removed).
 * Returns true when it was deleted.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) === 1;
}
