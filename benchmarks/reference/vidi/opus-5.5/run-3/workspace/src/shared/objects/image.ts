// Images (story 12).
//
// objects/<id>: Y.Map { type: 'image', x, y, width, height, z, createdAt, createdBy,
//                       assetKey: string | null, contentType, naturalWidth, naturalHeight,
//                       status: 'uploading' | 'ready' | 'failed', uploadStartedAt, uploaderId }
//
// A placeholder is created (status 'uploading', no assetKey) the moment files are added, so everyone sees where the
// image will be; the uploader then marks it ready (with the stored asset's key) or failed. Those status updates use
// UPLOAD_ORIGIN, which the undo manager does not track, so finishing an upload is never an undo step of its own.
// 'unfinished' is not stored: it is derived at render time from uploadStartedAt.
import * as Y from 'yjs';
import { LOCAL_ORIGIN, maxZ, registerSnapshotReader, type ObjectSnapshot } from '../board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import type { Point, Rect } from '../geometry';

/** Transaction origin of upload status updates: not tracked by the undo manager (and not LOCAL_ORIGIN). */
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

const STATUSES: readonly ImageStatus[] = ['uploading', 'ready', 'failed'];

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isStatus(s: unknown): s is ImageStatus {
  return typeof s === 'string' && (STATUSES as readonly string[]).includes(s);
}

export function isImage(obj: ObjectSnapshot): obj is ImageSnap {
  return obj.type === 'image';
}

registerSnapshotReader('image', (_id, obj, base) => {
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
    assetKey: typeof assetKey === 'string' && assetKey !== '' ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : '',
    naturalWidth: isFiniteNumber(naturalWidth) ? naturalWidth : base.width,
    naturalHeight: isFiniteNumber(naturalHeight) ? naturalHeight : base.height,
    // An image without a known status but with a stored file shows it; anything else is treated as uploading
    // (and so becomes 'unfinished' after the timeout).
    status: isStatus(status) ? status : typeof assetKey === 'string' && assetKey !== '' ? 'ready' : 'uploading',
    uploadStartedAt: isFiniteNumber(uploadStartedAt) ? uploadStartedAt : 0,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
  } satisfies ImageSnap;
});

/**
 * The size an image is placed at: its natural pixel size in world units, scaled down proportionally so the longest
 * side is at most IMAGE_MAX_PLACE_SIZE_WORLD. Never scaled up.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > 0 ? Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest) : 1;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Lays sizes out left to right with IMAGE_LAYOUT_GAP_WORLD between them, tops aligned. 'top-left': the first image's
 * top-left is at `start` (drop). 'centre': the whole row's bounding box is centred on `start` (picker, paste).
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  const total = sizes.reduce((sum, s) => sum + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * Math.max(0, sizes.length - 1);
  const tallest = sizes.reduce((max, s) => Math.max(max, s.height), 0);
  let x = anchor === 'centre' ? start.x - total / 2 : start.x;
  const y = anchor === 'centre' ? start.y - tallest / 2 : start.y;
  return sizes.map((s) => {
    const r = { x, y, width: s.width, height: s.height };
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
    return r;
  });
}

export interface PlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Adds an 'uploading' image placeholder for each item, above all other objects, in ONE LOCAL_ORIGIN transaction
 * (one undo step for the whole add action). Items with a non-finite or non-positive size or position are skipped.
 * Returns the ids of the created placeholders, in item order ([] and no transaction when none is valid).
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly PlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (it) =>
      [it.rect.x, it.rect.y, it.rect.width, it.rect.height, it.naturalWidth, it.naturalHeight].every(isFiniteNumber) &&
      it.rect.width > 0 &&
      it.rect.height > 0,
  );
  if (valid.length === 0) return [];
  const ids = valid.map(() => crypto.randomUUID());
  doc.transact(() => {
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    let z = maxZ(doc);
    valid.forEach((it, i) => {
      const obj = new Y.Map<unknown>();
      obj.set('type', 'image');
      obj.set('x', it.rect.x);
      obj.set('y', it.rect.y);
      obj.set('width', it.rect.width);
      obj.set('height', it.rect.height);
      obj.set('z', ++z);
      obj.set('createdAt', now);
      obj.set('createdBy', uploaderId);
      obj.set('assetKey', null);
      obj.set('contentType', it.contentType);
      obj.set('naturalWidth', it.naturalWidth);
      obj.set('naturalHeight', it.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      objects.set(ids[i], obj);
    });
  }, LOCAL_ORIGIN);
  return ids;
}

function imageMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = doc.getMap<unknown>('objects').get(id);
  return obj instanceof Y.Map && obj.get('type') === 'image' ? obj : undefined;
}

/** The upload finished: everyone now loads the stored file. False (no update) when the image is gone. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = imageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/** The upload failed. False (no update) when the image is gone. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = imageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => obj.set('status', 'failed'), UPLOAD_ORIGIN);
  return true;
}

/** The uploader retries: uploading again from `now`. False (no update) when the image is gone. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = imageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/** What to show for an image at time `now`: an upload running longer than IMAGE_UPLOAD_STALE_MS is 'unfinished'. */
export function displayStatus(img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
  return img.status;
}
