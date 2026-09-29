/**
 * Image object model (story 12, image.model).
 *
 * An image object is a Y.Map under the board's `objects` map with:
 *   type: 'image'
 *   x, y: top-left of the image (world units)
 *   width, height: display dimensions (world units, proportional to natural)
 *   assetKey: string | null (null while uploading; set to "<boardId>/<assetId>" when ready)
 *   contentType: string (sniffed MIME type, e.g. 'image/png')
 *   naturalWidth: number (pixels)
 *   naturalHeight: number (pixels)
 *   imageStatus: 'uploading' | 'ready' | 'failed'
 *   uploadStartedAt: number (epoch ms)
 *   uploaderId: string
 *   z, createdAt: standard fields
 *
 * Undo behaviour:
 *  - `createImagePlaceholders` uses LOCAL_ORIGIN (tracked by the UndoManager):
 *    one transaction for the whole add action = one undo step.
 *  - `markImageReady` / `markImageFailed` / `markImageRetrying` use UPLOAD_ORIGIN
 *    (NOT tracked by the UndoManager): upload completion is never its own
 *    undo step.
 */

import * as Y from 'yjs';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import type { Point } from '../../client/canvas/camera';
import type { Rect } from '../geometry';

// --- Origins -----------------------------------------------------------------

/**
 * Transaction origin for image status updates (upload completion, failure,
 * retry). NOT in the UndoManager's trackedOrigins, so these updates never
 * create a separate undo step (image.upload_failure / design decision).
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.uploadOrigin');

// --- Types -------------------------------------------------------------------

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

/** A minimal size (width/height) for layout purposes. */
export interface Size {
  width: number;
  height: number;
}

/**
 * An image object snapshot, as used by the renderer and `displayStatus`.
 * (Extends the generic ObjectSnapshot; see board-model.ts.)
 */
export interface ImageSnap {
  id: string;
  type: 'image';
  x: number;
  y: number;
  z: number;
  createdAt: number;
  width: number;
  height: number;
  assetKey: string | null;
  contentType: string | null;
  naturalWidth: number | null;
  naturalHeight: number | null;
  imageStatus: ImageStatus | null;
  uploadStartedAt: number | null;
  uploaderId: string | null;
}

// --- Y.Map keys (must match board-model.ts) ----------------------------------

const TYPE_KEY = 'type';
const X_KEY = 'x';
const Y_KEY = 'y';
const WIDTH_KEY = 'width';
const HEIGHT_KEY = 'height';
const Z_KEY = 'z';
const CREATED_AT_KEY = 'createdAt';
const ASSET_KEY_KEY = 'assetKey';
const CONTENT_TYPE_KEY = 'contentType';
const NATURAL_WIDTH_KEY = 'naturalWidth';
const NATURAL_HEIGHT_KEY = 'naturalHeight';
const IMAGE_STATUS_KEY = 'imageStatus';
const UPLOAD_STARTED_AT_KEY = 'uploadStartedAt';
const UPLOADER_ID_KEY = 'uploaderId';

const IMAGE_TYPE = 'image';
const OBJECTS_KEY = 'objects';

function objects(doc: Y.Doc): Y.Map<Y.Map<any>> {
  return doc.getMap(OBJECTS_KEY);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get(Z_KEY);
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

// --- Placement size ----------------------------------------------------------

/**
 * Scale an image's natural pixel dimensions so the longest side is at most
 * IMAGE_MAX_PLACE_SIZE_WORLD. Never upscales (a 400×300 image stays 400×300).
 * Returns { width, height } in world units.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return {
    width: Math.round(naturalWidth * scale * 100) / 100,
    height: Math.round(naturalHeight * scale * 100) / 100,
  };
}

// --- Row layout ---------------------------------------------------------------

/**
 * Place a row of `sizes` left to right with IMAGE_LAYOUT_GAP_WORLD between
 * them.
 *
 * - `top-left`: the first size's top-left corner is at `start`.
 * - `centre`:   the whole row is centred on `start`.
 *
 * Returns an array of Rects in the same order as `sizes`.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  // Total row width (including gaps).
  const totalWidth = sizes.reduce((sum, s) => sum + s.width, 0) +
    IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);

  // Starting x for the first size.
  let cursorX: number;
  if (anchor === 'top-left') {
    cursorX = start.x;
  } else {
    // Centre: the row's left edge is at start.x - totalWidth/2.
    cursorX = start.x - totalWidth / 2;
  }

  const rects: Rect[] = [];
  for (const s of sizes) {
    rects.push({ x: cursorX, y: start.y, width: s.width, height: s.height });
    cursorX += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

// --- Create placeholders -------------------------------------------------------

/**
 * Create N image placeholder objects in one LOCAL_ORIGIN transaction.
 * One add action = one undo step (image.uploading / design decision).
 *
 * Items with non-finite sizes are skipped. Returns the array of new ids
 * (empty array when all items were invalid).
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  // Validate and collect valid items.
  const valid: { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[] = [];
  for (const item of items) {
    if (
      !Number.isFinite(item.rect.x) || !Number.isFinite(item.rect.y) ||
      !Number.isFinite(item.rect.width) || !Number.isFinite(item.rect.height) ||
      !Number.isFinite(item.naturalWidth) || !Number.isFinite(item.naturalHeight)
    ) continue;
    valid.push(item);
  }
  if (valid.length === 0) return [];

  const ids: string[] = [];
  const z = maxZ(doc);

  doc.transact(() => {
    for (let i = 0; i < valid.length; i++) {
      const item = valid[i]!;
      const id = crypto.randomUUID();
      const obj = new Y.Map();
      obj.set(TYPE_KEY, IMAGE_TYPE);
      obj.set(X_KEY, item.rect.x);
      obj.set(Y_KEY, item.rect.y);
      obj.set(WIDTH_KEY, item.rect.width);
      obj.set(HEIGHT_KEY, item.rect.height);
      obj.set(Z_KEY, z + i + 1);
      obj.set(CREATED_AT_KEY, now);
      obj.set(ASSET_KEY_KEY, null);
      obj.set(CONTENT_TYPE_KEY, item.contentType);
      obj.set(NATURAL_WIDTH_KEY, item.naturalWidth);
      obj.set(NATURAL_HEIGHT_KEY, item.naturalHeight);
      obj.set(IMAGE_STATUS_KEY, 'uploading');
      obj.set(UPLOAD_STARTED_AT_KEY, now);
      obj.set(UPLOADER_ID_KEY, uploaderId);
      objects(doc).set(id, obj);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

// --- Status updates -------------------------------------------------------------

function getImageMap(doc: Y.Doc, id: string): Y.Map<any> | undefined {
  const obj = objects(doc).get(id);
  if (!obj || obj.get(TYPE_KEY) !== IMAGE_TYPE) return undefined;
  return obj;
}

/**
 * Mark an image as ready (upload complete). Sets assetKey.
 * Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 * Returns false for a stale id (no transaction opened).
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = getImageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set(ASSET_KEY_KEY, assetKey);
    obj.set(IMAGE_STATUS_KEY, 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as failed (upload error).
 * Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 * Returns false for a stale id.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = getImageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set(IMAGE_STATUS_KEY, 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as retrying (Reset to uploading with a new timestamp).
 * Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 * Returns false for a stale id.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = getImageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set(IMAGE_STATUS_KEY, 'uploading');
    obj.set(UPLOAD_STARTED_AT_KEY, now);
  }, UPLOAD_ORIGIN);
  return true;
}

// --- Display status -------------------------------------------------------------

/**
 * Derive the display status from the stored status and the current time.
 * An uploading image older than IMAGE_UPLOAD_STALE_MS becomes 'unfinished'.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  const status = img.imageStatus;
  if (status === 'uploading') {
    const started = img.uploadStartedAt ?? 0;
    if (now - started > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
    return 'uploading';
  }
  if (status === 'ready') return 'ready';
  return 'failed';
}
