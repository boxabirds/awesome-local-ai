/**
 * Story 12: image object model (image.model unit, TC-03 to TC-07).
 *
 * An image is a board object of type 'image' with fixed fields:
 *   x, y, width, height, z — geometry (like every object);
 *   assetKey: string | null — immutable R2 key `<boardId>/<assetId>` once
 *     the upload lands, null while uploading;
 *   contentType, naturalWidth, naturalHeight — measured client-side before
 *     upload (createImageBitmap), stored once at placeholder creation;
 *   status: 'uploading' | 'ready' | 'failed';
 *   uploadStartedAt — epoch ms of the (re)try, for the 5-minute stale clock;
 *   uploaderId — identity of the client that started the upload (its
 *     placeholder shows progress; everyone else sees "Uploading…").
 *
 * Status transitions happen on UPLOAD_ORIGIN so they are NEVER undo steps;
 * placeholder creation is one LOCAL_ORIGIN transaction = one undo step for
 * the whole add action.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, objectsOf } from 'src/shared/board-model';
import type { ObjectSnapshot } from 'src/shared/board-model';
import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from 'src/shared/config';
import type { Point, Rect } from 'src/shared/geometry';

export const UPLOAD_ORIGIN = Symbol('vidi6-upload-origin');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

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

export interface ImageItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * placementSize: scale so the longest side is at most
 * IMAGE_MAX_PLACE_SIZE_WORLD, never upscale. (image.placement_size)
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

/**
 * layoutRow: row of rects.
 *  - 'top-left': first rect at `start`, tops aligned, gaps of
 *    IMAGE_LAYOUT_GAP_WORLD (image.drop).
 *  - 'centre': the row's bounding box centred on `start` (image.pick /
 *    image.paste: "in the centre of the visible area").
 */
export function layoutRow(
  sizes: readonly { width: number; height: number }[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const rects: Rect[] = [];
  let x = start.x;
  let maxHeight = 0;
  for (const s of sizes) {
    rects.push({ x, y: start.y, width: s.width, height: s.height });
    maxHeight = Math.max(maxHeight, s.height);
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  if (anchor === 'centre' && rects.length > 0) {
    const totalWidth = x - start.x - IMAGE_LAYOUT_GAP_WORLD;
    const shiftX = -totalWidth / 2;
    const shiftY = -maxHeight / 2;
    for (const r of rects) {
      r.x += shiftX;
      r.y += shiftY;
    }
  }
  return rects;
}

/**
 * createImagePlaceholders: one LOCAL_ORIGIN transaction creating one
 * 'uploading' placeholder per finite item (non-finite sizes are skipped),
 * z above the current top. Returns the created ids in item order.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImageItem[],
  uploaderId: string,
  now: number,
): string[] {
  const finite = items.filter(
    (it) =>
      Number.isFinite(it.rect.x) && Number.isFinite(it.rect.y) &&
      Number.isFinite(it.rect.width) && Number.isFinite(it.rect.height) &&
      Number.isFinite(it.naturalWidth) && Number.isFinite(it.naturalHeight) &&
      it.naturalWidth > 0 && it.naturalHeight > 0,
  );
  if (finite.length === 0) return [];
  const ids: string[] = [];
  doc.transact(() => {
    const objects = objectsOf(doc);
    let z = maxZOf(objects);
    for (const it of finite) {
      const id = crypto.randomUUID();
      const obj = new Y.Map();
      obj.set('type', 'image');
      obj.set('x', it.rect.x);
      obj.set('y', it.rect.y);
      obj.set('width', it.rect.width);
      obj.set('height', it.rect.height);
      obj.set('z', ++z);
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

function maxZOf(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    if (!(obj instanceof Y.Map)) return;
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/** Sets assetKey + status 'ready' on UPLOAD_ORIGIN. false if the id is gone. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = imageOf(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/** Sets status 'failed' on UPLOAD_ORIGIN. false if the id is gone. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = imageOf(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/** Flips a failed image back to 'uploading' with a fresh timestamp. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = imageOf(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

function imageOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

/**
 * displayStatus: 'uploading' older than IMAGE_UPLOAD_STALE_MS reads
 * 'unfinished' (image.unfinished); 'ready'/'failed' pass through.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}

