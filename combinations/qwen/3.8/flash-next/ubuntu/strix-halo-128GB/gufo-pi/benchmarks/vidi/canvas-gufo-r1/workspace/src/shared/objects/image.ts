import * as Y from 'yjs';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Rect, Point } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';

/** Origin for upload status updates — NOT tracked by the UndoManager. */
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
  text: string; // empty, for union compatibility
}

interface Size {
  width: number;
  height: number;
}

/**
 * Scale image dimensions so the longest side <= IMAGE_MAX_PLACE_SIZE_WORLD.
 * Never upscales.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
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
 * Layout a row of images left to right with IMAGE_LAYOUT_GAP_WORLD gap.
 * - 'top-left': first image's top-left corner is at `start`.
 * - 'centre': the whole row is centred on `start`.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  // Total row width
  let totalWidth = 0;
  for (let i = 0; i < sizes.length; i++) {
    totalWidth += sizes[i].width;
    if (i < sizes.length - 1) totalWidth += IMAGE_LAYOUT_GAP_WORLD;
  }

  // Starting x
  let x: number;
  if (anchor === 'top-left') {
    x = start.x;
  } else {
    x = start.x - totalWidth / 2;
  }

  // Max height for vertical centring
  let maxH = 0;
  for (const s of sizes) {
    if (s.height > maxH) maxH = s.height;
  }

  const rects: Rect[] = [];
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i];
    let y: number;
    if (anchor === 'top-left') {
      y = start.y;
    } else {
      y = start.y - maxH / 2;
    }
    rects.push({ x, y, width: s.width, height: s.height });
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }

  return rects;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

/**
 * Create image placeholder objects in one LOCAL_ORIGIN transaction.
 * Returns the ids created. Items with non-finite dimensions are skipped.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const objects = objectsMap(doc);

  // Filter out invalid items
  const valid = items.filter(
    (item) =>
      Number.isFinite(item.rect.x) &&
      Number.isFinite(item.rect.y) &&
      Number.isFinite(item.rect.width) &&
      Number.isFinite(item.rect.height) &&
      Number.isFinite(item.naturalWidth) &&
      Number.isFinite(item.naturalHeight) &&
      item.rect.width > 0 &&
      item.rect.height > 0,
  );

  if (valid.length === 0) return [];

  const ids: string[] = [];

  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((obj) => {
      const z = obj.get('z') as number;
      if (z > maxZ) maxZ = z;
    });

    for (let i = 0; i < valid.length; i++) {
      const item = valid[i];
      const id = crypto.randomUUID();
      ids.push(id);
      const yMap = new Y.Map<unknown>();
      yMap.set('type', 'image');
      yMap.set('x', item.rect.x);
      yMap.set('y', item.rect.y);
      yMap.set('width', item.rect.width);
      yMap.set('height', item.rect.height);
      yMap.set('z', maxZ + 1 + i);
      yMap.set('createdAt', now);
      yMap.set('createdBy', uploaderId);
      yMap.set('assetKey', null);
      yMap.set('contentType', item.contentType);
      yMap.set('naturalWidth', item.naturalWidth);
      yMap.set('naturalHeight', item.naturalHeight);
      yMap.set('status', 'uploading');
      yMap.set('uploadStartedAt', now);
      yMap.set('uploaderId', uploaderId);
      objects.set(id, yMap);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/**
 * Mark an image as ready (upload succeeded). Returns false if the id is stale/deleted.
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
 * Mark an image as failed (upload failed). Returns false if the id is stale/deleted.
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
 * Mark an image as retrying (status back to uploading with new uploadStartedAt).
 * Returns false if the id is stale/deleted.
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
 * Derive the display status for rendering.
 * If status is 'uploading' and it's been longer than IMAGE_UPLOAD_STALE_MS, return 'unfinished'.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt >= IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
