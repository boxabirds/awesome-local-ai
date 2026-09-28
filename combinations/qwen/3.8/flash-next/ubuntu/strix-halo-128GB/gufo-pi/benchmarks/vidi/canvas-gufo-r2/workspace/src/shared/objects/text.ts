/**
 * Text object model (story 9).
 *
 * Schema: type 'text', x, y, width, height, z, createdAt, createdBy,
 *         text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
 *
 * All mutations go through `doc.transact(fn, LOCAL_ORIGIN)`.
 */
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  type TextSize,
} from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import type { Point } from '../geometry';

export interface TextSnapshot {
  id: string;
  type: 'text';
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  createdAt: number;
  createdBy: string;
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

const VALID_SIZES: ReadonlySet<string> = new Set(Object.keys(TEXT_SIZES));

/**
 * Create a text object at the given world point (top-left corner).
 * Returns the new id or null if the point is non-finite.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const objects = getObjects(doc);
  const id = crypto.randomUUID();
  const z = maxZ(objects) + 1;
  const size = DEFAULT_TEXT_SIZE;
  // Initial estimate so bounds exist before first measure:
  // width = min(TEXT_MAX_AUTO_WIDTH_WORLD, one-char estimate), height = one line
  const initialWidth = Math.min(10, TEXT_MAX_AUTO_WIDTH_WORLD);
  const initialHeight = TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
  doc.transact(() => {
    if (objects.has(id)) return; // id collision (should never happen)
    const yMap = new Y.Map();
    objects.set(id, yMap);
    yMap.set('type', 'text');
    yMap.set('x', at.x);
    yMap.set('y', at.y);
    yMap.set('width', initialWidth);
    yMap.set('height', initialHeight);
    yMap.set('z', z);
    yMap.set('createdAt', Date.now());
    yMap.set('createdBy', createdBy);
    yMap.set('size', size);
    yMap.set('widthMode', 'auto');
    const yText = new Y.Text();
    yMap.set('text', yText);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Set the text size. Returns false for unknown size key or missing id.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!VALID_SIZES.has(size)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width on a text object (clamps to TEXT_MIN_WIDTH_WORLD).
 * Sets widthMode to 'fixed'. Returns false for missing id or non-finite width.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;
  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  doc.transact(() => {
    obj.set('width', clamped);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set the computed width and height on a text object.
 * Returns false for missing id or non-finite values.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Get the Y.Text of a text object, or undefined if not found.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return undefined;
  return obj.get('text') as Y.Text;
}

/**
 * Check if a text object has zero characters. Returns false if id not found.
 * Note: whitespace-only text is NOT considered empty (only zero characters).
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;
  const ytext = obj.get('text') as Y.Text;
  return ytext.toString().length === 0;
}

/**
 * Delete the text object if it is empty. Returns true if deleted, false otherwise.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  const objects = getObjects(doc);
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}
