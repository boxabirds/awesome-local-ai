import * as Y from 'yjs';
import { deleteObjects, LOCAL_ORIGIN, type TextSnapshot } from '../board-model';
import {
  DEFAULT_TEXT_SIZE, TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD, TEXT_PADDING_WORLD, TEXT_SIZES, type TextSize,
} from '../config';
import type { Point } from '../geometry';

export type { TextSnapshot };

function objectsOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('objects') as Y.Map<unknown>;
}

function textObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsOf(doc).get(id);
  return m instanceof Y.Map && m.get('type') === 'text' ? m : undefined;
}

export const isTextSize = (s: string): s is TextSize => Object.prototype.hasOwnProperty.call(TEXT_SIZES, s);

/** Creates empty text of the default size with its top-left at `at`; null (no change) for non-finite points. */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = crypto.randomUUID();
  let z = 0;
  objectsOf(doc).forEach((o) => {
    const v = o instanceof Y.Map ? o.get('z') : 0;
    if (typeof v === 'number' && Number.isFinite(v)) z = Math.max(z, v);
  });
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    objectsOf(doc).set(id, m);
    m.set('type', 'text');
    m.set('x', at.x);
    m.set('y', at.y);
    // An estimate so bounds exist before the first measurement.
    m.set('width', TEXT_PADDING_WORLD);
    m.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    m.set('z', z + 1);
    m.set('createdAt', Date.now());
    m.set('createdBy', createdBy);
    m.set('text', new Y.Text());
    m.set('size', DEFAULT_TEXT_SIZE);
    m.set('widthMode', 'auto');
  }, LOCAL_ORIGIN);
  return id;
}

/** False (no change) for a stale id or an unknown size key. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const m = textObject(doc, id);
  if (!m || !isTextSize(size)) return false;
  if (m.get('size') === size) return false;
  doc.transact(() => m.set('size', size), LOCAL_ORIGIN);
  return true;
}

/** Switches to a fixed width, never below TEXT_MIN_WIDTH_WORLD. */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const m = textObject(doc, id);
  if (!m || !Number.isFinite(width)) return false;
  const w = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  if (m.get('widthMode') === 'fixed' && m.get('width') === w) return false;
  doc.transact(() => {
    m.set('widthMode', 'fixed');
    m.set('width', w);
  }, LOCAL_ORIGIN);
  return true;
}

/** Stores the measured box; false (no write) when stale, non-finite or unchanged. */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  const m = textObject(doc, id);
  if (!m || !Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) return false;
  if (m.get('width') === box.width && m.get('height') === box.height) return false;
  doc.transact(() => {
    m.set('width', box.width);
    m.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The text's content, size and width mode, read directly (no whole-board snapshot). */
export function readText(doc: Y.Doc, id: string):
  { text: string; size: TextSize; widthMode: 'auto' | 'fixed'; width: number } | undefined {
  const m = textObject(doc, id);
  if (!m) return undefined;
  const t = m.get('text');
  const size = m.get('size');
  const width = m.get('width');
  return {
    text: t instanceof Y.Text ? t.toString() : '',
    size: typeof size === 'string' && isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: m.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
    width: typeof width === 'number' && Number.isFinite(width) ? width : TEXT_PADDING_WORLD,
  };
}

export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const t = textObject(doc, id)?.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/** Only zero characters count as empty; whitespace is content. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const t = getTextContent(doc, id);
  return t !== undefined && t.length === 0;
}

export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  return isEmptyText(doc, id) && deleteObjects(doc, [id]) > 0;
}
