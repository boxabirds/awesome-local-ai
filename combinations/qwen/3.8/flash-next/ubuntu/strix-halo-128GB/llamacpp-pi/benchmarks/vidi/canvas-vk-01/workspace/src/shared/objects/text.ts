import * as Y from 'yjs';
import { LOCAL_ORIGIN, deleteObjects, type ObjectSnapshot } from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_WIDTH_PADDING_WORLD,
  type TextSize,
} from '../config';

/**
 * Text object model (story 9). Plain text placed anywhere on the board: no
 * background, four size presets, auto width (grows, then wraps at
 * TEXT_MAX_AUTO_WIDTH_WORLD) or a fixed width set by dragging a side handle.
 * Selection, move, delete and undo come from the generic story 7/8 code —
 * nothing text-specific lives there.
 *
 * Schema (Y.Map in `objects`): type, x, y, width, height, z, createdAt,
 * createdBy, text (Y.Text — content, never sized data), size, widthMode.
 * The stored box always exists (width/height set at creation from the
 * estimate) so selection bounds work before the first measurement.
 */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  x: number;
  y: number;
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

/** World-space point (structurally identical to board-model's internal Point). */
interface Point {
  x: number;
  y: number;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** The Y.Map for `id` when it is a text object; null for anything else. */
function getTextMap(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const obj = getObjects(doc).get(id);
  if (!obj || obj.get('type') !== 'text') {
    return null;
  }
  return obj;
}

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);
}

/**
 * Width estimate by character count — the documented fallback when no
 * measurer (canvas) is available. Never accurate, only proportional; the
 * client measures for real as soon as it can.
 */
export function estimateTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_ESTIMATED_GLYPH_RATIO;
}

/**
 * Create an empty text object at `at`, on top of everything. Returns the new
 * id, or null when the point is not usable (non-finite — no transaction).
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
    return null;
  }
  const objects = getObjects(doc);
  const id = crypto.randomUUID();
  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((obj) => {
      const z = obj.get('z');
      if (typeof z === 'number' && z > maxZ) {
        maxZ = z;
      }
    });
    const fontPx = TEXT_SIZES[DEFAULT_TEXT_SIZE];
    // Initial box from the estimate of the empty string; the client remeasures
    // with a real measurer as soon as editing starts.
    const width = estimateTextWidth('', fontPx) + TEXT_WIDTH_PADDING_WORLD;
    const height = fontPx * TEXT_LINE_HEIGHT;
    const map = new Y.Map<unknown>();
    map.set('type', 'text');
    map.set('x', at.x);
    map.set('y', at.y);
    map.set('width', width);
    map.set('height', height);
    map.set('z', maxZ + 1);
    map.set('createdAt', Date.now());
    map.set('createdBy', createdBy);
    map.set('text', new Y.Text(''));
    map.set('size', DEFAULT_TEXT_SIZE);
    map.set('widthMode', 'auto');
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Set one of the four size presets (a client-side re-layout follows).
 * Unknown sizes are rejected — no transaction at all.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const map = getTextMap(doc, id);
  if (map === null || !isTextSize(size)) {
    return false;
  }
  if (map.get('size') === size) {
    return true;
  }
  doc.transact(() => {
    map.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Pin the box to a dragged width: stores the width (clamped up to
 * TEXT_MIN_WIDTH_WORLD) and switches widthMode to 'fixed' — from then on the
 * box never grows with typing, lines wrap at this width instead.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const map = getTextMap(doc, id);
  if (map === null || !Number.isFinite(width)) {
    return false;
  }
  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  doc.transact(() => {
    if (map.get('width') !== clamped) {
      map.set('width', clamped);
    }
    if (map.get('widthMode') !== 'fixed') {
      map.set('widthMode', 'fixed');
    }
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Store a measured box. Called by the client after any local change that
 * alters layout (text, size, width mode) — never for a remote peer's change.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  const map = getTextMap(doc, id);
  if (
    map === null ||
    !Number.isFinite(box.width) ||
    !Number.isFinite(box.height)
  ) {
    return false;
  }
  doc.transact(() => {
    if (map.get('width') !== box.width) {
      map.set('width', box.width);
    }
    if (map.get('height') !== box.height) {
      map.set('height', box.height);
    }
  }, LOCAL_ORIGIN);
  return true;
}

/** The object's shared Y.Text, or undefined when it is not a text object. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = getTextMap(doc, id);
  if (map === null) {
    return undefined;
  }
  const text = map.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** True when the object exists and holds zero characters (blank is content). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  return ytext !== undefined && ytext.length === 0;
}

/**
 * Remove the object when its text is empty — one deletion operation, so it
 * joins the keystrokes before it in the same undo item. A text that still has
 * content (even a blank character) is kept.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) {
    return false;
  }
  return deleteObjects(doc, [id]) === 1;
}
