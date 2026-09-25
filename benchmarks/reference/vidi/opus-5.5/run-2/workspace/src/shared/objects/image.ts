/**
 * Images on the board (anchor: image.model).
 *
 *   objects/<id>: Y.Map { type: 'image', x, y, width, height, z, createdAt, createdBy,
 *                         assetKey: string | null, contentType, naturalWidth, naturalHeight,
 *                         status: 'uploading' | 'ready' | 'failed', uploadStartedAt, uploaderId }
 *
 * A placeholder is created (status `uploading`, no assetKey) as soon as an add action starts,
 * so every participant sees it; the upload's outcome then sets `ready` + `assetKey` or
 * `failed`. Creating the placeholders of one add action is one LOCAL_ORIGIN transaction (one
 * undo step, story 8). Status updates use UPLOAD_ORIGIN, which the UndoManager does not track,
 * so an upload finishing never becomes an undo step of its own. `unfinished` is never stored:
 * it is derived from `uploadStartedAt` at render time (`displayStatus`).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, nextZ, registerSnapshotReader, type ObjectSnapshot } from '../board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import type { Point, Rect } from '../geometry';

export const IMAGE_TYPE = 'image';
const HALF = 2;

/** Transaction origin of upload status updates; deliberately not tracked by the UndoManager. */
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

export interface PlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

const STATUSES: readonly ImageStatus[] = ['uploading', 'ready', 'failed'];

function isImageStatus(value: unknown): value is ImageStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

function finite(...values: number[]): boolean {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function isImageSnap(obj: ObjectSnapshot): obj is ImageSnap {
  return obj.type === IMAGE_TYPE;
}

registerSnapshotReader(IMAGE_TYPE, (base, obj): ImageSnap => {
  const assetKey = obj.get('assetKey');
  const contentType = obj.get('contentType');
  const status = obj.get('status');
  const uploaderId = obj.get('uploaderId');
  const key = typeof assetKey === 'string' && assetKey !== '' ? assetKey : null;
  return {
    ...base,
    type: IMAGE_TYPE,
    assetKey: key,
    contentType: typeof contentType === 'string' ? contentType : '',
    naturalWidth: num(obj.get('naturalWidth'), base.width),
    naturalHeight: num(obj.get('naturalHeight'), base.height),
    // A ready image without an address cannot be shown: treat it as failed.
    status: isImageStatus(status) ? (status === 'ready' && key === null ? 'failed' : status) : key !== null ? 'ready' : 'failed',
    uploadStartedAt: num(obj.get('uploadStartedAt'), base.createdAt),
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
  };
});

/** Natural size in world units, scaled down (never up) so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD. */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > 0 ? Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest) : 1;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Places `sizes` left to right, IMAGE_LAYOUT_GAP_WORLD apart, tops aligned. `top-left`: the
 * first image's top-left is `start` (drop). `centre`: the whole row is centred on `start`
 * (picker and paste, at the centre of the view).
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

function validItem(item: PlaceholderItem): boolean {
  const { rect } = item;
  return (
    finite(rect.x, rect.y, rect.width, rect.height, item.naturalWidth, item.naturalHeight) &&
    rect.width > 0 &&
    rect.height > 0 &&
    item.naturalWidth > 0 &&
    item.naturalHeight > 0
  );
}

/**
 * Adds one `uploading` placeholder per item above every other object, all in one
 * LOCAL_ORIGIN transaction (one undo step). Returns the ids in item order; an item with a
 * non-finite or non-positive size is skipped and gets ''. Nothing is written when every
 * item is skipped.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly PlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const ids = items.map((item) => (validItem(item) ? crypto.randomUUID() : ''));
  if (ids.every((id) => id === '')) return ids;
  doc.transact(() => {
    let z = nextZ(doc);
    const map = doc.getMap<Y.Map<unknown>>('objects');
    items.forEach((item, i) => {
      const id = ids[i]!;
      if (id === '') return;
      const obj = new Y.Map<unknown>();
      obj.set('type', IMAGE_TYPE);
      obj.set('x', item.rect.x);
      obj.set('y', item.rect.y);
      obj.set('width', item.rect.width);
      obj.set('height', item.rect.height);
      obj.set('assetKey', null);
      obj.set('contentType', item.contentType);
      obj.set('naturalWidth', item.naturalWidth);
      obj.set('naturalHeight', item.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      obj.set('z', z);
      obj.set('createdAt', now);
      obj.set('createdBy', uploaderId);
      map.set(id, obj);
      z += 1;
    });
  }, LOCAL_ORIGIN);
  return ids;
}

function imageMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
  return obj instanceof Y.Map && obj.get('type') === IMAGE_TYPE ? obj : undefined;
}

/** The upload finished: everyone now loads the image from `assetKey`. False for a deleted id. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = imageMap(doc, id);
  if (obj === undefined || assetKey === '') return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/** The upload failed. False for a deleted id or an image that is already ready. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = imageMap(doc, id);
  if (obj === undefined || obj.get('status') === 'ready' || obj.get('status') === 'failed') return false;
  doc.transact(() => obj.set('status', 'failed'), UPLOAD_ORIGIN);
  return true;
}

/** The uploader retries a failed upload: uploading again from `now`. False for a deleted or ready id. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = imageMap(doc, id);
  if (obj === undefined || obj.get('status') === 'ready' || !Number.isFinite(now)) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/** Status to show: an upload running longer than IMAGE_UPLOAD_STALE_MS is `unfinished`. */
export function displayStatus(img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
  return img.status;
}
