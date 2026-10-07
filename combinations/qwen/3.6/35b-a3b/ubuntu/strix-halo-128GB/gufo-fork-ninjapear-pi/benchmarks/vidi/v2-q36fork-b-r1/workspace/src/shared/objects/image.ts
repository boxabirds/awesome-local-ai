/**
 * Story 12 — Image object model.
 *
 * Pure functions for placing images, creating placeholders, and managing
 * upload status in a Y.Doc. Uses UPLOAD_ORIGIN so that upload completion
 * does not become its own undo step (the UndoManager only tracks LOCAL_ORIGIN).
 */
import * as Y from 'yjs';
import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '@/shared/config';
import { LOCAL_ORIGIN } from '../board-model';

export const UPLOAD_ORIGIN = Symbol('upload-origin');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

export interface Size {
  width: number;
  height: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Rect extends Size, Point2D {}

export interface ImageInner {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
  z: number;
}

export interface ImageSnap extends Omit<ImageInner, 'type'> {
  type: 'image';
}

/**
 * Compute the placement size for a natural image, scaled down so the longest
 * side is at most IMAGE_MAX_PLACE_SIZE_WORLD. Never upscales.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  if (!isFinite(naturalWidth) || !isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return {
    width: naturalWidth * scale,
    height: naturalHeight * scale,
  };
}

/**
 * Layout images left to right with gaps.
 * @param sizes - array of {width, height} for each image
 * @param start - starting point for the layout anchor
 * @param anchor - 'top-left' anchors first item's top-left; 'centre' centres the whole row
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point2D,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  // Calculate total row width
  const totalWidth = sizes.reduce((sum, s, i) => sum + s.width + (i > 0 ? IMAGE_LAYOUT_GAP_WORLD : 0), 0);

  let offsetX: number;
  if (anchor === 'centre') {
    offsetX = start.x - totalWidth / 2;
  } else {
    offsetX = start.x;
  }

  const result: Rect[] = [];
  let currentX = offsetX;
  for (const size of sizes) {
    result.push({
      x: currentX,
      y: start.y,
      width: size.width,
      height: size.height,
    });
    currentX += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return result;
}

/** Create image placeholder objects in the Y.Doc. One transaction per call (one undo step). */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const objects = doc.getMap('objects') as Y.Map<any>;

  // Filter out non-finite sizes
  const validItems = items.filter(
    item =>
      isFinite(item.rect.x) &&
      isFinite(item.rect.y) &&
      isFinite(item.rect.width) &&
      isFinite(item.rect.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0,
  );

  if (validItems.length === 0) return [];

  const ids: string[] = [];
  let maxZ = 0;
  objects.forEach((inner: any) => {
    if (typeof inner?.get === 'function') {
      const z = Number(inner.get('z'));
      if (z > maxZ) maxZ = z;
    }
  });

  doc.transact(() => {
    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i];
      const id = crypto.randomUUID();
      ids.push(id);
      const inner = new Y.Map() as Y.Map<unknown>;
      inner.set('id', id);
      inner.set('type', 'image');
      inner.set('x', item.rect.x);
      inner.set('y', item.rect.y);
      inner.set('width', item.rect.width);
      inner.set('height', item.rect.height);
      inner.set('assetKey', null);
      inner.set('contentType', item.contentType);
      inner.set('naturalWidth', item.naturalWidth);
      inner.set('naturalHeight', item.naturalHeight);
      inner.set('status', 'uploading');
      inner.set('uploadStartedAt', now);
      inner.set('uploaderId', uploaderId);
      inner.set('z', maxZ + 1 + i);
      objects.set(id, inner);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/** Mark an image as ready with its asset key. Returns false if id doesn't exist. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const objects = doc.getMap('objects') as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return false;

  doc.transact(() => {
    inner.set('assetKey', assetKey);
    inner.set('status', 'ready');
  }, UPLOAD_ORIGIN);

  return true;
}

/** Mark an image as failed. Returns false if id doesn't exist. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap('objects') as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return false;

  doc.transact(() => {
    inner.set('status', 'failed');
  }, UPLOAD_ORIGIN);

  return true;
}

/** Mark an image as retried (reset to uploading). Returns false if id doesn't exist. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const objects = doc.getMap('objects') as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return false;

  doc.transact(() => {
    inner.set('status', 'uploading');
    inner.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);

  return true;
}

/** Derive the display status considering staleness. */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'failed') return 'failed';
  if (img.status === 'ready') return 'ready';
  // uploading or undefined → check staleness
  const elapsed = now - img.uploadStartedAt;
  if (elapsed > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return 'uploading';
}
