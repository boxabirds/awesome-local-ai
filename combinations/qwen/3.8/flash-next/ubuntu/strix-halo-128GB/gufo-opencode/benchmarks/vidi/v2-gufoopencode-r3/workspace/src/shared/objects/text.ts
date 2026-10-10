import * as Y from 'yjs';
import {
  deleteObjects,
  LOCAL_ORIGIN,
  type ObjectSnapshot
} from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize
} from '../config';
import type { Point } from '../geometry';

export interface TextSnapshot extends ObjectSnapshot {
  readonly type: 'text';
  readonly text: string;
  readonly size: TextSize;
  readonly widthMode: 'auto' | 'fixed';
}

export type TextWidthMode = 'auto' | 'fixed';

export interface TextFields {
  readonly text: string;
  readonly size: TextSize;
  readonly widthMode: TextWidthMode;
  readonly width?: number;
  readonly height?: number;
  readonly createdAt: number;
  readonly createdBy: string;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function textMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'text') return undefined;
  return obj;
}

function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.hasOwn(TEXT_SIZES, value);
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function readDimension(obj: Y.Map<unknown>, key: 'width' | 'height'): number | undefined {
  const value = obj.get(key);
  return finitePositive(value as number) ? (value as number) : undefined;
}

function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const obj of objectsMap(doc).values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

// Places a text object whose TOP-LEFT is `at` (text flows right and down from
// the clicked point). Unlike createSticky this returns null for non-finite
// coordinates instead of throwing: the Text tool feeds screen-derived values.
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'text');
    obj.set('x', at.x);
    obj.set('y', at.y);
    obj.set('size', DEFAULT_TEXT_SIZE);
    obj.set('widthMode', 'auto');
    // Estimated box so selection and hit-testing work before the first
    // local edit triggers a real measurement (useTextBoxSync).
    obj.set('width', TEXT_MIN_WIDTH_WORLD);
    obj.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', createdBy);
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const obj = textMap(doc, id);
  if (obj === undefined || !isTextSize(size)) return false;
  if (obj.get('size') === size) return false;
  doc.transact(() => obj.set('size', size), LOCAL_ORIGIN);
  return true;
}

// Fixed-width mode is entered by dragging an e/w handle; widths below the
// minimum clamp up so text always has a usable measure.
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const obj = textMap(doc, id);
  if (obj === undefined || !Number.isFinite(width)) return false;
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  if (obj.get('width') === clamped && obj.get('widthMode') === 'fixed') return false;
  doc.transact(() => {
    obj.set('width', clamped);
    obj.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number }
): boolean {
  const obj = textMap(doc, id);
  if (
    obj === undefined ||
    !finitePositive(box.width) ||
    !finitePositive(box.height)
  ) {
    return false;
  }
  if (obj.get('width') === box.width && obj.get('height') === box.height) return false;
  doc.transact(() => {
    obj.set('width', box.width);
    obj.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = textMap(doc, id);
  const text = obj?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  if (text === undefined) return false;
  return text.length === 0;
}

// Called on edit end inside the same capture window as the last keystroke so
// one undo restores the abandoned text (key decision 3).
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

export function getTextFields(doc: Y.Doc, id: string): TextFields | undefined {
  const obj = textMap(doc, id);
  if (obj === undefined) return undefined;
  const text = obj.get('text');
  const size = obj.get('size');
  const widthMode = obj.get('widthMode');
  const createdAt = obj.get('createdAt');
  const createdBy = obj.get('createdBy');
  return {
    text: text instanceof Y.Text ? text.toString() : '',
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
    width: readDimension(obj, 'width'),
    height: readDimension(obj, 'height'),
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : ''
  };
}

// Snapshot view of every text object, used by the test hooks and toolbars.
export function collectTextSnapshots(doc: Y.Doc): readonly TextSnapshot[] {
  const out: TextSnapshot[] = [];
  for (const [id, obj] of objectsMap(doc)) {
    if (obj.get('type') !== 'text') continue;
    const fields = getTextFields(doc, id);
    if (fields === undefined) continue;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    out.push({
      id,
      type: 'text',
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
      z: typeof z === 'number' ? z : 0,
      width: fields.width,
      height: fields.height,
      text: fields.text,
      size: fields.size,
      widthMode: fields.widthMode
    });
  }
  return out;
}
