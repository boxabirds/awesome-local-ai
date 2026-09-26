/**
 * Text object model (story 9).
 *
 * Schema:
 * ```
 * objects/<id>: Y.Map {
 *   type: 'text', x, y, width, height, z, createdAt, createdBy,
 *   text: Y.Text,
 *   size: TextSize,
 *   widthMode: 'auto' | 'fixed'
 * }
 * ```
 */
import * as Y from 'yjs';
import {
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  type TextSize,
} from '../config';
import type { Point } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';

/** Snapshot shape for text objects. */
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

const TEXT_INITIAL_WIDTH = 80;
const TEXT_INITIAL_HEIGHT = TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT;

/**
 * Create a text object at the given world point (top-left corner).
 * Returns the new id, or null when the point is non-finite.
 */
export function createText(
  doc: Y.Doc,
  at: Point,
  createdBy: string,
): string | null {
  if (!Number.isFinite(at?.x) || !Number.isFinite(at?.y)) return null;

  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `text-${Math.random().toString(36).slice(2)}`;

  // Compute z above all existing objects.
  let maxZ = 0;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  objects.forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > maxZ) maxZ = z;
  });

  const z = maxZ + 1;

  doc.transact(() => {
    const textMap = new Y.Map<unknown>();
    textMap.set('type', 'text');
    textMap.set('x', at.x);
    textMap.set('y', at.y);
    textMap.set('width', TEXT_INITIAL_WIDTH);
    textMap.set('height', TEXT_INITIAL_HEIGHT);
    textMap.set('z', z);
    textMap.set('createdAt', Date.now());
    textMap.set('createdBy', createdBy);
    textMap.set('text', new Y.Text());
    textMap.set('size', DEFAULT_TEXT_SIZE);
    textMap.set('widthMode', 'auto');
    objects.set(id, textMap);
  }, LOCAL_ORIGIN);

  return id;
}

/** Return the Y.Text of a text object, or undefined when the object is gone. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!(obj instanceof Y.Map) || obj.get('type') !== 'text') return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** Change the size preset. False for unknown keys or a stale id. */
export function setTextSize(
  doc: Y.Doc,
  id: string,
  size: string,
): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!(obj instanceof Y.Map) || obj.get('type') !== 'text') return false;
  if (!(size in TEXT_SIZES)) return false;
  if (obj.get('size') === size) return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width, clamped to TEXT_MIN_WIDTH_WORLD.
 * Switches widthMode to 'fixed'. False for stale id or non-finite width.
 */
export function setTextWidthFixed(
  doc: Y.Doc,
  id: string,
  width: number,
): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!(obj instanceof Y.Map) || obj.get('type') !== 'text') return false;
  if (!Number.isFinite(width)) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    obj.set('width', clamped);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set the bounding box (width and height). False for stale id or non-finite.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!(obj instanceof Y.Map) || obj.get('type') !== 'text') return false;
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  const cw = obj.get('width');
  const ch = obj.get('height');
  if (cw === box.width && ch === box.height) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** True when the text object has zero characters. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  if (!text) return true;
  return text.length === 0;
}

/**
 * Delete the text object if it is empty (zero characters).
 * Returns true when the object was deleted, false otherwise.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!(obj instanceof Y.Map) || obj.get('type') !== 'text') return false;
  const text = obj.get('text');
  if (!(text instanceof Y.Text)) return false;
  if (text.length !== 0) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}