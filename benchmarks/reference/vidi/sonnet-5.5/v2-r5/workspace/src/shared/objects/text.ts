import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE, TEXT_AVG_GLYPH_RATIO, TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES, type TextSize,
} from '../config';
import {
  deleteObjects, hasObject, LOCAL_ORIGIN, registerKnownObjectType, type ObjectSnapshot,
} from '../board-model';
import type { Point } from '../geometry';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text'; text: string; size: TextSize; widthMode: 'auto' | 'fixed';
}

registerKnownObjectType('text');

const objectsOf = (doc: Y.Doc) => doc.getMap('objects') as Y.Map<Y.Map<unknown>>;

function textObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map && obj.get('type') === 'text' ? obj : undefined;
}

export function isTextSize(s: unknown): s is TextSize {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, s);
}

/** Top-left at `at`; returns the new id, or null for a non-finite point (no transaction). */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    let max = 0;
    objectsOf(doc).forEach((o) => {
      const z = o instanceof Y.Map ? o.get('z') : 0;
      if (typeof z === 'number') max = Math.max(max, z);
    });
    const obj = new Y.Map<unknown>();
    objectsOf(doc).set(id, obj);
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    // Initial box from an estimate so bounds exist before the first measure.
    obj.set('width', Math.ceil(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_AVG_GLYPH_RATIO));
    obj.set('height', Math.ceil(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT));
    obj.set('z', max + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
  }, LOCAL_ORIGIN);
  return id;
}

export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const obj = textObject(doc, id);
  if (!obj || !isTextSize(size)) return false;
  if (obj.get('size') === size) return true;
  doc.transact(() => obj.set('size', size), LOCAL_ORIGIN);
  return true;
}

/** Clamps to TEXT_MIN_WIDTH_WORLD; switches to fixed width. */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const obj = textObject(doc, id);
  if (!obj || !Number.isFinite(width)) return false;
  const w = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  if (obj.get('widthMode') === 'fixed' && obj.get('width') === w) return true;
  doc.transact(() => { obj.set('widthMode', 'fixed'); obj.set('width', w); }, LOCAL_ORIGIN);
  return true;
}

export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  const obj = textObject(doc, id);
  if (!obj || !Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) {
    return false;
  }
  if (obj.get('width') === box.width && obj.get('height') === box.height) return true;
  doc.transact(() => { obj.set('width', box.width); obj.set('height', box.height); }, LOCAL_ORIGIN);
  return true;
}

export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const t = textObject(doc, id)?.get('text');
  return t instanceof Y.Text ? t : undefined;
}

export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const t = getTextContent(doc, id);
  return t !== undefined && t.length === 0;
}

/** Current content, size and width mode of a text object, or undefined for a stale id. */
export function readText(doc: Y.Doc, id: string):
  { text: string; size: TextSize; widthMode: 'auto' | 'fixed'; width: number | null } | undefined {
  const obj = textObject(doc, id);
  if (!obj) return undefined;
  const t = obj.get('text');
  const size = obj.get('size');
  const w = obj.get('width');
  return {
    text: t instanceof Y.Text ? t.toString() : '',
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
    width: typeof w === 'number' ? w : null,
  };
}

export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id) || !hasObject(doc, id)) return false;
  return deleteObjects(doc, [id]) === 1;
}
