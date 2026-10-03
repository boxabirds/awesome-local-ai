// Image object model: schema, placement, row layout, placeholders, status updates.
// Story 12.

import * as Y from 'yjs';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { LOCAL_ORIGIN, getObjects, getMaxZ } from '../board-model';
import type { Point, Rect } from '../geometry';
import type { Camera } from '../../client/canvas/camera';

/** Origin for upload status updates (NOT tracked by the UndoManager). */
export const UPLOAD_ORIGIN: unique symbol = Symbol('UPLOAD_ORIGIN');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

/** A read-only snapshot of an image object. */
export interface ImageSnap {
  id: string;
  type: 'image';
  x: number;
  y: number;
  z: number;
  createdAt: number;
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

/**
 * Compute the placement size for an image given its natural dimensions.
 * Scales down so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
 * Never upscales.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Layout a row of images left to right.
 * - 'top-left': the first image's top-left corner is at `start`.
 * - 'centre': the entire row is centred on `start`.
 * Images are separated by IMAGE_LAYOUT_GAP_WORLD.
 */
export function layoutRow(
  sizes: readonly { width: number; height: number }[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  // Compute total row width
  const totalWidth = sizes.reduce((sum, s) => sum + s.width, 0) +
    IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);

  let cursorX: number;
  let startY: number;
  if (anchor === 'top-left') {
    cursorX = start.x;
    startY = start.y;
  } else {
    // Centre the row on start (both axes)
    const maxHeight = Math.max(...sizes.map((s) => s.height));
    cursorX = start.x - totalWidth / 2;
    startY = start.y - maxHeight / 2;
  }

  const result: Rect[] = [];
  for (const s of sizes) {
    result.push({ x: cursorX, y: startY, width: s.width, height: s.height });
    cursorX += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return result;
}

/**
 * Create image placeholder objects in the doc.
 * One LOCAL_ORIGIN transaction for all items (single undo step).
 * Returns the array of created object ids.
 * Items with non-finite sizes are skipped.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (it) =>
      Number.isFinite(it.rect.x) && Number.isFinite(it.rect.y) &&
      Number.isFinite(it.rect.width) && Number.isFinite(it.rect.height) &&
      Number.isFinite(it.naturalWidth) && Number.isFinite(it.naturalHeight),
  );
  if (valid.length === 0) return [];

  const ids: string[] = [];
  doc.transact(() => {
    const objects = getObjects(doc);
    let z = getMaxZ(doc);
    for (const item of valid) {
      const id = crypto.randomUUID();
      const obj = new Y.Map();
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
      ids.push(id);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/**
 * Mark an image as ready (upload complete). Sets the assetKey.
 * Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 * Returns false if the id is stale.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as failed.
 * Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 * Returns false if the id is stale.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as retrying (back to uploading with a new timestamp).
 * Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 * Returns false if the id is stale.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Derive the display status from the stored status and elapsed time.
 * 'uploading' older than IMAGE_UPLOAD_STALE_MS → 'unfinished'.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}

/**
 * Read an image object's snapshot from the doc, or undefined if stale/malformed.
 */
export function readImageSnap(doc: Y.Doc, id: string): ImageSnap | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  const type = obj.get('type');
  if (type !== 'image') return undefined;
  return {
    id,
    type: 'image',
    x: obj.get('x') as number,
    y: obj.get('y') as number,
    z: obj.get('z') as number,
    createdAt: obj.get('createdAt') as number,
    width: obj.get('width') as number,
    height: obj.get('height') as number,
    assetKey: (obj.get('assetKey') as string | null) ?? null,
    contentType: obj.get('contentType') as string,
    naturalWidth: obj.get('naturalWidth') as number,
    naturalHeight: obj.get('naturalHeight') as number,
    status: obj.get('status') as ImageStatus,
    uploadStartedAt: obj.get('uploadStartedAt') as number,
    uploaderId: obj.get('uploaderId') as string,
  };
}
