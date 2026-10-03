// The free text object model (story 9). See the text.model contract.
//
// A text object is a plain `text` entry in the shared `objects` map, carrying a
// `Y.Text` (so it merges like a sticky note's text), a size preset key, a width
// mode ('auto' — as wide as its longest line, up to TEXT_MAX_AUTO_WIDTH_WORLD; or
// 'fixed' — a width the user dragged) and an explicit box. The *box* (width /
// height) is written by whichever client made the local change (typing, a size
// change, a side-handle drag) via `useTextBoxSync`, so selection bounds, marquee
// and export never re-measure on every client and one undo reverts text and box
// together.
//
// Selection, move, nudge and delete are NOT here — text objects reuse story 7's
// generic `moveObjects` / `deleteObjects` / selection unchanged (text.consistent).
// Only the text-specific fields are.
//
// Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)` so the
// undo manager sees one reversible operation per action and the provider skips
// echoing it. Every rejection (stale id, unknown size, non-finite number) returns
// false / null *before* opening a transaction, so it emits no `update` event.

import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import { LOCAL_ORIGIN, deleteObjects } from '../board-model';
import type { Point } from '../geometry';
import type { TextSnapshot } from '../board-model';

const OBJECTS = 'objects';

type ObjectMap = Y.Map<unknown>;
type Objects = Y.Map<Y.Map<unknown>>;

function objects(doc: Y.Doc): Objects {
  return doc.getMap<Y.Map<unknown>>(OBJECTS);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && value in TEXT_SIZES;
}

/** Return the object's Y.Map only when `id` is an existing text object. */
function getTextMap(doc: Y.Doc, id: string): ObjectMap | undefined {
  const map = objects(doc).get(id);
  if (!map || map.get('type') !== 'text') return undefined;
  return map;
}

/** Highest `z` across every object (text or otherwise), so text lands on top. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}`;
}

/**
 * Create a text object whose TOP-LEFT is `at`, size M, `widthMode: 'auto'`, with an
 * empty `Y.Text`, on top of every other object (z = maxZ + 1), owned by `createdBy`,
 * in one LOCAL_ORIGIN transaction. Returns the new id, or `null` for a non-finite
 * point (nothing is written then). (text.create / text.model.)
 *
 * The box starts as a single minimum-width line so the object has real bounds from
 * the moment it exists — before the first measure there is nothing to size to.
 */
export function createText(
  doc: Y.Doc,
  at: Point,
  createdBy: string,
): string | null {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;

  const id = newId();
  const fontPx = TEXT_SIZES[DEFAULT_TEXT_SIZE];

  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    // A sensible starting box so selection bounds exist before the first measure.
    obj.set('width', TEXT_MIN_WIDTH_WORLD);
    obj.set('height', Math.round(fontPx * TEXT_LINE_HEIGHT));
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    obj.set('text', new Y.Text(''));
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Change a text object's size preset. Keeps x / y untouched; the *box* is recomputed
 * separately by `useTextBoxSync` after this returns true. False for a stale id or an
 * unknown size key (no transaction) — the error path TC-02 exercises. (text.size.)
 */
export function setTextSize(
  doc: Y.Doc,
  id: string,
  size: string,
): boolean {
  if (!isTextSize(size)) return false;
  const obj = getTextMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Give a text object a fixed `width`, clamped up to TEXT_MIN_WIDTH_WORLD, and switch
 * its `widthMode` to 'fixed'. The height is rewrapped by `useTextBoxSync` afterwards.
 * False for a stale id or a non-finite width (no transaction). (text.fixed_width.)
 */
export function setTextWidthFixed(
  doc: Y.Doc,
  id: string,
  width: number,
): boolean {
  if (!isFiniteNumber(width)) return false;
  const obj = getTextMap(doc, id);
  if (!obj) return false;
  const w = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  doc.transact(() => {
    obj.set('width', w);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the object's measured box. Returns false (no transaction) for a stale id, a
 * non-finite dimension, or a box already exactly there — so a remeasure that changed
 * nothing emits no update (the no-redundant-writes rule, TC-13). (text.model.)
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  const obj = getTextMap(doc, id);
  if (!obj) return false;
  const curW = obj.get('width');
  const curH = obj.get('height');
  if (curW === box.width && curH === box.height) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The object's `Y.Text` for live editing, or undefined for a stale id. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getTextMap(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * The text fields `useTextBoxSync` needs to remeasure: the string, the size preset,
 * the width mode and the current box. Undefined for a stale id.
 */
export function readTextFields(
  doc: Y.Doc,
  id: string,
):
  | {
      text: string;
      size: TextSize;
      widthMode: 'auto' | 'fixed';
      width: number;
      height: number;
    }
  | undefined {
  const obj = getTextMap(doc, id);
  if (!obj) return undefined;
  const size = obj.get('size');
  const widthMode = obj.get('widthMode');
  const width = obj.get('width');
  const height = obj.get('height');
  const text = obj.get('text');
  return {
    text: text instanceof Y.Text ? text.toString() : '',
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
    width: isFiniteNumber(width) ? width : 0,
    height: isFiniteNumber(height) ? height : 0,
  };
}

/**
 * True when the text object exists and holds ZERO characters. Whitespace-only text
 * is *not* empty (a lone space is a character a person typed and keeps — the
 * decision TC-04 records). (text.empty_removed / text.model.)
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const obj = getTextMap(doc, id);
  if (!obj) return false;
  const text = obj.get('text');
  return text instanceof Y.Text ? text.length === 0 : false;
}

/**
 * Remove the text object when it is empty (zero characters), via story 7's generic
 * `deleteObjects` so it deletes exactly like every other object. Returns true when a
 * (present, empty) object was removed; false when the id is gone or the text is not
 * empty — leaving the board with no invisible text (text.empty_removed).
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

/** Read one text object's snapshot by id, or undefined when gone / other type. */
export function readTextSnapshot(
  doc: Y.Doc,
  id: string,
): TextSnapshot | undefined {
  const obj = getTextMap(doc, id);
  if (!obj) return undefined;
  const fields = readTextFields(doc, id);
  if (!fields) return undefined;
  return {
    id,
    type: 'text',
    x: obj.get('x') as number,
    y: obj.get('y') as number,
    z: obj.get('z') as number,
    createdAt: obj.get('createdAt') as number,
    text: fields.text,
    size: fields.size,
    widthMode: fields.widthMode,
    width: fields.width,
    height: fields.height,
    createdBy: typeof obj.get('createdBy') === 'string' ? (obj.get('createdBy') as string) : '',
  };
}
