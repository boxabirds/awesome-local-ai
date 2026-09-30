// Images (story 12, image.model). Framework-free like board-model.
//
// objects/<id>: Y.Map {
//   type: 'image', x, y, width, height, z, createdAt,
//   assetKey: string | null        // '<boardId>/<assetId>' once uploaded
//   contentType, naturalWidth, naturalHeight,
//   status: 'uploading' | 'ready' | 'failed', uploadStartedAt, uploaderId
// }
// Creating placeholders is a LOCAL_ORIGIN transaction (one undo step per add
// action); upload outcomes use UPLOAD_ORIGIN, which the UndoManager does not
// track, so completing an upload never becomes its own undo step.
import * as Y from 'yjs';
import {
  getObject,
  getObjectsMap,
  isFiniteNumber,
  LOCAL_ORIGIN,
  maxZ,
  registerModelType,
  type ObjectSnapshot,
} from '../board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import type { Point, Rect } from '../geometry';
import { isAssetKey } from '../image-format';

export const IMAGE_TYPE = 'image';

/** Transaction origin for upload outcomes: not tracked by the UndoManager. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

export interface Size {
  width: number;
  height: number;
}

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

const HALF = 2;
const STATUSES: ReadonlySet<string> = new Set<ImageStatus>(['uploading', 'ready', 'failed']);

export function isImage(obj: ObjectSnapshot): obj is ImageSnap {
  return obj.type === IMAGE_TYPE;
}

function readImage(base: ObjectSnapshot, obj: Y.Map<unknown>): ImageSnap {
  const assetKey = obj.get('assetKey');
  const contentType = obj.get('contentType');
  const naturalWidth = obj.get('naturalWidth');
  const naturalHeight = obj.get('naturalHeight');
  const status = obj.get('status');
  const uploadStartedAt = obj.get('uploadStartedAt');
  const uploaderId = obj.get('uploaderId');
  return {
    ...base,
    type: 'image',
    assetKey: isAssetKey(assetKey) ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : '',
    naturalWidth: isFiniteNumber(naturalWidth) && naturalWidth > 0 ? naturalWidth : base.width,
    naturalHeight: isFiniteNumber(naturalHeight) && naturalHeight > 0 ? naturalHeight : base.height,
    // An image without a known status is treated as failed (never a permanent "Uploading…").
    status: typeof status === 'string' && STATUSES.has(status) ? (status as ImageStatus) : 'failed',
    uploadStartedAt: isFiniteNumber(uploadStartedAt) ? uploadStartedAt : 0,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
  };
}

registerModelType(IMAGE_TYPE, readImage);

/**
 * An image's size on the board: its natural pixel size in world units, scaled
 * down proportionally so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD
 * (never enlarged).
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Places images left to right with IMAGE_LAYOUT_GAP_WORLD between them, tops
 * aligned. 'top-left': the first image's top-left corner is `start` (drop);
 * 'centre': the whole row is centred on `start` (picker, paste).
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  if (sizes.length === 0) return [];
  const total = sizes.reduce((sum, s) => sum + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);
  const tallest = Math.max(...sizes.map((s) => s.height));
  let x = anchor === 'centre' ? start.x - total / HALF : start.x;
  const y = anchor === 'centre' ? start.y - tallest / HALF : start.y;
  return sizes.map((s) => {
    const rect = { x, y, width: s.width, height: s.height };
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
    return rect;
  });
}

export interface PlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

function isValidItem(it: PlaceholderItem): boolean {
  const { rect } = it;
  return (
    [rect.x, rect.y, rect.width, rect.height, it.naturalWidth, it.naturalHeight].every(isFiniteNumber) &&
    rect.width > 0 &&
    rect.height > 0 &&
    it.naturalWidth > 0 &&
    it.naturalHeight > 0
  );
}

/**
 * Creates one 'uploading' image per item, on top of every object, in one
 * LOCAL_ORIGIN transaction (one undo step for the whole add action). Items
 * with non-finite or empty sizes are skipped. Returns the ids created, in
 * item order (skipped items have no id).
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly PlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(isValidItem);
  if (valid.length === 0) return [];
  const ids: string[] = [];
  doc.transact(() => {
    let z = maxZ(doc);
    for (const it of valid) {
      const id = crypto.randomUUID();
      const obj = new Y.Map<unknown>();
      obj.set('type', IMAGE_TYPE);
      obj.set('x', it.rect.x);
      obj.set('y', it.rect.y);
      obj.set('width', it.rect.width);
      obj.set('height', it.rect.height);
      obj.set('z', ++z);
      obj.set('createdAt', now);
      obj.set('assetKey', null);
      obj.set('contentType', it.contentType);
      obj.set('naturalWidth', it.naturalWidth);
      obj.set('naturalHeight', it.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      getObjectsMap(doc).set(id, obj);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

function imageMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = getObject(doc, id);
  return obj && obj.get('type') === IMAGE_TYPE ? obj : undefined;
}

/** Upload finished: the image shows for everyone. False (nothing written) for a missing image or bad key. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = imageMap(doc, id);
  if (!obj || !isAssetKey(assetKey)) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/** Upload failed. False (nothing written) for a missing image. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = imageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/** The uploader retries: uploading again from `now`. False (nothing written) for a missing image. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = imageMap(doc, id);
  if (!obj || !isFiniteNumber(now)) return false;
  doc.transact(() => {
    obj.set('assetKey', null);
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/** What to show: an upload running for more than IMAGE_UPLOAD_STALE_MS is 'unfinished'. */
export function displayStatus(img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
  return img.status;
}
