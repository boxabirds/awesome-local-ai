import * as Y from 'yjs';
import {
  deleteObjects,
  LOCAL_ORIGIN,
  registerSelectableType,
  registerSnapshotReader,
  type ObjectSnapshot,
} from '../board-model';
import type { Point } from '../geometry';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import { clampToLimit } from '../text-edit';

/**
 * The text object model (anchor `text.model`).
 *
 * Schema (`objects/<id>`):
 *
 * ```
 * { type: 'text', x, y, width, height, z, createdAt, createdBy,
 *   text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed' }
 * ```
 *
 * `width` and `height` are always stored (Key decision 1 of the design): the
 * client that made a local change measures and writes them, so selection
 * bounds, marquee and rendering work on every client without each of them
 * measuring the same text five times.
 *
 * Like the rest of the model, nothing here throws for user-driven input: a
 * stale id, an unknown size, a non-finite number or a no-op is refused before a
 * transaction opens, so no `update` event is emitted.
 */

export interface TextSnapshot extends ObjectSnapshot {
  readonly type: 'text';
  /** Always present for text: the box is measured, never inferred (Key decision 1). */
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly size: TextSize;
  readonly widthMode: 'auto' | 'fixed';
  readonly createdBy: string;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isTextSize = (value: unknown): value is TextSize =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(TEXT_SIZES, value) &&
  (TEXT_SIZES as Record<string, number>)[value] !== undefined;

const isWidthMode = (value: unknown): value is 'auto' | 'fixed' =>
  value === 'auto' || value === 'fixed';

const objectsOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>('objects');

const asObjectMap = (value: unknown): Y.Map<unknown> | undefined =>
  value instanceof Y.Map ? value : undefined;

/** The stored entry for `id`, when it is a text object. */
const textEntry = (doc: Y.Doc, id: string): Y.Map<unknown> | undefined => {
  if (typeof id !== 'string' || id === '') {
    return undefined;
  }
  const entry = asObjectMap(objectsOf(doc).get(id));
  if (!entry || entry.get('type') !== 'text') {
    return undefined;
  }
  return entry;
};

/** UUIDs, so two people creating text at the same moment cannot collide (story 3). */
function randomId(): string {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  const bytes = new Uint8Array(16);
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/** Highest `z` in the document (0 when it holds nothing). */
function maxZ(objects: Y.Map<unknown>): number {
  let highest = 0;
  objects.forEach((value) => {
    const z = asObjectMap(value)?.get('z');
    if (isFiniteNumber(z) && z > highest) {
      highest = z;
    }
  });
  return highest;
}

/** The box an object of this size starts with, before anything is measured. */
function initialBox(size: TextSize): { width: number; height: number } {
  return {
    width: TEXT_MIN_WIDTH_WORLD,
    height: TEXT_SIZES[size] * TEXT_LINE_HEIGHT,
  };
}

/**
 * Read one stored object as a text snapshot (`text.model`).
 *
 * Registered with the board model, so `objectSnapshots` - and with it selection,
 * marquee, move and delete - knows how to read a text object without any
 * text-specific interaction code (`text.consistent`).
 */
export function textFrom(id: string, value: unknown): TextSnapshot | undefined {
  const entry = asObjectMap(value);
  if (!entry || entry.get('type') !== 'text') {
    return undefined;
  }
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
  const width = entry.get('width');
  const height = entry.get('height');
  const text = entry.get('text');
  const size = entry.get('size');
  const widthMode = entry.get('widthMode');
  const createdBy = entry.get('createdBy');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return undefined; // a half-written object is not renderable
  }
  const box = initialBox(isTextSize(size) ? size : DEFAULT_TEXT_SIZE);
  return Object.freeze({
    id,
    type: 'text' as const,
    x,
    y,
    width: isFiniteNumber(width) && width > 0 ? width : box.width,
    height: isFiniteNumber(height) && height > 0 ? height : box.height,
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    text: text instanceof Y.Text ? text.toString() : '',
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: isWidthMode(widthMode) ? widthMode : 'auto',
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  });
}

registerSelectableType('text');
registerSnapshotReader('text', textFrom);

/** One stored text object, read as a snapshot - for measuring and rendering. */
export function readTextSnapshot(doc: Y.Doc, id: string): TextSnapshot | undefined {
  return textFrom(id, objectsOf(doc).get(id));
}

/**
 * Create a text object whose **top-left** is `at` (`text.create`), size M,
 * automatic width, empty text, above every object already on the board.
 *
 * Returns the new id, or `null` when the point is not a real position - in which
 * case no transaction is opened and nothing is created (TC-06).
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) {
    return null;
  }
  if (typeof createdBy !== 'string') {
    return null;
  }
  const id = randomId();
  const box = initialBox(DEFAULT_TEXT_SIZE);
  doc.transact(() => {
    const objects = objectsOf(doc);
    const object = new Y.Map<unknown>();
    object.set('type', 'text');
    object.set('x', at.x);
    object.set('y', at.y);
    object.set('width', box.width);
    object.set('height', box.height);
    object.set('z', maxZ(objects) + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', createdBy);
    object.set('text', new Y.Text(''));
    object.set('size', DEFAULT_TEXT_SIZE);
    object.set('widthMode', 'auto');
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/** The text object's shared `Y.Text`, or `undefined` for a stale id. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = textEntry(doc, id);
  if (!entry) {
    return undefined;
  }
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Change the text size preset (`text.size`).
 *
 * The position and the text are untouched; the caller recomputes the box
 * (`useTextBoxSync`), which is what "its top-left corner stays put" means.
 * An unknown size key answers `false` and changes nothing (TC-02).
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) {
    return false;
  }
  const entry = textEntry(doc, id);
  if (!entry) {
    return false;
  }
  if (entry.get('size') === size) {
    return false; // already this size: no transaction
  }
  doc.transact(() => {
    entry.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Give the text a fixed width (`text.fixed_width`), never smaller than
 * TEXT_MIN_WIDTH_WORLD (TC-03). The top-left corner does not move; the height is
 * the content's business, so it is left to the caller's remeasure.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) {
    return false;
  }
  const entry = textEntry(doc, id);
  if (!entry) {
    return false;
  }
  const clamped = Math.min(Math.max(width, TEXT_MIN_WIDTH_WORLD), MAX_OBJECT_SIZE_WORLD);
  if (entry.get('widthMode') === 'fixed' && entry.get('width') === clamped) {
    return false; // already exactly this box
  }
  doc.transact(() => {
    entry.set('width', clamped);
    entry.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Store the measured box (Key decision 1). `false` - and no transaction - when
 * the box is already what the document holds, which is what keeps a remeasure
 * that changed nothing from broadcasting anything (TC-13).
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (
    !box ||
    !isFiniteNumber(box.width) ||
    !isFiniteNumber(box.height) ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    return false;
  }
  const entry = textEntry(doc, id);
  if (!entry) {
    return false;
  }
  if (entry.get('width') === box.width && entry.get('height') === box.height) {
    return false;
  }
  doc.transact(() => {
    entry.set('width', box.width);
    entry.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** True when the text object holds no characters at all (TC-04). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  return ytext !== undefined && ytext.length === 0;
}

/**
 * Remove a text object that ended up with no characters (`text.empty_removed`),
 * through the same group delete every other type uses (`text.consistent`).
 * Whitespace-only text is text: it stays (TC-04).
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) {
    return false;
  }
  return deleteObjects(doc, [id]) > 0;
}

/** The limit for a text object's characters (`text.limit`). */
export const TEXT_LIMIT = TEXT_MAX_CHARS;

/** Clamp typed text to this type's limit. */
export function clampText(next: string): string {
  return clampToLimit(next, TEXT_MAX_CHARS);
}
