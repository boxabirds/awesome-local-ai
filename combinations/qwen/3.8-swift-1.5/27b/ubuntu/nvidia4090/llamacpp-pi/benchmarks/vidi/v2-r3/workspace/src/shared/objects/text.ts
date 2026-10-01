import * as Y from 'yjs';
import {
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_SIZE,
  isTextSize,
  type TextSize,
} from '../config';
import {
  deleteObjects,
  LOCAL_ORIGIN,
  type ObjectSnapshot,
} from '../board-model';

const OBJECT_TYPE_TEXT = 'text';

/** Render-ready snapshot of a text object (story 9, text.model). */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function objectMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objectsMap(doc).get(id);
}

/** Highest z among all objects, or 0 when the board is empty. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsMap(doc).values()) {
    const z = m.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

/**
 * Create a text object whose TOP-LEFT is `at` (world units), size M,
 * widthMode auto, with an empty Y.Text, stacked on top (z = maxZ + 1), in one
 * LOCAL_ORIGIN transaction. Returns the new id, or `null` for non-finite
 * coordinates (no transaction).
 *
 * The initial box is a small estimate (min width × one line at M) so the
 * object has bounds before the editor's first measure (Key decision 1).
 */
export function createText(doc: Y.Doc, at: { x: number; y: number }, createdBy: string): string | null {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;
  const id = crypto.randomUUID();
  const text = new Y.Text();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', OBJECT_TYPE_TEXT);
    m.set('x', at.x);
    m.set('y', at.y);
    m.set('width', TEXT_MIN_WIDTH_WORLD);
    m.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    m.set('createdBy', createdBy);
    m.set('text', text);
    m.set('size', DEFAULT_TEXT_SIZE);
    m.set('widthMode', 'auto');
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a text object's size preset. Returns `false` for an unknown size key
 * or a stale id (no transaction). The top-left position is untouched.
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
 * Set a FIXED width on a text object (side-handle drag, text.fixed_width).
 * Clamped to at least TEXT_MIN_WIDTH_WORLD; widthMode becomes 'fixed'.
 * Returns `false` for a stale id or non-finite width (no transaction).
 * The height is NOT set here — the box sync remeasures it from the content.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const m = objectMap(doc, id);
  if (!m) return false;
  const w = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    m.set('width', w);
    m.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the measured box (width + height) of a text object. Returns `false`
 * for a stale id or non-finite dimensions (no transaction).
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

/** Return the text object's Y.Text, or `undefined` for a stale id. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = objectMap(doc, id);
  if (!m) return undefined;
  const t = m.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/**
 * True when the text object contains ZERO characters (text.empty_removed).
 * Whitespace-only text is NOT empty. Stale id → false.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const t = getTextContent(doc, id);
  if (!t) return false;
  return t.length === 0;
}

/**
 * Delete the text object if it is empty (end of an edit that produced no
 * characters — it must never become an invisible object). Returns `true` when
 * it was removed, `false` when it was kept (or the id is stale).
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

/**
 * Read the stored size preset of a text object (for the toolbar), validated.
 * Stale id / unknown value → undefined.
 */
export function getTextSize(doc: Y.Doc, id: string): TextSize | undefined {
  const m = objectMap(doc, id);
  if (!m) return undefined;
  const s = m.get('size');
  return isTextSize(s) ? s : undefined;
}
