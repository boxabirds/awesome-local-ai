import * as Y from 'yjs';
import {
  TEXT_SIZES,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TextSize,
} from '../config';
import { LOCAL_ORIGIN, deleteObjects } from '../board-model';

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

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getTextMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsMap(doc).get(id);
  if (!m || !(m instanceof Y.Map) || m.get('type') !== 'text') return undefined;
  return m;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((m) => {
    if (m instanceof Y.Map) {
      const z = m.get('z');
      if (isFiniteNumber(z) && z > max) max = z;
    }
  });
  return max;
}

/**
 * Creates a text object at the given world point (top-left).
 * Returns the new id, or null if the point is invalid.
 */
export function createText(
  doc: Y.Doc,
  at: { x: number; y: number },
  createdBy: string,
): string | null {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;
  const id = crypto.randomUUID();
  const size = DEFAULT_TEXT_SIZE;
  const fontPx = TEXT_SIZES[size];
  // Initial estimate for empty text: minimal width, one line height
  const initialWidth = TEXT_MIN_WIDTH_WORLD;
  const initialHeight = Math.ceil(fontPx * TEXT_LINE_HEIGHT);
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'text');
    m.set('x', at.x);
    m.set('y', at.y);
    m.set('width', initialWidth);
    m.set('height', initialHeight);
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    m.set('createdBy', createdBy);
    m.set('text', new Y.Text());
    m.set('size', size);
    m.set('widthMode', 'auto');
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/** Set the text size preset. Returns false for unknown size keys or stale ids. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const m = getTextMap(doc, id);
  if (!m) return false;
  if (!isTextSize(size)) return false;
  if (m.get('size') === size) return false;
  doc.transact(() => {
    m.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/** Set a fixed width (clamped to TEXT_MIN_WIDTH_WORLD). Sets widthMode to 'fixed'. */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const m = getTextMap(doc, id);
  if (!m) return false;
  if (!isFiniteNumber(width)) return false;
  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  doc.transact(() => {
    m.set('widthMode', 'fixed');
    m.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/** Set the stored width and height. */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  const m = getTextMap(doc, id);
  if (!m) return false;
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  const curW = m.get('width');
  const curH = m.get('height');
  if (curW === box.width && curH === box.height) return false;
  doc.transact(() => {
    m.set('width', box.width);
    m.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** Returns the Y.Text for a text object, or undefined if not found. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getTextMap(doc, id);
  if (!m) return undefined;
  const t = m.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/** True if the text object has zero characters. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const yt = getTextContent(doc, id);
  if (!yt) return false; // stale id treated as not empty (already gone)
  return yt.length === 0;
}

/** Delete the text object if it has zero characters. Returns true if deleted. */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!getTextMap(doc, id)) return false;
  if (!isEmptyText(doc, id)) return false;
  deleteObjects(doc, [id]);
  return true;
}

/** Snapshot all text objects (sorted by z, id). */
export function snapshotText(doc: Y.Doc): readonly TextSnapshot[] {
  const result: TextSnapshot[] = [];
  objectsMap(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map) || m.get('type') !== 'text') return;
    const x = m.get('x');
    const y = m.get('y');
    const width = m.get('width');
    const height = m.get('height');
    const z = m.get('z');
    const createdAt = m.get('createdAt');
    const createdBy = m.get('createdBy');
    const text = m.get('text');
    const size = m.get('size');
    const widthMode = m.get('widthMode');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return;
    result.push({
      id,
      type: 'text',
      x,
      y,
      width: isFiniteNumber(width) ? width : TEXT_MIN_WIDTH_WORLD,
      height: isFiniteNumber(height) ? height : 0,
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      createdBy: typeof createdBy === 'string' ? createdBy : '',
      text: text instanceof Y.Text ? text.toString() : '',
      size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
      widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
    });
  });
  result.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
