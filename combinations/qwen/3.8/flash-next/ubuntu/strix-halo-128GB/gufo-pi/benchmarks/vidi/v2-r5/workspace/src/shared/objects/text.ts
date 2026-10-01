import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import { LOCAL_ORIGIN, deleteObjects, type ObjectSnapshot } from '../board-model';

/**
 * Text object model: schema helpers for creating, sizing and managing text objects.
 *
 * Schema per text object:
 *   objects/<id>: Y.Map {
 *     type: 'text', x, y, width, height, z, createdAt, createdBy,
 *     text: Y.Text,
 *     size: TextSize,
 *     widthMode: 'auto' | 'fixed'
 *   }
 */

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const TEXT_SIZE_KEYS = new Set<string>(Object.keys(TEXT_SIZES));

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

/** Largest `z` currently in use across all objects (0 for an empty board). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const value of objectsMap(doc).values()) {
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > top) top = z;
  }
  return top;
}

/**
 * Create a text object with its top-left at `at`, size M, widthMode 'auto', empty Y.Text.
 * Returns the new id, or null if `at` is not finite (no transaction).
 */
export function createText(
  doc: Y.Doc,
  at: { x: number; y: number },
  createdBy: string,
): string | null {
  if (!isFiniteNumber(at?.x) || !isFiniteNumber(at?.y)) return null;

  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  const size = DEFAULT_TEXT_SIZE;
  const fontPx = TEXT_SIZES[size];
  // Initial estimate: one empty line height, min width
  const initialWidth = TEXT_MIN_WIDTH_WORLD;
  const initialHeight = Math.round(fontPx * 1.3); // TEXT_LINE_HEIGHT

  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', 'text');
    map.set('x', at.x);
    map.set('y', at.y);
    map.set('width', initialWidth);
    map.set('height', initialHeight);
    map.set('z', z);
    map.set('createdAt', Date.now());
    map.set('createdBy', createdBy);
    map.set('text', new Y.Text(''));
    map.set('size', size);
    map.set('widthMode', 'auto');
    objectsMap(doc).set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a text object's size preset. Returns false for stale id, non-text type,
 * or unknown size key (no transaction in those cases).
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!TEXT_SIZE_KEYS.has(size)) return false;
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'text') return false;
  if (map.get('size') === size) return false;
  doc.transact(() => {
    map.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width on a text object, clamped to TEXT_MIN_WIDTH_WORLD minimum.
 * Sets widthMode to 'fixed'. Returns false for stale id or non-text type.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'text') return false;
  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  doc.transact(() => {
    map.set('width', clamped);
    map.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set the stored width and height of a text object.
 * Returns false for stale id, non-text type, or non-finite dimensions.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'text') return false;
  if (map.get('width') === box.width && map.get('height') === box.height) return false;
  doc.transact(() => {
    map.set('width', box.width);
    map.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** Get the shared Y.Text of a text object, or undefined for stale id / wrong type. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'text') return undefined;
  const text = map.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text object exists and contains zero characters. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  if (!ytext) return false;
  return ytext.toString().length === 0;
}

/**
 * Delete the text object if it contains zero characters.
 * Returns true if the object was deleted, false if it still has content or does not exist.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  deleteObjects(doc, [id]);
  return true;
}

/** Read a text snapshot from the doc for a given id. */
export function readTextSnapshot(doc: Y.Doc, id: string): TextSnapshot | undefined {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'text') return undefined;
  const text = map.get('text');
  const size = map.get('size');
  const widthMode = map.get('widthMode');
  return {
    id,
    type: 'text',
    x: typeof map.get('x') === 'number' ? (map.get('x') as number) : 0,
    y: typeof map.get('y') === 'number' ? (map.get('y') as number) : 0,
    width: typeof map.get('width') === 'number' ? (map.get('width') as number) : TEXT_MIN_WIDTH_WORLD,
    height: typeof map.get('height') === 'number' ? (map.get('height') as number) : 26,
    z: typeof map.get('z') === 'number' ? (map.get('z') as number) : 0,
    text: text instanceof Y.Text ? text.toString() : '',
    size: typeof size === 'string' && TEXT_SIZE_KEYS.has(size) ? (size as TextSize) : DEFAULT_TEXT_SIZE,
    widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
  };
}

/** Return all text object snapshots (for integration with the main snapshot function). */
export function textSnapshots(doc: Y.Doc): TextSnapshot[] {
  const result: TextSnapshot[] = [];
  for (const [id] of objectsMap(doc)) {
    const snap = readTextSnapshot(doc, id);
    if (snap) result.push(snap);
  }
  return result;
}
