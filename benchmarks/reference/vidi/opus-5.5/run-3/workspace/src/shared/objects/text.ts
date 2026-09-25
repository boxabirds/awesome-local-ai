// Text objects (story 9): plain text with no background, a size preset and an automatic or fixed width.
//
// objects/<id>: Y.Map { type: 'text', x, y, width, height, z, createdAt, createdBy, text: Y.Text, size: TextSize,
//                       widthMode: 'auto' | 'fixed' }
//
// `width`/`height` are the stored box. Only the client that made a local change (typing, size change, width drag)
// measures and writes them, so selection, marquee and remote clients never need to measure. Selection, moving,
// deleting and undo are the generic story 7/8 operations; nothing here is specific to them.
//
// As in board-model, every successful mutation is one LOCAL_ORIGIN transaction; rejected or no-op calls (stale id,
// wrong type, unknown size, non-finite numbers, no change) return false/null without opening a transaction.
import * as Y from 'yjs';
import {
  deleteObjects,
  LOCAL_ORIGIN,
  maxZ,
  registerSnapshotReader,
  type ObjectSnapshot,
} from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import type { Point } from '../geometry';

export type TextWidthMode = 'auto' | 'fixed';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: TextWidthMode;
}

export function isTextSize(s: unknown): s is TextSize {
  return typeof s === 'string' && Object.hasOwn(TEXT_SIZES, s);
}

export function isText(obj: ObjectSnapshot): obj is TextSnapshot {
  return obj.type === 'text';
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function getTextMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map && obj.get('type') === 'text' ? obj : undefined;
}

function sizeOfMap(obj: Y.Map<unknown>): TextSize {
  const size = obj.get('size');
  return isTextSize(size) ? size : DEFAULT_TEXT_SIZE;
}

function widthModeOf(obj: Y.Map<unknown>): TextWidthMode {
  return obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
}

registerSnapshotReader('text', (_id, obj, base) => {
  const text = obj.get('text');
  return {
    ...base,
    type: 'text',
    text: text instanceof Y.Text ? text.toString() : '',
    size: sizeOfMap(obj),
    widthMode: widthModeOf(obj),
  } satisfies TextSnapshot;
});

/**
 * Adds an empty, size DEFAULT_TEXT_SIZE, auto-width text object with its top-left at `at`, above all other objects.
 * Its box starts as one empty line until the editing client measures it. Returns the new id, or null (and changes
 * nothing) when `at` is not finite.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', TEXT_PADDING_WORLD);
    obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    objectsOf(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Changes the size preset (the top-left stays put; the caller re-measures the box). False for unknown sizes. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const obj = getTextMap(doc, id);
  if (!obj || obj.get('size') === size) return false;
  doc.transact(() => obj.set('size', size), LOCAL_ORIGIN);
  return true;
}

/** Gives the text a fixed width, clamped to [TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD]. */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const obj = getTextMap(doc, id);
  if (!obj) return false;
  const w = Math.min(MAX_OBJECT_SIZE_WORLD, Math.max(TEXT_MIN_WIDTH_WORLD, width));
  if (obj.get('widthMode') === 'fixed' && obj.get('width') === w) return false;
  doc.transact(() => {
    obj.set('widthMode', 'fixed');
    if (obj.get('width') !== w) obj.set('width', w);
  }, LOCAL_ORIGIN);
  return true;
}

/** Stores the measured box. False (no write) when it is unchanged or not a positive finite size. */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  const { width, height } = box;
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) return false;
  const obj = getTextMap(doc, id);
  if (!obj || (obj.get('width') === width && obj.get('height') === height)) return false;
  doc.transact(() => {
    if (obj.get('width') !== width) obj.set('width', width);
    if (obj.get('height') !== height) obj.set('height', height);
  }, LOCAL_ORIGIN);
  return true;
}

export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = getTextMap(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** The current state of one text object, or undefined when it is gone or not text. */
export function readText(doc: Y.Doc, id: string): TextSnapshot | undefined {
  const obj = getTextMap(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  const num = (k: string) => {
    const v = obj.get(k);
    return isFiniteNumber(v) ? v : 0;
  };
  return {
    id,
    type: 'text',
    x: num('x'),
    y: num('y'),
    width: num('width'),
    height: num('height'),
    z: num('z'),
    text: text instanceof Y.Text ? text.toString() : '',
    size: sizeOfMap(obj),
    widthMode: widthModeOf(obj),
  };
}

/** True when the text object has zero characters (whitespace counts as content). False for stale ids. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/** Removes the text object if it has no characters (text.empty_removed). */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
