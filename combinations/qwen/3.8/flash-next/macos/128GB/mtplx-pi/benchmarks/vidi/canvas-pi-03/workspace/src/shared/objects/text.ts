// Free-text blocks (story 9, contract `text.model`).
//
// The schema and every mutation a client can make to a text block live here,
// framework-free and DOM-free, exactly like `board-model.ts`:
//
//   objects/<id>: Y.Map {
//     type: 'text', x, y, width, height, z, createdAt, createdBy,
//     text: Y.Text,
//     size: TextSize,
//     widthMode: 'auto' | 'fixed'
//   }
//
// `width`/`height` are stored (not re-derived on every client) because
// selection bounds, the marquee and export all need a footprint without
// measuring; the client that made the local change writes them (design §Key
// decision 1). Selection, moving, deleting and undo stay generic — nothing
// text-specific is added to those operations.

import * as Y from 'yjs';
import {
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_SIZE,
  type TextSize,
} from '../config';
import { LOCAL_ORIGIN, deleteObjects } from '../board-model';

/** The object-map key holding the board's objects. */
const OBJECTS_KEY = 'objects';

/** Everything the layout layer needs about one block, read in one pass. */
export interface TextObjectState {
  /** Raw text of the block. */
  text: string;
  /** Size preset ('S' | 'M' | 'L' | 'XL'). */
  size: TextSize;
  /** 'auto' sizes to the content, 'fixed' keeps the stored width. */
  widthMode: 'auto' | 'fixed';
  /** Stored footprint. */
  width: number;
  height: number;
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

function textOf(doc: Y.Doc, id: string): { obj: Y.Map<unknown>; text: Y.Text } | null {
  const obj = objects(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'text') return null;
  const text = obj.get('text') as Y.Text | undefined;
  if (text === undefined) return null;
  return { obj, text };
}

function topZ(doc: Y.Doc): number {
  let z = 0;
  objects(doc).forEach((obj) => {
    const value = obj.get('z');
    if (typeof value === 'number' && value > z) z = value;
  });
  return z;
}

/** Height of one line at a size preset, in world units. */
export function textLineHeight(size: TextSize): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}

/** Width a brand-new block gets before anything is measured: just wide enough
 * for the caret to have somewhere to live. */
function initialWidth(): number {
  return TEXT_MIN_WIDTH_WORLD;
}

/**
 * Create an empty text block whose TOP-LEFT is `at`, stacked above everything
 * else, authored by `createdBy`. Returns the new id, or null when `at` is not a
 * usable point (non-finite) — in which case nothing is written at all.
 */
export function createText(doc: Y.Doc, at: { x: number; y: number }, createdBy: string): string | null {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = crypto.randomUUID();
  const obj = objects(doc);
  const z = topZ(doc) + 1;
  const text = new Y.Text();
  const record = new Y.Map<unknown>();
  doc.transact(() => {
    record.set('type', 'text');
    record.set('x', at.x);
    record.set('y', at.y);
    record.set('width', initialWidth());
    record.set('height', textLineHeight(DEFAULT_TEXT_SIZE));
    record.set('text', text);
    record.set('size', DEFAULT_TEXT_SIZE);
    record.set('widthMode', 'auto');
    record.set('z', z);
    record.set('createdAt', Date.now());
    record.set('createdBy', createdBy);
    obj.set(id, record);
  }, LOCAL_ORIGIN);
  return id;
}

/** The block's Y.Text, or undefined for a stale or non-text id. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  return textOf(doc, id)?.text;
}

/** Read the block's state, or null when `id` is not a text block. */
export function getTextObject(doc: Y.Doc, id: string): TextObjectState | null {
  const found = textOf(doc, id);
  if (found === null) return null;
  const size = found.obj.get('size') as TextSize;
  const width = found.obj.get('width') as number;
  const height = found.obj.get('height') as number;
  return {
    text: found.text.toString(),
    size: size in TEXT_SIZES ? size : DEFAULT_TEXT_SIZE,
    widthMode: found.obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
    width: Number.isFinite(width) ? width : TEXT_MIN_WIDTH_WORLD,
    height: Number.isFinite(height) ? height : textLineHeight(DEFAULT_TEXT_SIZE),
  };
}

/**
 * Change a block's size preset. An unknown key (or a stale id) returns false
 * and writes nothing; so does a preset the block already has.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (typeof size !== 'string' || !(size in TEXT_SIZES)) return false;
  const found = textOf(doc, id);
  if (found === null) return false;
  if (found.obj.get('size') === size) return false;
  doc.transact(() => {
    found.obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Store a measured footprint. Rejects a stale id and any non-finite or
 * non-positive number without opening a transaction, and skips the write when
 * the box is already exactly this (no redundant updates, TC-13).
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  const found = textOf(doc, id);
  if (found === null) return false;
  if (!box) return false;
  const { width, height } = box;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  if (found.obj.get('width') === width && found.obj.get('height') === height) return false;
  doc.transact(() => {
    found.obj.set('width', width);
    found.obj.set('height', height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Pin a block to a fixed width (what a horizontal handle drag does): the width
 * is clamped up to TEXT_MIN_WIDTH_WORLD and `widthMode` becomes 'fixed', so
 * later edits rewrap inside it instead of resizing. Height is left to the
 * following `setTextBox` (design §Key decision 2).
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const found = textOf(doc, id);
  if (found === null) return false;
  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  const same = found.obj.get('width') === clamped && found.obj.get('widthMode') === 'fixed';
  if (same) return false;
  doc.transact(() => {
    found.obj.set('width', clamped);
    found.obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/** True when the block holds zero characters. Whitespace-only text is NOT
 * empty: only zero characters counts (TC-04). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const found = textOf(doc, id);
  if (found === null) return false;
  return found.text.length === 0;
}

/** Remove the block when it holds nothing, so an abandoned text block never
 * stays on the board (TC-20, TC-31). Deleting goes through the generic
 * story-7 operation, which is one undo step. */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
