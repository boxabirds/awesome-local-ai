import * as Y from 'yjs';
import {
  deleteObjects,
  LOCAL_ORIGIN,
  type ObjectSnapshot,
} from '../board-model';
import type { Point } from '../geometry';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';

export type { TextSize } from '../config';

/**
 * Free text object (story 9, text.model). Plain text with no background,
 * placed anywhere on the board. Schema:
 *
 *   objects/<id>: Y.Map {
 *     type: 'text', x, y, width, height, z, createdAt, createdBy,
 *     text: Y.Text,
 *     size: TextSize,
 *     widthMode: 'auto' | 'fixed'
 *   }
 *
 * `x`/`y` is the top-left corner; `width`/`height` are the measured box
 * (written by the client that made the local change — see useTextBoxSync).
 * Selection, move, delete and undo are the generic story 7/8 operations.
 */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  /** Text objects always have a measured box (unlike the base snapshot). */
  width: number;
  height: number;
  createdAt: number;
  createdBy: string;
}

type ObjectMap = Y.Map<unknown>;

function objects(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap('objects') as Y.Map<ObjectMap>;
}

function isText(obj: ObjectMap | undefined): obj is ObjectMap {
  return !!obj && obj.get('type') === 'text';
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Creates a size-M, auto-width text object whose **top-left** is `at` (world
 * units), on top of all other objects (z = maxZ + 1), with an empty Y.Text and
 * an initial estimated box (so bounds exist before the first measure). One
 * LOCAL_ORIGIN transaction. Returns the new id, or null for a non-finite point.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = crypto.randomUUID();
  const text = new Y.Text();
  const initialWidth = TEXT_MIN_WIDTH_WORLD;
  const initialHeight = TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT;
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', initialWidth);
    obj.set('height', initialHeight);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', text);
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Changes a text object's size preset. False for unknown keys / stale ids. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!(size in TEXT_SIZES)) return false;
  const obj = objects(doc).get(id);
  if (!isText(obj)) return false;
  doc.transact(() => {
    obj.set('size', size as TextSize);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets a fixed width (clamped to at least TEXT_MIN_WIDTH_WORLD) and switches
 * the object to fixed width mode. False for stale ids / non-finite widths.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const obj = objects(doc).get(id);
  if (!isText(obj)) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    obj.set('width', clamped);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/** Writes the measured box (width/height). False for stale ids / non-finite. */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  const obj = objects(doc).get(id);
  if (!isText(obj)) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** Returns the Y.Text of a text object, or undefined for stale/non-text ids. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  if (!isText(obj)) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text object contains zero characters (whitespace is NOT empty). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  if (!text) return false;
  return text.length === 0;
}

/**
 * Removes the text object if it is empty (zero characters). Returns true when
 * it was removed. Whitespace-only text is kept; stale ids are a no-op.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
