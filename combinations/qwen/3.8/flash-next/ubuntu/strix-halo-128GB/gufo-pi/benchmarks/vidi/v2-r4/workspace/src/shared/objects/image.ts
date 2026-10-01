/**
 * Image object model: schema helpers for the 'image' object type.
 *
 * Placeholder creation uses LOCAL_ORIGIN (one undo step per add action).
 * Status updates (ready/failed/retrying) use UPLOAD_ORIGIN which is NOT tracked
 * by the UndoManager, so upload completion never becomes its own undo step.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../local-origin';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Rect } from '../geometry';
import type { Point, Size } from '../../client/canvas/camera';

/** Origin tag for upload status updates — NOT tracked by UndoManager. */
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
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
  z: number;
  createdAt: number;
  createdBy: string;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/**
 * Compute placement size: scale down so longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
 * Never upscales. Returns natural size if both sides are <= the max.
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
 * Layout images left to right with IMAGE_LAYOUT_GAP_WORLD between them.
 * anchor 'top-left': first image's top-left is at `start`.
 * anchor 'centre': the entire row is centred on `start`.
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  if (sizes.length === 0) return [];

  // Compute total row width
  let totalWidth = 0;
  for (let i = 0; i < sizes.length; i++) {
    totalWidth += sizes[i].width;
    if (i < sizes.length - 1) totalWidth += IMAGE_LAYOUT_GAP_WORLD;
  }

  // Compute max height for vertical centring
  let maxHeight = 0;
  for (const s of sizes) {
    if (s.height > maxHeight) maxHeight = s.height;
  }

  let startX: number;
  let startY: number;
  if (anchor === 'top-left') {
    startX = start.x;
    startY = start.y;
  } else {
    // 'centre': the row is centred on `start`
    startX = start.x - totalWidth / 2;
    startY = start.y - maxHeight / 2;
  }

  const rects: Rect[] = [];
  let curX = startX;
  for (const s of sizes) {
    rects.push({ x: curX, y: startY, width: s.width, height: s.height });
    curX += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/**
 * Create image placeholder objects in one LOCAL_ORIGIN transaction.
 * Items with non-finite sizes are skipped.
 * Returns the ids of created placeholders.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  // Validate: skip items with non-finite rect dimensions
  const valid = items.filter(
    (item) =>
      Number.isFinite(item.rect.x) &&
      Number.isFinite(item.rect.y) &&
      Number.isFinite(item.rect.width) &&
      Number.isFinite(item.rect.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0,
  );
  if (valid.length === 0) return [];

  const objects = objectsMap(doc);
  const ids: string[] = [];
  doc.transact(() => {
    let z = maxZ(objects);
    for (const item of valid) {
      const id = crypto.randomUUID();
      ids.push(id);
      const obj = new Y.Map();
      obj.set('type', 'image');
      obj.set('x', item.rect.x);
      obj.set('y', item.rect.y);
      obj.set('width', item.rect.width);
      obj.set('height', item.rect.height);
      obj.set('assetKey', null);
      obj.set('contentType', item.contentType);
      obj.set('naturalWidth', item.naturalWidth);
      obj.set('naturalHeight', item.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      obj.set('z', ++z);
      obj.set('createdAt', now);
      obj.set('createdBy', uploaderId);
      objects.set(id, obj);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * Mark an image as ready with its asset key. Uses UPLOAD_ORIGIN (not undo-tracked).
 * Returns false if the id is stale or not an image.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'image') return false;
  doc.transact(() => {
    obj.set('status', 'ready');
    obj.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as failed. Uses UPLOAD_ORIGIN (not undo-tracked).
 * Returns false if the id is stale or not an image.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'image') return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as retrying (back to uploading with a new uploadStartedAt).
 * Uses UPLOAD_ORIGIN (not undo-tracked).
 * Returns false if the id is stale or not an image.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'image') return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Derive the display status from an image snapshot and current time.
 * An 'uploading' image older than IMAGE_UPLOAD_STALE_MS shows as 'unfinished'.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}

/** Read an image object from the Y.Map. Returns null if type !== 'image'. */
export function readImage(id: string, obj: Y.Map<unknown>): ImageSnap | null {
  if (obj.get('type') !== 'image') return null;
  const x = obj.get('x');
  const y = obj.get('y');
  const width = obj.get('width');
  const height = obj.get('height');
  const assetKey = obj.get('assetKey');
  const contentType = obj.get('contentType');
  const naturalWidth = obj.get('naturalWidth');
  const naturalHeight = obj.get('naturalHeight');
  const status = obj.get('status');
  const uploadStartedAt = obj.get('uploadStartedAt');
  const uploaderId = obj.get('uploaderId');
  const z = obj.get('z');
  const createdAt = obj.get('createdAt');
  const createdBy = obj.get('createdBy');
  const validStatus: ImageStatus =
    status === 'ready' || status === 'failed' ? status : 'uploading';
  return {
    id,
    type: 'image',
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
    width: typeof width === 'number' ? width : 100,
    height: typeof height === 'number' ? height : 100,
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : 'image/png',
    naturalWidth: typeof naturalWidth === 'number' ? naturalWidth : 0,
    naturalHeight: typeof naturalHeight === 'number' ? naturalHeight : 0,
    status: validStatus,
    uploadStartedAt: typeof uploadStartedAt === 'number' ? uploadStartedAt : 0,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
    z: typeof z === 'number' ? z : 0,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}
