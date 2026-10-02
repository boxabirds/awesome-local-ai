/**
 * Text object model (story 9): plain text placed anywhere on the board.
 *
 * Schema (one entry of the board document's `objects` map):
 *   { type: 'text', x, y, width, height, z, createdAt, createdBy,
 *     text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed' }
 *
 * `width`/`height` are stored so every client can draw selection bounds without
 * measuring; the client that made the local change measures and writes them
 * (see `src/client/objects/useTextBoxSync.ts`). Height always follows the
 * content, so there is no height setter (`setTextBox` writes both).
 *
 * Selection, moving, nudging, deleting and undo come from the generic object
 * operations in `board-model`; nothing text-specific is added to those.
 */
import * as Y from 'yjs';
import {
  deleteObjects,
  getObjectsMap,
  isTextSize,
  LOCAL_ORIGIN,
  nextZ,
} from '../board-model';
import type { BaseObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';
import type { TextSize } from '../config';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../config';

export type TextWidthMode = 'auto' | 'fixed';

export interface TextSnapshot extends BaseObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: TextWidthMode;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getTextMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const m = getObjectsMap(doc).get(id);
  if (!m || m.get('type') !== 'text') return undefined;
  return m;
}

/**
 * Creates a text object whose **top-left** is `at` (unlike a sticky note, which
 * is centred). Size M, automatic width, empty text, stacked above every other
 * object. Returns the new id, or null for a non-finite point (no transaction).
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;

  const objects = getObjectsMap(doc);
  const id = crypto.randomUUID();
  const z = nextZ(objects);
  const now = Date.now();

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'text');
    m.set('x', at.x);
    m.set('y', at.y);
    // A box exists before the first measurement so selection bounds and the
    // marquee have something to work with.
    m.set('width', TEXT_MIN_WIDTH_WORLD);
    m.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    m.set('text', new Y.Text());
    m.set('size', DEFAULT_TEXT_SIZE);
    m.set('widthMode', 'auto' satisfies TextWidthMode);
    m.set('z', z);
    m.set('createdAt', now);
    m.set('createdBy', typeof createdBy === 'string' ? createdBy : '');
    objects.set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

/** Applies one of the four size presets. False for unknown sizes and stale ids. */
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
 * Sets a fixed width (never smaller than TEXT_MIN_WIDTH_WORLD) and switches the
 * object to fixed width mode. False for stale ids and non-finite widths.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const m = getTextMap(doc, id);
  if (!m) return false;
  if (!isFiniteNumber(width)) return false;
  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  if (m.get('widthMode') === 'fixed' && m.get('width') === clamped) return false;

  doc.transact(() => {
    m.set('width', clamped);
    m.set('widthMode', 'fixed' satisfies TextWidthMode);
  }, LOCAL_ORIGIN);
  return true;
}

/** Stores the measured box. False when unchanged, stale or non-finite. */
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

/** The `Y.Text` of a text object, for collaborative editing. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getTextMap(doc, id);
  if (!m) return undefined;
  const text = m.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the object holds zero characters (whitespace counts as content). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  return ytext !== undefined && ytext.toString().length === 0;
}

/**
 * Removes the object when its editing ended with no characters, so an abandoned
 * text never lingers as an invisible object. False when it has content.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
