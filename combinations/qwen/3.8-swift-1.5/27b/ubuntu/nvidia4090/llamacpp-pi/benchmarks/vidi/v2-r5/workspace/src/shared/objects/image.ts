// src/shared/objects/image.ts
// Image object model: schema, placement, layout, placeholders, status updates.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Rect, Point } from '../geometry';

export const UPLOAD_ORIGIN: unique symbol = Symbol('UPLOAD_ORIGIN');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

export interface ImageSnap {
  id: string;
  type: 'image';
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

/**
 * Computes the placement size for an image with the given natural dimensions.
 * Scales down proportionally so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
 * Never upscales.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD || longest === 0) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

/**
 * Lays out a row of sizes left to right with IMAGE_LAYOUT_GAP_WORLD gaps.
 * - 'top-left': the first rect's top-left corner is at `start`.
 * - 'centre': the entire row is centred on `start`.
 */
export function layoutRow(sizes: readonly { width: number; height: number }[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  if (sizes.length === 0) return [];

  const totalWidth = sizes.reduce((sum, s) => sum + s.width + IMAGE_LAYOUT_GAP_WORLD, -IMAGE_LAYOUT_GAP_WORLD);

  let cursorX: number;
  if (anchor === 'top-left') {
    cursorX = start.x;
  } else {
    cursorX = start.x - totalWidth / 2;
  }

  const result: Rect[] = [];
  for (const s of sizes) {
    result.push({ x: cursorX, y: start.y, width: s.width, height: s.height });
    cursorX += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return result;
}

/**
 * Creates image placeholder objects in the doc.
 * One LOCAL_ORIGIN transaction for the whole batch (single undo step).
 * Skips items with non-finite sizes.
 * Returns the created object ids.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (item) =>
      Number.isFinite(item.rect.x) && Number.isFinite(item.rect.y) &&
      Number.isFinite(item.rect.width) && Number.isFinite(item.rect.height) &&
      Number.isFinite(item.naturalWidth) && Number.isFinite(item.naturalHeight)
  );

  if (valid.length === 0) return [];

  const objects = doc.getMap('objects');
  let maxZ = 0;
  objects.forEach((_val: unknown, _key: string, obj: Y.Map<unknown>) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  const ids: string[] = [];

  doc.transact(() => {
    for (let i = 0; i < valid.length; i++) {
      const item = valid[i];
      const id = crypto.randomUUID();
      const obj = new Y.Map();
      obj.set('type', 'image');
      obj.set('x', item.rect.x);
      obj.set('y', item.rect.y);
      obj.set('width', item.rect.width);
      obj.set('height', item.rect.height);
      obj.set('z', maxZ + 1 + i);
      obj.set('assetKey', null);
      obj.set('contentType', item.contentType);
      obj.set('naturalWidth', item.naturalWidth);
      obj.set('naturalHeight', item.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      objects.set(id, obj);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/**
 * Marks an image as ready (upload complete). Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 * Returns false if the id doesn't exist.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const objects = doc.getMap('objects');
  const obj = objects.get(id) as Y.Map<unknown> | undefined;
  if (!obj) return false;

  doc.transact(() => {
    obj.set('status', 'ready');
    obj.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);

  return true;
}

/**
 * Marks an image as failed. Uses UPLOAD_ORIGIN.
 * Returns false if the id doesn't exist.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap('objects');
  const obj = objects.get(id) as Y.Map<unknown> | undefined;
  if (!obj) return false;

  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);

  return true;
}

/**
 * Marks an image as retrying (back to uploading with new timestamp). Uses UPLOAD_ORIGIN.
 * Returns false if the id doesn't exist.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const objects = doc.getMap('objects');
  const obj = objects.get(id) as Y.Map<unknown> | undefined;
  if (!obj) return false;

  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);

  return true;
}

/**
 * Derives the display status from the stored status and elapsed time.
 * 'uploading' older than IMAGE_UPLOAD_STALE_MS → 'unfinished'.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
