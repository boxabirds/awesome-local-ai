import * as Y from 'yjs';
import {
  TEXT_MAX_CHARS,
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
} from '@/shared/config';
import { LOCAL_ORIGIN } from '@/shared/board-model';
import type { TextSize } from '@/shared/config';

// ---- Types ----

export interface TextSnapshot {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  [key: string]: unknown;
}

/** A known TextSize key. */
export type KnownTextSize = keyof typeof TEXT_SIZES;

// ---- Helpers ----

function getObjectsMap(doc: Y.Doc): any {
  return doc.getMap('objects');
}

function getField(inner: any, key: string): any {
  try {
    return inner.get(key);
  } catch {
    return undefined;
  }
}

function setField(inner: any, key: string, val: any): void {
  inner.set(key, val);
}

function getMaxZ(objects: any): number {
  let max = 0;
  (objects as any).forEach((inner: any) => {
    if (typeof inner?.get === 'function') {
      const z = Number(getField(inner, 'z'));
      if (z > max) max = z;
    }
  });
  return max;
}

// ---- Public API ----

/**
 * Create a new text object at the given world point.
 * Returns the new id, or null if the point is not finite.
 */
export function createText(
  doc: Y.Doc,
  at: { x: number; y: number },
  createdBy: string,
): string | null {
  if (!isFinite(at.x) || !isFinite(at.y)) {
    return null;
  }

  const objects = getObjectsMap(doc);
  const maxZ = getMaxZ(objects);
  const id = crypto.randomUUID();
  const inner = new Y.Map() as Y.Map<unknown>;

  doc.transact(() => {
    setField(inner, 'type', 'text');
    setField(inner, 'x', at.x);
    setField(inner, 'y', at.y);
    setField(inner, 'size', DEFAULT_TEXT_SIZE);
    setField(inner, 'widthMode', 'auto');
    // Set initial box so bounds exist before first measure
    setField(inner, 'width', 100);
    setField(inner, 'height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * 1.3);
    setField(inner, 'text', new Y.Text());
    setField(inner, 'z', maxZ + 1);
    setField(inner, 'createdAt', Date.now());
    setField(inner, 'createdBy', createdBy);
    (objects as any).set(id, inner);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Change the text size preset. Returns true if applied, false for unknown keys or stale id.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!(size in TEXT_SIZES)) return false;

  const objects = getObjectsMap(doc) as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return false;

  const sizeKey = size as KnownTextSize;

  doc.transact(() => {
    setField(inner, 'size', sizeKey);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set fixed width mode with the given width clamped to TEXT_MIN_WIDTH_WORLD.
 * Returns true if applied, false for stale id.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFinite(width)) return false;

  const objects = getObjectsMap(doc) as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return false;

  const clampedWidth = Math.max(width, TEXT_MIN_WIDTH_WORLD);

  doc.transact(() => {
    setField(inner, 'widthMode', 'fixed');
    setField(inner, 'width', clampedWidth);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set the stored width/height box. Returns true if the object exists, false otherwise.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFinite(box.width) || !isFinite(box.height)) return false;

  const objects = getObjectsMap(doc) as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return false;

  doc.transact(() => {
    setField(inner, 'width', box.width);
    setField(inner, 'height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Get the Y.Text content for this text object, or undefined if stale.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjectsMap(doc) as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return undefined;
  const textVal = getField(inner, 'text');
  if (textVal instanceof Y.Text) return textVal;
  return undefined;
}

/**
 * Check if the text object has zero characters (empty).
 * Whitespace-only text returns false.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const textVal = getTextContent(doc, id);
  if (!textVal) return false;
  return textVal.toString().length === 0;
}

/**
 * If the text object is empty, delete it via the generic deleteObjects.
 * Returns true if deleted, false if not empty or stale.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;

  // Use generic deleteObjects from board-model (we import inline to avoid circular deps here)
  const objects = getObjectsMap(doc) as Y.Map<any>;
  if (!objects.has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}
