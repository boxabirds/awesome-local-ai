// Images (story 12): placed as a placeholder while the file uploads, then pointing at the stored
// asset. Framework-free.
//
// objects/<id>: Y.Map {
//   type: 'image', x, y, width, height, z, createdAt, createdBy,
//   assetKey: string | null        // `<boardId>/<assetId>` once uploaded
//   contentType: string, naturalWidth, naturalHeight,
//   status: 'uploading' | 'ready' | 'failed', uploadStartedAt: number, uploaderId: string
// }
// `unfinished` is never stored: it is derived at render time from `uploadStartedAt`.
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

/**
 * Origin of upload status changes (ready, failed, retrying). Not tracked by the undo history, so
 * the end of an upload never becomes an undo step of its own.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface ImageSnap extends ObjectSnapshot {
  readonly type: 'image';
  readonly assetKey: string | null;
  readonly contentType: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly status: ImageStatus;
  readonly uploadStartedAt: number;
  readonly uploaderId: string;
}

export function isImage(obj: ObjectSnapshot): obj is ImageSnap {
  return obj.type === 'image';
}

const STATUSES: ReadonlySet<string> = new Set(['uploading', 'ready', 'failed']);
const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** The image-specific fields of a stored image; malformed values read as safe defaults. */
export function readImageFields(
  obj: Y.Map<unknown>,
  box: Size,
): Pick<
  ImageSnap,
  'assetKey' | 'contentType' | 'naturalWidth' | 'naturalHeight' | 'status' | 'uploadStartedAt' | 'uploaderId'
> {
  const assetKey = obj.get('assetKey');
  const contentType = obj.get('contentType');
  const naturalWidth = obj.get('naturalWidth');
  const naturalHeight = obj.get('naturalHeight');
  const status = obj.get('status');
  const uploadStartedAt = obj.get('uploadStartedAt');
  const uploaderId = obj.get('uploaderId');
  const key = typeof assetKey === 'string' ? assetKey : null;
  return {
    assetKey: key,
    contentType: typeof contentType === 'string' ? contentType : '',
    naturalWidth: finitePositive(naturalWidth) ? naturalWidth : box.width,
    naturalHeight: finitePositive(naturalHeight) ? naturalHeight : box.height,
    // A "ready" image without an address cannot be shown: it reads as failed.
    status:
      typeof status === 'string' && STATUSES.has(status)
        ? status === 'ready' && key === null
          ? 'failed'
          : (status as ImageStatus)
        : key !== null
          ? 'ready'
          : 'failed',
    uploadStartedAt: typeof uploadStartedAt === 'number' && Number.isFinite(uploadStartedAt) ? uploadStartedAt : 0,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
  };
}

/**
 * The size an image is placed at: its natural pixel size in world units, scaled down (never up)
 * so that its longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Rects for images placed left to right, IMAGE_LAYOUT_GAP_WORLD apart, tops aligned. `top-left`:
 * the first image's top-left corner is at `start` (drop). `centre`: the whole row is centred on
 * `start` (picker, paste).
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  if (sizes.length === 0) return [];
  const total = sizes.reduce((sum, s) => sum + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);
  const tallest = Math.max(...sizes.map((s) => s.height));
  let x = anchor === 'centre' ? start.x - total / 2 : start.x;
  const y = anchor === 'centre' ? start.y - tallest / 2 : start.y;
  return sizes.map((s) => {
    const rect = { x, y, width: s.width, height: s.height };
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
    return rect;
  });
}

function getImage(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = doc.getMap('objects').get(id);
  return obj instanceof Y.Map && obj.get('type') === 'image' ? (obj as Y.Map<unknown>) : undefined;
}

/**
 * Creates one `uploading` image placeholder per item, on top of every other object, in one
 * LOCAL_ORIGIN transaction (one undo step for the whole add action). Items with a non-finite or
 * non-positive rect or natural size are skipped. Returns the new ids in item order.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (it) =>
      Number.isFinite(it.rect.x) &&
      Number.isFinite(it.rect.y) &&
      finitePositive(it.rect.width) &&
      finitePositive(it.rect.height) &&
      finitePositive(it.naturalWidth) &&
      finitePositive(it.naturalHeight),
  );
  if (valid.length === 0) return [];
  const objects = doc.getMap('objects');
  const ids: string[] = [];
  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((o) => {
      const z = o instanceof Y.Map ? o.get('z') : undefined;
      if (typeof z === 'number' && Number.isFinite(z)) maxZ = Math.max(maxZ, z);
    });
    valid.forEach((it, i) => {
      const id = crypto.randomUUID();
      const obj = new Y.Map<unknown>();
      obj.set('type', 'image');
      obj.set('x', it.rect.x);
      obj.set('y', it.rect.y);
      obj.set('width', it.rect.width);
      obj.set('height', it.rect.height);
      obj.set('z', maxZ + i + 1);
      obj.set('createdAt', now);
      obj.set('createdBy', uploaderId);
      obj.set('assetKey', null);
      obj.set('contentType', it.contentType);
      obj.set('naturalWidth', it.naturalWidth);
      obj.set('naturalHeight', it.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      objects.set(id, obj);
      ids.push(id);
    });
  }, LOCAL_ORIGIN);
  return ids;
}

/** The upload finished: the image shows the stored asset. False (nothing written) for a stale id. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = getImage(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/** The upload failed. False (nothing written) for a stale id or an image that is already ready. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = getImage(doc, id);
  if (!obj || obj.get('status') === 'ready') return false;
  doc.transact(() => obj.set('status', 'failed'), UPLOAD_ORIGIN);
  return true;
}

/** The uploader retries: uploading again from `now`. False for a stale id or a ready image. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = getImage(doc, id);
  if (!obj || obj.get('status') === 'ready') return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/** What to show: `uploading` for more than IMAGE_UPLOAD_STALE_MS reads as `unfinished`. */
export function displayStatus(img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
  return img.status;
}
