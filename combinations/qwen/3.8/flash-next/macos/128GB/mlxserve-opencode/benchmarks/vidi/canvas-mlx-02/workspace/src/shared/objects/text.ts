// The free text object (story 9): one object in `objects`, text in a Y.Text
// field. The object keeps the same shape as every other object (x, y, width,
// height, z, type, createdAt, createdBy), so selection (story 7) and Undo
// (story 8) act on it with their existing code; only the fields below are new.
//
// A text has no background, no colour, no rotation: it is a box of glyphs
// whose HEIGHT is computed from the text, so nothing but the horizontal sides
// is ever dragged. Every write here is a LOCAL_ORIGIN transaction, which is
// exactly what story 8's undo captures - one size change, one re-measure, one
// undo step.
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../config.ts';
import type { TextSize } from '../config.ts';
import type { Point } from '../geometry.ts';
import {
  LOCAL_ORIGIN,
  objectsMapOf,
  objectsSnapshot,
  deleteObjects,
} from '../board-model.ts';
import type { ObjectSnapshot } from '../board-model.ts';

/** The one type string this object is stored under. */
export const TEXT_TYPE = 'text';

// The object's own fields on top of the generic object snapshot.
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  createdBy: string;
}

// The smallest box a brand-new text can have before the first layout: one
// empty line at the default size, at the minimum width. The layout hook takes
// over the moment the object is on screen; this estimate only guarantees
// objectBounds is a real rect the instant the object exists - and it is what
// an empty text lays out to, so the hook's first look writes nothing.
const INITIAL_WIDTH_WORLD = TEXT_MIN_WIDTH_WORLD;
const INITIAL_HEIGHT_WORLD = TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT;

function textMapOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsMapOf(doc).get(id);
  if (!m || m.get('type') !== TEXT_TYPE) return undefined;
  return m;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMapOf(doc).forEach((m) => {
    const z = Number(m.get('z'));
    if (Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/**
 * Create an empty text whose top-left corner is `at`, inside one LOCAL_ORIGIN
 * transaction (so story 8's Undo can remove it).
 *
 * Unlike a sticky note the text is placed EXACTLY at the point clicked, not
 * centred on it: the click is where the first glyph lands. A non-finite point
 * is refused with null - no object is appended, nothing is announced (TC-06).
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!at || !isCoord(at.x) || !isCoord(at.y)) return null;

  const id = crypto.randomUUID();
  const now = Date.now();

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', TEXT_TYPE);
    m.set('x', at.x);
    m.set('y', at.y);
    m.set('width', INITIAL_WIDTH_WORLD);
    m.set('height', INITIAL_HEIGHT_WORLD);
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', now);
    m.set('createdBy', createdBy);
    m.set('size', DEFAULT_TEXT_SIZE);
    m.set('widthMode', 'auto');
    m.set('text', new Y.Text());
    objectsMapOf(doc).set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set the font size, inside a LOCAL_ORIGIN transaction. An unknown key is
 * refused (false) and opens NO transaction at all - the undo stack stays as it
 * was (TC-02). The layout hook grows the box to fit inside the same step.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(TEXT_SIZES, size)) return false;
  const key = size as TextSize;
  const m = textMapOf(doc, id);
  if (!m) return false;
  if (m.get('size') === key) return false; // no-op: avoid pointless traffic

  doc.transact(() => {
    const mm = textMapOf(doc, id);
    if (!mm) return;
    mm.set('size', key);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Give the text a FIXED width - the result of dragging a side handle. The
 * width is clamped to at least TEXT_MIN_WIDTH_WORLD (a handle drag toward zero
 * leaves the minimum behind, never an object of width 0), and the mode becomes
 * 'fixed' in the same transaction (TC-03).
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (typeof width !== 'number' || !Number.isFinite(width)) return false;
  const w = Math.max(TEXT_MIN_WIDTH_WORLD, width);

  const m = textMapOf(doc, id);
  if (!m) return false;
  if (m.get('width') === w && m.get('widthMode') === 'fixed') return false;

  doc.transact(() => {
    const mm = textMapOf(doc, id);
    if (!mm) return;
    mm.set('width', w);
    mm.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the laid-out box directly (the layout hook's write, after the text,
 * the size or the width changed). Widths below the floor land on it; a box
 * that is already exact writes nothing - no transaction, nothing on the wire,
 * no undo step (TC-13).
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (
    !box ||
    typeof box.width !== 'number' ||
    typeof box.height !== 'number' ||
    !Number.isFinite(box.width) ||
    !Number.isFinite(box.height) ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    return false;
  }
  const width = Math.max(TEXT_MIN_WIDTH_WORLD, box.width);

  const m = textMapOf(doc, id);
  if (!m) return false;
  if (m.get('width') === width && m.get('height') === box.height) return false;

  doc.transact(() => {
    const mm = textMapOf(doc, id);
    if (!mm) return;
    mm.set('width', width);
    mm.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The object's shared text, or undefined for anything but a text object. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = textMapOf(doc, id);
  if (!m) return undefined;
  const text = m.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Whether the text is EMPTY: zero characters. Whitespace is text, so a note
 * of spaces is not empty - the rule the deletion on end-of-edit follows
 * (TC-04).
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  return ytext !== undefined && ytext.length === 0;
}

/**
 * Remove the text object if its text is empty, inside a LOCAL_ORIGIN
 * transaction (one undo step, story 8). A text that has characters is left
 * alone (false), and so is any object that is not a text.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

/** Read one text object into a snapshot, or null if it is not a text object. */
export function readTextSnapshot(doc: Y.Doc, id: string): TextSnapshot | null {
  const found = objectsSnapshot(doc).find((o) => o.id === id);
  if (!found || found.type !== TEXT_TYPE) return null;
  // createdBy is not one of the generic fields the snapshot reader surfaces,
  // so it is read from the map beside it.
  const m = objectsMapOf(doc).get(id);
  const createdBy = typeof m?.get('createdBy') === 'string' ? (m.get('createdBy') as string) : '';
  return {
    ...found,
    type: 'text',
    size: found.size ?? DEFAULT_TEXT_SIZE,
    widthMode: found.widthMode ?? 'auto',
    text: found.text ?? '',
    createdBy,
  } as TextSnapshot;
}
