/**
 * Image object model: schema helpers for creating and managing image objects.
 *
 * Schema per image:
 *   objects/<id>: Y.Map {
 *     type: 'image', x, y, width, height, z, createdAt,
 *     assetKey: string | null,
 *     contentType: string,
 *     naturalWidth: number, naturalHeight: number,
 *     status: 'uploading' | 'ready' | 'failed',
 *     uploadStartedAt: number,
 *     uploaderId: string
 *   }
 */

import * as Y from 'yjs';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Rect, Point } from '../geometry';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';

/**
 * Transaction origin for upload status updates.
 * NOT tracked by the UndoManager, so upload completion never becomes a separate undo step.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished' | 'unavailable';

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

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Largest `z` currently in use across all objects (0 for an empty board). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const value of objectsMap(doc).values()) {
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > top) top = z;
  }
  return top;
}

/**
 * Compute the placement size for an image: natural size if <= IMAGE_MAX_PLACE_SIZE_WORLD
 * on its longest side; otherwise scaled down proportionally so longest side = IMAGE_MAX_PLACE_SIZE_WORLD.
 * Never upscales.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  if (!isFiniteNumber(naturalWidth) || !isFiniteNumber(naturalHeight)) {
    return { width: 0, height: 0 };
  }
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

/**
 * Layout images left to right in a row.
 * - 'top-left': the first image's top-left corner is at `start`.
 * - 'centre': the entire row is centred on `start`.
 * Images are separated by IMAGE_LAYOUT_GAP_WORLD.
 */
export function layoutRow(
  sizes: readonly { width: number; height: number }[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  // Compute total row width
  let totalWidth = 0;
  for (let i = 0; i < sizes.length; i++) {
    totalWidth += sizes[i]!.width;
    if (i < sizes.length - 1) totalWidth += IMAGE_LAYOUT_GAP_WORLD;
  }

  // Compute starting x
  let x: number;
  if (anchor === 'top-left') {
    x = start.x;
  } else {
    // 'centre': centre the row on start
    x = start.x - totalWidth / 2;
  }

  // Compute y: for 'top-left', tops are aligned at start.y.
  // For 'centre', centre the tallest image vertically on start.y.
  let y: number;
  if (anchor === 'top-left') {
    y = start.y;
  } else {
    // Use the height of each image individually; they're all top-aligned
    // but the row is vertically centred using the tallest image
    let maxH = 0;
    for (const s of sizes) {
      if (s.height > maxH) maxH = s.height;
    }
    y = start.y - maxH / 2;
  }

  const rects: Rect[] = [];
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i]!;
    rects.push({ x, y, width: s.width, height: s.height });
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }

  return rects;
}

export interface CreateImageItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Create image placeholder objects in one LOCAL_ORIGIN transaction (one undo step).
 * Skips items with non-finite rect dimensions. Returns array of created ids.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly CreateImageItem[],
  uploaderId: string,
  now: number,
): string[] {
  // Validate items: skip non-finite sizes
  const valid = items.filter((item) =>
    isFiniteNumber(item.rect.x) &&
    isFiniteNumber(item.rect.y) &&
    isFiniteNumber(item.rect.width) &&
    isFiniteNumber(item.rect.height) &&
    isFiniteNumber(item.naturalWidth) &&
    isFiniteNumber(item.naturalHeight),
  );

  if (valid.length === 0) return [];

  const ids: string[] = [];
  let z = maxZ(doc);

  doc.transact(() => {
    for (const item of valid) {
      const id = crypto.randomUUID();
      z += 1;
      const map = new Y.Map<unknown>();
      map.set('type', 'image');
      map.set('x', item.rect.x);
      map.set('y', item.rect.y);
      map.set('width', item.rect.width);
      map.set('height', item.rect.height);
      map.set('z', z);
      map.set('createdAt', now);
      map.set('assetKey', null);
      map.set('contentType', item.contentType);
      map.set('naturalWidth', item.naturalWidth);
      map.set('naturalHeight', item.naturalHeight);
      map.set('status', 'uploading');
      map.set('uploadStartedAt', now);
      map.set('uploaderId', uploaderId);
      objectsMap(doc).set(id, map);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/**
 * Mark an image as ready after upload completes. Uses UPLOAD_ORIGIN (no undo step).
 * Returns false for stale id (deleted, or not an image).
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'image') return false;
  doc.transact(() => {
    map.set('status', 'ready');
    map.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as failed. Uses UPLOAD_ORIGIN (no undo step).
 * Returns false for stale id.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'image') return false;
  doc.transact(() => {
    map.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as retrying (back to uploading with a new uploadStartedAt).
 * Uses UPLOAD_ORIGIN (no undo step). Returns false for stale id.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'image') return false;
  doc.transact(() => {
    map.set('status', 'uploading');
    map.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Derive the display status: an uploading image older than IMAGE_UPLOAD_STALE_MS
 * shows as 'unfinished'.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading') {
    if (now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
      return 'unfinished';
    }
  }
  return img.status;
}

/** Read an image snapshot from the doc for a given id. */
export function readImageSnapshot(doc: Y.Doc, id: string): ImageSnap | undefined {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'image') return undefined;
  return imageFromMap(id, map);
}

/** Build an ImageSnap from a Y.Map. */
export function imageFromMap(id: string, map: Y.Map<unknown>): ImageSnap | undefined {
  const status = map.get('status');
  if (status !== 'uploading' && status !== 'ready' && status !== 'failed') return undefined;
  const assetKey = map.get('assetKey');
  const contentType = map.get('contentType');
  return {
    id,
    type: 'image',
    x: typeof map.get('x') === 'number' ? (map.get('x') as number) : 0,
    y: typeof map.get('y') === 'number' ? (map.get('y') as number) : 0,
    width: typeof map.get('width') === 'number' ? (map.get('width') as number) : 0,
    height: typeof map.get('height') === 'number' ? (map.get('height') as number) : 0,
    z: typeof map.get('z') === 'number' ? (map.get('z') as number) : 0,
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : 'image/png',
    naturalWidth: typeof map.get('naturalWidth') === 'number' ? (map.get('naturalWidth') as number) : 0,
    naturalHeight: typeof map.get('naturalHeight') === 'number' ? (map.get('naturalHeight') as number) : 0,
    status,
    uploadStartedAt: typeof map.get('uploadStartedAt') === 'number' ? (map.get('uploadStartedAt') as number) : 0,
    uploaderId: typeof map.get('uploaderId') === 'string' ? (map.get('uploaderId') as string) : '',
  };
}
