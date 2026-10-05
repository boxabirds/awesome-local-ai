import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Point, Rect } from '../geometry';

/** A size in board units (width/height). */
interface Size {
  width: number;
  height: number;
}

/**
 * Image objects (story 12). An image is added as a placeholder
 * (`status: 'uploading'`) in one LOCAL_ORIGIN transaction (one undo step),
 * then uploaded; completion/failure is written with UPLOAD_ORIGIN, which is
 * NOT tracked by the UndoManager, so upload completion is never its own undo
 * step.
 */

/** Origin for upload status updates — not tracked by the UndoManager. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6:upload-origin');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

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

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function imageMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'image') return undefined;
  return obj;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

function isFiniteRect(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

/**
 * The placement size for an image with the given natural pixel dimensions:
 * natural size in board units (1 px = 1 world unit), scaled down
 * proportionally so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
 * Images smaller than the cap keep their natural size (never enlarged).
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  // Round to 0.01 world units: keeps exact cases exact and avoids float noise.
  return {
    width: Math.round(naturalWidth * scale * 100) / 100,
    height: Math.round(naturalHeight * scale * 100) / 100,
  };
}

/**
 * Lays `sizes` out left to right in a row separated by IMAGE_LAYOUT_GAP_WORLD.
 * `top-left` anchors the first image's top-left corner at `start` (drop);
 * `centre` centres the whole row (its bounding box) on `start` (picker, paste).
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const totalWidth =
    sizes.reduce((acc, s) => acc + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * Math.max(0, sizes.length - 1);
  const maxH = sizes.reduce((acc, s) => Math.max(acc, s.height), 0);
  const x0 = anchor === 'top-left' ? start.x : start.x - totalWidth / 2;
  const y0 = anchor === 'top-left' ? start.y : start.y - maxH / 2;
  const rects: Rect[] = [];
  let x = x0;
  for (const s of sizes) {
    rects.push({ x, y: y0, width: s.width, height: s.height });
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/**
 * Creates one uploading placeholder per item in a single LOCAL_ORIGIN
 * transaction (one undo step for the whole add action). Items with non-finite
 * rect or natural sizes are skipped. Returns the new ids in order.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (it) =>
      isFiniteRect(it.rect) &&
      Number.isFinite(it.naturalWidth) &&
      Number.isFinite(it.naturalHeight) &&
      it.naturalWidth > 0 &&
      it.naturalHeight > 0,
  );
  const ids: string[] = [];
  doc.transact(() => {
    let z = maxZ(doc);
    for (const it of valid) {
      const id = crypto.randomUUID();
      const obj = new Y.Map<unknown>();
      obj.set('type', 'image');
      obj.set('x', it.rect.x);
      obj.set('y', it.rect.y);
      obj.set('width', it.rect.width);
      obj.set('height', it.rect.height);
      obj.set('assetKey', null);
      obj.set('contentType', it.contentType);
      obj.set('naturalWidth', it.naturalWidth);
      obj.set('naturalHeight', it.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      obj.set('createdBy', uploaderId);
      z += 1;
      obj.set('z', z);
      obj.set('createdAt', now);
      objectsMap(doc).set(id, obj);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * Sets the image ready with its stored asset key (UPLOAD_ORIGIN: never an
 * undo step). False (no update) for stale/unknown ids.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = imageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'ready');
    obj.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/** Marks the image failed (UPLOAD_ORIGIN). False (no update) for stale ids. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = imageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Puts the image back to uploading with a fresh uploadStartedAt (Retry,
 * UPLOAD_ORIGIN). False (no update) for stale ids.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = imageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The status to render: an `uploading` image whose upload is older than
 * IMAGE_UPLOAD_STALE_MS displays as `unfinished` (the uploader likely
 * reloaded or closed the page).
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
