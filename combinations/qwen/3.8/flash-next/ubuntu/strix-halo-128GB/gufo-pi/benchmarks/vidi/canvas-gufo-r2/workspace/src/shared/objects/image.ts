/**
 * Image object model (story 12, image.model).
 *
 * Schema: common fields + assetKey: string | null, contentType, naturalWidth,
 *         naturalHeight, status: 'uploading' | 'ready' | 'failed',
 *         uploadStartedAt, uploaderId
 *
 * Two origins are used on purpose:
 *
 * - `createImagePlaceholders` runs in one LOCAL_ORIGIN transaction, so adding a
 *   batch of images is a single undo step (PRD undo.step).
 * - `markImageReady` / `markImageFailed` / `markImageRetrying` run in
 *   UPLOAD_ORIGIN, which the UndoManager does not track, so an upload finishing
 *   later never becomes its own undo step and never pollutes the history.
 */
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

/** Transaction origin for upload bookkeeping: deliberately not undo-tracked. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** `unfinished` is derived at render time, never stored. */
export type DisplayStatus = ImageStatus | 'unfinished';

export interface Size {
  width: number;
  height: number;
}

export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
  /** null until the upload succeeds. */
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

export interface ImagePlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

function finite(...values: readonly number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

/**
 * Size an image is placed at: its natural pixels as world units, scaled down so
 * the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD. Small images are never
 * upscaled (PRD image.placement_size).
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): Size {
  if (!finite(naturalWidth, naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Lay sizes out left to right separated by IMAGE_LAYOUT_GAP_WORLD, tops aligned.
 *
 * `top-left` anchors the first image's top-left corner at `start` (a drop);
 * `centre` centres the whole row on `start` (picker and paste).
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const usable = sizes.filter((s) => finite(s.width, s.height) && s.width > 0 && s.height > 0);
  if (usable.length === 0 || !finite(start.x, start.y)) return [];

  const rowWidth =
    usable.reduce((total, s) => total + s.width, 0) +
    IMAGE_LAYOUT_GAP_WORLD * (usable.length - 1);
  const rowHeight = usable.reduce((tallest, s) => Math.max(tallest, s.height), 0);

  const originX = anchor === 'centre' ? start.x - rowWidth / 2 : start.x;
  const originY = anchor === 'centre' ? start.y - rowHeight / 2 : start.y;

  const rects: Rect[] = [];
  let x = originX;
  for (const size of usable) {
    rects.push({ x, y: originY, width: size.width, height: size.height });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/**
 * Create one placeholder per item in a single LOCAL_ORIGIN transaction — the one
 * undo step for the whole add action. Items with non-finite geometry are skipped.
 * Returns the created ids in layout order.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (item) =>
      item !== null &&
      finite(item.rect.x, item.rect.y, item.rect.width, item.rect.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0 &&
      finite(item.naturalWidth, item.naturalHeight) &&
      item.naturalWidth > 0 &&
      item.naturalHeight > 0,
  );
  if (valid.length === 0) return [];

  const objects = getObjects(doc);
  const created: string[] = [];
  const stamp = finite(now) ? now : Date.now();

  doc.transact(() => {
    let z = maxZ(objects);
    for (const item of valid) {
      const id = crypto.randomUUID();
      if (objects.has(id)) continue;
      const yMap = new Y.Map();
      objects.set(id, yMap);
      yMap.set('type', 'image');
      yMap.set('x', item.rect.x);
      yMap.set('y', item.rect.y);
      yMap.set('width', item.rect.width);
      yMap.set('height', item.rect.height);
      yMap.set('z', ++z);
      yMap.set('createdAt', stamp);
      yMap.set('createdBy', uploaderId);
      yMap.set('assetKey', null);
      yMap.set('contentType', item.contentType);
      yMap.set('naturalWidth', item.naturalWidth);
      yMap.set('naturalHeight', item.naturalHeight);
      yMap.set('status', 'uploading' satisfies ImageStatus);
      yMap.set('uploadStartedAt', stamp);
      yMap.set('uploaderId', uploaderId);
      created.push(id);
    }
  }, LOCAL_ORIGIN);

  return created;
}

/** Look up an image object, or undefined for missing / other-type ids. */
function imageMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = getObjects(doc).get(id);
  if (!obj || obj.get('type') !== 'image') return undefined;
  return obj;
}

/** Record a successful upload: `assetKey` set, status ready. Untracked by undo. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = imageMap(doc, id);
  if (!obj || typeof assetKey !== 'string' || assetKey.length === 0) return false;
  doc.transact(() => {
    obj.set('status', 'ready' satisfies ImageStatus);
    obj.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/** Record a failed upload (server error, network error, rate limit). */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = imageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'failed' satisfies ImageStatus);
  }, UPLOAD_ORIGIN);
  return true;
}

/** Start another attempt: back to uploading with a fresh stale timer. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = imageMap(doc, id);
  if (!obj) return false;
  const stamp = Number.isFinite(now) ? now : Date.now();
  doc.transact(() => {
    obj.set('status', 'uploading' satisfies ImageStatus);
    obj.set('uploadStartedAt', stamp);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Status the board renders. An upload that has been "in progress" for longer
 * than IMAGE_UPLOAD_STALE_MS was abandoned (the uploader reloaded or left), so
 * everyone is told it didn't finish instead of waiting forever.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status !== 'uploading') return img.status;
  const elapsed = now - img.uploadStartedAt;
  if (Number.isFinite(elapsed) && elapsed > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
  return 'uploading';
}
