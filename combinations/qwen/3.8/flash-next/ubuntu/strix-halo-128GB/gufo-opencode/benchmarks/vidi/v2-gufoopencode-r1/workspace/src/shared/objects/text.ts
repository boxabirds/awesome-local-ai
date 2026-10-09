import * as Y from 'yjs';
import { deleteObjects, LOCAL_ORIGIN } from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize
} from '../config';
import type { Point } from '../geometry';
import type { ObjectSnapshot } from '../board-model';

// Story 9: free text objects. See spec story 009 "Text object model".
// Text uses story 7's generic moveObjects/deleteObjects/selection; nothing
// text-specific lives there.

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function textEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (entry === undefined || entry.get('type') !== 'text') return undefined;
  return entry;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const value of doc.getMap('objects').values()) {
    const z = (value as Y.Map<unknown>).get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

// Initial box is a one-line estimate; the first local remeasure (typing or a
// size change) replaces it with the measured layout.
function initialBox(): { width: number; height: number } {
  return {
    width: TEXT_MIN_WIDTH_WORLD,
    height: TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT
  };
}

export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;
  const id = newId();
  const box = initialBox();
  const objects = doc.getMap('objects');
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', 'text');
    entry.set('x', at.x);
    entry.set('y', at.y);
    entry.set('width', box.width);
    entry.set('height', box.height);
    entry.set('z', maxZ(doc) + 1);
    entry.set('createdAt', Date.now());
    entry.set('createdBy', createdBy);
    entry.set('size', DEFAULT_TEXT_SIZE);
    entry.set('widthMode', 'auto');
    entry.set('text', new Y.Text(''));
    objects.set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const entry = textEntry(doc, id);
  if (entry === undefined || entry.get('size') === size) return false;
  doc.transact(() => {
    entry.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const entry = textEntry(doc, id);
  if (entry === undefined) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  if (entry.get('width') === clamped && entry.get('widthMode') === 'fixed') return false;
  doc.transact(() => {
    entry.set('width', clamped);
    entry.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  const entry = textEntry(doc, id);
  if (entry === undefined) return false;
  doc.transact(() => {
    entry.set('width', box.width);
    entry.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = textEntry(doc, id);
  if (entry === undefined) return undefined;
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

// Empty means zero characters on purpose: whitespace-only text is kept
// (design text.model, TC-04).
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  if (text === undefined) return false;
  return text.toString().length === 0;
}

export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
