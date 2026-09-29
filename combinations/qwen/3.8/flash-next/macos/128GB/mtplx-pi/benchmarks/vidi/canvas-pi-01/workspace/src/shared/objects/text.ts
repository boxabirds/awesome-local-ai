/**
 * Story 9 · task 2 — the free-text object model (design "Text object model").
 *
 * The framework-free half of "write free text anywhere on the board": every
 * mutation of a `text` object lives here, written against a real `Y.Doc` exactly
 * like `board-model.ts`. A `text` object is a `Y.Map` of the generic object
 * schema plus three of its own fields — `text` (a `Y.Text`), `size` (a preset
 * key) and `widthMode` (`'auto' | 'fixed'`). Selection, move, delete and undo
 * come from stories 7 and 8 unchanged: nothing text-specific is added there.
 *
 * Like the model module, none of these functions throws for user-driven input.
 * A stale id, an unknown size key or a non-finite number returns `false` (or
 * `null` for `createText`) and opens **no** transaction, so a bad gesture or a
 * read-only board never produces pointless sync traffic. A successful mutation
 * is exactly one `doc.transact(fn, LOCAL_ORIGIN)`.
 */
import * as Y from 'yjs';
import { deleteObjects, LOCAL_ORIGIN } from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';

/** The registry key for a free-text object. */
export const TEXT_TYPE = 'text';

/** A point in world units. */
export interface Point {
  x: number;
  y: number;
}

/** The two width behaviours a text box can be in. */
export type TextWidthMode = 'auto' | 'fixed';

type Record_ = Y.Map<unknown>;

function objects(doc: Y.Doc): Y.Map<Record_> {
  return doc.getMap<Record_>('objects');
}

/** True when the record is a text object (not a sticky, not a shape). */
export function isTextRecord(record: Record_ | undefined): record is Record_ {
  return record !== undefined && record.get('type') === TEXT_TYPE;
}

function recordOf(doc: Y.Doc, id: string): Record_ | undefined {
  return objects(doc).get(id);
}

/** Highest `z` over **every** object type (0 when the board is empty). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  objects(doc).forEach((rec) => {
    const z = rec.get('z');
    if (typeof z === 'number' && z > top) top = z;
  });
  return top;
}

/** A stable identifier, matching `board-model`'s fallback behaviour. */
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A conservative footprint so a freshly created box has bounds before its
 * first real measure (the editor remeasures on the first keystroke). */
function estimateBox(size: TextSize): { width: number; height: number } {
  const fontPx = TEXT_SIZES[size];
  return {
    width: Math.round(fontPx * 12),
    height: Math.round(fontPx * TEXT_LINE_HEIGHT),
  };
}

/**
 * Create a free-text object whose **top-left** sits at `at` (a text box grows
 * down and to the right from the click, unlike a note which centres). Returns
 * the new id, or `null` for a non-finite point — in which case no transaction
 * is opened. The new object is placed above every other object (z = max + 1),
 * starts at the default size in auto-width mode, and records who made it.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = newId();
  const top = maxZ(doc) + 1;
  const box = estimateBox(DEFAULT_TEXT_SIZE);
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    record.set('type', TEXT_TYPE);
    record.set('x', at.x);
    record.set('y', at.y);
    record.set('width', box.width);
    record.set('height', box.height);
    record.set('z', top);
    record.set('createdAt', Date.now());
    record.set('createdBy', createdBy);
    record.set('text', new Y.Text(''));
    record.set('size', DEFAULT_TEXT_SIZE);
    record.set('widthMode', 'auto');
    objects(doc).set(id, record);
  }, LOCAL_ORIGIN);
  return id;
}

/** True when `size` is one of the four presets. */
export function isTextSize(size: unknown): size is TextSize {
  return typeof size === 'string' &&
    Object.prototype.hasOwnProperty.call(TEXT_SIZES, size);
}

/**
 * Change a text object's font-size preset. Rejects a stale id, a non-text
 * object and an unknown size key (returns false, no transaction). A no-op
 * recolour (already that size) is also rejected. `x`/`y` are untouched.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const rec = recordOf(doc, id);
  if (!isTextRecord(rec)) return false;
  if (!isTextSize(size)) return false;
  if (rec.get('size') === size) return false;
  doc.transact(() => {
    rec.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Switch a text object to fixed-width mode at `width` world units, clamped up
 * to `TEXT_MIN_WIDTH_WORLD`. Rejects a stale id and a non-finite width. The
 * height always follows the content later (remeasured by the editor), so only
 * the width and the mode change here.
 */
export function setTextWidthFixed(
  doc: Y.Doc,
  id: string,
  width: number,
): boolean {
  const rec = recordOf(doc, id);
  if (!isTextRecord(rec)) return false;
  if (!Number.isFinite(width)) return false;
  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  const sameMode = rec.get('widthMode') === 'fixed';
  const sameWidth = Math.abs((rec.get('width') as number) - clamped) < 1e-6;
  if (sameMode && sameWidth) return false;
  doc.transact(() => {
    rec.set('width', clamped);
    rec.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the stored box. Rejects a stale id, a non-text object and any
 * non-finite dimension. Returns false when the box is unchanged, so the box
 * sync never writes a redundant update (a key design rule: remote clients never
 * race to write dimensions).
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  const rec = recordOf(doc, id);
  if (!isTextRecord(rec)) return false;
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  const sameWidth = Math.abs((rec.get('width') as number) - box.width) < 1e-6;
  const sameHeight = Math.abs((rec.get('height') as number) - box.height) < 1e-6;
  if (sameWidth && sameHeight) return false;
  doc.transact(() => {
    rec.set('width', box.width);
    rec.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The text object's `Y.Text`, or `undefined` for a stale / non-text id. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const rec = recordOf(doc, id);
  if (!isTextRecord(rec)) return undefined;
  const text = rec.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the object holds **zero** characters (whitespace is not empty). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  if (!text) return false;
  return text.toString().length === 0;
}

/**
 * Remove a text object if it is still empty, otherwise do nothing. Called when
 * editing ends: an abandoned heading (no characters typed) must not stay on the
 * board as invisible text. A whitespace-only object is kept (only zero
 * characters counts as empty).
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

/** The current size preset of a text object (defaults to the created size). */
export function getTextSize(doc: Y.Doc, id: string): TextSize {
  const rec = recordOf(doc, id);
  if (!isTextRecord(rec)) return DEFAULT_TEXT_SIZE;
  const size = rec.get('size');
  return isTextSize(size) ? size : DEFAULT_TEXT_SIZE;
}

/** The current width mode of a text object. */
export function getTextWidthMode(doc: Y.Doc, id: string): TextWidthMode {
  const rec = recordOf(doc, id);
  if (!isTextRecord(rec)) return 'auto';
  return rec.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
}