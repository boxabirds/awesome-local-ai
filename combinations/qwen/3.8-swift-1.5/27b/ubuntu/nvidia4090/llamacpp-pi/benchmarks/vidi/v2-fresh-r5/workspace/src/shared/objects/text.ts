/**
 * Text object model (story 9). Schema helpers for creating and modifying
 * text objects in the Y.Doc.
 */
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  deleteObjects,
  type ObjectSnapshot,
} from '../board-model';
import {
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  type TextSize,
} from '../config';
import type { Point } from '../geometry';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function isFiniteCoord(n: number): boolean {
  return Number.isFinite(n);
}

/**
 * Create a new text object with its top-left at the given world point.
 * Returns the new text's id, or null if coordinates are invalid.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!isFiniteCoord(at.x) || !isFiniteCoord(at.y)) return null;

  const id = crypto.randomUUID();
  const objects = getObjects(doc);

  // Compute maxZ
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const textMap = new Y.Map<unknown>();
  const ytext = new Y.Text();
  textMap.set('type', 'text');
  textMap.set('x', at.x);
  textMap.set('y', at.y);
  textMap.set('width', 0);
  textMap.set('height', 0);
  textMap.set('z', maxZ + 1);
  textMap.set('createdAt', Date.now());
  textMap.set('createdBy', createdBy);
  textMap.set('text', ytext);
  textMap.set('size', DEFAULT_TEXT_SIZE);
  textMap.set('widthMode', 'auto');

  doc.transact(() => {
    objects.set(id, textMap);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set the text size preset. Returns true if applied, false for unknown size keys.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!(size in TEXT_SIZES)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width (clamped to TEXT_MIN_WIDTH_WORLD minimum).
 * Returns true if applied, false for stale id or non-finite width.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteCoord(width)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    obj.set('width', clamped);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set the stored box dimensions. Returns true if applied.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFiniteCoord(box.width) || !isFiniteCoord(box.height)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Get the Y.Text for a text object, or undefined if the id is unknown.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  return obj.get('text') as Y.Text | undefined;
}

/**
 * Returns true if the text object contains zero characters.
 * Whitespace-only text is NOT considered empty.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  if (!ytext) return true;
  return ytext.length === 0;
}

/**
 * Delete the text object if it is empty (zero characters).
 * Returns true if the object was removed.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
