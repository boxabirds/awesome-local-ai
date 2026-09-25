/**
 * Images (story 12).
 *
 *   objects/<id>: Y.Map {
 *     type: 'image', x, y, width, height, z, createdAt, createdBy,
 *     assetKey: string | null        // '<boardId>/<assetId>' once uploaded, null before
 *     contentType: string            // the file's type as the uploader's browser reported it
 *     naturalWidth, naturalHeight    // pixel size (aspect ratio of the box)
 *     status: 'uploading' | 'ready' | 'failed'
 *     uploadStartedAt: number        // Date.now() of the uploader when the (latest) upload began
 *     uploaderId: string             // who is uploading (only they can Retry)
 *   }
 *
 * A placeholder is created before the upload, so everyone sees where the image will be. Adding
 * images is one LOCAL_ORIGIN transaction (one undo step); the upload's outcome is written with
 * UPLOAD_ORIGIN, which the undo manager does not track, so finishing an upload is never an undo
 * step of its own. `unfinished` is never stored: it is derived from uploadStartedAt.
 */
import * as Y from 'yjs';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import { IMAGE_TYPE, LOCAL_ORIGIN, maxZ, objectOf, type ImageStatus, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';
import { isAssetKey } from '../image-format';

export { IMAGE_TYPE, type ImageStatus };

/** Origin of upload status changes: synced like any change, but never an undo step. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

export type DisplayStatus = ImageStatus | 'unfinished';

export interface Size {
  width: number;
  height: number;
}

export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
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

export interface PlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

const HALF = 2;

export function isImage(obj: ObjectSnapshot): obj is ImageSnap {
  return obj.type === IMAGE_TYPE && obj.status !== undefined && obj.naturalWidth !== undefined;
}

/**
 * The size an image is placed at: its pixel size in world units, scaled down in proportion so
 * the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD; never scaled up (image.placement_size).
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Rects for images placed left to right with IMAGE_LAYOUT_GAP_WORLD between them and their tops
 * aligned. 'top-left': the first image's top-left is `start` (drops); 'centre': the row's
 * bounding box is centred on `start` (picker and paste, at the view centre).
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  let left = start.x;
  let top = start.y;
  if (anchor === 'centre' && sizes.length > 0) {
    const total = sizes.reduce((sum, s) => sum + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);
    const tallest = Math.max(...sizes.map((s) => s.height));
    left = start.x - total / HALF;
    top = start.y - tallest / HALF;
  }
  const rects: Rect[] = [];
  for (const s of sizes) {
    rects.push({ x: left, y: top, width: s.width, height: s.height });
    left += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

function validItem(item: PlaceholderItem): boolean {
  const { rect, naturalWidth, naturalHeight } = item;
  const numbers = [rect.x, rect.y, rect.width, rect.height, naturalWidth, naturalHeight];
  return numbers.every(Number.isFinite) && rect.width > 0 && rect.height > 0 && naturalWidth > 0 && naturalHeight > 0;
}

/**
 * Adds one uploading placeholder per item, above every other object, in ONE LOCAL_ORIGIN
 * transaction (one undo step for the whole add action). Items with non-finite or non-positive
 * sizes are skipped. Returns the new ids in item order ([] and no transaction when none is valid).
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly PlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(validItem);
  if (valid.length === 0) return [];
  const ids = valid.map(() => crypto.randomUUID());
  doc.transact(() => {
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    let z = maxZ(doc);
    valid.forEach((item, i) => {
      const obj = new Y.Map<unknown>();
      objects.set(ids[i]!, obj);
      z += 1;
      obj.set('type', IMAGE_TYPE);
      obj.set('x', item.rect.x);
      obj.set('y', item.rect.y);
      obj.set('width', item.rect.width);
      obj.set('height', item.rect.height);
      obj.set('z', z);
      obj.set('createdAt', now);
      obj.set('createdBy', uploaderId);
      obj.set('assetKey', null);
      obj.set('contentType', item.contentType);
      obj.set('naturalWidth', item.naturalWidth);
      obj.set('naturalHeight', item.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
    });
  }, LOCAL_ORIGIN);
  return ids;
}

function imageMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectOf(doc, id);
  return obj && obj.get('type') === IMAGE_TYPE ? obj : undefined;
}

/**
 * The upload finished: sets the asset key for everyone (image.shared). False, with no update,
 * for stale ids (the placeholder was removed or undone), malformed keys and images not uploading.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = imageMap(doc, id);
  if (!obj || !isAssetKey(assetKey) || obj.get('status') !== 'uploading') return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/** The upload failed. False, with no update, for stale ids and images not uploading. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = imageMap(doc, id);
  if (!obj || obj.get('status') !== 'uploading') return false;
  doc.transact(() => obj.set('status', 'failed'), UPLOAD_ORIGIN);
  return true;
}

/** Retry: a failed image is uploading again from `now`. False for stale ids and other states. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = imageMap(doc, id);
  if (!obj || obj.get('status') !== 'failed' || !Number.isFinite(now)) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * What to show for an image at time `now`: its stored status, except that an upload running
 * for more than IMAGE_UPLOAD_STALE_MS is 'unfinished' (image.unfinished).
 */
export function displayStatus(img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
  return img.status;
}
