import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  type TextSize,
} from '../config';
import type { Point } from '../geometry';
import { LOCAL_ORIGIN, deleteObjects } from '../board-model';

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

const SIZE_KEYS: Set<string> = new Set(Object.keys(TEXT_SIZES));

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function isValidFinite(n: number): boolean {
  return Number.isFinite(n);
}

/**
 * Create a new text object on the board. Returns the id, or null if point is non-finite.
 */
export function createText(
  doc: Y.Doc,
  at: Point,
  createdBy: string,
): string | null {
  if (!isValidFinite(at.x) || !isValidFinite(at.y)) return null;
  const id = crypto.randomUUID();
  const objects = objectsMap(doc);
  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((obj) => {
      const z = obj.get('z') as number;
      if (z > maxZ) maxZ = z;
    });
    const yMap = new Y.Map<unknown>();
    yMap.set('type', 'text');
    yMap.set('x', at.x);
    yMap.set('y', at.y);
    // Initial estimated box (will be remeasured on first edit)
    const sizePx = TEXT_SIZES[DEFAULT_TEXT_SIZE];
    yMap.set('width', sizePx * 2);
    yMap.set('height', sizePx * TEXT_LINE_HEIGHT);
    yMap.set('z', maxZ + 1);
    yMap.set('createdAt', Date.now());
    yMap.set('createdBy', createdBy);
    yMap.set('text', new Y.Text(''));
    yMap.set('size', DEFAULT_TEXT_SIZE);
    yMap.set('widthMode', 'auto');
    objects.set(id, yMap);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Set the text size preset. Returns false for unknown size keys or stale ids.
 */
export function setTextSize(
  doc: Y.Doc,
  id: string,
  size: string,
): boolean {
  if (!SIZE_KEYS.has(size)) return false;
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;
  if (obj.get('size') === size) return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width (clamped to TEXT_MIN_WIDTH_WORLD). Sets widthMode to 'fixed'.
 * Returns false for stale ids or non-finite width.
 */
export function setTextWidthFixed(
  doc: Y.Doc,
  id: string,
  width: number,
): boolean {
  if (!isValidFinite(width)) return false;
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;
  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  doc.transact(() => {
    obj.set('widthMode', 'fixed');
    obj.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set the stored box (width and height). Returns false for stale ids or non-finite values.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!isValidFinite(box.width) || !isValidFinite(box.height)) return false;
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;
  const curW = obj.get('width') as number;
  const curH = obj.get('height') as number;
  if (curW === box.width && curH === box.height) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Get the Y.Text of a text object, or undefined if not found or wrong type.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return undefined;
  return obj.get('text') as Y.Text;
}

/**
 * Returns true if the text object contains zero characters.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return true;
  const ytext = obj.get('text') as Y.Text;
  return ytext.toString().length === 0;
}

/**
 * Delete the text object if it has zero characters. Returns true if deleted.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  const count = deleteObjects(doc, [id]);
  return count > 0;
}
