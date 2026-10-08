import * as Y from 'yjs';
import {
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
} from '../config';
import type { TextSize } from '../config';
import { LOCAL_ORIGIN } from '../board-model';

/** Minimal snapshot interface for text objects. */
export interface TextSnapshot extends Record<string, any> {
  id: string;
  type: 'text';
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

type ObjectsMap = Y.Map<Y.Map<any>>;

function getObjects(doc: Y.Doc): ObjectsMap {
  return doc.getMap('objects') as ObjectsMap;
}

/**
 * Get the max z among all objects in the document.
 */
function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((v) => {
    const z = v.get('z');
    if (typeof z === 'number' && z > maxZ) {
      maxZ = z;
    }
  });
  return maxZ;
}

/** Create a new text object at the given world point. Returns id or null if point is invalid. */
export function createText(
  doc: Y.Doc,
  at: { x: number; y: number },
  createdBy: string,
): string | null {
  // Reject non-finite coordinates
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
    return null;
  }

  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;

  doc.transact(() => {
    const objects = getObjects(doc);
    const textMap = new Y.Map();
    textMap.set('type', 'text');
    textMap.set('x', at.x);
    textMap.set('y', at.y);
    textMap.set('width', TEXT_MAX_AUTO_WIDTH_WORLD);
    textMap.set('height', TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    textMap.set('z', z);
    textMap.set('createdAt', Date.now());
    textMap.set('createdBy', createdBy);
    textMap.set('text', new Y.Text());
    textMap.set('size', DEFAULT_TEXT_SIZE);
    textMap.set('widthMode', 'auto');
    objects.set(id, textMap);
  }, LOCAL_ORIGIN);

  return id;
}

/** Set the text size preset. Returns true if changed. */
export function setTextSize(
  doc: Y.Doc,
  id: string,
  size: string,
): boolean {
  // Validate size key
  if (!(size in TEXT_SIZES)) {
    return false;
  }

  const objects = getObjects(doc);
  const textMap = objects.get(id);
  if (!textMap) {
    return false;
  }

  const currentSize = textMap.get('size') as TextSize;
  if (currentSize === size) {
    return false;
  }

  doc.transact(() => {
    textMap.set('size', size);
  }, LOCAL_ORIGIN);

  return true;
}

/** Set fixed width mode. Clamps to TEXT_MIN_WIDTH_WORLD. Returns true if changed. */
export function setTextWidthFixed(
  doc: Y.Doc,
  id: string,
  width: number,
): boolean {
  if (!Number.isFinite(width)) {
    return false;
  }

  const objects = getObjects(doc);
  const textMap = objects.get(id);
  if (!textMap) {
    return false;
  }

  const clampedWidth = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  const currentWidth = textMap.get('width') as number;
  const currentWidthMode = textMap.get('widthMode') as string | undefined;

  if (currentWidthMode === 'fixed' && currentWidth === clampedWidth) {
    return false;
  }

  doc.transact(() => {
    textMap.set('width', clampedWidth);
    textMap.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);

  return true;
}

/** Set the stored box dimensions. Returns true if changed. */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) {
    return false;
  }

  const objects = getObjects(doc);
  const textMap = objects.get(id);
  if (!textMap) {
    return false;
  }

  const currentW = textMap.get('width') as number;
  const currentH = textMap.get('height') as number;

  if (currentW === box.width && currentH === box.height) {
    return false;
  }

  doc.transact(() => {
    textMap.set('width', box.width);
    textMap.set('height', box.height);
  }, LOCAL_ORIGIN);

  return true;
}

/** Get the Y.Text content for a text object. */
export function getTextContent(
  doc: Y.Doc,
  id: string,
): Y.Text | undefined {
  const objects = getObjects(doc);
  const textMap = objects.get(id);
  if (!textMap) {
    return undefined;
  }
  const textVal = textMap.get('text');
  return textVal instanceof Y.Text ? textVal : undefined;
}

/** Check if the text object has zero characters. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  return !ytext || ytext.length === 0;
}

/** Delete the text object if empty. Returns true if deleted. */
export function deleteIfEmpty(
  doc: Y.Doc,
  id: string,
): boolean {
  if (!isEmptyText(doc, id)) {
    return false;
  }
  // Delete this object via a transaction with LOCAL_ORIGIN
  try {
    const objects = getObjects(doc);
    if (!objects.has(id)) return false;
    doc.transact(() => {
      objects.delete(id);
    }, LOCAL_ORIGIN);
    return true;
  } catch {
    return false;
  }
}
