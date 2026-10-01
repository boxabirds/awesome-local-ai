// src/shared/objects/text.ts
// Text object schema helpers: create, set size, set width mode, set box, empty check.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import {
  TEXT_SIZES,
  TEXT_MIN_WIDTH_WORLD,
  DEFAULT_TEXT_SIZE,
  type TextSize,
} from '../config';
import type { ObjectSnapshot } from '../board-model';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  width: number;
  height: number;
  createdAt: number;
  createdBy: string;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });
  return maxZ;
}

function isFiniteCoord(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function isValidSize(size: string): size is TextSize {
  return size in TEXT_SIZES;
}

/**
 * Creates a text object at the given world point.
 * Returns the new id, or null if the point is non-finite.
 */
export function createText(doc: Y.Doc, at: { x: number; y: number }, createdBy: string): string | null {
  if (!isFiniteCoord(at.x, at.y)) return null;

  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;
  const text = new Y.Text();

  // Initial box estimate: minimum size so bounds exist before first measure
  const initialWidth = TEXT_MIN_WIDTH_WORLD;
  const initialHeight = TEXT_SIZES[DEFAULT_TEXT_SIZE] * 1.3;

  doc.transact(() => {
    const objects = getObjects(doc);
    const obj = new Y.Map<unknown>();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', initialWidth);
    obj.set('height', initialHeight);
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', text);
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Sets the text size preset. Returns false for unknown size keys.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isValidSize(size)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;

  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets a fixed width on the text object, clamped to TEXT_MIN_WIDTH_WORLD.
 * Returns false for stale ids or non-finite widths.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return false;

  doc.transact(() => {
    obj.set('width', clamped);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets the stored width/height box on the text object.
 * Returns false for stale ids or non-finite values.
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
 * Returns the Y.Text content of a text object, or undefined if not found.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return undefined;
  return obj.get('text') as Y.Text | undefined;
}

/**
 * Returns true if the text object contains zero characters.
 * Whitespace-only text is NOT considered empty.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  if (!ytext) return false;
  return ytext.length === 0;
}

/**
 * Deletes the text object if it is empty (zero characters).
 * Returns true if the object was deleted, false otherwise.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  const objects = getObjects(doc);
  if (!objects.has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}
