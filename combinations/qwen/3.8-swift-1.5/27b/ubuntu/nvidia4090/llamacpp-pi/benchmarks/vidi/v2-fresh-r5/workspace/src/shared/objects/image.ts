/**
 * Image object model (story 12).
 * Pure Y.Doc operations for image placeholders, status updates, and display logic.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Rect, Point, Size } from '../geometry';

/**
 * Origin symbol for upload status updates. NOT tracked by the UndoManager,
 * so upload completion/failure never creates its own undo step.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('UPLOAD_ORIGIN');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

/** Snapshot of an image object for rendering. */
export interface ImageSnap {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

/**
 * Compute the placement size for an image given its natural dimensions.
 * Scales down so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
 * Never upscales.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
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
 * Layout a row of images left to right with IMAGE_LAYOUT_GAP_WORLD between them.
 * - 'top-left': the first image's top-left corner is at `start`.
 * - 'centre': the row is centred on `start`.
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  if (sizes.length === 0) return [];

  const gap = IMAGE_LAYOUT_GAP_WORLD;
  const totalWidth = sizes.reduce((sum, s) => sum + s.width, 0) + gap * (sizes.length - 1);

  let cursorX: number;
  if (anchor === 'top-left') {
    cursorX = start.x;
  } else {
    cursorX = start.x - totalWidth / 2;
  }

  const rects: Rect[] = [];
  for (const s of sizes) {
    rects.push({ x: cursorX, y: start.y, width: s.width, height: s.height });
    cursorX += s.width + gap;
  }
  return rects;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

/**
 * Create image placeholder objects in the document.
 * All items are created in ONE LOCAL_ORIGIN transaction (one undo step).
 * Items with non-finite sizes are skipped.
 * Returns the array of created ids (in order).
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const objects = getObjects(doc);

  // Compute maxZ
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const ids: string[] = [];
  const validItems = items.filter(
    (item) =>
      Number.isFinite(item.rect.x) &&
      Number.isFinite(item.rect.y) &&
      Number.isFinite(item.rect.width) &&
      Number.isFinite(item.rect.height) &&
      Number.isFinite(item.naturalWidth) &&
      Number.isFinite(item.naturalHeight),
  );

  doc.transact(() => {
    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i];
      const id = crypto.randomUUID();
      const objMap = new Y.Map<unknown>();
      objMap.set('type', 'image');
      objMap.set('x', item.rect.x);
      objMap.set('y', item.rect.y);
      objMap.set('width', item.rect.width);
      objMap.set('height', item.rect.height);
      objMap.set('assetKey', null);
      objMap.set('contentType', item.contentType);
      objMap.set('naturalWidth', item.naturalWidth);
      objMap.set('naturalHeight', item.naturalHeight);
      objMap.set('status', 'uploading');
      objMap.set('uploadStartedAt', now);
      objMap.set('uploaderId', uploaderId);
      objMap.set('z', maxZ + 1 + i);
      objMap.set('createdAt', now);
      objects.set(id, objMap);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/**
 * Mark an image as ready (upload complete). Uses UPLOAD_ORIGIN (not tracked by UndoManager).
 * Returns false if the id is not found (stale/deleted).
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('status', 'ready');
    obj.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as failed. Uses UPLOAD_ORIGIN.
 * Returns false if the id is not found.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image as retrying (back to uploading). Uses UPLOAD_ORIGIN.
 * Updates uploadStartedAt to the current time.
 * Returns false if the id is not found.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Derive the display status from the stored status and elapsed time.
 * - 'uploading' older than IMAGE_UPLOAD_STALE_MS → 'unfinished'
 * - otherwise pass through the stored status.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading') {
    if (now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
      return 'unfinished';
    }
    return 'uploading';
  }
  return img.status;
}
