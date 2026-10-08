// Image object model (story 12, image.model contract): document schema and
// model operations for board images.
//
//   objects.<id> : {
//     type:            'image'
//     x, y, width, height: number   // the FINAL placed box (placementSize)
//     z:               number
//     assetKey:        string | null   // null until the upload completes
//     contentType:     string          // sniffed by the server
//     naturalWidth:    number          // decoded pixels
//     naturalHeight:   number
//     status:          'uploading' | 'ready' | 'failed'
//     uploadStartedAt: number          // epoch ms
//     uploaderId:      string
//     createdAt:       number
//     createdBy:       string
//   }
//
// Undo policy (story 8): placeholder creation is ONE LOCAL_ORIGIN transaction
// for the whole add action (one undo step). markImageReady / markImageFailed
// / markImageRetrying use UPLOAD_ORIGIN, which is NOT tracked by the
// UndoManager, so upload completion is never its own undo step.

import * as Y from 'yjs';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import {
  LOCAL_ORIGIN,
  nextZAboveAll,
  newObjectId,
  objects,
  registerKnownObjectType,
  type ObjectSnapshot,
} from '../board-model';
import type { Point, Rect } from '../geometry';

/** 'image' is a known object type as soon as this module loads. */
registerKnownObjectType('image');

/** Transaction origin for upload status updates: never an undo step. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.uploadOrigin');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
/** Status derived for rendering: `unfinished` is not persisted, it is what
 *  an expired `uploading` becomes (image.unfinished). */
export type DisplayStatus = ImageStatus | 'unfinished';

/** Snapshot of an image object (ObjectSnapshot plus the image fields). */
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

export interface ImagePlaceholderItem {
  /** The final box for this image (placementSize applied, laid out). */
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * image.placement_size: natural pixels map 1:1 to board units, scaled down
 * proportionally so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
 * Never enlarged.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  // Natural pixels map 1:1 to board units, scaled down proportionally so
  // the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD. Never enlarged.
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > IMAGE_MAX_PLACE_SIZE_WORLD
    ? IMAGE_MAX_PLACE_SIZE_WORLD / longest
    : 1;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Lay `sizes` out left to right separated by IMAGE_LAYOUT_GAP_WORLD.
 * 'top-left' anchors the first image's top-left corner at `start` (drop);
 * 'centre' centres the whole row (its bounding box) on `start` (picker,
 * paste). Tops are aligned in both cases.
 */
export function layoutRow(
  sizes: readonly { width: number; height: number }[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const totalWidth =
    sizes.reduce((n, s) => n + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * Math.max(0, sizes.length - 1);
  const totalHeight = sizes.reduce((n, s) => Math.max(n, s.height), 0);
  // 'top-left' anchors the first image's top-left corner at `start` (a
  // drop); 'centre' centres the row's bounding box on `start` (picker and
  // paste). Tops are aligned in both cases.
  const x0 = anchor === 'top-left' ? start.x : start.x - totalWidth / 2;
  const y0 = anchor === 'top-left' ? start.y : start.y - totalHeight / 2;
  const rects: Rect[] = [];
  let x = x0;
  for (const s of sizes) {
    rects.push({ x, y: y0, width: s.width, height: s.height });
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/**
 * Create one placeholder per item in ONE LOCAL_ORIGIN transaction (a single
 * undo step for the whole add action). Items with non-finite sizes are
 * skipped. Returns the new ids, in item order.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  // Items with non-finite sizes are skipped (defence in depth: the client
  // decodes dimensions before calling, but the document is the source of
  // truth and must stay well-formed).
  const valid = items.filter(
    (it) =>
      Number.isFinite(it.rect.x) &&
      Number.isFinite(it.rect.y) &&
      Number.isFinite(it.rect.width) &&
      Number.isFinite(it.rect.height) &&
      it.rect.width > 0 &&
      it.rect.height > 0 &&
      Number.isFinite(it.naturalWidth) &&
      Number.isFinite(it.naturalHeight) &&
      it.naturalWidth > 0 &&
      it.naturalHeight > 0,
  );
  if (valid.length === 0) return [];

  const ids: string[] = [];
  doc.transact(() => {
    const map = objects(doc);
    const baseZ = nextZAboveAll(doc);
    valid.forEach((item, i) => {
      const id = newObjectId();
      ids.push(id);
      const obj = new Y.Map<unknown>();
      obj.set('type', 'image');
      obj.set('x', item.rect.x);
      obj.set('y', item.rect.y);
      obj.set('width', item.rect.width);
      obj.set('height', item.rect.height);
      obj.set('z', baseZ + i);
      obj.set('assetKey', null);
      obj.set('contentType', item.contentType);
      obj.set('naturalWidth', item.naturalWidth);
      obj.set('naturalHeight', item.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      obj.set('createdAt', now);
      obj.set('createdBy', uploaderId);
      map.set(id, obj);
    });
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * Mark `id` ready with the stored `assetKey`. False for a stale id (no
 * transaction). One UPLOAD_ORIGIN transaction (never an undo step).
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = objects(doc).get(id);
  if (obj?.get('type') !== 'image') return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/** Mark `id` failed. False for a stale id (no transaction). */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc).get(id);
  if (obj?.get('type') !== 'image') return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark `id` uploading again (a Retry by the uploader): a fresh
 * uploadStartedAt so the unfinished clock restarts. False for a stale id.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = objects(doc).get(id);
  if (obj?.get('type') !== 'image') return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
    obj.set('assetKey', null);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The render status of an image at `now`: `uploading` older than
 * IMAGE_UPLOAD_STALE_MS becomes `unfinished` (image.unfinished); ready and
 * failed are reported as stored.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
