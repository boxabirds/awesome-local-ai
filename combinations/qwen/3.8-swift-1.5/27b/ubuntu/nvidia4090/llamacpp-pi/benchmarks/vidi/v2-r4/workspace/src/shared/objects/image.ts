import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Rect, Point, Size } from '../geometry';
import type { ObjectSnapshot } from '../board-model';

/**
 * Origin for upload status updates (ready/failed/retrying). Deliberately NOT
 * in the UndoManager's trackedOrigins, so completing an upload is never its
 * own undo step (image.upload_failure + story 8).
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('UPLOAD_ORIGIN');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
/** `unfinished` is derived at render time from uploadStartedAt. */
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
  width: number;
  height: number;
}

export interface ImagePlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getMaxZ(doc: Y.Doc): number {
  let maxZ = 0;
  getObjects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  return maxZ;
}

/**
 * Sizes an image to its natural pixels, scaled down proportionally so the
 * longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD. Never upscales.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const longest = Math.max(naturalWidth, naturalHeight);
  if (!Number.isFinite(longest) || longest <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Lays images out left to right with IMAGE_LAYOUT_GAP_WORLD between them.
 * `top-left`: the first image's top-left corner is at `start` (drop).
 * `centre`: the whole row is horizontally centred on `start.x`, with the row's
 * top at `start.y` (picker, paste).
 * Within a row every image's top is aligned to `start.y`.
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  if (sizes.length === 0) return [];

  const gap = IMAGE_LAYOUT_GAP_WORLD;
  const totalWidth = sizes.reduce((sum, s) => sum + s.width, 0) + gap * (sizes.length - 1);

  // Both anchors top-align the row to `start.y`; they differ only in the
  // horizontal origin: `top-left` starts the first image's left at `start.x`,
  // `centre` centres the whole row on `start.x`.
  let cursorX = anchor === 'top-left' ? start.x : start.x - totalWidth / 2;
  const topY = start.y;

  const rects: Rect[] = [];
  for (const s of sizes) {
    rects.push({ x: cursorX, y: topY, width: s.width, height: s.height });
    cursorX += s.width + gap;
  }
  return rects;
}

/**
 * Creates one placeholder object per item in a single LOCAL_ORIGIN
 * transaction (one undo step for the whole add action). Items with
 * non-finite sizes are skipped. Returns the created ids in order.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (it) =>
      Number.isFinite(it.rect.x) &&
      Number.isFinite(it.rect.y) &&
      Number.isFinite(it.rect.width) &&
      Number.isFinite(it.rect.height) &&
      Number.isFinite(it.naturalWidth) &&
      Number.isFinite(it.naturalHeight),
  );
  if (valid.length === 0) return [];

  const ids: string[] = [];
  doc.transact(() => {
    const objects = getObjects(doc);
    let z = getMaxZ(doc);
    for (const it of valid) {
      const id = crypto.randomUUID();
      z += 1;
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
      obj.set('z', z);
      objects.set(id, obj);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

function getImageObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = getObjects(doc).get(id);
  if (!obj || obj.get('type') !== 'image') return undefined;
  return obj;
}

/** Sets the uploaded asset key and status 'ready' (UPLOAD_ORIGIN). Stale id → false. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = getImageObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/** Marks the upload as failed (UPLOAD_ORIGIN). Stale id → false. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = getImageObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/** Puts a failed placeholder back to uploading with a fresh timestamp (UPLOAD_ORIGIN). */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = getImageObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/** Derives the display status: uploading older than IMAGE_UPLOAD_STALE_MS → 'unfinished'. */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
