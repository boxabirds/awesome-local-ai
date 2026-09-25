/**
 * Free text object model (story 9).
 *
 * A text object is a Y.Map under the board's `objects` map with:
 *   type: 'text'
 *   x, y: top-left of the box (world units)
 *   width, height: box dimensions (always stored; auto mode updates on change)
 *   size: TextSize ('S' | 'M' | 'L' | 'XL')
 *   widthMode: 'auto' | 'fixed'
 *   content: Y.Text
 *   createdBy: session-scoped anonymous id
 *   z, createdAt: standard fields
 *
 * All mutations are no-ops (return false, emit no transaction) when the
 * inputs are invalid or the value is unchanged.
 */

import * as Y from 'yjs';
import {
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import type { Rect } from '../geometry';

// --- Session identity (story 6 out of scope) --------------------------------

let _sessionId: string | undefined;

/** Session-scoped anonymous id for createdBy. */
export function getSessionId(): string {
  if (!_sessionId) _sessionId = crypto.randomUUID();
  return _sessionId;
}

/** Reset the session id (for tests). */
export function _resetSessionId(): void {
  _sessionId = undefined;
}

// --- Y.Map keys (must match board-model.ts) ---------------------------------

const TYPE_KEY = 'type';
const X_KEY = 'x';
const Y_KEY = 'y';
const WIDTH_KEY = 'width';
const HEIGHT_KEY = 'height';
const SIZE_KEY = 'size';
const WIDTH_MODE_KEY = 'widthMode';
const CONTENT_KEY = 'content';
const CREATED_BY_KEY = 'createdBy';
const Z_KEY = 'z';
const CREATED_AT_KEY = 'createdAt';
const OBJECTS_KEY = 'objects';

const TEXT_TYPE = 'text';

function objects(doc: Y.Doc): Y.Map<Y.Map<any>> {
  return doc.getMap(OBJECTS_KEY);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get(Z_KEY);
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

function getTextMap(doc: Y.Doc, id: string): Y.Map<any> | undefined {
  const obj = objects(doc).get(id);
  if (!obj || obj.get(TYPE_KEY) !== TEXT_TYPE) return undefined;
  return obj;
}

// --- Types -------------------------------------------------------------------

/** Snapshot of a text object for e2e assertions and rendering. */
export interface TextSnapshot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  content: string;
  createdBy: string;
}

/** Maximum number of characters a text object may hold. */
export { TEXT_MAX_CHARS };

// --- Mutations ----------------------------------------------------------------

/**
 * Create a text object at the given position (top-left of the box).
 * Returns the new id, or '' when the inputs are invalid.
 */
export function createText(
  doc: Y.Doc,
  origin: unknown,
  pos: { x: number; y: number },
  size: TextSize,
): string {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !(size in TEXT_SIZES)) return '';
  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set(TYPE_KEY, TEXT_TYPE);
  obj.set(X_KEY, pos.x);
  obj.set(Y_KEY, pos.y);
  obj.set(WIDTH_KEY, 0);
  obj.set(HEIGHT_KEY, 0);
  obj.set(SIZE_KEY, size);
  obj.set(WIDTH_MODE_KEY, 'auto');
  obj.set(CONTENT_KEY, new Y.Text());
  obj.set(CREATED_BY_KEY, getSessionId());
  obj.set(Z_KEY, maxZ(doc) + 1);
  obj.set(CREATED_AT_KEY, Date.now());
  doc.transact(() => {
    objects(doc).set(id, obj);
  }, origin);
  return id;
}

/**
 * Change the text size. Returns false for a stale id or invalid size.
 * No-op (false) when the size is unchanged.
 */
export function setTextSize(
  doc: Y.Doc,
  origin: unknown,
  id: string,
  size: TextSize,
): boolean {
  if (!(size in TEXT_SIZES)) return false;
  const obj = getTextMap(doc, id);
  if (!obj) return false;
  if (obj.get(SIZE_KEY) === size) return false;
  doc.transact(() => {
    obj.set(SIZE_KEY, size);
  }, origin);
  return true;
}

/**
 * Set the text to fixed width mode. The stored width is clamped to at least
 * TEXT_MIN_WIDTH_WORLD. `anchorX` is the new left edge of the box.
 * Returns false for a stale id or non-finite inputs.
 */
export function setTextWidthFixed(
  doc: Y.Doc,
  origin: unknown,
  id: string,
  width: number,
  anchorX: number,
): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(anchorX)) return false;
  const obj = getTextMap(doc, id);
  if (!obj) return false;
  const clampedWidth = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    obj.set(WIDTH_MODE_KEY, 'fixed');
    obj.set(WIDTH_KEY, clampedWidth);
    obj.set(X_KEY, anchorX);
  }, origin);
  return true;
}

/**
 * Set the text box (x, y, width, height). No-op (false) when the box is
 * unchanged or the id is stale.
 */
export function setTextBox(
  doc: Y.Doc,
  origin: unknown,
  id: string,
  box: Rect,
): boolean {
  if (
    !Number.isFinite(box.x) || !Number.isFinite(box.y) ||
    !Number.isFinite(box.width) || !Number.isFinite(box.height)
  ) return false;
  const obj = getTextMap(doc, id);
  if (!obj) return false;
  const cx = obj.get(X_KEY) as number;
  const cy = obj.get(Y_KEY) as number;
  const cw = obj.get(WIDTH_KEY) as number;
  const ch = obj.get(HEIGHT_KEY) as number;
  if (cx === box.x && cy === box.y && cw === box.width && ch === box.height) return false;
  doc.transact(() => {
    obj.set(X_KEY, box.x);
    obj.set(Y_KEY, box.y);
    obj.set(WIDTH_KEY, box.width);
    obj.set(HEIGHT_KEY, box.height);
  }, origin);
  return true;
}

// --- Queries ------------------------------------------------------------------

/** The text content as a string. Returns '' for a stale id. */
export function getTextContent(doc: Y.Doc, id: string): string {
  const obj = getTextMap(doc, id);
  if (!obj) return '';
  const content = obj.get(CONTENT_KEY);
  return content instanceof Y.Text ? content.toString() : '';
}

/** The Y.Text for editing. Returns undefined for a stale id. */
export function getTextYText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getTextMap(doc, id);
  if (!obj) return undefined;
  const content = obj.get(CONTENT_KEY);
  return content instanceof Y.Text ? content : undefined;
}

/** True when the text content is empty (zero characters). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const obj = getTextMap(doc, id);
  if (!obj) return false;
  const content = obj.get(CONTENT_KEY);
  return content instanceof Y.Text ? content.toString().length === 0 : true;
}

/**
 * Delete the text object if its content is empty. Returns true when deleted.
 * No-op (false) when the text has content or the id is stale.
 */
export function deleteIfEmpty(
  doc: Y.Doc,
  origin: unknown,
  id: string,
): boolean {
  if (!isEmptyText(doc, id)) return false;
  const map = objects(doc);
  if (!map.get(id)) return false;
  doc.transact(() => {
    map.delete(id);
  }, origin);
  return true;
}

/** Snapshot a text object. Returns undefined for a stale id or non-text object. */
export function snapshotText(doc: Y.Doc, id: string): TextSnapshot | undefined {
  const obj = getTextMap(doc, id);
  if (!obj) return undefined;
  const size = obj.get(SIZE_KEY);
  const widthMode = obj.get(WIDTH_MODE_KEY);
  const content = obj.get(CONTENT_KEY);
  const createdBy = obj.get(CREATED_BY_KEY);
  return {
    id,
    x: obj.get(X_KEY) as number,
    y: obj.get(Y_KEY) as number,
    w: obj.get(WIDTH_KEY) as number,
    h: obj.get(HEIGHT_KEY) as number,
    size: typeof size === 'string' && size in TEXT_SIZES ? (size as TextSize) : 'M',
    widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
    content: content instanceof Y.Text ? content.toString() : '',
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}
