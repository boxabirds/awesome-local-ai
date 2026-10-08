import * as Y from 'yjs';
import { IMAGE_MAX_PLACE_SIZE_WORLD } from '../config';
import type { Rect, Point } from '../../shared/geometry';

export const LOCAL_ORIGIN: unique symbol = Symbol('localOrigin');
export const UPLOAD_ORIGIN: unique symbol = Symbol('uploadOrigin');

export type ImageStatus = 'uploading' | 'ready' | 'failed';

export type DisplayStatus = ImageStatus | 'unfinished';

/** Snap of an image object as stored in Y.Doc */
export interface ImageSnap {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

/** Compute placement size from natural dimensions */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
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

/** Layout images in a row with gap */
export function layoutRow(
  sizes: readonly { width: number; height: number }[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  // Calculate total row width and height
  const totalGap = (sizes.length - 1) * 24; // IMAGE_LAYOUT_GAP_WORLD
  let totalWidth = 0;
  for (const s of sizes) {
    totalWidth += s.width;
  }
  totalWidth += totalGap;

  // Find max height to align tops
  const maxHeight = Math.max(...sizes.map((s) => s.height));

  const rects: Rect[] = [];

  if (anchor === 'top-left') {
    // First image starts at start point
    let cursorX = start.x;
    for (let i = 0; i < sizes.length; i++) {
      rects.push({
        x: cursorX,
        y: start.y,
        width: sizes[i].width,
        height: sizes[i].height,
      });
      cursorX += sizes[i].width + 24;
    }
  } else {
    // Centre: centre the whole row on the point
    const startX = start.x - totalWidth / 2;
    let cursorX = startX;
    for (let i = 0; i < sizes.length; i++) {
      rects.push({
        x: cursorX,
        y: start.y,
        width: sizes[i].width,
        height: sizes[i].height,
      });
      cursorX += sizes[i].width + 24;
    }
  }

  return rects;
}

/** Create placeholder objects for multiple images in one transaction */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  if (items.length === 0) return [];

  const ids: string[] = [];
  let maxZ = 0;

  // First pass: find max Z
  try {
    const objectsMap = doc.getMap('objects');
    objectsMap.forEach((_v, _k) => {
      // We don't have direct access to Z here; we'll compute it inline
    });
  } catch {
    // No objects yet
  }

  doc.transact(() => {
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<any>>;
    let z = 1;
    objectsMap.forEach((_v, _k) => {
      const zv = _v.get('z');
      if (typeof zv === 'number' && zv > maxZ) maxZ = zv;
    });
    z = maxZ + 1;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Skip non-finite sizes
      if (
        !Number.isFinite(item.rect.x) ||
        !Number.isFinite(item.rect.y) ||
        !Number.isFinite(item.rect.width) ||
        !Number.isFinite(item.rect.height)
      ) {
        continue;
      }

      const id = crypto.randomUUID();
      ids.push(id);

      const objMap = new Y.Map();
      objMap.set('type', 'image');
      objMap.set('x', item.rect.x);
      objMap.set('y', item.rect.y);
      objMap.set('width', item.rect.width);
      objMap.set('height', item.rect.height);
      objMap.set('z', z + i);
      objMap.set('assetKey', null);
      objMap.set('contentType', item.contentType);
      objMap.set('naturalWidth', item.naturalWidth);
      objMap.set('naturalHeight', item.naturalHeight);
      objMap.set('status', 'uploading');
      objMap.set('uploadStartedAt', now);
      objMap.set('uploaderId', uploaderId);

      objectsMap.set(id, objMap);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/** Mark an image as ready (upload completed). Returns false if id not found. */
export function markImageReady(
  doc: Y.Doc,
  id: string,
  assetKey: string,
): boolean {
  try {
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<any>>;
    const objMap = objectsMap.get(id);
    if (!objMap) return false;

    doc.transact(() => {
      objMap.set('status', 'ready');
      objMap.set('assetKey', assetKey);
    }, UPLOAD_ORIGIN);

    return true;
  } catch {
    return false;
  }
}

/** Mark an image as failed. Returns false if id not found. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  try {
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<any>>;
    const objMap = objectsMap.get(id);
    if (!objMap) return false;

    doc.transact(() => {
      objMap.set('status', 'failed');
    }, UPLOAD_ORIGIN);

    return true;
  } catch {
    return false;
  }
}

/** Mark an image for retrying. Returns false if id not found. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  try {
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<any>>;
    const objMap = objectsMap.get(id);
    if (!objMap) return false;

    doc.transact(() => {
      objMap.set('status', 'uploading');
      objMap.set('uploadStartedAt', now);
    }, UPLOAD_ORIGIN);

    return true;
  } catch {
    return false;
  }
}

/** Derive display status including 'unfinished' based on stale timeout */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'failed') return 'failed';
  if (img.status === 'ready') return 'ready';
  // uploading — check if stale
  const elapsed = now - img.uploadStartedAt;
  if (elapsed >= 5 * 60 * 1000) {
    return 'unfinished';
  }
  return 'uploading';
}
