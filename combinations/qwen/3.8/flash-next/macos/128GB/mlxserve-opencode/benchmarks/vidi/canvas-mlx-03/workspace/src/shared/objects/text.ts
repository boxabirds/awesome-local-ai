// The text object model (story 9 `text.model`): the Yjs schema for a free-text
// object and every mutation of it. Framework-free, so the client and any future
// worker code import it unchanged.
//
// Schema (one entry in the shared `objects` map):
//   objects/<id>: Y.Map {
//     type: 'text', x, y, width, height, z, createdAt, createdBy,
//     text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
//   }
//
// Selection, move, delete and undo all come from the generic board-model +
// registry (stories 7 and 8); nothing text-specific is added there. This file
// only owns the fields the generic machinery cannot infer about a text object.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model.ts';
import {
  deleteObjects,
  objectSnapshots,
  type ObjectSnapshot,
} from '../board-model.ts';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
  clamp,
  type TextSize,
} from '../../shared/config.ts';
import type { Point } from '../../shared/geometry.ts';

const TEXT_TYPE = 'text';

/** A text object as the client renders it. */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  createdBy: string;
  width: number;
  height: number;
}

const SIZES = TEXT_SIZES as Readonly<Record<string, number>>;

function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SIZES, value);
}

function finite(n: number): boolean {
  return Number.isFinite(n);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** The highest z across every object, or 0 when none. */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let m = 0;
  for (const o of objects.values()) {
    const z = o.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > m) m = z;
  }
  return m;
}

/** A usable positive size, or undefined when the stored value is unusable. */
function positive(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function getText(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  const o = objects.get(id);
  if (o && o.get('type') === TEXT_TYPE) return o;
  return undefined;
}

/**
 * A conservative empty-text box, so selection bounds and the marquee have real
 * numbers to work with before the first real measurement (which the editor's box
 * sync writes). It is deliberately small; the client re-measures on the first
 * input.
 */
function initialBox(size: TextSize): { width: number; height: number } {
  // Two lines tall, one comfortable line wide — clamped into the legal box so it
  // never exceeds the auto width or dips below the fixed minimum.
  const lineH = TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
  return {
    width: clamp(TEXT_MIN_WIDTH_WORLD * 3, TEXT_MIN_WIDTH_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD),
    height: lineH,
  };
}

/**
 * Create a free-text object with its **top-left** at `at` (unlike a sticky note,
 * which centres on the point). Starts size M, auto width, empty, on top of every
 * object, `createdBy` from the caller's identity. Returns the new id, or null
 * (writing nothing) for a non-finite point.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!at || !finite(at.x) || !finite(at.y)) return null;
  const id = crypto.randomUUID();
  const objects = objectsMap(doc);
  const z = maxZ(objects) + 1;
  const box = initialBox(DEFAULT_TEXT_SIZE);
  const text = new Y.Text('');
  const o = new Y.Map<unknown>();
  doc.transact(() => {
    o.set('type', TEXT_TYPE);
    o.set('x', at.x);
    o.set('y', at.y);
    o.set('width', box.width);
    o.set('height', box.height);
    o.set('text', text);
    o.set('size', DEFAULT_TEXT_SIZE);
    o.set('widthMode', 'auto');
    o.set('z', z);
    o.set('createdAt', Date.now());
    o.set('createdBy', typeof createdBy === 'string' ? createdBy : '');
    objects.set(id, o);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a text object's size preset. The top-left position is left untouched;
 * the caller re-measures the box afterwards (via the box sync). Rejects an
 * unknown key with false and no transaction.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const objects = objectsMap(doc);
  const o = getText(objects, id);
  if (!o) return false;
  if (o.get('size') === size) return true; // already this size; still a legal no-op
  doc.transact(() => {
    o.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Switch a text object to a **fixed** width, clamped to no smaller than
 * TEXT_MIN_WIDTH_WORLD. Rewrapping the text to the new width is the box sync's
 * job (it rewrites the height next); this only records the width and the mode.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!finite(width)) return false;
  const objects = objectsMap(doc);
  const o = getText(objects, id);
  if (!o) return false;
  const w = clamp(width, TEXT_MIN_WIDTH_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  doc.transact(() => {
    o.set('widthMode', 'fixed');
    o.set('width', w);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the stored box (width, height). The single writer is the client that made
 * the local change (typing, size change, handle drag); remote clients render this
 * box and never re-measure, so five clients never race to write dimensions.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!box || !finite(box.width) || !finite(box.height) || box.width <= 0 || box.height <= 0) {
    return false;
  }
  const objects = objectsMap(doc);
  const o = getText(objects, id);
  if (!o) return false;
  if (o.get('width') === box.width && o.get('height') === box.height) return true; // no write needed
  doc.transact(() => {
    o.set('width', box.width);
    o.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The text object's Y.Text, or undefined for a stale / non-text id. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const o = getText(objectsMap(doc), id);
  const t = o?.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/**
 * True when the object holds *zero* characters. Whitespace-only text is NOT empty
 * (decision: only zero characters removes the object), so "  " survives an
 * end-of-edit.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const t = getTextContent(doc, id);
  return t !== undefined && t.toString().length === 0;
}

/**
 * Remove the text object when it is empty, via the generic `deleteObjects` so it
 * lands in the same undo step as the last edit that emptied it. Returns false when
 * the id is stale or the text has characters.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) === 1;
}

/**
 * One text object's full snapshot (size preset, width mode, author), or undefined
 * for a stale / non-text id. This is the type-aware reader the TextObject
 * component uses; the generic `objectSnapshots` carries the geometry fields.
 */
export function textSnapshot(doc: Y.Doc, id: string): TextSnapshot | undefined {
  const found = objectSnapshots(doc).find((o) => o.id === id && o.type === TEXT_TYPE);
  if (!found) return undefined;
  return asTextSnapshot(found);
}

/** Narrow a generic ObjectSnapshot (already read) to a TextSnapshot. */
export function asTextSnapshot(o: ObjectSnapshot): TextSnapshot {
  return {
    ...o,
    type: 'text',
    text: o.text ?? '',
    size: isTextSize(o.size) ? o.size : DEFAULT_TEXT_SIZE,
    widthMode: o.widthMode === 'fixed' ? 'fixed' : 'auto',
    createdBy: o.createdBy ?? '',
    width: positive(o.width) ?? TEXT_MIN_WIDTH_WORLD,
    height: positive(o.height) ?? TEXT_SIZES[isTextSize(o.size) ? o.size : DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT,
  };
}

/** Every text object in the document, in stacking order. */
export function textSnapshots(doc: Y.Doc): readonly TextSnapshot[] {
  const out: TextSnapshot[] = [];
  for (const o of objectSnapshots(doc)) {
    if (o.type === TEXT_TYPE) out.push(asTextSnapshot(o));
  }
  return out;
}
