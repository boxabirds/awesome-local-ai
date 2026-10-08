/**
 * Image object model (story 12, image.model).
 *
 * The 'image' object type is a board object with an asset key (stored on the
 * worker's R2 bucket), content type, natural dimensions, and an upload
 * status. Images go through an upload lifecycle:
 *
 *   placeholder (status: 'uploading') → ready | failed
 *
 * The placeholder creation is one LOCAL_ORIGIN transaction (one undo step).
 * Status updates use UPLOAD_ORIGIN (not tracked by the UndoManager), so
 * upload completion is never its own undo step.
 *
 * `unfinished` is a derived display status: an 'uploading' image older than
 * IMAGE_UPLOAD_STALE_MS is shown as unfinished (the uploader left).
 */

import * as Y from 'yjs';
import {
  addKnownObjectType,
  LOCAL_ORIGIN,
  maxZ,
  type ObjectSnapshot,
} from '../board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Point, Rect } from '../geometry';

// The image model owns the 'image' type for the document layer.
addKnownObjectType('image');

/**
 * Transaction origin for image status updates (markImageReady,
 * markImageFailed, markImageRetrying). NOT tracked by the UndoManager, so
 * upload completion is never its own undo step.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload-origin');

/** Status stored in the document. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** Display status derived from the stored status + time. */
export type DisplayStatus = ImageStatus | 'unfinished';

/**
 * Immutable view of one image object.
 */
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

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The placement size for an image given its natural pixel dimensions.
 * Scales down proportionally so the longest side is at most
 * IMAGE_MAX_PLACE_SIZE_WORLD; never upscales.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: naturalWidth, height: naturalHeight };
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
 * Lays out a row of images left to right, separated by IMAGE_LAYOUT_GAP_WORLD.
 *
 * - `top-left`: the first image's top-left corner is at `start` (drop point).
 * - `centre`: the whole row is centred on `start` (picker, paste).
 */
export function layoutRow(
  sizes: readonly { width: number; height: number }[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) {
    return [];
  }

  const totalWidth =
    sizes.reduce((sum, s) => sum + s.width, 0) +
    IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);

  let cursorX: number;
  if (anchor === 'top-left') {
    cursorX = start.x;
  } else {
    // Centre the row on `start`
    cursorX = start.x - totalWidth / 2;
  }

  const rects: Rect[] = [];
  for (const s of sizes) {
    rects.push({ x: cursorX, y: start.y, width: s.width, height: s.height });
    cursorX += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/**
 * Creates image placeholder objects in the document. All items are created
 * in ONE LOCAL_ORIGIN transaction (one undo step for the whole add action).
 *
 * Returns the created ids (empty if all items had non-finite sizes).
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly {
    rect: Rect;
    naturalWidth: number;
    naturalHeight: number;
    contentType: string;
  }[],
  uploaderId: string,
  now: number,
): string[] {
  const ids: string[] = [];

  // Filter out items with non-finite sizes (defensive).
  const valid = items.filter(
    (item) =>
      finiteNumber(item.rect.x) &&
      finiteNumber(item.rect.y) &&
      finiteNumber(item.rect.width) &&
      finiteNumber(item.rect.height) &&
      finiteNumber(item.naturalWidth) &&
      finiteNumber(item.naturalHeight),
  );

  if (valid.length === 0) {
    return ids;
  }

  doc.transact(
    () => {
      const objects = doc.getMap('objects');
      for (const item of valid) {
        const id = crypto.randomUUID();
        const entry = new Y.Map();
        entry.set('type', 'image');
        entry.set('x', item.rect.x);
        entry.set('y', item.rect.y);
        entry.set('width', item.rect.width);
        entry.set('height', item.rect.height);
        entry.set('assetKey', null);
        entry.set('contentType', item.contentType);
        entry.set('naturalWidth', item.naturalWidth);
        entry.set('naturalHeight', item.naturalHeight);
        entry.set('status', 'uploading');
        entry.set('uploadStartedAt', now);
        entry.set('uploaderId', uploaderId);
        entry.set('z', maxZ(doc) + 1);
        entry.set('createdAt', now);
        objects.set(id, entry);
        ids.push(id);
      }
    },
    LOCAL_ORIGIN,
  );

  return ids;
}

/** The 'image' entry for `id`, or undefined for stale ids / other types. */
function imageEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = doc.getMap('objects').get(id);
  if (entry instanceof Y.Map && entry.get('type') === 'image') {
    return entry;
  }
  return undefined;
}

/**
 * Marks an image as ready (upload succeeded). Sets the assetKey.
 * Uses UPLOAD_ORIGIN (not tracked by the UndoManager).
 * Returns false for stale ids.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const entry = imageEntry(doc, id);
  if (entry === undefined) {
    return false;
  }
  doc.transact(
    () => {
      entry.set('status', 'ready');
      entry.set('assetKey', assetKey);
    },
    UPLOAD_ORIGIN,
  );
  return true;
}

/**
 * Marks an image as failed (upload failed). Uses UPLOAD_ORIGIN.
 * Returns false for stale ids.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const entry = imageEntry(doc, id);
  if (entry === undefined) {
    return false;
  }
  doc.transact(
    () => {
      entry.set('status', 'failed');
    },
    UPLOAD_ORIGIN,
  );
  return true;
}

/**
 * Marks an image as retrying (back to uploading with a new timestamp).
 * Uses UPLOAD_ORIGIN. Returns false for stale ids.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const entry = imageEntry(doc, id);
  if (entry === undefined) {
    return false;
  }
  doc.transact(
    () => {
      entry.set('status', 'uploading');
      entry.set('uploadStartedAt', now);
      entry.set('assetKey', null);
    },
    UPLOAD_ORIGIN,
  );
  return true;
}

/**
 * Derives the display status from the stored status and time.
 * An 'uploading' image older than IMAGE_UPLOAD_STALE_MS is 'unfinished'.
 */
export function displayStatus(
  img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>,
  now: number,
): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}

/**
 * Reads the image snapshot from the document, or undefined for stale/unknown.
 */
export function imageSnapshot(doc: Y.Doc, id: string): ImageSnap | undefined {
  const entry = imageEntry(doc, id);
  if (entry === undefined) {
    return undefined;
  }
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
  if (!finiteNumber(x) || !finiteNumber(y) || !finiteNumber(z)) {
    return undefined;
  }
  const status = entry.get('status');
  const validStatus =
    status === 'uploading' || status === 'ready' || status === 'failed';
  if (!validStatus) {
    return undefined;
  }
  const uploadStartedAt = entry.get('uploadStartedAt');
  const naturalWidth = entry.get('naturalWidth');
  const naturalHeight = entry.get('naturalHeight');
  if (
    !finiteNumber(uploadStartedAt) ||
    !finiteNumber(naturalWidth) ||
    !finiteNumber(naturalHeight)
  ) {
    return undefined;
  }
  return {
    id,
    type: 'image',
    x,
    y,
    width: finiteNumber(entry.get('width')) ? (entry.get('width') as number) : undefined,
    height: finiteNumber(entry.get('height')) ? (entry.get('height') as number) : undefined,
    z,
    createdAt: finiteNumber(createdAt) ? createdAt : 0,
    assetKey: typeof entry.get('assetKey') === 'string' ? (entry.get('assetKey') as string) : null,
    contentType: typeof entry.get('contentType') === 'string' ? (entry.get('contentType') as string) : '',
    naturalWidth,
    naturalHeight,
    status: status as ImageStatus,
    uploadStartedAt,
    uploaderId: typeof entry.get('uploaderId') === 'string' ? (entry.get('uploaderId') as string) : '',
  };
}
