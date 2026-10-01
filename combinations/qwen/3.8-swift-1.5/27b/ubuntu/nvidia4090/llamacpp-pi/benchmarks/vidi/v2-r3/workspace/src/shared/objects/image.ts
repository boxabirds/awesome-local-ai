import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Rect, Point } from '../geometry';

/**
 * Origin for upload status updates. NOT tracked by the UndoManager, so
 * upload completion never becomes its own undo step.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload-origin');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
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
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function objectMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objectsMap(doc).get(id);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsMap(doc).values()) {
    const z = m.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

/**
 * Size an image for placement: natural pixel dimensions scaled down so the
 * longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD. Never upscales.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
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
 * Lay out a row of images left to right, separated by IMAGE_LAYOUT_GAP_WORLD.
 * - 'top-left': the first image's top-left corner is at `start`.
 * - 'centre': the whole row is centred on `start`.
 */
export function layoutRow(
  sizes: readonly { width: number; height: number }[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  const gap = IMAGE_LAYOUT_GAP_WORLD;
  const totalWidth = sizes.reduce((sum, s) => sum + s.width + gap, -gap);

  const results: Rect[] = [];
  if (anchor === 'top-left') {
    let x = start.x;
    for (const s of sizes) {
      results.push({ x, y: start.y, width: s.width, height: s.height });
      x += s.width + gap;
    }
  } else {
    // centre: centre the row on `start`
    let x = start.x - totalWidth / 2;
    const y = start.y;
    for (const s of sizes) {
      results.push({ x, y, width: s.width, height: s.height });
      x += s.width + gap;
    }
  }
  return results;
}

/**
 * Create image placeholder objects in the doc. One LOCAL_ORIGIN transaction
 * for the whole add action (one undo step). Items with non-finite sizes are
 * skipped. Returns the created ids.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (i) =>
      isFiniteNumber(i.rect.x) && isFiniteNumber(i.rect.y) &&
      isFiniteNumber(i.rect.width) && isFiniteNumber(i.rect.height) &&
      isFiniteNumber(i.naturalWidth) && isFiniteNumber(i.naturalHeight),
  );
  if (valid.length === 0) return [];

  const ids: string[] = [];
  doc.transact(() => {
    let z = maxZ(doc);
    for (const item of valid) {
      const id = crypto.randomUUID();
      z += 1;
      const m = new Y.Map<unknown>();
      m.set('type', 'image');
      m.set('x', item.rect.x);
      m.set('y', item.rect.y);
      m.set('width', item.rect.width);
      m.set('height', item.rect.height);
      m.set('assetKey', null);
      m.set('contentType', item.contentType);
      m.set('naturalWidth', item.naturalWidth);
      m.set('naturalHeight', item.naturalHeight);
      m.set('status', 'uploading');
      m.set('uploadStartedAt', now);
      m.set('uploaderId', uploaderId);
      m.set('z', z);
      m.set('createdAt', now);
      objectsMap(doc).set(id, m);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * Mark an image as ready (upload complete). Uses UPLOAD_ORIGIN (not tracked
 * by UndoManager). Returns false for a stale id.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const m = objectMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    m.set('assetKey', assetKey);
    m.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as failed. Uses UPLOAD_ORIGIN. Returns false for a stale id.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const m = objectMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    m.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as retrying (back to uploading). Uses UPLOAD_ORIGIN.
 * Returns false for a stale id.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const m = objectMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    m.set('status', 'uploading');
    m.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Derive the display status from the stored status and elapsed time.
 * 'uploading' older than IMAGE_UPLOAD_STALE_MS becomes 'unfinished'.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}

/**
 * Read an image snapshot from the doc. Returns null if the id is not an image.
 */
export function readImageSnap(_doc: Y.Doc, id: string, m: Y.Map<unknown>): ImageSnap | null {
  const x = m.get('x');
  const y = m.get('y');
  const z = m.get('z');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  const width = m.get('width');
  const height = m.get('height');
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;

  const assetKey = m.get('assetKey');
  const contentType = m.get('contentType');
  const naturalWidth = m.get('naturalWidth');
  const naturalHeight = m.get('naturalHeight');
  const status = m.get('status');
  const uploadStartedAt = m.get('uploadStartedAt');
  const uploaderId = m.get('uploaderId');

  return {
    id,
    type: 'image',
    x,
    y,
    z,
    width,
    height,
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : 'image/png',
    naturalWidth: isFiniteNumber(naturalWidth) ? naturalWidth : 0,
    naturalHeight: isFiniteNumber(naturalHeight) ? naturalHeight : 0,
    status: status === 'ready' || status === 'failed' ? status : 'uploading',
    uploadStartedAt: isFiniteNumber(uploadStartedAt) ? uploadStartedAt : 0,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
  };
}
