/**
 * Story 12: the image object — its stored fields, and the model calls that create
 * placeholders and update their status.
 *
 * An image object is an ordinary board object (common fields) plus its asset key,
 * content type, natural dimensions, upload status and uploader identity. Placeholders
 * are created in a single LOCAL_ORIGIN transaction (one undo step per add action);
 * status updates (ready/failed/retrying) use UPLOAD_ORIGIN which is not tracked by
 * the UndoManager, so upload completion never becomes its own undo step.
 */

import * as Y from 'yjs';

import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Point, Rect } from '../geometry';

/** Transaction origin for upload status changes — NOT tracked by the UndoManager. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

/** What an image stores on top of the common fields. */
export interface ImageSnapshot extends ObjectSnapshot {
  type: 'image';
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Highest stacking number currently in use across all objects. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsMap(doc).values()) {
    const z = entry.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/**
 * Compute the placement size of an image given its natural pixel dimensions.
 * Scales down proportionally so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
 * Never upscales: if both sides are already smaller, they stay as-is.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
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
 * Lay out images in a left-to-right row separated by IMAGE_LAYOUT_GAP_WORLD.
 *
 * @param sizes - The width/height of each image
 * @param point - The anchor point in world coordinates
 * @param anchor - 'top-left': first image's top-left is at `point`.
 *                 'centre': the whole row is centred on `point`.
 * @returns An array of Rect, one per image.
 */
export function layoutRow(
  sizes: readonly { width: number; height: number }[],
  point: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  // Total row width (including gaps)
  let totalWidth = 0;
  for (let i = 0; i < sizes.length; i++) {
    totalWidth += sizes[i]!.width;
    if (i < sizes.length - 1) totalWidth += IMAGE_LAYOUT_GAP_WORLD;
  }

  // Find the maximum height for vertical centring
  let maxHeight = 0;
  for (const s of sizes) {
    if (s.height > maxHeight) maxHeight = s.height;
  }

  let startX: number;
  let startY: number;

  if (anchor === 'top-left') {
    startX = point.x;
    startY = point.y;
  } else {
    // Centre: centre the row on the point
    startX = point.x - totalWidth / 2;
    startY = point.y - maxHeight / 2;
  }

  const rects: Rect[] = [];
  let cx = startX;
  for (const size of sizes) {
    rects.push({ x: cx, y: startY, width: size.width, height: size.height });
    cx += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/** Input item for creating image placeholders. */
export interface ImagePlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Create image placeholder objects in a single LOCAL_ORIGIN transaction (one undo step).
 * Skips items with non-finite sizes. Returns the ids of the created objects.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (item) =>
      Number.isFinite(item.rect.width) &&
      Number.isFinite(item.rect.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0,
  );
  if (valid.length === 0) return [];

  const ids: string[] = [];
  doc.transact(() => {
    let z = maxZ(doc);
    for (const item of valid) {
      const id = crypto.randomUUID();
      ids.push(id);
      z += 1;
      const entry = new Y.Map<unknown>();
      entry.set('type', 'image');
      entry.set('x', item.rect.x);
      entry.set('y', item.rect.y);
      entry.set('width', item.rect.width);
      entry.set('height', item.rect.height);
      entry.set('z', z);
      entry.set('createdAt', now);
      entry.set('assetKey', null);
      entry.set('contentType', item.contentType);
      entry.set('naturalWidth', item.naturalWidth);
      entry.set('naturalHeight', item.naturalHeight);
      entry.set('status', 'uploading');
      entry.set('uploadStartedAt', now);
      entry.set('uploaderId', uploaderId);
      objectsMap(doc).set(id, entry);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * Mark an image upload as ready (asset available). Returns false for a stale id.
 * Uses UPLOAD_ORIGIN so this is not an undo step.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const entry = objectsMap(doc).get(id);
  if (!entry) return false;
  doc.transact(() => {
    entry.set('status', 'ready');
    entry.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image upload as failed. Returns false for a stale id.
 * Uses UPLOAD_ORIGIN so this is not an undo step.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const entry = objectsMap(doc).get(id);
  if (!entry) return false;
  doc.transact(() => {
    entry.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark a failed image as retrying (back to uploading with new timestamp).
 * Returns false for a stale id. Uses UPLOAD_ORIGIN so this is not an undo step.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const entry = objectsMap(doc).get(id);
  if (!entry) return false;
  doc.transact(() => {
    entry.set('status', 'uploading');
    entry.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Derive the display status of an image. Returns 'unfinished' when the image has been
 * uploading for longer than IMAGE_UPLOAD_STALE_MS.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading') {
    if (now - img.uploadStartedAt >= IMAGE_UPLOAD_STALE_MS) {
      return 'unfinished';
    }
    return 'uploading';
  }
  return img.status;
}

/**
 * Read an ImageSnapshot from a Y.Map entry (for the board-model's readSnapshot).
 */
export function imageSnapshotOf(id: string, entry: Y.Map<unknown>): ImageSnapshot {
  const status = entry.get('status');
  const assetKey = entry.get('assetKey');
  return {
    id,
    type: 'image',
    x: num(entry.get('x')),
    y: num(entry.get('y')),
    width: num(entry.get('width')),
    height: num(entry.get('height')),
    z: num(entry.get('z')),
    createdAt: num(entry.get('createdAt')),
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof entry.get('contentType') === 'string' ? (entry.get('contentType') as string) : '',
    naturalWidth: num(entry.get('naturalWidth')),
    naturalHeight: num(entry.get('naturalHeight')),
    status:
      status === 'ready' || status === 'failed' || status === 'uploading'
        ? (status as ImageStatus)
        : 'uploading',
    uploadStartedAt: num(entry.get('uploadStartedAt')),
    uploaderId: typeof entry.get('uploaderId') === 'string' ? (entry.get('uploaderId') as string) : '',
  };
}

/** Type guard for image snapshots. */
export function readImages(doc: Y.Doc): ImageSnapshot[] {
  const out: ImageSnapshot[] = [];
  const objectsMap = doc.getMap<Y.Map<unknown>>('objects');
  for (const [id, entry] of objectsMap) {
    if (entry.get('type') === 'image') out.push(imageSnapshotOf(id, entry));
  }
  return out;
}

export function isImageSnapshot(obj: ObjectSnapshot): obj is ImageSnapshot {
  return obj.type === 'image';
}

/** Alias used in the design document — same as ImageSnapshot. */
export type ImageSnap = ImageSnapshot;
