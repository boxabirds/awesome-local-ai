/**
 * Text object model (story 9).
 *
 * Schema:
 *   objects/<id>: Y.Map {
 *     type: 'text', x, y, width, height, z, createdAt, createdBy,
 *     text: Y.Text,
 *     size: TextSize,
 *     widthMode: 'auto' | 'fixed'
 *   }
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
import { LOCAL_ORIGIN, deleteObjects, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.hasOwn(TEXT_SIZES, value);
}

/** Highest `z` in the document. */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const m of objects.values()) {
    const z = m.get('z');
    if (finite(z) && z > max) max = z;
  }
  return max;
}

/**
 * Create a text object with its top-left at `at`, size M, auto width.
 * Returns the new id, or null for a non-finite point.
 */
export function createText(
  doc: Y.Doc,
  at: Point,
  createdBy: string,
): string | null {
  if (!at || !finite(at.x) || !finite(at.y)) return null;

  let id: string | null = null;
  doc.transact(() => {
    const objects = objectsMap(doc);
    id = crypto.randomUUID();
    const obj = new Y.Map<unknown>();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    // Initial box: small placeholder so bounds exist before first measure.
    const fontSize = TEXT_SIZES[DEFAULT_TEXT_SIZE];
    obj.set('width', fontSize);
    obj.set('height', Math.round(fontSize * TEXT_LINE_HEIGHT));
    obj.set('z', maxZ(objects) + 1);
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
 * Change a text object's size preset.
 * Returns false for unknown size keys or stale ids.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const obj = objectsMap(doc).get(id);
  if (!obj) return false;
  if (obj.get('type') !== 'text') return false;
  if (obj.get('size') === size) return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width on a text object (clamped to TEXT_MIN_WIDTH_WORLD).
 * Returns false for stale ids or non-finite width.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!finite(width)) return false;
  const obj = objectsMap(doc).get(id);
  if (!obj) return false;
  if (obj.get('type') !== 'text') return false;
  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  doc.transact(() => {
    obj.set('widthMode', 'fixed');
    obj.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Switch a text object to auto width mode and recalculate the width
 * from the longest line using a greedy wrap. Returns false for stale ids.
 */
export function setAutoWidth(doc: Y.Doc, id: string): boolean {
  const obj = objectsMap(doc).get(id);
  if (!obj) return false;
  if (obj.get('type') !== 'text') return false;
  const text = obj.get('text');
  const size = obj.get('size') as TextSize;
  const fontPx = TEXT_SIZES[size] ?? 16;
  const content = text instanceof Y.Text ? text.toString() : '';

  // Greedy word-wrap: find the natural width.
  let longest = 0;
  let line = '';
  for (const word of content.split(/(\s+)/)) {
    if (word.length === 0) continue;
    const candidate = line + word;
    if (candidate.length > TEXT_MAX_AUTO_WIDTH_WORLD / fontPx && line.length > 0) {
      longest = Math.max(longest, line.trimEnd().length);
      line = word.trimStart();
    } else {
      line = candidate;
    }
  }
  longest = Math.max(longest, line.trimEnd().length);

  const width = Math.max(TEXT_MIN_WIDTH_WORLD, longest * fontPx * 0.6);
  const lines = countLines(content, size, 'auto', null);
  const height = Math.round(lines * fontPx * TEXT_LINE_HEIGHT);

  doc.transact(() => {
    obj.set('widthMode', 'auto');
    obj.set('width', width);
    obj.set('height', height);
  }, LOCAL_ORIGIN);
  return true;
}

/** Count how many visual lines the text occupies (approximate, for model-level use). */
function countLines(content: string, size: TextSize, mode: 'auto' | 'fixed', storedWidth: number | null): number {
  const fontPx = TEXT_SIZES[size] ?? 16;
  const cap = mode === 'auto'
    ? TEXT_MAX_AUTO_WIDTH_WORLD / fontPx
    : (storedWidth ?? TEXT_MIN_WIDTH_WORLD) / (fontPx * 0.6);
  if (cap <= 0) return 1;

  let lines = 0;
  for (const para of content.split('\n')) {
    if (para.length === 0) { lines++; continue; }
    let lineLen = 0;
    let paraLines = 1;
    for (const word of para.split(/(\s+)/)) {
      if (word.length === 0) continue;
      if (lineLen + word.length > cap && lineLen > 0) {
        paraLines++;
        lineLen = word.trimStart().length;
      } else {
        lineLen += word.length;
      }
    }
    lines += paraLines;
  }
  return lines;
}

/**
 * Set the measured width and height on a text object.
 * Returns false for stale ids or non-finite values.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!finite(box.width) || !finite(box.height)) return false;
  const obj = objectsMap(doc).get(id);
  if (!obj) return false;
  if (obj.get('type') !== 'text') return false;
  if (obj.get('width') === box.width && obj.get('height') === box.height) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** Get the Y.Text of a text object. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj) return undefined;
  if (obj.get('type') !== 'text') return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text object contains zero characters. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  if (!text) return true;
  return text.length === 0;
}

/**
 * Delete the text object if it is empty (zero characters).
 * Returns true if it was deleted, false otherwise.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) === 1;
}
