// The text object model (story 9, text.model): Yjs schema helpers for the
// plain-text objects the Text tool places on the board.
//
// Schema (objects/<id>):
//   type: 'text'
//   x, y: number          // top-left, world units
//   width, height: number // stored box; measured by the client that made
//                         // the local change (story 9 key decision 1)
//   z: number             // stacking; higher is on top
//   createdAt: number     // epoch ms
//   createdBy: string     // client identity of the creator
//   text: Y.Text
//   size: TextSize        // preset key 'S' | 'M' | 'L' | 'XL'
//   widthMode: 'auto' | 'fixed'
//
// Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
// rejections (stale id, unknown size, non-finite numbers, no-ops) return
// false/null before opening a transaction. Never throws for user-driven input.

import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import {
  LOCAL_ORIGIN,
  deleteObjects,
  registerBoardType,
  type ObjectSnapshot,
} from '../board-model';

const TEXT_TYPE = 'text';

// Register the type with the board schema (module-load time) so snapshots,
// select-all and the worker's validation know about it.
registerBoardType(TEXT_TYPE);

/** Snapshot of one text object (board-model ObjectSnapshot + text fields).
 *  width/height are always present for text objects (they start as a finite
 *  estimate at creation and are measured from then on). */
export interface TextSnapshot extends Omit<ObjectSnapshot, 'width' | 'height'> {
  type: 'text';
  width: number;
  height: number;
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && value in TEXT_SIZES;
}

/** The entry's Y.Map when `id` exists and is a text object. */
function textEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = objectsMap(doc).get(id);
  if (!entry || entry.get('type') !== TEXT_TYPE) return undefined;
  return entry;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsMap(doc).values()) {
    const z = entry.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

/**
 * Creates a size-M auto-width text object with its top-left at `at`, its
 * z above every existing object and its createdBy set to `createdBy`.
 * Returns the new id; a non-finite point is rejected with null and no
 * transaction. The initial box is an estimate (one empty line) so bounds
 * exist before the first measure (the local editor re-measures on first
 * input; remote clients render the stored box until then).
 */
export function createText(doc: Y.Doc, at: { x: number; y: number }, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  if (typeof createdBy !== 'string') return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', TEXT_TYPE);
    entry.set('x', at.x);
    entry.set('y', at.y);
    entry.set('width', 2 * TEXT_PADDING_WORLD);
    entry.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    entry.set('z', maxZ(doc) + 1);
    entry.set('createdAt', Date.now());
    entry.set('createdBy', createdBy);
    entry.set('text', new Y.Text());
    entry.set('size', DEFAULT_TEXT_SIZE);
    entry.set('widthMode', 'auto');
    objectsMap(doc).set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Changes the text's size preset. Returns true when a change was applied;
 * false for a stale id, an unknown size key, or the object's current size
 * (no-op). x/y are untouched (text.size keeps the top-left position).
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const entry = textEntry(doc, id);
  if (!entry) return false;
  if (entry.get('size') === size) return false;
  doc.transact(() => {
    entry.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets a fixed width (side-handle drag), clamped to
 * [TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD]. Sets widthMode to 'fixed'.
 * Returns true when a change was applied; false for a stale id or a
 * non-finite width.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const entry = textEntry(doc, id);
  if (!entry) return false;
  const clamped = Math.min(Math.max(width, TEXT_MIN_WIDTH_WORLD), MAX_OBJECT_SIZE_WORLD);
  if (entry.get('width') === clamped && entry.get('widthMode') === 'fixed') return false;
  doc.transact(() => {
    entry.set('width', clamped);
    entry.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Writes the measured box. Returns true when a change was applied; false
 * for a stale id, non-finite numbers, or an exact no-op.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  const entry = textEntry(doc, id);
  if (!entry) return false;
  if (entry.get('width') === box.width && entry.get('height') === box.height) return false;
  doc.transact(() => {
    entry.set('width', box.width);
    entry.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The object's Y.Text, if `id` exists and is a text object. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = textEntry(doc, id);
  if (!entry) return undefined;
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the object's text has zero characters (whitespace is kept —
 *  only zero characters counts as empty, story 9 decision). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  if (text === undefined) return false;
  return text.length === 0;
}

/** Deletes the object when its text is empty; true when it was removed. */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

/** The text object's extended snapshot, or null for a stale/non-text id. */
export function textSnapshot(doc: Y.Doc, id: string): TextSnapshot | null {
  const entry = textEntry(doc, id);
  if (!entry) return null;
  const text = entry.get('text');
  const width = entry.get('width');
  const height = entry.get('height');
  const size = entry.get('size');
  const widthMode = entry.get('widthMode');
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  if (!isTextSize(size)) return null;
  if (widthMode !== 'auto' && widthMode !== 'fixed') return null;
  return {
    id,
    type: TEXT_TYPE,
    x: entry.get('x') as number,
    y: entry.get('y') as number,
    width,
    height,
    z: entry.get('z') as number,
    createdAt: entry.get('createdAt') as number,
    color: undefined,
    text: text instanceof Y.Text ? text.toString() : '',
    size,
    widthMode,
  };
}
