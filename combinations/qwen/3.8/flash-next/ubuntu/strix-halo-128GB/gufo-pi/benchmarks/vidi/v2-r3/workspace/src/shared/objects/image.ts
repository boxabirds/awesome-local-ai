/**
 * Image object model (story 12).
 *
 * Schema addition: image objects carry assetKey, contentType, naturalWidth,
 * naturalHeight, status, uploadStartedAt, uploaderId.
 */
import * as Y from 'yjs';
import type { Rect, Point, Size } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';

/** Transaction origin for upload status updates (not tracked by UndoManager). */
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
}

/**
 * Compute the placement size: scale down proportionally so the longest side
 * is at most IMAGE_MAX_PLACE_SIZE_WORLD. Never upscales.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
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
 * Layout images in a row.
 * - 'top-left': first image's top-left at the start point.
 * - 'centre': the entire row is centred on the start point.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  // Compute total row width including gaps
  let totalWidth = 0;
  for (let i = 0; i < sizes.length; i++) {
    totalWidth += sizes[i].width;
    if (i < sizes.length - 1) totalWidth += IMAGE_LAYOUT_GAP_WORLD;
  }

  // Max height for vertical alignment
  let maxH = 0;
  for (const s of sizes) {
    if (s.height > maxH) maxH = s.height;
  }

  let originX: number;
  let originY: number;

  if (anchor === 'top-left') {
    originX = start.x;
    originY = start.y;
  } else {
    // Centre the row on the point
    originX = start.x - totalWidth / 2;
    originY = start.y - maxH / 2;
  }

  const rects: Rect[] = [];
  let curX = originX;
  for (const size of sizes) {
    rects.push({ x: curX, y: originY, width: size.width, height: size.height });
    curX += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }

  return rects;
}

/**
 * Create image placeholder objects in the Y.Doc.
 * All items are created in one LOCAL_ORIGIN transaction (single undo step).
 * Items with non-finite sizes are skipped.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  // Filter out non-finite sizes
  const valid = items.filter(
    (it) =>
      Number.isFinite(it.rect.width) && Number.isFinite(it.rect.height) &&
      it.rect.width > 0 && it.rect.height > 0,
  );
  if (valid.length === 0) return [];

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const ids: string[] = [];

  // Find max z
  let maxZ = 0;
  for (const m of objects.values()) {
    const z = m.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  }

  doc.transact(() => {
    for (let i = 0; i < valid.length; i++) {
      const item = valid[i];
      const id = crypto.randomUUID();
      ids.push(id);
      const m = new Y.Map<unknown>();
      m.set('type', 'image');
      m.set('x', item.rect.x);
      m.set('y', item.rect.y);
      m.set('width', item.rect.width);
      m.set('height', item.rect.height);
      m.set('z', maxZ + i + 1);
      m.set('createdAt', now);
      m.set('assetKey', null);
      m.set('contentType', item.contentType);
      m.set('naturalWidth', item.naturalWidth);
      m.set('naturalHeight', item.naturalHeight);
      m.set('status', 'uploading');
      m.set('uploadStartedAt', now);
      m.set('uploaderId', uploaderId);
      objects.set(id, m);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/**
 * Mark an image as ready (upload succeeded).
 * Returns false if the object no longer exists or is not an image.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const m = objects.get(id);
  if (!m || m.get('type') !== 'image') return false;

  doc.transact(() => {
    m.set('status', 'ready');
    m.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as failed (upload error).
 * Returns false if the object no longer exists or is not an image.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const m = objects.get(id);
  if (!m || m.get('type') !== 'image') return false;

  doc.transact(() => {
    m.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as retrying (set back to uploading with new uploadStartedAt).
 * Returns false if the object no longer exists or is not an image.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const m = objects.get(id);
  if (!m || m.get('type') !== 'image') return false;

  doc.transact(() => {
    m.set('status', 'uploading');
    m.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Derive the display status of an image given the current time.
 * 'uploading' older than IMAGE_UPLOAD_STALE_MS becomes 'unfinished'.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading') {
    if (now - img.uploadStartedAt >= IMAGE_UPLOAD_STALE_MS) {
      return 'unfinished';
    }
  }
  return img.status;
}

/**
 * Read an image snapshot from a Y.Map. Returns null for invalid data.
 */
export function readImage(id: string, m: Y.Map<unknown>): ImageSnap | null {
  if (m.get('type') !== 'image') return null;
  const x = m.get('x');
  const y = m.get('y');
  const width = m.get('width');
  const height = m.get('height');
  const z = m.get('z');
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  if (typeof width !== 'number' || !Number.isFinite(width)) return null;
  if (typeof height !== 'number' || !Number.isFinite(height)) return null;
  if (typeof z !== 'number') return null;

  const assetKey = m.get('assetKey');
  const contentType = m.get('contentType');
  const naturalWidth = m.get('naturalWidth');
  const naturalHeight = m.get('naturalHeight');
  const status = m.get('status');
  const uploadStartedAt = m.get('uploadStartedAt');
  const uploaderId = m.get('uploaderId');
  const createdAt = m.get('createdAt');

  return {
    id,
    type: 'image',
    x,
    y,
    width,
    height,
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : '',
    naturalWidth: typeof naturalWidth === 'number' ? naturalWidth : 0,
    naturalHeight: typeof naturalHeight === 'number' ? naturalHeight : 0,
    status: (status === 'ready' || status === 'failed') ? status : 'uploading',
    uploadStartedAt: typeof uploadStartedAt === 'number' ? uploadStartedAt : 0,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
  };
}
