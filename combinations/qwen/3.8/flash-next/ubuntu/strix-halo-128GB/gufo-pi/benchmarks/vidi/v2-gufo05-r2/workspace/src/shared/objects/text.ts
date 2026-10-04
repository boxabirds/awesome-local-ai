/**
 * Story 9: the text object — the board's plain, background-free words.
 *
 * Schema (one entry of the `objects` map):
 *
 *   type: 'text', x, y, width, height, z, createdAt, createdBy,
 *   text: Y.Text,
 *   size: TextSize,                 // 'S' | 'M' | 'L' | 'XL'
 *   widthMode: 'auto' | 'fixed'     // auto = as wide as its longest line
 *
 * `width`/`height` are stored, not measured on every screen: selection bounds,
 * the marquee and a future export must be able to lay out an object they cannot
 * measure. The client that made a local change measures and writes the new box
 * (see `client/objects/useTextBoxSync`); remote clients render the stored box as
 * it arrives, so five people looking at one heading produce one set of numbers.
 *
 * Selection, moving, nudging, deleting and undo are story 7's and story 8's
 * generic group operations on these very fields — nothing in this file is about
 * them (PRD text.consistent).
 */

import * as Y from 'yjs';

import { LOCAL_ORIGIN, deleteObjects, objectSnapshot, objectSnapshots } from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import type { ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

/** True when this snapshot is a text object this client can draw. */
export function isTextSnapshot(obj: ObjectSnapshot): obj is TextSnapshot {
  return obj.type === 'text';
}

/** Is `value` one of the four size preset keys? */
function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.hasOwn(TEXT_SIZES, value);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** The entry for `id`, but only when it is a text object. */
function textEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = objectsMap(doc).get(id);
  if (!entry || entry.get('type') !== 'text') return undefined;
  return entry;
}

function finite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

/** Highest stacking number in use, so a new object lands on top. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const object of objectSnapshots(doc)) max = Math.max(max, object.z);
  return max;
}

/**
 * The box of a text object nothing has measured yet: one line of the default
 * size, as narrow as a text object may be. It exists so an object has bounds
 * from the moment it is created — the first measurement replaces it immediately.
 */
/** The box an empty object of `size` starts with: the minimum width, one line. */
function initialBox(size: TextSize = DEFAULT_TEXT_SIZE): { width: number; height: number } {
  return {
    width: TEXT_MIN_WIDTH_WORLD,
    height: Math.round(TEXT_SIZES[isTextSize(size) ? size : DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT),
  };
}

/**
 * Create a text object whose **top-left** is `at` — where the pointer clicked —
 * with size M, automatic width and no characters yet, above every other object.
 * Returns the new id, or null for a non-finite point (nothing written).
 */
export function createText(
  doc: Y.Doc,
  at: Point,
  createdBy: string,
  size: TextSize = DEFAULT_TEXT_SIZE,
): string | null {
  if (!finite(at.x, at.y)) return null;
  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  const box = initialBox(size);
  const now = Date.now();
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', 'text');
    entry.set('x', at.x);
    entry.set('y', at.y);
    entry.set('width', box.width);
    entry.set('height', box.height);
    entry.set('z', z);
    entry.set('createdAt', now);
    entry.set('createdBy', createdBy);
    entry.set('text', new Y.Text());
    entry.set('size', isTextSize(size) ? size : DEFAULT_TEXT_SIZE);
    entry.set('widthMode', 'auto');
    objectsMap(doc).set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a text object's size preset (PRD text.size). The position is untouched,
 * so the text grows from the same corner; the caller re-measures and writes the
 * box. An unknown key or a stale id is rejected without a transaction.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const entry = textEntry(doc, id);
  if (!entry) return false;
  if (entry.get('size') === size) return false; // already that size: nothing to write
  doc.transact(() => {
    entry.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Give a text object a fixed width and rewrap it at that width by setting
 * `widthMode` (PRD text.fixed_width). Widths below TEXT_MIN_WIDTH_WORLD are
 * clamped up to it; nothing is ever wider than MAX_OBJECT_SIZE_WORLD.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!finite(width)) return false;
  const entry = textEntry(doc, id);
  if (!entry) return false;
  const clamped = Math.round(Math.min(Math.max(width, TEXT_MIN_WIDTH_WORLD), MAX_OBJECT_SIZE_WORLD));
  const current = entry.get('width');
  if (entry.get('widthMode') === 'fixed' && current === clamped) return false;
  doc.transact(() => {
    entry.set('widthMode', 'fixed');
    entry.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the measured box of a text object (PRD text.height). Height always comes
 * from the content; this is how it gets stored. A box that is not finite, not
 * positive, or already stored writes nothing.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!finite(box.width, box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  const entry = textEntry(doc, id);
  if (!entry) return false;
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  if (entry.get('width') === width && entry.get('height') === height) return false;
  doc.transact(() => {
    entry.set('width', width);
    entry.set('height', height);
  }, LOCAL_ORIGIN);
  return true;
}

/** Every text object on the board, in the order they are drawn. */
export function textSnapshot(doc: Y.Doc): readonly TextSnapshot[] {
  return objectSnapshots(doc).filter(
    (object): object is TextSnapshot => object.type === 'text',
  );
}

/**
 * One text object's current fields, without walking the board: what a caller
 * needs in order to measure it and write the box back.
 */
export function getTextObject(doc: Y.Doc, id: string): TextSnapshot | undefined {
  const object = objectSnapshot(doc, id);
  return object && isTextSnapshot(object) ? object : undefined;
}

/** The shared text of a text object, or undefined for a stale / other type. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = textEntry(doc, id);
  if (!entry) return undefined;
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * True when a text object holds zero characters. Whitespace-only text is *not*
 * empty: a line of spaces is a choice somebody made, and the PRD's rule for
 * removing text is about the object that never got a character in it.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  return ytext !== undefined && ytext.length === 0;
}

/**
 * Remove a text object that holds nothing (PRD text.empty_removed), so an
 * abandoned heading never stays on the board as an invisible object. Calls
 * story 7's generic `deleteObjects`; called on edit end, in the capture window of
 * the last keystroke, so one undo brings the text back.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) === 1;
}
