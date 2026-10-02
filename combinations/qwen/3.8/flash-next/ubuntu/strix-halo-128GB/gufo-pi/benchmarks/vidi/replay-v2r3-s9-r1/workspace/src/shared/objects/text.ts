/**
 * Free text object model (story 9).
 *
 * Schema (one entry of the board document's `objects` map):
 *   <id>: Y.Map {
 *     type: 'text', x, y, width, height, z, createdAt, createdBy,
 *     text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
 *   }
 *
 * `width`/`height` are stored (not just measured on screen) so selection
 * bounds, marquee and future export work on every client without re-measuring.
 * The client that made a local change writes the new box (see
 * `client/objects/useTextBoxSync.ts`); remote clients only render it.
 */
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  isTextSize,
} from '../config';
import type { TextSize } from '../config';
import { LOCAL_ORIGIN, deleteObjects, getObjectsMap } from '../board-model';
import type { Point } from '../geometry';

export type TextWidthMode = 'auto' | 'fixed';

export interface TextSnapshot {
  id: string;
  type: 'text';
  /** Top-left in world units. */
  x: number;
  y: number;
  /** Width in world units (written by the client that changed the text). */
  width?: number;
  /** Height in world units; always the height of the content. */
  height?: number;
  /** Stacking order; higher is drawn on top. */
  z: number;
  createdAt: number;
  /** Identity of the person who created the text (story 6 hooks this up). */
  createdBy: string;
  text: string;
  size: TextSize;
  widthMode: TextWidthMode;
  /** Text has no colour; declared so generic code may read `.color` on any object. */
  color?: undefined;
}

/** Pixel (board-unit) font size of a size preset. */
export function textSizePx(size: TextSize): number {
  return TEXT_SIZES[size] ?? TEXT_SIZES[DEFAULT_TEXT_SIZE];
}

/** One line of text at `size`, in world units. */
export function textLineHeightWorld(size: TextSize): number {
  return textSizePx(size) * TEXT_LINE_HEIGHT;
}

/**
 * The box a freshly created text object carries before the first measurement,
 * so it has bounds (and a visible caret) from the very first render.
 */
export function initialTextBox(size: TextSize): { width: number; height: number } {
  return { width: TEXT_MIN_WIDTH_WORLD, height: textLineHeightWorld(size) };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Reads a `text` object map, or undefined when absent / of another type. */
function getTextMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const m = getObjectsMap(doc).get(id);
  if (!m || m.get('type') !== 'text') return undefined;
  return m;
}

/** Reads a snapshot of one `text` object, or null when absent / invalid. */
export function readTextSnapshot(id: string, m: Y.Map<unknown>): TextSnapshot | null {
  if (m.get('type') !== 'text') return null;
  const x = m.get('x');
  const y = m.get('y');
  const z = m.get('z');
  if (!isFiniteNumber(x)) return null;
  if (!isFiniteNumber(y)) return null;
  if (typeof z !== 'number') return null;
  const width = m.get('width');
  const height = m.get('height');
  const text = m.get('text');
  const size = m.get('size');
  const widthMode = m.get('widthMode');
  const createdAt = m.get('createdAt');
  const createdBy = m.get('createdBy');
  return {
    id,
    type: 'text',
    x,
    y,
    width: isFiniteNumber(width) ? width : undefined,
    height: isFiniteNumber(height) ? height : undefined,
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    text: text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : '',
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
  };
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const m of objects.values()) {
    const z = m.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/**
 * Creates a size M, auto-width text object whose top-left is `at`, on top of
 * every other object, in one LOCAL_ORIGIN transaction.
 * Returns the new id, or null for a non-finite point (no transaction).
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;

  const objects = getObjectsMap(doc);
  const id = crypto.randomUUID();
  const z = maxZ(objects) + 1;
  const box = initialTextBox(DEFAULT_TEXT_SIZE);

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'text');
    m.set('x', at.x);
    m.set('y', at.y);
    m.set('width', box.width);
    m.set('height', box.height);
    m.set('text', new Y.Text());
    m.set('size', DEFAULT_TEXT_SIZE);
    m.set('widthMode', 'auto');
    m.set('z', z);
    m.set('createdAt', Date.now());
    m.set('createdBy', typeof createdBy === 'string' ? createdBy : '');
    objects.set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

/** Applies one of the four size presets. False for unknown keys and stale ids. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const m = getTextMap(doc, id);
  if (!m) return false;
  if (!isTextSize(size)) return false;
  if (m.get('size') === size) return false;

  doc.transact(() => {
    m.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Switches the object to a fixed width, clamped to at least
 * TEXT_MIN_WIDTH_WORLD. False for stale ids and non-finite widths.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const m = getTextMap(doc, id);
  if (!m) return false;
  if (!isFiniteNumber(width)) return false;
  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  if (m.get('widthMode') === 'fixed' && m.get('width') === clamped) return false;

  doc.transact(() => {
    m.set('widthMode', 'fixed');
    m.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/** Stores the measured box. False for stale ids, non-finite or equal values. */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  const m = getTextMap(doc, id);
  if (!m) return false;
  if (!box || !isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  if (m.get('width') === box.width && m.get('height') === box.height) return false;

  doc.transact(() => {
    m.set('width', box.width);
    m.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The `Y.Text` holding the text, for collaborative editing. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getTextMap(doc, id);
  if (!m) return undefined;
  const text = m.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the object holds zero characters (whitespace counts as content). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  if (!ytext) return false;
  return ytext.toString().length === 0;
}

/**
 * Removes the object when it holds no characters, so ending an edit that typed
 * nothing never leaves an invisible object on the board. Returns true when the
 * object was deleted.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
