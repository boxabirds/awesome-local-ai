import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '@/shared/config';
import { LOCAL_ORIGIN, ensureMeta, type ObjectSnapshot } from '@/shared/board-model';
import { registerKnownObjectType } from '@/shared/known-object-types';
import type { Point, Rect } from '@/shared/geometry';

// The image model marks its type known (sel.all_types) so images can be
// selected, moved, resized and deleted like any other object (image PRD).
registerKnownObjectType('image');

/**
 * Upload status updates (markImageReady / markImageFailed / markImageRetrying)
 * run under this origin, which is NOT in the UndoManager's tracked origins
 * (only LOCAL_ORIGIN is). So upload completion is never its own undo step:
 * the placeholder creation (LOCAL_ORIGIN) is the single undo step for the whole
 * add action, and the later ready/failed transition does not add one.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('image-upload-origin');

/** The persisted upload status of an image object. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';
/**
 * The status the renderer shows. `unfinished` is DERIVED (not persisted): an
 * image whose `uploading` has lasted longer than IMAGE_UPLOAD_STALE_MS.
 */
export type DisplayStatus = ImageStatus | 'unfinished';

/**
 * A snapshot of an image object (type guard: isImageSnap). `assetKey` is null
 * while uploading; once set, the image is ready and its bytes are served from
 * `/api/assets/<assetKey>`.
 */
export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
  width: number;
  height: number;
}

export function isImageSnap(o: ObjectSnapshot): o is ImageSnap {
  if (o.type !== 'image') return false;
  return (
    (o.assetKey === null || typeof o.assetKey === 'string') &&
    typeof o.contentType === 'string' &&
    typeof o.naturalWidth === 'number' &&
    typeof o.naturalHeight === 'number' &&
    (o.status === 'uploading' || o.status === 'ready' || o.status === 'failed')
  );
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function imageObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'image') return undefined;
  return obj;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isFiniteRect(r: Rect): boolean {
  return isFiniteNumber(r.x) && isFiniteNumber(r.y) && isFiniteNumber(r.width) && isFiniteNumber(r.height);
}

/**
 * Sizes a placed image from its natural pixel dimensions (image.placement_size):
 * the natural size in world units, scaled DOWN proportionally so the longest
 * side is at most IMAGE_MAX_PLACE_SIZE_WORLD. Never upscales (scale ≤ 1).
 * Non-finite input yields a degenerate 0x0 size (the caller skips such items).
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  if (!isFiniteNumber(naturalWidth) || !isFiniteNumber(naturalHeight)) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > 0 ? Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest) : 1;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

export interface SizeLike {
  readonly width: number;
  readonly height: number;
}

/**
 * Lays out a row of image boxes (image.drop, image.pick, image.paste).
 *
 *  - `top-left` (drops): the first box's top-left corner is at `start`; each
 *    following box sits IMAGE_LAYOUT_GAP_WORLD to the right; tops are aligned.
 *  - `centre` (picker / paste): the whole row's bounding box (total width
 *    including gaps, tallest box) is centred on `start`.
 *
 * Returns the boxes left to right. Empty input → empty output.
 */
export function layoutRow(sizes: readonly SizeLike[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  if (sizes.length === 0) return [];
  const gap = IMAGE_LAYOUT_GAP_WORLD;
  let totalWidth = 0;
  let maxHeight = 0;
  for (const s of sizes) {
    totalWidth += s.width;
    if (s.height > maxHeight) maxHeight = s.height;
  }
  totalWidth += gap * (sizes.length - 1);

  let x: number;
  let y: number;
  if (anchor === 'top-left') {
    x = start.x;
    y = start.y;
  } else {
    x = start.x - totalWidth / 2;
    y = start.y - maxHeight / 2;
  }

  const rects: Rect[] = [];
  let cx = x;
  for (const s of sizes) {
    rects.push({ x: cx, y, width: s.width, height: s.height });
    cx += s.width + gap;
  }
  return rects;
}

/**
 * One item of an add action: the placed box (from placementSize + layoutRow)
 * plus the image's natural dimensions and (client-side) MIME type.
 */
export interface ImagePlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Creates image placeholder objects for a whole add action (image.drop,
 * image.pick, image.paste). All items are written in ONE LOCAL_ORIGIN
 * transaction — a single undo step for the whole action (image undo rule).
 *
 * Each placeholder starts `status: 'uploading'` with `uploadStartedAt = now`
 * and the uploader's id, so every connected participant can render the
 * uploading state (image.uploading). Items with a non-finite rect or non-finite
 * natural size are skipped. Returns the created ids (creation order); empty
 * (no transaction) when nothing is valid.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (it) => isFiniteRect(it.rect) && isFiniteNumber(it.naturalWidth) && isFiniteNumber(it.naturalHeight),
  );
  if (valid.length === 0) return [];

  const ids = valid.map(() => crypto.randomUUID());
  doc.transact(() => {
    ensureMeta(doc);
    const objects = objectsMap(doc);
    const baseZ = maxZ(objects);
    valid.forEach((it, i) => {
      const obj = new Y.Map();
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
      obj.set('z', baseZ + i + 1);
      obj.set('createdAt', now);
      objects.set(ids[i], obj);
    });
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * Marks an image's upload as complete (image.shared): sets the assetKey for
 * everyone and status 'ready'. Runs under UPLOAD_ORIGIN (no extra undo step).
 * Returns false with no transaction for a stale/non-image id.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = imageObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Marks an image's upload as failed (image.upload_failure). Runs under
 * UPLOAD_ORIGIN. Returns false with no transaction for a stale/non-image id.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = imageObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Re-arms a failed image for a retry (image.upload_failure): back to
 * `uploading` with a fresh uploadStartedAt. Runs under UPLOAD_ORIGIN. Returns
 * false with no transaction for a stale/non-image id.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = imageObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The status the renderer should show (image.unfinished): an `uploading` image
 * whose upload has been running longer than IMAGE_UPLOAD_STALE_MS is
 * `unfinished`; everything else is its stored status.
 */
export function displayStatus(img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}

/**
 * Reads an image object as a typed snapshot (design "snapshot() emits
 * ImageSnap"). Returns undefined for a stale/non-image id or missing
 * required fields. Malformed values fall back to sensible defaults so a
 * partially-written object never crashes the renderer.
 */
export function readImage(doc: Y.Doc, id: string): ImageSnap | undefined {
  const obj = imageObj(doc, id);
  if (!obj) return undefined;
  const x = obj.get('x');
  const y = obj.get('y');
  const width = obj.get('width');
  const height = obj.get('height');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return undefined;
  }
  const assetKey = obj.get('assetKey');
  const status = obj.get('status');
  const z = obj.get('z');
  const createdAt = obj.get('createdAt');
  const naturalWidth = obj.get('naturalWidth');
  const naturalHeight = obj.get('naturalHeight');
  const uploadStartedAt = obj.get('uploadStartedAt');
  const uploaderId = obj.get('uploaderId');
  const contentType = obj.get('contentType');
  return {
    id,
    type: 'image',
    x,
    y,
    width,
    height,
    assetKey: assetKey === null || typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : 'image/png',
    naturalWidth: isFiniteNumber(naturalWidth) ? naturalWidth : 0,
    naturalHeight: isFiniteNumber(naturalHeight) ? naturalHeight : 0,
    status:
      status === 'uploading' || status === 'ready' || status === 'failed'
        ? status
        : 'uploading',
    uploadStartedAt: isFiniteNumber(uploadStartedAt) ? uploadStartedAt : 0,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
    z: isFiniteNumber(z) ? z : 0,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
}
