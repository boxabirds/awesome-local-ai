// Text object model (story 9): schema helpers for `text` objects.
//
// A text object is a Y.Map with:
//   type: 'text', x, y (top-left, world), z, text: Y.Text,
//   size: TextSize, widthMode: 'auto' | 'fixed',
//   width, height (world units; kept by the client box-sync hook),
//   createdBy, createdAt.
//
// All mutating helpers are no-ops returning false for stale/missing ids and
// never open a transaction: the caller is responsible for the undo boundary.

import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import { getMaxZ, LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

/** A text object snapshot. */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function getObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

/**
 * Create a text object with its top-left corner at `at` (world point).
 * Size M, auto width, empty Y.Text, z above all existing objects.
 * Returns the new id, or null when the point is non-finite (no transaction).
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;
  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;
  const text = new Y.Text();
  doc.transact(() => {
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = new Y.Map();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('z', z);
    obj.set('text', text);
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    // A sane box before the first client-side measure (one M line).
    obj.set('width', TEXT_MIN_WIDTH_WORLD);
    obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * 1.3);
    obj.set('createdBy', createdBy);
    obj.set('createdAt', Date.now());
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Set the text size ('S' | 'M' | 'L' | 'XL'). false for unknown keys/stale ids. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!(size in TEXT_SIZES)) return false;
  const obj = getObj(doc, id);
  if (!obj || obj.get('type') !== 'text') return false;
  doc.transact(() => {
    obj.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set a fixed width (world units), clamped to TEXT_MIN_WIDTH_WORLD.
 * Sets widthMode to 'fixed'. Height is corrected by the box-sync hook.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number, x?: number): boolean {
  if (!isFiniteNumber(width)) return false;
  if (x !== undefined && !isFiniteNumber(x)) return false;
  const obj = getObj(doc, id);
  if (!obj || obj.get('type') !== 'text') return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    obj.set('widthMode', 'fixed');
    obj.set('width', clamped);
    if (x !== undefined) obj.set('x', x);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set the measured box (world units). Only finite positive values are
 * applied. Does not change widthMode.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  const obj = getObj(doc, id);
  if (!obj || obj.get('type') !== 'text') return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The Y.Text of a text object, or undefined for stale ids. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getObj(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the text has zero characters. Whitespace-only is NOT empty. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/** Delete a text object if its content is empty. Returns true when deleted. */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The auto-width cap (re-exported for layout code). */
export const TEXT_MAX_AUTO_WIDTH = TEXT_MAX_AUTO_WIDTH_WORLD;
