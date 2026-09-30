// Images (story 12): uploaded files shown on the board.
//
// objects/<id>: Y.Map {
//   type: 'image', x, y, width, height, z, createdAt, createdBy,
//   assetKey: string | null        // `<boardId>/<assetId>` once uploaded
//   contentType: string, naturalWidth: number, naturalHeight: number,
//   status: 'uploading' | 'ready' | 'failed', uploadStartedAt: number, uploaderId: string
// }
// `unfinished` is never stored: it is derived from `uploadStartedAt` at render time.
import * as Y from 'yjs';
import { type ObjectSnapshot, LOCAL_ORIGIN, getObject, maxZ, objectsMap } from '../board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import type { Point, Rect } from '../geometry';

/**
 * Origin of upload status changes (ready, failed, retrying). Not tracked by the
 * UndoManager, so an upload completing is never its own undo step.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload');

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

export function isImage(obj: ObjectSnapshot): obj is ImageSnap {
  return obj.type === 'image';
}

export function isImageStatus(value: unknown): value is ImageStatus {
  return value === 'uploading' || value === 'ready' || value === 'failed';
}

const finitePositive = (n: number) => Number.isFinite(n) && n > 0;

/**
 * Size of a new image in world units: its natural pixel size (1 px = 1 unit),
 * scaled down proportionally so the longest side is at most
 * IMAGE_MAX_PLACE_SIZE_WORLD. Never enlarged.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Places `sizes` left to right, IMAGE_LAYOUT_GAP_WORLD apart, tops aligned.
 * `top-left`: the first image's top-left corner is `start` (drop point).
 * `centre`: the row's bounding box is centred on `start` (picker, paste).
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  let x = start.x;
  let y = start.y;
  if (anchor === 'centre') {
    const total = sizes.reduce((sum, s) => sum + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * Math.max(0, sizes.length - 1);
    const tallest = sizes.reduce((max, s) => Math.max(max, s.height), 0);
    x -= total / 2;
    y -= tallest / 2;
  }
  return sizes.map((s) => {
    const rect = { x, y, width: s.width, height: s.height };
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
    return rect;
  });
}

/**
 * Creates one `uploading` image placeholder per item, above every other object,
 * in ONE LOCAL_ORIGIN transaction (one undo step for the whole add action).
 * Items with non-finite or non-positive sizes are skipped. Returns the new ids
 * in item order (skipped items are left out).
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const usable = items.filter(
    (it) =>
      Number.isFinite(it.rect.x) &&
      Number.isFinite(it.rect.y) &&
      finitePositive(it.rect.width) &&
      finitePositive(it.rect.height) &&
      finitePositive(it.naturalWidth) &&
      finitePositive(it.naturalHeight),
  );
  if (usable.length === 0) return [];
  const ids: string[] = [];
  doc.transact(() => {
    let z = maxZ(doc);
    for (const it of usable) {
      const id = crypto.randomUUID();
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
      objectsMap(doc).set(id, obj);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

function imageObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = getObject(doc, id);
  return obj && obj.get('type') === 'image' ? obj : undefined;
}

/** The stored status of an image object; undefined for stale ids and other types. */
export function getImageStatus(doc: Y.Doc, id: string): ImageStatus | undefined {
  const status = imageObject(doc, id)?.get('status');
  return isImageStatus(status) ? status : undefined;
}

/** The upload finished: the image shows for everyone. False (nothing written) for stale ids. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = imageObject(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/** The upload failed. False (nothing written) for stale ids. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = imageObject(doc, id);
  if (!obj) return false;
  doc.transact(() => obj.set('status', 'failed'), UPLOAD_ORIGIN);
  return true;
}

/** The uploader retries: back to `uploading` with a new start time. False for stale ids. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = imageObject(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/** What to show: an upload running for more than IMAGE_UPLOAD_STALE_MS is `unfinished`. */
export function displayStatus(img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
  return img.status;
}
