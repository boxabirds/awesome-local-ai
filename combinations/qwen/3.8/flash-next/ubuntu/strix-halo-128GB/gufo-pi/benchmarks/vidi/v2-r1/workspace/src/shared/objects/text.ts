/**
 * Text object model: schema helpers for creating and mutating text objects
 * stored in the Y.Doc objects map.
 *
 * Schema:
 * ```
 * objects/<id>: Y.Map {
 *   type: 'text', x, y, width, height, z, createdAt, createdBy,
 *   text: Y.Text,
 *   size: TextSize,
 *   widthMode: 'auto' | 'fixed'
 * }
 * ```
 */

import * as Y from 'yjs';

import {
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  type TextSize,
} from '../config';
import {
  LOCAL_ORIGIN,
  deleteObjects,
  type ObjectSnapshot,
  type Point,
} from '../board-model';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

const OBJECTS_MAP = 'objects';

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown> | undefined> {
  return doc.getMap(OBJECTS_MAP) as unknown as Y.Map<Y.Map<unknown> | undefined>;
}

function entryOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string') return undefined;
  const entry = objectsOf(doc).get(id);
  return entry instanceof Y.Map ? entry : undefined;
}

function isTextEntry(entry: Y.Map<unknown> | undefined): entry is Y.Map<unknown> {
  return entry !== undefined && entry.get('type') === 'text';
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Highest `z` currently in the document (over every object type). */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsOf(doc).values()) {
    const z = entry instanceof Y.Map ? entry.get('z') : undefined;
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

function isValidTextSize(size: unknown): size is TextSize {
  return typeof size === 'string' && Object.hasOwn(TEXT_SIZES, size);
}

/**
 * Create a text object with its top-left at `at`, size M, auto width mode,
 * empty Y.Text, z above all existing objects. Returns the new id, or null
 * for a non-finite point.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!at || !isFiniteNum(at.x) || !isFiniteNum(at.y)) return null;

  const id = crypto.randomUUID();
  const size = DEFAULT_TEXT_SIZE;
  // Provide an initial estimated box so bounds exist before first measure
  const initialWidth = TEXT_SIZES[size] * 4; // rough placeholder
  const initialHeight = TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

  doc.transact(() => {
    const objects = objectsOf(doc);
    const obj = new Y.Map<unknown>();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', initialWidth);
    obj.set('height', initialHeight);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', new Y.Text());
    obj.set('size', size);
    obj.set('widthMode', 'auto');
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a text object's size preset. Returns false for an unknown size key
 * or a stale id.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isValidTextSize(size)) return false;
  const entry = entryOf(doc, id);
  if (!isTextEntry(entry)) return false;
  if (entry.get('size') === size) return false;
  doc.transact(() => {
    entry.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width on a text object (clamped to TEXT_MIN_WIDTH_WORLD).
 * Returns false for stale id or non-finite width.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNum(width)) return false;
  const entry = entryOf(doc, id);
  if (!isTextEntry(entry)) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    entry.set('width', clamped);
    entry.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the measured width and height on a text object.
 * Returns false for stale id or non-finite dimensions.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFiniteNum(box.width) || !isFiniteNum(box.height)) return false;
  const entry = entryOf(doc, id);
  if (!isTextEntry(entry)) return false;
  if (entry.get('width') === box.width && entry.get('height') === box.height) return false;
  doc.transact(() => {
    entry.set('width', box.width);
    entry.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** Get the Y.Text of a text object, or undefined for a stale id. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = entryOf(doc, id);
  if (!isTextEntry(entry)) return undefined;
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text object contains zero characters. Returns false for stale ids. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const entry = entryOf(doc, id);
  if (!isTextEntry(entry)) return false;
  const text = entry.get('text');
  if (!(text instanceof Y.Text)) return true;
  return text.toString().length === 0;
}

/**
 * Delete the text object if it is empty (zero characters).
 * Returns true if it was deleted, false otherwise.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  const entry = entryOf(doc, id);
  if (!isTextEntry(entry)) return false;
  const text = entry.get('text');
  if (!(text instanceof Y.Text)) return false;
  if (text.toString().length !== 0) return false;
  deleteObjects(doc, [id]);
  return true;
}

/** Read a full TextSnapshot from a Y.Doc entry. */
export function readTextSnapshot(id: string, entry: Y.Map<unknown>): TextSnapshot | null {
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const width = entry.get('width');
  const height = entry.get('height');
  const text = entry.get('text');
  const size = entry.get('size');
  const widthMode = entry.get('widthMode');

  if (!isFiniteNum(x) || !isFiniteNum(y)) return null;

  return {
    id,
    type: 'text',
    x,
    y,
    z: isFiniteNum(z) ? z : 0,
    width: isFiniteNum(width) ? width : undefined,
    height: isFiniteNum(height) ? height : undefined,
    text: text instanceof Y.Text ? text.toString() : '',
    size: isValidTextSize(size) ? size : 'M',
    widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
  };
}
