// The image object model (story 12, image.model): Yjs schema helpers for
// image objects added by drop, paste or picker.
//
// Schema (objects/<id>):
//   type: 'image'
//   x, y: number            // top-left, world units
//   width, height: number   // world units (the PLACED size)
//   z: number               // stacking; higher is on top
//   createdAt: number       // epoch ms
//   createdBy: string       // client identity of the creator
//   assetKey: string | null // null while uploading; "<boardId>/<assetId>" when ready
//   contentType: string     // sniffed type (server) / File.type (client, pre-upload)
//   naturalWidth, naturalHeight: number
//   status: 'uploading' | 'ready' | 'failed'
//   uploadStartedAt: number // epoch ms (re-stamped on retry)
//   uploaderId: string
//
// Placeholder creation is ONE LOCAL_ORIGIN transaction for the whole add
// action (one undo step, story 8). Upload completion/failure/retry uses
// UPLOAD_ORIGIN, which the UndoManager does not track, so completing an
// upload is never its own undo step (TC-05).

import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { LOCAL_ORIGIN, maxZ, objectsMap, registerBoardType, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

const IMAGE_TYPE = 'image';

// Module-load registration is safe here: this module imports board-model
// (no cycle back), unlike the connector module. The registry re-calls
// ensureImageType() at load so viewer clients know the type before the
// first remote image arrives.
registerBoardType(IMAGE_TYPE);

/** Public registration seam (same rationale as ensureShapeType). */
export function ensureImageType(): void {
  registerBoardType(IMAGE_TYPE);
}

/** Origin for upload status updates: deliberately NOT tracked by the
 *  UndoManager (story 8) so upload completion is not an undo step. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload-origin');

/** Persisted status of an image object. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';
/** Status rendered by ImageObject: `unfinished` is derived, never stored
 *  (image.unfinished). */
export type DisplayStatus = ImageStatus | 'unfinished';

/** Snapshot of one image object (generic ObjectSnapshot + image fields). */
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

function finiteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function imageEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = objectsMap(doc).get(id);
  return entry instanceof Y.Map && entry.get('type') === IMAGE_TYPE ? entry : undefined;
}

/**
 * The size an image is placed at: its natural pixel dimensions in board
 * units, scaled down proportionally so the longest side is at most
 * IMAGE_MAX_PLACE_SIZE_WORLD. Never upscales (image.placement_size).
 * Non-finite or non-positive input yields zero size (callers skip it).
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  if (!finiteNumber(naturalWidth) || !finiteNumber(naturalHeight)) return { width: 0, height: 0 };
  if (naturalWidth <= 0 || naturalHeight <= 0) return { width: 0, height: 0 };
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

/**
 * Lays `sizes` out left to right in a row with IMAGE_LAYOUT_GAP_WORLD
 * between neighbours (image.drop). `top-left` anchors the first image's
 * top-left corner at `start` (drops); `centre` centres the whole row —
 * horizontally and vertically — on `start` (picker and paste).
 */
export function layoutRow(
  sizes: readonly { width: number; height: number }[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const rects: Rect[] = [];
  if (sizes.length === 0) return rects;
  const totalWidth =
    sizes.reduce((sum, s) => sum + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);
  let x = anchor === 'top-left' ? start.x : start.x - totalWidth / 2;
  for (const s of sizes) {
    // `centre` aligns every image's vertical centre on the point.
    const y = anchor === 'top-left' ? start.y : start.y - s.height / 2;
    rects.push({ x, y, width: s.width, height: s.height });
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/**
 * Creates one placeholder per item in a SINGLE LOCAL_ORIGIN transaction
 * (one undo step for the whole add action, story 8). Items with non-finite
 * rect or natural sizes are skipped. Returns the new ids in order.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (i) =>
      finiteNumber(i.rect.x) && finiteNumber(i.rect.y) && finiteNumber(i.rect.width) && finiteNumber(i.rect.height) &&
      finiteNumber(i.naturalWidth) && finiteNumber(i.naturalHeight) &&
      i.rect.width > 0 && i.rect.height > 0,
  );
  if (valid.length === 0) return [];

  const ids: string[] = [];
  let z = maxZ(doc);
  doc.transact(() => {
    for (const item of valid) {
      const id = crypto.randomUUID();
      ids.push(id);
      const entry = new Y.Map<unknown>();
      entry.set('type', IMAGE_TYPE);
      entry.set('x', item.rect.x);
      entry.set('y', item.rect.y);
      entry.set('width', item.rect.width);
      entry.set('height', item.rect.height);
      entry.set('z', ++z);
      entry.set('createdAt', now);
      entry.set('createdBy', uploaderId);
      entry.set('assetKey', null);
      entry.set('contentType', item.contentType);
      entry.set('naturalWidth', item.naturalWidth);
      entry.set('naturalHeight', item.naturalHeight);
      entry.set('status', 'uploading');
      entry.set('uploadStartedAt', now);
      entry.set('uploaderId', uploaderId);
      objectsMap(doc).set(id, entry);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

function setImageStatus(doc: Y.Doc, id: string, mutate: (entry: Y.Map<unknown>) => void): boolean {
  const entry = imageEntry(doc, id);
  if (entry === undefined) return false;
  doc.transact(() => {
    mutate(entry);
  }, UPLOAD_ORIGIN);
  return true;
}

/** Sets assetKey and status 'ready' (UPLOAD_ORIGIN). Stale id → false, no
 *  transaction (TC-07). */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  return setImageStatus(doc, id, (entry) => {
    entry.set('assetKey', assetKey);
    entry.set('status', 'ready');
  });
}

/** Sets status 'failed' (UPLOAD_ORIGIN). Stale id → false. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return setImageStatus(doc, id, (entry) => {
    entry.set('status', 'failed');
  });
}

/** Restart of a failed upload: status 'uploading' with a fresh
 *  uploadStartedAt (UPLOAD_ORIGIN). Stale id → false. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return setImageStatus(doc, id, (entry) => {
    entry.set('status', 'uploading');
    entry.set('uploadStartedAt', now);
  });
}

/** The extended snapshot for `id`, or null for a stale/non-image id. */
export function imageSnapshot(doc: Y.Doc, id: string): ImageSnap | null {
  const entry = imageEntry(doc, id);
  if (entry === undefined) return null;
  const x = entry.get('x');
  const y = entry.get('y');
  const width = entry.get('width');
  const height = entry.get('height');
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
  const naturalWidth = entry.get('naturalWidth');
  const naturalHeight = entry.get('naturalHeight');
  const uploadStartedAt = entry.get('uploadStartedAt');
  if (![x, y, width, height, z, createdAt, naturalWidth, naturalHeight, uploadStartedAt].every(finiteNumber)) {
    return null;
  }
  const status = entry.get('status');
  if (status !== 'uploading' && status !== 'ready' && status !== 'failed') return null;
  const assetKey = entry.get('assetKey');
  const snap: ImageSnap = {
    id,
    type: 'image',
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
    z: z as number,
    createdAt: createdAt as number,
    color: undefined,
    text: '',
    assetKey: assetKey === null || typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof entry.get('contentType') === 'string' ? (entry.get('contentType') as string) : '',
    naturalWidth: naturalWidth as number,
    naturalHeight: naturalHeight as number,
    status,
    uploadStartedAt: uploadStartedAt as number,
    uploaderId: typeof entry.get('uploaderId') === 'string' ? (entry.get('uploaderId') as string) : '',
  };
  return snap;
}

/**
 * Render status: an upload in flight longer than IMAGE_UPLOAD_STALE_MS is
 * `unfinished` (image.unfinished); everything else renders as stored.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
