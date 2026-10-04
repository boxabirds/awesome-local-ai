/**
 * Image object model (story 12): schema helpers for `type: 'image'` objects.
 *
 * Schema (Y.Map per object under the `objects` map):
 *   type: 'image', x, y, width, height, z, createdAt,
 *   assetKey: string | null, contentType: string,
 *   naturalWidth: number, naturalHeight: number,
 *   status: 'uploading' | 'ready' | 'failed',
 *   uploadStartedAt: number, uploaderId: string
 *
 * Placeholder creation uses LOCAL_ORIGIN (one undo step per add action).
 * Status updates (markImageReady/Failed/Retrying) use UPLOAD_ORIGIN which is
 * NOT tracked by the UndoManager, so upload completion is not its own undo step.
 */
import * as Y from 'yjs';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

/** Origin symbol for upload status updates (not tracked by the UndoManager). */
export const UPLOAD_ORIGIN: unique symbol = Symbol('UPLOAD_ORIGIN');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

/** Image object snapshot (story 12). */
export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

/** Type guard for image snapshots. */
export function isImageSnapshot(obj: ObjectSnapshot): obj is ImageSnap {
  return obj.type === 'image';
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Compute the placement size for an image given its natural pixel dimensions.
 * The image is sized to its natural dimensions (1px = 1 world unit), scaled
 * down proportionally so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
 * Smaller images are never enlarged.
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
 * Layout a row of images left to right, separated by IMAGE_LAYOUT_GAP_WORLD.
 *
 * - anchor 'top-left': the first image's top-left corner is at `start`.
 * - anchor 'centre': the row's bounding box is centred on `start`.
 *
 * Returns an array of Rects (one per image), in the same order as `sizes`.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  // Compute total row width
  let totalWidth = 0;
  for (let i = 0; i < sizes.length; i++) {
    totalWidth += sizes[i].width;
    if (i < sizes.length - 1) totalWidth += IMAGE_LAYOUT_GAP_WORLD;
  }

  let cursorX: number;
  if (anchor === 'top-left') {
    cursorX = start.x;
  } else {
    // Centre: the row's centre is at `start`
    cursorX = start.x - totalWidth / 2;
  }

  const result: Rect[] = [];
  for (let i = 0; i < sizes.length; i++) {
    result.push({
      x: cursorX,
      y: start.y,
      width: sizes[i].width,
      height: sizes[i].height,
    });
    cursorX += sizes[i].width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return result;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/**
 * Create image placeholder objects in one LOCAL_ORIGIN transaction.
 * Returns the array of new object ids (one per accepted item).
 * Items with non-finite sizes are skipped.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  if (items.length === 0) return [];

  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  const ids: string[] = [];
  let zCounter = maxZ;

  doc.transact(() => {
    for (const item of items) {
      if (
        !Number.isFinite(item.naturalWidth) || !Number.isFinite(item.naturalHeight) ||
        !Number.isFinite(item.rect.x) || !Number.isFinite(item.rect.y) ||
        !Number.isFinite(item.rect.width) || !Number.isFinite(item.rect.height)
      ) {
        continue;
      }
      zCounter++;
      const id = crypto.randomUUID();
      const obj = new Y.Map<unknown>();
      obj.set('type', 'image');
      obj.set('x', item.rect.x);
      obj.set('y', item.rect.y);
      obj.set('width', item.rect.width);
      obj.set('height', item.rect.height);
      obj.set('z', zCounter);
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
 * Mark an image as ready (upload succeeded). Sets the assetKey.
 * Returns true if applied, false for a stale id.
 * Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = getObjects(doc).get(id);
  if (!obj || obj.get('type') !== 'image') return false;

  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);

  return true;
}

/**
 * Mark an image as failed (upload failed).
 * Returns true if applied, false for a stale id.
 * Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = getObjects(doc).get(id);
  if (!obj || obj.get('type') !== 'image') return false;

  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);

  return true;
}

/**
 * Mark an image as retrying (reset to uploading with a new timestamp).
 * Returns true if applied, false for a stale id.
 * Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = getObjects(doc).get(id);
  if (!obj || obj.get('type') !== 'image') return false;

  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);

  return true;
}

/**
 * Derive the display status from the stored status and elapsed time.
 * An 'uploading' image older than IMAGE_UPLOAD_STALE_MS is 'unfinished'.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
