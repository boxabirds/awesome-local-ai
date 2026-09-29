/**
 * Story 9: the free-text object type (text.model).
 *
 * Schema (one entry per object in the `objects` map):
 *   type: 'text', x, y, width, height, z, createdAt, createdBy,
 *   text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
 *
 * `width`/`height` are the STORED box, measured by the client that made the
 * local change (typing, size change, fixed-width drag) via textLayout —
 * remote clients render the stored box and never write dimensions
 * (key decision 1). `widthMode` is 'auto' (width follows the longest line up
 * to TEXT_MAX_AUTO_WIDTH_WORLD) or 'fixed' (width pinned by a side-handle
 * drag, ≥ TEXT_MIN_WIDTH_WORLD).
 *
 * Selection, move, nudge, delete and undo come from the generic story 7/8
 * machinery (text.consistent) — nothing text-specific is added to those.
 */
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  deleteObjects,
  type ObjectSnapshot,
} from '../board-model';
import type { Point } from '../geometry';
import {
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  DEFAULT_TEXT_SIZE,
  type TextSize,
} from '../config';

export type TextWidthMode = 'auto' | 'fixed';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: TextWidthMode;
}

type ObjectMap = Y.Map<unknown>;

function textOf(doc: Y.Doc, id: string): ObjectMap | undefined {
  const obj = doc.getMap('objects').get(id);
  if (!(obj instanceof Y.Map)) return undefined;
  return obj.get('type') === 'text' ? obj : undefined;
}

function isFiniteSize(s: { width?: number; height?: number }): boolean {
  return (
    (s.width === undefined || Number.isFinite(s.width)) &&
    (s.height === undefined || Number.isFinite(s.height))
  );
}

/** True for a known size preset key. */
export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && value in TEXT_SIZES;
}

/**
 * Creates a size-M auto-width text object with its top-left at `at` (world
 * units), on top of all other objects. The box starts as a small estimate so
 * selection bounds exist before the first measure. Returns the new id, or
 * null for a non-finite point (no transaction).
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const objects = doc.getMap('objects');
    let max = 0;
    objects.forEach((obj) => {
      if (!(obj instanceof Y.Map)) return;
      const z = obj.get('z');
      if (typeof z === 'number' && z > max) max = z;
    });
    const obj = new Y.Map();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('width', TEXT_MIN_WIDTH_WORLD); // estimate until first measure
    obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT); // one line at M
    obj.set('z', max + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    obj.set('text', new Y.Text());
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Returns the text's Y.Text, or undefined for a stale id. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = textOf(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** The stored size preset, or undefined for a stale id. */
export function getTextSize(doc: Y.Doc, id: string): TextSize | undefined {
  const size = textOf(doc, id)?.get('size');
  return isTextSize(size) ? size : undefined;
}

/** The stored width mode, or undefined for a stale id. */
export function getTextWidthMode(doc: Y.Doc, id: string): TextWidthMode | undefined {
  const mode = textOf(doc, id)?.get('widthMode');
  return mode === 'auto' || mode === 'fixed' ? mode : undefined;
}

/**
 * Changes the text's size preset. The top-left (x, y) is kept by the caller's
 * subsequent remeasure (text.size). Returns true when changed; false for a
 * stale id, an unknown size key, or the size already set (no transaction).
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const obj = textOf(doc, id);
  if (!obj) return false;
  if (obj.get('size') === size) return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets a fixed width from a side-handle drag, clamped to at least
 * TEXT_MIN_WIDTH_WORLD, and flips `widthMode` to 'fixed' (text.fixed_width).
 * Returns false for a stale id, a non-finite width, or a no-op.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  const obj = textOf(doc, id);
  if (!obj) return false;
  if (obj.get('widthMode') === 'fixed' && obj.get('width') === clamped) return false;
  doc.transact(() => {
    obj.set('widthMode', 'fixed');
    obj.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Writes the measured box (text.height always follows content). Returns true
 * when the box changed; false for a stale id, non-finite values, or a no-op.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFiniteSize(box)) return false;
  const obj = textOf(doc, id);
  if (!obj) return false;
  if (obj.get('width') === box.width && obj.get('height') === box.height) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** True when the text has ZERO characters (whitespace-only is NOT empty). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/**
 * Removes the text object when it is empty (text.empty_removed: an abandoned
 * text never leaves an invisible object). Returns true when removed.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) === 1;
}
