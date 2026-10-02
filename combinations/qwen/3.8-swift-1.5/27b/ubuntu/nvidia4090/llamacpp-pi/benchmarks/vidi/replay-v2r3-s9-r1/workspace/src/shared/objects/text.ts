import * as Y from 'yjs';
import {
  TEXT_SIZES,
  TEXT_MIN_WIDTH_WORLD,
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  type TextSize,
} from '../config';
import { LOCAL_ORIGIN, objectMap, type ObjectSnapshot } from '../board-model';

/**
 * Text object schema helpers (story 9).
 *
 * A text object lives in the `objects` Y.Map with:
 *   type: 'text', x, y, width, height, z, createdAt, createdBy,
 *   text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
 */

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isTextSize(s: unknown): s is TextSize {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, s);
}

/** Estimated initial box for a new (empty) text object so bounds exist before first measure. */
function initialBox(size: TextSize): { width: number; height: number } {
  const fontPx = TEXT_SIZES[size];
  return {
    width: fontPx * 2,
    height: fontPx * TEXT_LINE_HEIGHT,
  };
}

/**
 * Create a text object whose top-left is at `at` (world units), with
 * `size: 'M'`, `widthMode: 'auto'`, empty Y.Text, and z above every other
 * object. Returns the new id, or `null` for non-finite coordinates.
 */
export function createText(doc: Y.Doc, at: { x: number; y: number }, createdBy: string): string | null {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;
  const id = crypto.randomUUID();
  const text = new Y.Text();
  const size = DEFAULT_TEXT_SIZE;
  const box = initialBox(size);
  doc.transact(() => {
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    let maxZ = 0;
    for (const m of objects.values()) {
      const z = m.get('z');
      if (isFiniteNumber(z) && z > maxZ) maxZ = z;
    }
    const m = new Y.Map<unknown>();
    m.set('type', 'text');
    m.set('x', at.x);
    m.set('y', at.y);
    m.set('width', box.width);
    m.set('height', box.height);
    m.set('z', maxZ + 1);
    m.set('createdAt', Date.now());
    m.set('createdBy', createdBy);
    m.set('text', text);
    m.set('size', size);
    m.set('widthMode', 'auto');
    objects.set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a text object's size preset. Returns `false` for an unknown size key
 * or stale id (no transaction).
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const m = objectMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    m.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a text object's width to a fixed value (clamped to TEXT_MIN_WIDTH_WORLD)
 * and switch widthMode to 'fixed'. Returns `false` for a stale id or
 * non-finite width (no transaction).
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const m = objectMap(doc, id);
  if (!m) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    m.set('widthMode', 'fixed');
    m.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a text object's stored box (width and height). Returns `false` for a
 * stale id or non-finite values (no transaction).
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  const m = objectMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    m.set('width', box.width);
    m.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Return the text object's Y.Text, or `undefined` for a stale id.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = objectMap(doc, id);
  if (!m) return undefined;
  const t = m.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/**
 * True when the text object has zero characters (whitespace-only is NOT empty).
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const t = getTextContent(doc, id);
  if (!t) return true; // stale id: treat as empty
  return t.length === 0;
}

/**
 * Delete the text object if it is empty (zero characters). Returns `true` if
 * deleted, `false` otherwise (stale id, non-empty, or already gone).
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  const m = objectMap(doc, id);
  if (!m) return false;
  const t = m.get('text');
  if (t instanceof Y.Text && t.length > 0) return false;
  const objects = doc.getMap('objects');
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}
