// Text object model (see spec: text.model).
//
// A text object is a board object of type 'text':
//   objects/<id>: Y.Map {
//     type: 'text', x, y, width, height, z, createdAt, createdBy,
//     text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
//   }
//
// width/height are the STORED box: the client that made a local change
// (typing, size change, fixed-width drag) measures and writes them in the
// same capture window, so undo reverts text and box together (key decision 1).
// Remote clients render the stored box and never write dimensions.
//
// Selection, move, delete and undo are the generic story 7/8 object
// operations — nothing text-specific is added there (text.consistent).

import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import type { Point } from '../geometry';
import {
  deleteObjects,
  LOCAL_ORIGIN,
  registerObjectTypeName,
  type ObjectSnapshot,
} from '../board-model';

// The model owns its type name so documents with text objects can be
// snapshotted/validated even before the client registry loads (unit tests,
// worker).
registerObjectTypeName('text');

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function objectById(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objects(doc).get(id);
}

/** Highest z among all objects (0 when the board is empty). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const object of objects(doc).values()) {
    const z = object.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

/** True when `size` is one of the four text size preset keys. */
export function isTextSize(size: unknown): size is TextSize {
  return typeof size === 'string' && size in TEXT_SIZES;
}

/**
 * Create a size M, auto-width text object with its top-left at `at`.
 * The initial box comes from the estimate (so bounds exist before the first
 * measure); the first keystroke re-measures. Returns the new id; null (no
 * transaction) for a non-finite point.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = crypto.randomUUID();
  const line = TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT;
  doc.transact(() => {
    const object = new Y.Map();
    object.set('type', 'text');
    object.set('x', at.x);
    object.set('y', at.y);
    object.set('width', TEXT_MIN_WIDTH_WORLD);
    object.set('height', line);
    object.set('text', new Y.Text());
    object.set('size', DEFAULT_TEXT_SIZE);
    object.set('widthMode', 'auto');
    object.set('z', maxZ(doc) + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', createdBy);
    objects(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change the text size preset. Unknown keys → false (no transaction); the
 * box is re-measured by the editor layer (size change keeps x/y).
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const object = objectById(doc, id);
  if (object === undefined) return false;
  doc.transact(() => {
    object.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Resize batch for text objects (selection resize, one rAF frame): writes
 * each object's new x and fixed width in a single transaction. Widths are
 * clamped to TEXT_MIN_WIDTH_WORLD; height and size are untouched (the box is
 * re-measured by the object's box sync). Stale ids are skipped.
 */
export function setTextsGeometry(
  doc: Y.Doc,
  entries: { id: string; x: number; width: number }[],
): number {
  const valid = entries.filter(
    (e) => Number.isFinite(e.x) && Number.isFinite(e.width) && objectById(doc, e.id) !== undefined,
  );
  if (valid.length === 0) return 0;
  doc.transact(() => {
    for (const e of valid) {
      const object = objectById(doc, e.id);
      if (object === undefined) continue;
      object.set('x', e.x);
      object.set('widthMode', 'fixed');
      object.set('width', Math.max(e.width, TEXT_MIN_WIDTH_WORLD));
    }
  }, LOCAL_ORIGIN);
  return valid.length;
}

/**
 * Set a fixed width (side-handle drag). Clamped to TEXT_MIN_WIDTH_WORLD;
 * non-finite widths and stale ids → false (no transaction).
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const object = objectById(doc, id);
  if (object === undefined) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    object.set('widthMode', 'fixed');
    object.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the stored box. Stale ids and non-finite values → false (no
 * transaction); an identical box is a no-op (no transaction, no event),
 * which is what keeps remeasures from producing redundant writes (TC-13).
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  if (box.width < 0 || box.height < 0) return false;
  const object = objectById(doc, id);
  if (object === undefined) return false;
  if (object.get('width') === box.width && object.get('height') === box.height) return true;
  doc.transact(() => {
    object.set('width', box.width);
    object.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The text object's editable Y.Text, if the object exists. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = objectById(doc, id);
  if (object === undefined) return undefined;
  const text = object.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text object contains zero characters (whitespace counts). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/**
 * Remove the text object when it is empty (edit-end rule: empty text never
 * becomes an invisible object). Returns true when it was removed.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
