// Story 9: the `text` object type's model layer. Field access and every
// mutation of a free-text object, mirroring the sticky helpers in
// shared/board-model.ts. The box (width/height) is normally written by the
// client text-box sync (client/objects/useTextBoxSync.ts); setTextBox and
// setTextWidthFixed are the low-level entry points it and the resize gesture
// use.

import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../config';
import {
  LOCAL_ORIGIN,
  deleteObjects,
  isTextSize,
  type TextSnapshot,
} from '../board-model';

export type { TextSnapshot } from '../board-model';

function textMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!obj || obj.get('type') !== 'text') return undefined;
  return obj;
}

// Places the text's top-left at `at`. The box starts as an estimate (one
// default-size line); the client re-measures and corrects it on first edit.
// Returns the new id, or null for non-finite coordinates.
export function createText(
  doc: Y.Doc,
  at: { x: number; y: number },
  createdBy: string,
): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', TEXT_MIN_WIDTH_WORLD);
    obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    obj.set('text', new Y.Text(''));
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    obj.set('z', max + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const obj = textMap(doc, id);
  if (!obj) return false;
  if (obj.get('size') === size) return true;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

// Switches the box to fixed width, clamped to TEXT_MIN_WIDTH_WORLD. Height is
// left alone; the caller re-measures afterwards.
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const obj = textMap(doc, id);
  if (!obj) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    obj.set('width', clamped);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  const obj = textMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = textMap(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

// Only zero characters counts as empty: whitespace-only text is kept.
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  if (!text) return false;
  return text.toString().length === 0;
}

export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
