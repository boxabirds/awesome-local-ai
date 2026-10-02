/**
 * Text object model (story 9): schema helpers for creating and mutating
 * free text objects on the board.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import type { Point } from '../geometry';
import {
  TEXT_SIZES,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
} from '../config';
import type { TextSize } from '../config';
import { getObjectsMap } from '../board-model';

export interface TextSnapshot {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy: string;
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

function isFinitePoint(p: unknown): p is Point {
  if (!p || typeof p !== 'object') return false;
  const obj = p as Record<string, unknown>;
  return typeof obj.x === 'number' && Number.isFinite(obj.x) &&
         typeof obj.y === 'number' && Number.isFinite(obj.y);
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
 * Creates a text object at the given world point (top-left).
 * Returns the new id, or null when the point is invalid.
 */
export function createText(
  doc: Y.Doc,
  at: Point,
  createdBy: string,
): string | null {
  if (!isFinitePoint(at)) return null;

  const objects = getObjectsMap(doc);
  const id = crypto.randomUUID();
  const z = maxZ(objects) + 1;
  const sizePx = TEXT_SIZES[DEFAULT_TEXT_SIZE];
  const initialHeight = Math.round(sizePx * TEXT_LINE_HEIGHT);

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'text');
    m.set('x', at.x);
    m.set('y', at.y);
    m.set('width', TEXT_MIN_WIDTH_WORLD);
    m.set('height', initialHeight);
    m.set('z', z);
    m.set('createdAt', Date.now());
    m.set('createdBy', createdBy);
    m.set('text', new Y.Text());
    m.set('size', DEFAULT_TEXT_SIZE);
    m.set('widthMode', 'auto');
    objects.set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

function getTextMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const m = getObjectsMap(doc).get(id);
  if (!m || m.get('type') !== 'text') return undefined;
  return m;
}

/**
 * Sets the text size preset. Returns false for unknown size keys or stale ids.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const m = getTextMap(doc, id);
  if (!m) return false;
  if (!Object.prototype.hasOwnProperty.call(TEXT_SIZES, size)) return false;
  if (m.get('size') === size) return false;

  doc.transact(() => {
    m.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets a fixed width, clamped to TEXT_MIN_WIDTH_WORLD.
 * Returns false for stale ids or non-finite width.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const m = getTextMap(doc, id);
  if (!m) return false;
  if (typeof width !== 'number' || !Number.isFinite(width)) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);

  doc.transact(() => {
    m.set('widthMode', 'fixed');
    m.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets the stored width and height of a text object.
 * Returns false for stale ids or non-finite values.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  const m = getTextMap(doc, id);
  if (!m) return false;
  if (typeof box.width !== 'number' || !Number.isFinite(box.width)) return false;
  if (typeof box.height !== 'number' || !Number.isFinite(box.height)) return false;

  const curW = m.get('width');
  const curH = m.get('height');
  if (curW === box.width && curH === box.height) return false;

  doc.transact(() => {
    m.set('width', box.width);
    m.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** Returns the Y.Text instance for a text object. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getTextMap(doc, id);
  if (!m) return undefined;
  const text = m.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text object contains zero characters. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  if (!ytext) return true;
  return ytext.toString().length === 0;
}

/**
 * Deletes the text object if it contains zero characters.
 * Returns true if deleted, false otherwise.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  const objects = getObjectsMap(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** Read a TextSnapshot from a Y.Map. Returns null for unknown types or invalid data. */
export function readText(id: string, m: Y.Map<unknown>): TextSnapshot | null {
  if (m.get('type') !== 'text') return null;
  const x = m.get('x');
  const y = m.get('y');
  const z = m.get('z');
  const width = m.get('width');
  const height = m.get('height');
  const createdAt = m.get('createdAt');
  const createdBy = m.get('createdBy');
  const text = m.get('text');
  const size = m.get('size');
  const widthMode = m.get('widthMode');

  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  if (typeof z !== 'number') return null;

  const validSize: TextSize = (typeof size === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, size))
    ? size as TextSize
    : DEFAULT_TEXT_SIZE;

  return {
    id,
    type: 'text',
    x,
    y,
    width: typeof width === 'number' && Number.isFinite(width) ? width : TEXT_MIN_WIDTH_WORLD,
    height: typeof height === 'number' && Number.isFinite(height) ? height : 0,
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    text: text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : '',
    size: validSize,
    widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
  };
}
