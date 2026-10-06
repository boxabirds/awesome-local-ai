/**
 * Image object model: schema, placement, layout, and status transitions.
 *
 * Images are board objects with a status that moves through uploading → ready|failed,
 * plus a derived "unfinished" state when an upload has been in progress too long.
 * Placeholder creation is one LOCAL_ORIGIN transaction (one undo step); status updates
 * use UPLOAD_ORIGIN, which is NOT tracked by the UndoManager, so completing an upload
 * never becomes its own undo step.
 */

import * as Y from 'yjs';
import { declareObjectType, LOCAL_ORIGIN, createId, maxZ, objectMap, type ObjectSnapshot } from '../board-model';
import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import type { Rect, Point } from '../geometry';

/** Transaction origin for image uploads — NOT tracked by the UndoManager. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload');

export const IMAGE_OBJECT_TYPE = 'image';

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

export interface ImageSnap {
  readonly id: string;
  readonly type: 'image';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  readonly assetKey: string | null;
  readonly contentType: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly status: ImageStatus;
  readonly uploadStartedAt: number;
  readonly uploaderId: string;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * Compute the placement size for an image: its natural size scaled down so the longest
 * side is at most IMAGE_MAX_PLACE_SIZE_WORLD. Never upscales.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) return { width: naturalWidth, height: naturalHeight };
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Lay out images left to right in a row, separated by IMAGE_LAYOUT_GAP_WORLD.
 * - `top-left`: first image's top-left corner at the start point.
 * - `centre`: the whole row centred on the start point.
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  if (sizes.length === 0) return [];

  // Calculate total row width and max height
  let totalWidth = 0;
  let maxHeight = 0;
  for (const s of sizes) {
    totalWidth += s.width;
    if (s.height > maxHeight) maxHeight = s.height;
  }
  totalWidth += IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);

  let x: number;
  let topY: number;
  if (anchor === 'top-left') {
    x = start.x;
    topY = start.y;
  } else {
    // centre anchor: row centred on start point
    x = start.x - totalWidth / 2;
    topY = start.y - maxHeight / 2;
  }

  const rects: Rect[] = [];
  for (const s of sizes) {
    rects.push({ x, y: topY, width: s.width, height: s.height });
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/** Create image placeholder objects in one LOCAL_ORIGIN transaction. Returns the ids created. */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number
): string[] {
  const valid = items.filter(
    (item) =>
      Number.isFinite(item.rect.width) && item.rect.width > 0 &&
      Number.isFinite(item.rect.height) && item.rect.height > 0
  );
  if (valid.length === 0) return [];

  const ids: string[] = [];
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const topZ = maxZ(doc);

  doc.transact(() => {
    for (let i = 0; i < valid.length; i++) {
      const item = valid[i];
      const id = createId();
      ids.push(id);
      const obj = new Y.Map<unknown>();
      obj.set('type', IMAGE_OBJECT_TYPE);
      obj.set('x', item.rect.x);
      obj.set('y', item.rect.y);
      obj.set('width', item.rect.width);
      obj.set('height', item.rect.height);
      obj.set('z', topZ + 1 + i);
      obj.set('assetKey', null);
      obj.set('contentType', item.contentType);
      obj.set('naturalWidth', item.naturalWidth);
      obj.set('naturalHeight', item.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      objects.set(id, obj);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/** Mark an image as ready with its asset key. Returns false for a stale id. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = objectMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'ready');
    obj.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/** Mark an image as failed. Returns false for a stale id. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = objectMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/** Mark an image as uploading again (retry). Returns false for a stale id. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = objectMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Derive the display status: if an image has been uploading for more than
 * IMAGE_UPLOAD_STALE_MS, it is "unfinished".
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The image's own snapshot reader. */
function readImageObject(
  object: Y.Map<unknown>,
  common: ObjectSnapshot
): ImageSnap | null {
  const assetKey = object.get('assetKey');
  const contentType = object.get('contentType');
  const naturalWidth = object.get('naturalWidth');
  const naturalHeight = object.get('naturalHeight');
  const status = object.get('status');
  const uploadStartedAt = object.get('uploadStartedAt');
  const uploaderId = object.get('uploaderId');

  if (!isFiniteNumber(naturalWidth) || !isFiniteNumber(naturalHeight)) return null;
  if (typeof contentType !== 'string') return null;
  if (status !== 'uploading' && status !== 'ready' && status !== 'failed') return null;
  if (!isFiniteNumber(uploadStartedAt)) return null;

  const width = isFiniteNumber(common.width) ? common.width : 0;
  const height = isFiniteNumber(common.height) ? common.height : 0;

  return {
    ...common,
    width,
    height,
    type: IMAGE_OBJECT_TYPE,
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType,
    naturalWidth: naturalWidth as number,
    naturalHeight: naturalHeight as number,
    status,
    uploadStartedAt: uploadStartedAt as number,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : ''
  };
}

declareObjectType(IMAGE_OBJECT_TYPE, readImageObject);
