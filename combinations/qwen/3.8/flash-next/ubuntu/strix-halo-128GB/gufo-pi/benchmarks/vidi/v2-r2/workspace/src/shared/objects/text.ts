import * as Y from 'yjs';
import {
  TEXT_SIZES,
  TEXT_MIN_WIDTH_WORLD,
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  type TextSize,
} from '@shared/config';
import { LOCAL_ORIGIN, deleteObjects, _registerTypeForModel } from '@shared/board-model';
import type { Point } from '@shared/geometry';

// Register 'text' type with board-model validation
_registerTypeForModel('text');

// Re-export TextSize so consumers can import from here
export type { TextSize };

export interface TextSnapshot {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

/**
 * Create a text object at the given world point.
 * Returns the new id, or null if the point is non-finite.
 */
export function createText(
  doc: Y.Doc,
  at: Point,
  createdBy: string,
): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const id = crypto.randomUUID();

  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  const fontSize = TEXT_SIZES[DEFAULT_TEXT_SIZE];
  const initialWidth = 100; // estimate before first measure
  const initialHeight = fontSize * TEXT_LINE_HEIGHT;

  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', initialWidth);
    obj.set('height', initialHeight);
    obj.set('z', maxZ + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    objects.set(id, obj);
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
  if (!(size in TEXT_SIZES)) return false;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width (clamped to TEXT_MIN_WIDTH_WORLD) and switch widthMode to 'fixed'.
 * Returns false for stale ids or non-finite width.
 */
export function setTextWidthFixed(
  doc: Y.Doc,
  id: string,
  width: number,
): boolean {
  if (!Number.isFinite(width)) return false;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;
  const clampedWidth = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  doc.transact(() => {
    obj.set('widthMode', 'fixed');
    obj.set('width', clampedWidth);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set the stored width and height of a text object.
 * Returns false for stale ids or non-finite values.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Get the Y.Text of a text object.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return undefined;
  return obj.get('text') as Y.Text | undefined;
}

/**
 * Returns true if the text object contains zero characters.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return true;
  const ytext = obj.get('text') as Y.Text;
  return ytext.toString().length === 0;
}

/**
 * Delete the text object if it is empty (zero characters).
 * Returns true if it was deleted, false otherwise.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;
  deleteObjects(doc, [id]);
  return true;
}

/**
 * Snapshot a text object from the doc's objects map.
 * Used by the board snapshot function.
 */
export function snapshotTextObject(id: string, obj: Y.Map<unknown>): TextSnapshot | null {
  if (obj.get('type') !== 'text') return null;
  return {
    id,
    type: 'text',
    x: obj.get('x') as number,
    y: obj.get('y') as number,
    width: obj.get('width') as number,
    height: obj.get('height') as number,
    z: obj.get('z') as number,
    createdAt: obj.get('createdAt') as number,
    text: (obj.get('text') as Y.Text).toString(),
    size: (obj.get('size') as TextSize) ?? DEFAULT_TEXT_SIZE,
    widthMode: (obj.get('widthMode') as 'auto' | 'fixed') ?? 'auto',
  };
}
