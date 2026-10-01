// The text object model (story 9): schema helpers over a Y.Doc.
//
// The rules this module holds, and nothing else:
//   createText        a new text, at the point clicked, above every object
//   setTextSize       one of the four named presets, and only that changes
//   setTextWidthFixed the width a side handle dragged, which fixes the width
//   setTextBox        the measured box, which the layout owns
//   getTextContent    the object's own Y.Text, for the editor to write into
//   isEmptyText       zero characters; whitespace is content
//   deleteIfEmpty     the removal an edit end asks for, when the text is empty
//
// No React, no canvas, no measurement: the box a layout measured arrives here
// already computed, by number. A text object's height is never decided here -
// only stored.
//
// Like board-model, every reader is defensive: an entry that is not a readable
// text object (missing fields, damaged values, another type) is not rendered
// rather than throwing, because a Y.Doc is shared and may hold anything.

import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TYPE_TEXT,
  type TextSize,
} from '../config';
import {
  LOCAL_ORIGIN,
  deleteObjects,
  newObjectId,
  type ObjectSnapshot,
} from '../board-model';
import type { Point } from '../geometry';

/** How a text's box width is arrived at. */
export type TextWidthMode = 'auto' | 'fixed';

/** A readable text object, ready to render. */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  /** The object's own Y.Text as a string; editing goes through getTextContent(). */
  text: string;
  /** The size preset, which is the font size. */
  size: TextSize;
  /** 'auto': the width follows the text. 'fixed': a side handle set it. */
  widthMode: TextWidthMode;
  createdAt: number;
  /** The id of the client that created the text, or null when it stores none. */
  createdBy: string | null;
  /**
   * A text always has both numbers: the layout stores a box, and an object missing
   * one is not readable rather than drawn without it. The base type leaves them
   * optional for types that may be drawn from a point alone; a text narrows them.
   */
  width: number;
  height: number;
}

const WIDTH_MODES: readonly TextWidthMode[] = ['auto', 'fixed'];

/** One line of a text: the font size times the line-height ratio. */
export function textLineHeight(size: TextSize): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}

/** The size preset a name names, or null when it names no preset. */
export function asTextSize(value: unknown): TextSize | null {
  return typeof value === 'string' && Object.hasOwn(TEXT_SIZES, value)
    ? (value as TextSize)
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asWidthMode(value: unknown): TextWidthMode | null {
  return WIDTH_MODES.includes(value as TextWidthMode) ? (value as TextWidthMode) : null;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** The raw entry of a text object, or null when it is absent or damaged. */
function textEntry(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const value = objectsOf(doc).get(id);
  if (!(value instanceof Y.Map) || value.get('type') !== TYPE_TEXT) return null;
  return value;
}

/**
 * Read one object entry as a text snapshot. Returns null when the entry is not
 * a readable text object: of another type, damaged, or holding a size preset
 * this build does not know.
 */
export function readText(id: string, object: Y.Map<unknown>): TextSnapshot | null {
  if (object.get('type') !== TYPE_TEXT) return null;
  const x = object.get('x');
  const y = object.get('y');
  const width = object.get('width');
  const height = object.get('height');
  const z = object.get('z');
  const createdAt = object.get('createdAt');
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || !finite(z) || !finite(createdAt)) {
    return null;
  }
  const size = asTextSize(object.get('size'));
  if (size === null) return null;
  const widthMode = asWidthMode(object.get('widthMode'));
  if (widthMode === null) return null;
  const text = object.get('text');
  if (!(text instanceof Y.Text)) return null;
  const createdBy = object.get('createdBy');
  return {
    id,
    type: TYPE_TEXT,
    x,
    y,
    width,
    height,
    z,
    createdAt,
    createdBy: typeof createdBy === 'string' ? createdBy : null,
    text: text.toString(),
    size,
    widthMode,
  };
}

function byCreation(a: { createdAt: number }, b: { createdAt: number }): number {
  return a.createdAt - b.createdAt;
}

/** Every readable text object on the board, oldest first. */
export function textSnapshots(doc: Y.Doc): readonly TextSnapshot[] {
  const out: TextSnapshot[] = [];
  for (const [id, object] of objectsOf(doc)) {
    const snap = readText(id, object);
    if (snap !== null) out.push(snap);
  }
  return out.sort(byCreation);
}

/** One text object by id, or null when it is absent or not readable. */
export function textSnapshot(doc: Y.Doc, id: string): TextSnapshot | null {
  const object = objectsOf(doc).get(id);
  if (!(object instanceof Y.Map)) return null;
  return readText(id, object);
}

/** The z above every object on the board, of any type. */
function topZ(doc: Y.Doc): number {
  let top = 0;
  for (const object of objectsOf(doc).values()) {
    const z = object.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > top) top = z;
  }
  return top + 1;
}

/**
 * Create an empty text at the point clicked, and return its id, or null when
 * the point cannot name a place. `createdBy` is the local person's id; story 6
 * owns it, and this build has no accounts so the caller passes its own id.
 *
 * The box is an estimate - one line of the default size at the narrowest width
 * the layout may return - so the object has bounds before a measurement has
 * been possible, and the layout overwrites both numbers as soon as it can.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = newObjectId();
  const size = DEFAULT_TEXT_SIZE;
  doc.transact(() => {
    const object = new Y.Map<unknown>();
    object.set('type', TYPE_TEXT);
    object.set('x', at.x);
    object.set('y', at.y);
    object.set('width', TEXT_MIN_WIDTH_WORLD);
    object.set('height', textLineHeight(size));
    object.set('z', topZ(doc));
    object.set('createdAt', Date.now());
    object.set('createdBy', createdBy);
    object.set('size', size);
    object.set('widthMode', 'auto');
    object.set('text', new Y.Text());
    objectsOf(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The text to edit. Every text object has its own Y.Text, which is what lets
 * two people typing in two objects - or in one object - merge.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const value = textEntry(doc, id)?.get('text');
  return value instanceof Y.Text ? value : undefined;
}

/** True when the text holds no character at all. A space is content. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.toString().length === 0;
}

/**
 * Change the size preset, and only the size preset: position, width mode, the
 * width and the text are left exactly as they are. False (and no update to the
 * document) for a stale id, a size that names no preset, or the size it has.
 * The box is the layout's to follow up on, which is why a size change and its
 * re-measure happen in one undo step.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const named = asTextSize(size);
  if (named === null) return false;
  const object = textEntry(doc, id);
  if (object === null || object.get('size') === named) return false;
  let written = false;
  doc.transact(() => {
    if (textEntry(doc, id) === null) return;
    object.set('size', named);
    written = true;
  }, LOCAL_ORIGIN);
  return written;
}

/**
 * Take the width a side handle dragged: the width becomes this number and the
 * width mode becomes 'fixed', nothing else changes. The width is clamped into
 * [TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD]; the height is left alone, as
 * always the layout's to write. False for a stale id or a width that is not a
 * number.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!finite(width)) return false;
  const object = textEntry(doc, id);
  if (object === null) return false;
  const clamped = Math.min(Math.max(width, TEXT_MIN_WIDTH_WORLD), MAX_OBJECT_SIZE_WORLD);
  const current = object.get('width');
  const currentMode = object.get('widthMode');
  let written = false;
  doc.transact(() => {
    if (textEntry(doc, id) === null) return;
    if (current === clamped && currentMode === 'fixed') return;
    object.set('width', clamped);
    object.set('widthMode', 'fixed');
    written = true;
  }, LOCAL_ORIGIN);
  return written;
}

/**
 * Give the width back to the text: the mode becomes 'auto' and the width keeps
 * the number it has until the layout writes the measured one. False for a
 * stale id, or when the mode is already 'auto'.
 */
export function setTextWidthAuto(doc: Y.Doc, id: string): boolean {
  const object = textEntry(doc, id);
  if (object === null || object.get('widthMode') === 'auto') return false;
  let written = false;
  doc.transact(() => {
    if (textEntry(doc, id) === null) return;
    object.set('widthMode', 'auto');
    written = true;
  }, LOCAL_ORIGIN);
  return written;
}

/**
 * Write the box a layout measured. The height is always the content's, and the
 * width only ever equals what a side handle asked for or a measurement found -
 * this function is the one writer of both numbers. False (and no update) for a
 * stale id, a box that is not a usable size, or the box the object already has:
 * a re-measure that comes to the same box must not be a change on the wire.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!finite(box.width) || !finite(box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  if (box.width > MAX_OBJECT_SIZE_WORLD || box.height > MAX_OBJECT_SIZE_WORLD) return false;
  const object = textEntry(doc, id);
  if (object === null) return false;
  const current = object;
  let written = false;
  doc.transact(() => {
    if (textEntry(doc, id) === null) return;
    if (current.get('width') === box.width && current.get('height') === box.height) return;
    current.set('width', box.width);
    current.set('height', box.height);
    written = true;
  }, LOCAL_ORIGIN);
  return written;
}

/**
 * Remove the text when it holds nothing, and report whether it was removed. A
 * stale id is not an error and writes nothing; whitespace-only text is content,
 * so it stays. The caller is an edit end, and the object it removes is the
 * "abandoned text" the PRD promises never appears.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
