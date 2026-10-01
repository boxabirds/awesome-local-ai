import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import { deleteObjects, LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

export function isText(o: ObjectSnapshot): o is TextSnapshot {
  return o.type === 'text';
}

export function isTextSize(s: string): s is TextSize {
  return Object.prototype.hasOwnProperty.call(TEXT_SIZES, s);
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function textObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const o = objects(doc).get(id);
  return o instanceof Y.Map && o.get('type') === 'text' ? o : undefined;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((o) => {
    const z = o.get('z');
    if (typeof z === 'number' && Number.isFinite(z)) max = Math.max(max, z);
  });
  return max;
}

/** Top-left at `at`, size M, automatic width, empty; the box is an estimate until the editor measures it. Null for a non-finite point. */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    objects(doc).set(id, obj);
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', TEXT_PADDING_WORLD);
    obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
  }, LOCAL_ORIGIN);
  return id;
}

/** False (nothing written) for a stale id, an unknown size key or the current size. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const obj = textObject(doc, id);
  if (!obj || !isTextSize(size) || obj.get('size') === size) return false;
  doc.transact(() => obj.set('size', size), LOCAL_ORIGIN);
  return true;
}

/** Switches to fixed width (clamped to TEXT_MIN_WIDTH_WORLD). */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const obj = textObject(doc, id);
  if (!obj || !Number.isFinite(width)) return false;
  const w = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  doc.transact(() => {
    obj.set('widthMode', 'fixed');
    obj.set('width', w);
  }, LOCAL_ORIGIN);
  return true;
}

/** False when the stored box already equals `box`. */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  const obj = textObject(doc, id);
  if (!obj || !Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) return false;
  if (obj.get('width') === box.width && obj.get('height') === box.height) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const t = textObject(doc, id)?.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/** Zero characters only: whitespace counts as content. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const t = getTextContent(doc, id);
  return t !== undefined && t.length === 0;
}

export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  return isEmptyText(doc, id) && deleteObjects(doc, [id]) > 0;
}
