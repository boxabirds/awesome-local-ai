import * as Y from 'yjs';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '@shared/config';
import { LOCAL_ORIGIN, _registerTypeForModel } from '@shared/board-model';
import type { Rect, Point } from '@shared/geometry';

export interface Size {
  width: number;
  height: number;
}

_registerTypeForModel('image');

export const UPLOAD_ORIGIN: unique symbol = Symbol('upload');

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
  createdBy: string;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

/**
 * Scale natural pixel dimensions down so longest side <= IMAGE_MAX_PLACE_SIZE_WORLD.
 * Never upscales.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

/**
 * Place images left to right separated by IMAGE_LAYOUT_GAP_WORLD.
 * 'top-left': first image's top-left corner at `start`.
 * 'centre': the whole row centred on `start`.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  const rects: Rect[] = [];
  let x = start.x;

  // Calculate total row width for centre anchoring
  if (anchor === 'centre') {
    let totalWidth = 0;
    for (let i = 0; i < sizes.length; i++) {
      totalWidth += sizes[i].width;
      if (i < sizes.length - 1) totalWidth += IMAGE_LAYOUT_GAP_WORLD;
    }
    x = start.x - totalWidth / 2;
  }

  const y = anchor === 'centre' ? start.y - sizes[0].height / 2 : start.y;

  for (const size of sizes) {
    rects.push({ x, y, width: size.width, height: size.height });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }

  return rects;
}

/**
 * Create image placeholder objects in one LOCAL_ORIGIN transaction (one undo step).
 * Returns array of created ids. Skips items with non-finite sizes.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  const ids: string[] = [];
  const validItems: Array<{ rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }> = [];

  for (const item of items) {
    if (
      !Number.isFinite(item.rect.x) ||
      !Number.isFinite(item.rect.y) ||
      !Number.isFinite(item.rect.width) ||
      !Number.isFinite(item.rect.height)
    ) {
      continue;
    }
    validItems.push(item);
  }

  if (validItems.length === 0) return [];

  doc.transact(() => {
    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i];
      const id = crypto.randomUUID();
      const obj = new Y.Map<unknown>();
      obj.set('type', 'image');
      obj.set('x', item.rect.x);
      obj.set('y', item.rect.y);
      obj.set('width', item.rect.width);
      obj.set('height', item.rect.height);
      obj.set('z', maxZ + i + 1);
      obj.set('createdAt', now);
      obj.set('createdBy', uploaderId);
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
 * Mark an image as ready with its asset key. Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 * Returns false for stale id.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'image') return false;

  doc.transact(() => {
    obj.set('status', 'ready');
    obj.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as failed. Uses UPLOAD_ORIGIN.
 * Returns false for stale id.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'image') return false;

  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as retrying (back to uploading with new timestamp). Uses UPLOAD_ORIGIN.
 * Returns false for stale id.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'image') return false;

  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
    obj.set('assetKey', null);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Derive the display status. Returns 'unfinished' if uploading for more than IMAGE_UPLOAD_STALE_MS.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt >= IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
