// Free text objects (story 9, text.create / text.sizes / text.fixed_width /
// text.remove_empty). Document schema per spec/stories/009 design.md:
//
//   objects.<id> : {
//     type:      'text'
//     x, y, z:   number
//     text:      Y.Text
//     size:      'S' | 'M' | 'L' | 'XL'
//     widthMode: 'auto' | 'fixed'
//     width:     number   // estimated before the first measurement
//     height:    number
//     createdAt: number
//     createdBy: string
//   }

import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_INITIAL_HEIGHT_WORLD,
  TEXT_INITIAL_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import { deleteObjects, nextZAboveAll, objects, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

/** Snapshot of a text object (ObjectSnapshot plus the text-specific fields). */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  /** Font size preset. */
  size: TextSize;
  /** 'auto': width follows the content; 'fixed': width follows the handle. */
  widthMode: 'auto' | 'fixed';
}

const WIDTH_MODES = new Set<string>(['auto', 'fixed']);

/** True when `v` is one of the four size presets. */
export function isTextSize(v: unknown): v is TextSize {
  return typeof v === 'string' && v in TEXT_SIZES;
}

export function isWidthMode(v: unknown): v is 'auto' | 'fixed' {
  return typeof v === 'string' && WIDTH_MODES.has(v);
}

/** Random object id (uuid when available, with a fallback for tests). */
function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The object map of `id` when it is a well-formed text object. */
function textObject(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const obj = objects(doc).get(id);
  if (!obj || obj.get('type') !== 'text') return null;
  return obj;
}

/**
 * Create a free text object with its top-left corner at `at`.
 * Returns the new id, or null (no transaction) when `at` is not finite.
 * The initial width/height is an estimate so the object has bounds before
 * its first measurement (text.layout); typing re-measures and corrects it.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;

  const id = randomId();
  const text = new Y.Text();
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('z', nextZAboveAll(doc));
    obj.set('text', text);
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    obj.set('width', TEXT_INITIAL_WIDTH_WORLD);
    obj.set('height', TEXT_INITIAL_HEIGHT_WORLD);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change the size preset (S/M/L/XL). Returns false (no update) for an
 * unknown key or a missing object. Position and stored box are untouched;
 * the local text-box sync re-measures after the change.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const obj = textObject(doc, id);
  if (!obj || !isTextSize(size) || obj.get('size') === size) return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width (text.fixed_width): widthMode becomes 'fixed' and the
 * width is clamped to [TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD]. Returns
 * false (no update) for non-finite widths or a missing object.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const obj = textObject(doc, id);
  if (!obj || !Number.isFinite(width)) return false;
  const clamped = Math.min(Math.max(width, TEXT_MIN_WIDTH_WORLD), MAX_OBJECT_SIZE_WORLD);
  if (obj.get('width') === clamped && obj.get('widthMode') === 'fixed') return false;
  doc.transact(() => {
    obj.set('width', clamped);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the measured box (text.layout). Returns false (no transaction) when
 * the object is missing, the box is not finite, or the box is unchanged.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  const obj = textObject(doc, id);
  if (!obj) return false;
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  if (obj.get('width') === box.width && obj.get('height') === box.height) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The object's Y.Text, or undefined when the object is missing. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  const t = obj?.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/** True when the text has zero characters. Whitespace-only text is NOT empty. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const t = getTextContent(doc, id);
  return t !== undefined && t.length === 0;
}

/**
 * Delete the object when it is empty (text.remove_empty: finishing editing
 * with an empty text removes it). Returns true when it was deleted.
 * Whitespace-only text is kept.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!textObject(doc, id)) return false;
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
