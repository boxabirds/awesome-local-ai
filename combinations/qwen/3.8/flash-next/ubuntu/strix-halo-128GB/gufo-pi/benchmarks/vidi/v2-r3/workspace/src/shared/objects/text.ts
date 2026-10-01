/**
 * Text object model (story 9).
 * Schema helpers: create, set size, set width mode, set box, empty check.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, getObjectsMap, deleteObjects } from '../board-model';
import type { Point } from '../geometry';
import type { TextSnapshot } from '../board-model';
import type { TextSize } from '../config';
import { DEFAULT_TEXT_SIZE, TEXT_SIZES, TEXT_MIN_WIDTH_WORLD, TEXT_LINE_HEIGHT } from '../config';

export type { TextSnapshot } from '../board-model';

export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;

  const objects = getObjectsMap(doc);
  const id = crypto.randomUUID();
  let z = 0;
  for (const m of objects.values()) {
    const zv = m.get('z');
    if (typeof zv === 'number' && zv > z) z = zv;
  }
  z += 1;

  const fontSize = TEXT_SIZES[DEFAULT_TEXT_SIZE];
  const initialWidth = 100; // estimate for empty text
  const initialHeight = Math.round(fontSize * TEXT_LINE_HEIGHT);

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'text');
    m.set('x', at.x);
    m.set('y', at.y);
    m.set('width', initialWidth);
    m.set('height', initialHeight);
    m.set('z', z);
    m.set('createdAt', Date.now());
    m.set('createdBy', createdBy);
    m.set('text', new Y.Text());
    m.set('size', DEFAULT_TEXT_SIZE);
    m.set('widthMode', 'auto');
    objects.set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (typeof id !== 'string' || id === '') return false;
  if (!(size in TEXT_SIZES)) return false;
  const objects = getObjectsMap(doc);
  const m = objects.get(id);
  if (!m || m.get('type') !== 'text') return false;
  if (m.get('size') === size) return false;

  doc.transact(() => {
    m.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (typeof id !== 'string' || id === '') return false;
  if (!Number.isFinite(width)) return false;
  const objects = getObjectsMap(doc);
  const m = objects.get(id);
  if (!m || m.get('type') !== 'text') return false;

  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    m.set('widthMode', 'fixed');
    m.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (typeof id !== 'string' || id === '') return false;
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  const objects = getObjectsMap(doc);
  const m = objects.get(id);
  if (!m || m.get('type') !== 'text') return false;

  const curW = m.get('width');
  const curH = m.get('height');
  if (curW === box.width && curH === box.height) return false;

  doc.transact(() => {
    m.set('width', box.width);
    m.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const objects = getObjectsMap(doc);
  const m = objects.get(id);
  if (!m || m.get('type') !== 'text') return undefined;
  const text = m.get('text');
  return text instanceof Y.Text ? text : undefined;
}

export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  if (!ytext) return true;
  return ytext.toString().length === 0;
}

export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  const objects = getObjectsMap(doc);
  const m = objects.get(id);
  if (!m || m.get('type') !== 'text') return false;
  const text = m.get('text');
  if (text instanceof Y.Text && text.toString().length === 0) {
    deleteObjects(doc, [id]);
    return true;
  }
  return false;
}
