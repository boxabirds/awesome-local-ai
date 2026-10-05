/**
 * Image object model (story 12).
 *
 * Schema addition:
 *   objects/<id>: Y.Map {
 *     type: 'image', x, y, width, height, z, createdAt,
 *     assetKey: string | null,
 *     contentType: string,
 *     naturalWidth: number,
 *     naturalHeight: number,
 *     status: 'uploading' | 'ready' | 'failed',
 *     uploadStartedAt: number,
 *     uploaderId: string
 *   }
 */
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import type { Point, Rect, Size } from '../geometry';

/**
 * Transaction origin for upload status updates.
 * Not tracked by the UndoManager, so upload completion is not its own undo step.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

export interface ImageSnap {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
  text: string;
}

/**
 * Compute the placement size for an image.
 *
 * Natural pixel dimensions in board units, scaled down proportionally so that
 * the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD. Never upscales.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): Size {
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= 0 || !Number.isFinite(longest)) return { width: 0, height: 0 };
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

/**
 * Lay out images in a row left to right.
 *
 * - `top-left` anchor: the first image's top-left corner starts at `start`.
 * - `centre` anchor: the whole row is centred on `start`.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  // Total width of the row
  let totalWidth = 0;
  for (let i = 0; i < sizes.length; i++) {
    totalWidth += sizes[i]!.width;
    if (i < sizes.length - 1) totalWidth += IMAGE_LAYOUT_GAP_WORLD;
  }

  // Starting x and y positions
  let x: number;
  let y: number;
  if (anchor === 'top-left') {
    x = start.x;
    y = start.y;
  } else {
    // centre: the row's bounding box is centred on start
    x = start.x - totalWidth / 2;
    // Vertical: centre based on the tallest image in the row
    let maxH = 0;
    for (const s of sizes) { if (s.height > maxH) maxH = s.height; }
    y = start.y - maxH / 2;
  }

  const rects: Rect[] = [];
  for (const size of sizes) {
    rects.push({ x, y, width: size.width, height: size.height });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const m of objects.values()) {
    const z = m.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export interface CreateImageItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Create image placeholder objects in the document.
 *
 * All placeholders are created in one LOCAL_ORIGIN transaction (one undo step).
 * Items with non-finite rect dimensions are skipped.
 * Returns the ids of the created placeholders.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly CreateImageItem[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (item) =>
      finite(item.rect.width) &&
      finite(item.rect.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0,
  );
  if (valid.length === 0) return [];

  const ids: string[] = [];
  doc.transact(() => {
    const objects = objectsMap(doc);
    let z = maxZ(objects);
    for (const item of valid) {
      const id = crypto.randomUUID();
      ids.push(id);
      const obj = new Y.Map<unknown>();
      obj.set('type', 'image');
      obj.set('x', item.rect.x);
      obj.set('y', item.rect.y);
      obj.set('width', item.rect.width);
      obj.set('height', item.rect.height);
      obj.set('z', ++z);
      obj.set('createdAt', now);
      obj.set('assetKey', null);
      obj.set('contentType', item.contentType);
      obj.set('naturalWidth', item.naturalWidth);
      obj.set('naturalHeight', item.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      objects.set(id, obj);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * Mark an image as ready after successful upload.
 * Returns false if the id is not found (deleted or stale).
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'image') return false;
  doc.transact(() => {
    obj.set('status', 'ready');
    obj.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as failed.
 * Returns false if the id is not found.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'image') return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as retrying (back to uploading with a new timestamp).
 * Returns false if the id is not found.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'image') return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Derive the display status from an image snapshot and the current time.
 *
 * An 'uploading' image that has been uploading for more than IMAGE_UPLOAD_STALE_MS
 * becomes 'unfinished'.
 */
export function displayStatus(img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (img.status === 'uploading') {
    if (now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
      return 'unfinished';
    }
  }
  return img.status;
}

/**
 * Read an image object's data into an ImageSnap. Returns null if the object
 * is not an image or has invalid data.
 */
export function readImageSnap(id: string, m: Y.Map<unknown>): ImageSnap | null {
  const type = m.get('type');
  if (type !== 'image') return null;
  const x = m.get('x');
  const y = m.get('y');
  const width = m.get('width');
  const height = m.get('height');
  if (!finite(x as number) || !finite(y as number) || !finite(width as number) || !finite(height as number)) {
    return null;
  }
  const status = m.get('status') as ImageStatus;
  if (status !== 'uploading' && status !== 'ready' && status !== 'failed') return null;
  return {
    id,
    type: 'image',
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
    z: (m.get('z') as number) ?? 0,
    createdAt: (m.get('createdAt') as number) ?? 0,
    assetKey: (m.get('assetKey') as string | null) ?? null,
    contentType: (m.get('contentType') as string) ?? '',
    naturalWidth: (m.get('naturalWidth') as number) ?? 0,
    naturalHeight: (m.get('naturalHeight') as number) ?? 0,
    status,
    uploadStartedAt: (m.get('uploadStartedAt') as number) ?? 0,
    uploaderId: (m.get('uploaderId') as string) ?? '',
    text: '',
  };
}
