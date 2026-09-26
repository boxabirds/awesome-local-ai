import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '@/shared/config';
import {
  LOCAL_ORIGIN,
  deleteObjects,
  ensureMeta,
  registerKnownObjectType,
  type ObjectSnapshot,
} from '@/shared/board-model';

/**
 * Text object model (story 9). Yjs schema (extends the story 2 object map):
 *   objects: Y.Map (id -> Y.Map)
 *     <id>: Y.Map {
 *       type: 'text',
 *       x, y,               // top-left in world units (text.anchor: click point)
 *       width, height,      // measured box (layout.*), written by the client
 *       z, createdAt,
 *       createdBy,          // per-tab client id (string 6 identity is out of this milestone)
 *       text: Y.Text,       // plain text (text.content)
 *       size,               // 'S' | 'M' | 'L' | 'XL' (text.sizes)
 *       widthMode,          // 'auto' (grow then wrap, capped) | 'fixed' (text.resize)
 *     }
 *
 * x, y never move when the box re-measures: the text always starts at the
 * click point (text.anchor). All successful mutations are exactly one
 * LOCAL_ORIGIN transaction; rejections return false without a transaction.
 */

/** 'text' is a known, selectable board type (sel.all_types). */
registerKnownObjectType('text');

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: string;
  widthMode: 'auto' | 'fixed';
  createdBy?: string;
}

export function isTextSnapshot(o: ObjectSnapshot): o is TextSnapshot {
  return o.type === 'text';
}

function textObjectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function textObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = textObjectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'text') return undefined;
  return obj;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/**
 * Creates an empty text object with its top-left at `at` (the click point,
 * text.anchor), size DEFAULT_TEXT_SIZE, widthMode 'auto', on top of
 * everything (z = maxZ + 1). Returns the new id, or null for non-finite
 * coordinates. `createdBy` is the creating tab's stable client id.
 */
export function createText(doc: Y.Doc, at: { x: number; y: number }, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = crypto.randomUUID();
  const text = new Y.Text();
  doc.transact(() => {
    ensureMeta(doc); // first content writes meta.schemaVersion (idempotent)
    const objects = textObjectsMap(doc);
    const obj = new Y.Map();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', text);
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** The Y.Text of a text object, or undefined for unknown/non-text ids. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = textObj(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text object exists and holds zero characters. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/**
 * Deletes the text object when it is empty (text.delete, Escape with zero
 * characters). Returns true when it was deleted. Whitespace-only text is NOT
 * empty and is kept.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

/** Changes the text size key (text.sizes). Unknown keys and stale ids are rejected. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (typeof size !== 'string' || !Object.prototype.hasOwnProperty.call(TEXT_SIZES, size)) return false;
  const obj = textObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets the box width to exactly `width` and switches to fixed mode
 * (text.resize: the handle commits fixed width). Widths below
 * TEXT_MIN_WIDTH_WORLD are clamped up. Stale ids and non-finite widths are
 * rejected.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const obj = textObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('width', Math.max(width, TEXT_MIN_WIDTH_WORLD));
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Writes the measured box (layout.*). Called by the client after a local
 * content/size/width change (useTextBoxSync) and by the width-handle gesture.
 * Non-finite values and stale ids are rejected.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  const obj = textObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}
