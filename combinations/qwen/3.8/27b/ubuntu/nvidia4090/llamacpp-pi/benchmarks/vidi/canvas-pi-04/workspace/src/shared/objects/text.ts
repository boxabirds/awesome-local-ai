// Story 9: text object model (anchor: text.model).
//
// The single authority for what a text object is. Mirrors the sticky model's
// contracts: stale ids and non-finite input are rejected with false/null and
// NO transaction; every local write is one LOCAL_ORIGIN transaction so story 8
// undo captures them as steps (undo.local_changes).

import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import { deleteObjects, LOCAL_ORIGIN, objectMap } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

/** How the text box's width is determined (document schema `widthMode`). */
export type TextWidthMode = 'auto' | 'fixed';

/**
 * Immutable view of one text object, as rendered by React. Extends the shared
 * base with the text-specific fields; the measured box (width/height) is
 * stored on the object and written by the client after each local change
 * (text.layout, key decision 1).
 */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  /** The text content (from the bound Y.Text). */
  text: string;
  /** One of the TEXT_SIZES preset names. */
  size: TextSize;
  widthMode: TextWidthMode;
  /** Epoch ms. */
  createdAt: number;
  /** Identity of the creating client (anonymous pre-story-6). */
  createdBy: string;
}

function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && value in TEXT_SIZES;
}

/**
 * Create an empty text object at world point `at` (its box's top-left), on
 * top of everything, and return its new id. Returns null (no object, no
 * update) when the point is not finite.
 *
 * The initial box is an estimate (the smallest useful box for empty text at
 * the default size) so selection bounds exist before the client's first
 * measurement; the client rewrites it after the first remeasure.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  if (typeof createdBy !== 'string') return null;

  const map = objectMap(doc);
  let z = 1;
  for (const obj of map.values()) {
    const zVal = obj.get('z');
    const existing = typeof zVal === 'number' ? zVal : 0;
    if (existing >= z) z = existing + 1;
  }

  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set('type', 'text');
  obj.set('x', at.x);
  obj.set('y', at.y);
  obj.set('width', TEXT_MIN_WIDTH_WORLD);
  obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
  obj.set('z', z);
  obj.set('createdAt', Date.now());
  obj.set('createdBy', createdBy);
  obj.set('text', new Y.Text());
  obj.set('size', DEFAULT_TEXT_SIZE);
  obj.set('widthMode', 'auto');
  doc.transact(() => map.set(id, obj), LOCAL_ORIGIN);
  return id;
}

/**
 * Set a text object's size to a known preset name; false (no update) for an
 * unknown key, a stale id or a non-text object. A no-op (same size) also
 * returns false without a transaction.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const obj = objectMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'text') return false;
  if (obj.get('size') === size) return false; // no-op: no update
  doc.transact(() => obj.set('size', size), LOCAL_ORIGIN);
  return true;
}

/**
 * Set a text object's fixed width (its side handle being used): the width is
 * clamped to at least TEXT_MIN_WIDTH_WORLD and widthMode becomes 'fixed'.
 * false (no update) for a non-finite width, a stale id or a non-text object.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const obj = objectMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'text') return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  if (obj.get('width') === clamped && obj.get('widthMode') === 'fixed') return false;
  doc.transact(
    () => {
      obj.set('width', clamped);
      obj.set('widthMode', 'fixed');
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/**
 * Write a measured text box (width AND height together, text.layout).
 * false (no update) for non-finite or negative numbers, a stale id or a
 * non-text object; a no-op (both values unchanged) returns false without a
 * transaction.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  if (box.width < 0 || box.height < 0) return false;
  const obj = objectMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'text') return false;
  if (obj.get('width') === box.width && obj.get('height') === box.height) return false;
  doc.transact(
    () => {
      obj.set('width', box.width);
      obj.set('height', box.height);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** The live Y.Text of a text object, or undefined for unknown ids / other types. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objectMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'text') return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * True when the text object exists and its content is zero characters (empty
 * means zero characters, PRD; whitespace-only is NOT empty). Unknown ids are
 * false (nothing is ever removable).
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/**
 * Delete a text object only when it is empty (text.empty_removed). Returns
 * true when the object was removed. Stale ids are false with no transaction.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

/**
 * Stored size, width mode and width of a text object — the inputs the client
 * layout needs after a local change (undefined for stale ids / other types).
 */
export function getTextMeta(
  doc: Y.Doc,
  id: string,
): { size: TextSize; widthMode: TextWidthMode; width: number } | undefined {
  const obj = objectMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'text') return undefined;
  const size = obj.get('size');
  const widthMode = obj.get('widthMode');
  const width = obj.get('width');
  return {
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
    width:
      typeof width === 'number' && Number.isFinite(width) ? width : TEXT_MIN_WIDTH_WORLD,
  };
}
