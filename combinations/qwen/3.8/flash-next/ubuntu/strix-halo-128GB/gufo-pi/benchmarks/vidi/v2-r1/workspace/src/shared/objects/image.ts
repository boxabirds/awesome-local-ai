/**
 * Image object model: placement, row layout, placeholders, status updates (story 12).
 */

import * as Y from 'yjs';

import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { LOCAL_ORIGIN } from '../board-model';

// Access the objects map directly (same pattern as board-model's private objectsOf)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getObjectsMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects');
}

// ---- Types ----

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

export interface ImageSnap {
  id: string;
  type: 'image';
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---- Origin symbol for undo tracking ----

/**
 * UPLOAD_ORIGIN: used for status updates (markImageReady, etc.) so they are
 * not tracked by the UndoManager. Defined as a symbol; board-model's UndoManager
 * only tracks LOCAL_ORIGIN, not this symbol.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('UPLOAD_ORIGIN');

// ---- Placement & layout ----

/**
 * Compute placement size for an image. Scales down so longest side <= IMAGE_MAX_PLACE_SIZE_WORLD.
 * Never upscales.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: IMAGE_MIN_SIZE_WORLD, height: IMAGE_MIN_SIZE_WORLD };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  let width: number, height: number;
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) {
    width = naturalWidth;
    height = naturalHeight;
  } else {
    const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
    width = Math.round(naturalWidth * scale);
    height = Math.round(naturalHeight * scale);
  }
  // Enforce minimum size
  if (width < IMAGE_MIN_SIZE_WORLD || height < IMAGE_MIN_SIZE_WORLD) {
    const minScale = IMAGE_MIN_SIZE_WORLD / Math.min(width, height);
    width = Math.max(IMAGE_MIN_SIZE_WORLD, Math.round(width * minScale));
    height = Math.max(IMAGE_MIN_SIZE_WORLD, Math.round(height * minScale));
  }
  return { width, height };
}

/**
 * Lay out images left-to-right in a row separated by IMAGE_LAYOUT_GAP_WORLD.
 * anchor 'top-left': first image's top-left corner at start point.
 * anchor 'centre': entire row centred on start point.
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  if (sizes.length === 0) return [];

  // Calculate total width
  let totalWidth = 0;
  for (let i = 0; i < sizes.length; i++) {
    totalWidth += sizes[i]!.width;
    if (i < sizes.length - 1) totalWidth += IMAGE_LAYOUT_GAP_WORLD;
  }

  // Determine starting x
  let x: number;
  let y: number;
  if (anchor === 'top-left') {
    x = start.x;
    y = start.y;
  } else {
    // centre: the row is centred on the start point
    x = start.x - totalWidth / 2;
    // Vertically, centre the tallest image on the point
    const maxH = Math.max(...sizes.map((s) => s.height));
    y = start.y - maxH / 2;
  }

  const rects: Rect[] = [];
  for (const s of sizes) {
    rects.push({ x, y, width: s.width, height: s.height });
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

// ---- Model operations ----

/**
 * Create image placeholder objects in the document.
 * All items are created in one LOCAL_ORIGIN transaction (one undo step).
 * Skips items with non-finite sizes.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const objects = getObjectsMap(doc);
  const ids: string[] = [];

  // We use a transaction so all items go in as one undo step.
  // Uses LOCAL_ORIGIN so the UndoManager tracks it.
  doc.transact(() => {
    for (const item of items) {
      if (!Number.isFinite(item.rect.width) || !Number.isFinite(item.rect.height) ||
          !Number.isFinite(item.rect.x) || !Number.isFinite(item.rect.y)) {
        continue;
      }
      const id = crypto.randomUUID();
      const entry = new Y.Map();
      entry.set('type', 'image');
      entry.set('x', item.rect.x);
      entry.set('y', item.rect.y);
      entry.set('z', now + ids.length);
      entry.set('width', item.rect.width);
      entry.set('height', item.rect.height);
      entry.set('assetKey', null);
      entry.set('contentType', item.contentType);
      entry.set('naturalWidth', item.naturalWidth);
      entry.set('naturalHeight', item.naturalHeight);
      entry.set('status', 'uploading' as ImageStatus);
      entry.set('uploadStartedAt', now);
      entry.set('uploaderId', uploaderId);
      objects.set(id, entry);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/**
 * Mark an image as ready with its asset key.
 * Returns false if the id no longer exists.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const objects = getObjectsMap(doc);
  const entry = objects.get(id);
  if (!entry) return false;

  // Use UPLOAD_ORIGIN metadata so this is not an undo step
  doc.transact(() => {
    const e = objects.get(id);
    if (!e) return;
    e.set('status', 'ready');
    e.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);

  return true;
}

/**
 * Mark an image as failed.
 * Returns false if the id no longer exists.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const objects = getObjectsMap(doc);
  const entry = objects.get(id);
  if (!entry) return false;

  doc.transact(() => {
    const e = objects.get(id);
    if (!e) return;
    e.set('status', 'failed');
  }, UPLOAD_ORIGIN);

  return true;
}

/**
 * Mark an image as retrying (back to uploading status with new uploadStartedAt).
 * Returns false if the id no longer exists.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const objects = getObjectsMap(doc);
  const entry = objects.get(id);
  if (!entry) return false;

  doc.transact(() => {
    const e = objects.get(id);
    if (!e) return;
    e.set('status', 'uploading');
    e.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);

  return true;
}

/**
 * Determine the display status for an image snapshot.
 * 'uploading' older than IMAGE_UPLOAD_STALE_MS → 'unfinished'.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading') {
    const elapsed = now - img.uploadStartedAt;
    if (elapsed >= IMAGE_UPLOAD_STALE_MS) {
      return 'unfinished';
    }
    return 'uploading';
  }
  return img.status;
}

/**
 * Read an ImageSnap from the Y.Doc for a given id.
 */
export function getImageSnapshot(doc: Y.Doc, id: string): ImageSnap | null {
  const objects = getObjectsMap(doc);
  const entry = objects.get(id);
  if (!entry) return null;
  return imageFromEntry(id, entry);
}

function imageFromEntry(id: string, entry: Y.Map<unknown>): ImageSnap {
  return {
    id,
    type: 'image',
    x: entry.get('x') as number,
    y: entry.get('y') as number,
    z: entry.get('z') as number,
    width: entry.get('width') as number,
    height: entry.get('height') as number,
    assetKey: (entry.get('assetKey') as string | null) ?? null,
    contentType: (entry.get('contentType') as string) ?? '',
    naturalWidth: (entry.get('naturalWidth') as number) ?? 0,
    naturalHeight: (entry.get('naturalHeight') as number) ?? 0,
    status: (entry.get('status') as ImageStatus) ?? 'uploading',
    uploadStartedAt: (entry.get('uploadStartedAt') as number) ?? 0,
    uploaderId: (entry.get('uploaderId') as string) ?? '',
  };
}
