import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import type { Rect, Point } from '../geometry';

export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

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

/**
 * Computes the placement size for an image with the given natural dimensions.
 * Scales down so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD;
 * never upscales.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
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
 * Lays out a row of sizes left to right with IMAGE_LAYOUT_GAP_WORLD between them.
 * - 'top-left': the first rect's top-left corner is at `start`
 * - 'centre': the entire row is centred on `start`
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  if (sizes.length === 0) return [];

  const totalWidth = sizes.reduce((sum, s) => sum + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);

  let cursorX: number;
  if (anchor === 'top-left') {
    cursorX = start.x;
  } else {
    cursorX = start.x - totalWidth / 2;
  }

  const rects: Rect[] = [];
  for (const s of sizes) {
    rects.push({ x: cursorX, y: anchor === 'top-left' ? start.y : start.y - s.height / 2, width: s.width, height: s.height });
    cursorX += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

interface ImageItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Creates image placeholder objects in one LOCAL_ORIGIN transaction (one undo step).
 * Returns the created ids.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImageItem[],
  uploaderId: string,
  now: number
): string[] {
  const objs = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  const ids: string[] = [];

  // Compute max z
  let maxZ = 0;
  objs.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  doc.transact(() => {
    for (const item of items) {
      if (!Number.isFinite(item.rect.width) || !Number.isFinite(item.rect.height) ||
          !Number.isFinite(item.naturalWidth) || !Number.isFinite(item.naturalHeight)) {
        continue;
      }
      const id = crypto.randomUUID();
      const obj = new Y.Map() as Y.Map<unknown>;
      obj.set('type', 'image');
      obj.set('x', item.rect.x);
      obj.set('y', item.rect.y);
      obj.set('width', item.rect.width);
      obj.set('height', item.rect.height);
      obj.set('z', maxZ + 1);
      obj.set('assetKey', null);
      obj.set('contentType', item.contentType);
      obj.set('naturalWidth', item.naturalWidth);
      obj.set('naturalHeight', item.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      objs.set(id, obj);
      ids.push(id);
      maxZ += 1;
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/**
 * Marks an image as ready (upload complete). Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 * Returns false for stale/missing ids.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const objs = doc.getMap('objects');
  const obj = objs.get(id) as Y.Map<unknown> | undefined;
  if (!obj || obj.get('type') !== 'image') return false;
  doc.transact(() => {
    obj.set('status', 'ready');
    obj.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Marks an image as failed. Uses UPLOAD_ORIGIN.
 * Returns false for stale/missing ids.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const objs = doc.getMap('objects');
  const obj = objs.get(id) as Y.Map<unknown> | undefined;
  if (!obj || obj.get('type') !== 'image') return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Marks an image as retrying (back to uploading with a new timestamp). Uses UPLOAD_ORIGIN.
 * Returns false for stale/missing ids.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const objs = doc.getMap('objects');
  const obj = objs.get(id) as Y.Map<unknown> | undefined;
  if (!obj || obj.get('type') !== 'image') return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Derives the display status from the stored status and elapsed time.
 * 'uploading' older than IMAGE_UPLOAD_STALE_MS → 'unfinished'.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
