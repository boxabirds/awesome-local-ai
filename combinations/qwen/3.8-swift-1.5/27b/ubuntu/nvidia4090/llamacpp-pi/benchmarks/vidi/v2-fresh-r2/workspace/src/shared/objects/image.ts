/**
 * Image object model (story 12, image.model).
 *
 * An `image` object is a board object that references a stored asset:
 *
 * ```
 * objects/<id>: Y.Map {
 *   type: 'image', x, y, width, height, z, createdAt,
 *   assetKey: string | null,   // set when the upload completes
 *   contentType: string,
 *   naturalWidth: number,
 *   naturalHeight: number,
 *   status: 'uploading' | 'ready' | 'failed',
 *   uploadStartedAt: number,
 *   uploaderId: string
 * }
 * ```
 *
 * Placeholder creation is one LOCAL_ORIGIN transaction (the single undo step
 * for an add action). `markImageReady`/`markImageFailed`/`markImageRetrying`
 * use UPLOAD_ORIGIN, which is NOT in the UndoManager's tracked origins, so
 * completing an upload is never its own undo step. `unfinished` is derived at
 * render time (displayStatus) from uploadStartedAt.
 */

import * as Y from 'yjs';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

/** Unique origin for upload status updates (never tracked by the UndoManager). */
export const UPLOAD_ORIGIN: unique symbol = Symbol('UPLOAD_ORIGIN');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

/** Immutable snapshot of an image object. */
export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
  // Images always carry an explicit size (the box is the image's aspect ratio).
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

export interface Size {
  width: number;
  height: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getObjects(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects');
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Size an image at its natural pixel dimensions (1 px = 1 board unit),
 * scaled down proportionally so its longest side is at most
 * IMAGE_MAX_PLACE_SIZE_WORLD. Smaller images are never enlarged.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  if (!isFiniteNumber(naturalWidth) || !isFiniteNumber(naturalHeight)) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= 0) return { width: 0, height: 0 };
  const factor = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * factor, height: naturalHeight * factor };
}

/**
 * Lay out a row of sizes left to right, separated by IMAGE_LAYOUT_GAP_WORLD.
 *
 * - `top-left`: the first image's top-left corner is at `start` (drop).
 * - `centre`: the whole row is centred on `start` (picker, paste).
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const rects: Rect[] = [];
  if (sizes.length === 0) return rects;
  const totalWidth =
    sizes.reduce((sum, s) => sum + s.width, 0) +
    IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);
  const maxHeight = sizes.reduce((m, s) => Math.max(m, s.height), 0);
  const topY = anchor === 'top-left' ? start.y : start.y - maxHeight / 2;
  let cursorX = anchor === 'top-left' ? start.x : start.x - totalWidth / 2;
  for (const s of sizes) {
    rects.push({ x: cursorX, y: topY, width: s.width, height: s.height });
    cursorX += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

export interface ImageItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Create image placeholders for every item in ONE LOCAL_ORIGIN transaction
 * (a single undo step for the whole add action). Items with non-finite sizes
 * are skipped. Returns the created ids (in item order, skipping invalid).
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImageItem[],
  uploaderId: string,
  now: number,
): string[] {
  const ids: string[] = [];
  // Validate sizes up front; skip invalid items (no partial transaction).
  const valid = items.filter(
    (it) =>
      isFiniteNumber(it.rect.x) &&
      isFiniteNumber(it.rect.y) &&
      isFiniteNumber(it.rect.width) &&
      isFiniteNumber(it.rect.height) &&
      it.rect.width > 0 &&
      it.rect.height > 0 &&
      isFiniteNumber(it.naturalWidth) &&
      isFiniteNumber(it.naturalHeight),
  );
  if (valid.length === 0) return ids;

  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (isFiniteNumber(z) && z > maxZ) maxZ = z;
  });

  doc.transact(() => {
    for (const it of valid) {
      const id = crypto.randomUUID();
      const obj = new Y.Map();
      obj.set('type', 'image');
      obj.set('x', it.rect.x);
      obj.set('y', it.rect.y);
      obj.set('width', it.rect.width);
      obj.set('height', it.rect.height);
      obj.set('z', ++maxZ);
      obj.set('createdAt', now);
      obj.set('assetKey', null);
      obj.set('contentType', it.contentType);
      obj.set('naturalWidth', it.naturalWidth);
      obj.set('naturalHeight', it.naturalHeight);
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
 * Mark an image ready with its asset key. Stale id → false, no transaction.
 * One UPLOAD_ORIGIN transaction (not an undo step).
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = getObjects(doc).get(id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image failed. Stale id → false, no transaction.
 * One UPLOAD_ORIGIN transaction (not an undo step).
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = getObjects(doc).get(id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image retrying (back to uploading with a fresh start time).
 * Stale id → false, no transaction. One UPLOAD_ORIGIN transaction.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = getObjects(doc).get(id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Derive the display status. An `uploading` image older than
 * IMAGE_UPLOAD_STALE_MS is `unfinished` (the uploader reloaded/closed).
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
