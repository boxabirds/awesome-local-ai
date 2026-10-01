/**
 * Text object model: schema helpers for the 'text' object type.
 *
 * Every mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`.
 * Rejections return false before opening a transaction, so no update event is emitted.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import { deleteObjects } from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_SIZES,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  type TextSize,
} from '../config';
import type { Point } from '../../client/canvas/camera';

export interface TextSnapshot {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy: string;
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

const VALID_SIZES = new Set<string>(Object.keys(TEXT_SIZES));

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

function getTextObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'text') return undefined;
  return obj;
}

/**
 * Create a text object with its top-left at `at`. Returns the new id, or null
 * when the point is not finite.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const objects = objectsMap(doc);
  const id = crypto.randomUUID();
  // Provide an initial estimated box so bounds exist before first measure.
  const initialWidth = TEXT_SIZES[DEFAULT_TEXT_SIZE] * 3;
  const initialHeight = TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT;
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', initialWidth);
    obj.set('height', initialHeight);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Change the size preset of a text object. Unknown size keys return false. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!VALID_SIZES.has(size)) return false;
  const obj = getTextObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/** Set a fixed width (clamped to TEXT_MIN_WIDTH_WORLD) and switch widthMode to 'fixed'. */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const obj = getTextObj(doc, id);
  if (!obj) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    obj.set('width', clamped);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/** Update the stored width and height of a text object. */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  const obj = getTextObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** Return the Y.Text of a text object for the editor. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getTextObj(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text object contains zero characters. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  if (!ytext) return false;
  return ytext.toString().length === 0;
}

/** Remove the text object if it is empty. Returns true if removed. */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  const obj = getTextObj(doc, id);
  if (!obj) return false;
  const text = obj.get('text');
  if (!(text instanceof Y.Text)) return false;
  if (text.toString().length > 0) return false;
  deleteObjects(doc, [id]);
  return true;
}
