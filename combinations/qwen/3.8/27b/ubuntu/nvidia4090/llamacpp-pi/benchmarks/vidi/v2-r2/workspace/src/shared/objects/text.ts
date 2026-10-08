/**
 * Free text object model (story 9, text.*): the 'text' object type is plain
 * text with no background, created at the click point (top-left at the
 * click), with four size presets (S/M/L/XL) and an auto or fixed width.
 *
 * Every text object stores explicit width/height (world units). The initial
 * box is written by createText; afterwards the client's box-sync observer
 * (`useTextBoxSync`) rewrites it whenever a local change alters the
 * re-measured layout. This module is the single owner of the 'text' schema
 * and every text mutation, exactly like board-model is for stickies.
 *
 * The module also registers 'text' as a known object type on import, so
 * shared-level code (unit tests) can create and snapshot text objects
 * without the client-side registry.
 */

import * as Y from 'yjs';
import {
  addKnownObjectType,
  deleteObjects,
  LOCAL_ORIGIN,
  maxZ,
  type ObjectSnapshot,
} from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import { type Point } from '../geometry';

// The text model owns the 'text' type for the document layer (idempotent;
// the client registry registers it again when it loads).
addKnownObjectType('text');

/** Text width behaviour: auto (grow-then-wrap) or fixed (wrap at the set width). */
export type TextWidthMode = 'auto' | 'fixed';

/** Immutable view of one text object (ObjectSnapshot + text fields). */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: TextWidthMode;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The 'text' entry for `id`, or undefined for stale ids / other types. */
export function textEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = doc.getMap('objects').get(id);
  if (entry instanceof Y.Map && entry.get('type') === 'text') {
    return entry;
  }
  return undefined;
}

/**
 * Creates a text object with its top-left at `at`, empty text, the default
 * size (M) and auto width, on top of all other objects. `createdBy` records
 * who created it (story 6 adds identity; until then callers pass a
 * per-tab client id).
 *
 * The initial box is a minimum-width, one-line box: bounds exist before the
 * first measurement, and the box-sync observer rewrites it as soon as text
 * is typed. Returns the new id, or null (no transaction) for non-finite
 * coordinates.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!finiteNumber(at.x) || !finiteNumber(at.y) || typeof createdBy !== 'string') {
    return null;
  }
  const id = crypto.randomUUID();
  doc.transact(
    () => {
      const entry = new Y.Map();
      entry.set('type', 'text');
      entry.set('x', at.x);
      entry.set('y', at.y);
      entry.set('width', TEXT_MIN_WIDTH_WORLD);
      entry.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
      entry.set('z', maxZ(doc) + 1);
      entry.set('createdAt', Date.now());
      entry.set('createdBy', createdBy);
      entry.set('text', new Y.Text());
      entry.set('size', DEFAULT_TEXT_SIZE);
      entry.set('widthMode', 'auto');
      doc.getMap('objects').set(id, entry);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/**
 * Sets the text size preset. Returns false (no transaction) for stale ids
 * or unknown size names; changing to the current size is also a no-op.
 */
export function setTextSize(doc: Y.Doc, id: string, size: TextSize): boolean {
  const entry = textEntry(doc, id);
  if (entry === undefined || !(size in TEXT_SIZES)) {
    return false;
  }
  if (entry.get('size') === size) {
    return false; // no-op
  }
  doc.transact(() => entry.set('size', size), LOCAL_ORIGIN);
  return true;
}

/**
 * Sets a fixed width (the width mode becomes 'fixed') and clamps the width
 * to at least TEXT_MIN_WIDTH_WORLD (text.fixed_width). Returns false (no
 * transaction) for stale ids or non-finite widths.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const entry = textEntry(doc, id);
  if (entry === undefined || !finiteNumber(width)) {
    return false;
  }
  doc.transact(
    () => {
      entry.set('width', Math.max(width, TEXT_MIN_WIDTH_WORLD));
      entry.set('widthMode', 'fixed');
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/**
 * Writes the measured layout box (width + height) for the object. Returns
 * false (no transaction) for stale ids, non-finite boxes, or when the box
 * already equals the stored one (no redundant writes).
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  const entry = textEntry(doc, id);
  if (
    entry === undefined ||
    !finiteNumber(box.width) ||
    !finiteNumber(box.height)
  ) {
    return false;
  }
  if (entry.get('width') === box.width && entry.get('height') === box.height) {
    return false; // already in sync: no redundant update
  }
  doc.transact(
    () => {
      entry.set('width', box.width);
      entry.set('height', box.height);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** The Y.Text content of the object, or undefined for stale/unknown ids. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = textEntry(doc, id);
  if (entry === undefined) {
    return undefined;
  }
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** The size preset of the object ('M' for stale ids or malformed values). */
export function getTextSize(doc: Y.Doc, id: string): TextSize {
  const entry = textEntry(doc, id);
  if (entry === undefined) {
    return DEFAULT_TEXT_SIZE;
  }
  const size = entry.get('size');
  return typeof size === 'string' && size in TEXT_SIZES ? (size as TextSize) : DEFAULT_TEXT_SIZE;
}

/** The width mode of the object ('auto' for stale ids or malformed values). */
export function getTextWidthMode(doc: Y.Doc, id: string): TextWidthMode {
  const entry = textEntry(doc, id);
  return entry !== undefined && entry.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
}

/** True when the object holds zero characters (whitespace-only is NOT empty). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/**
 * Deletes the object when it holds zero characters (text.empty_removed).
 * Returns true when the object was deleted; a text with any character —
 * including whitespace-only text — is kept, and stale ids return false.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) {
    return false;
  }
  return deleteObjects(doc, [id]) > 0;
}
