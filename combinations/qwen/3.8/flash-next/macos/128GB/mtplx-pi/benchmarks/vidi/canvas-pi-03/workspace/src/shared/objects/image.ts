// Image object model (story 12, contract `image.model`).
//
// An image is an ordinary board object: it lives in the same `objects` Y.Map as
// a note or a shape, so moving / resizing / deleting / undoing it is the generic
// story-7 code with no per-type branch. What is special is only its extra
// fields (where its bytes are, whether they have arrived yet) and the two rules
// that make a batch of images behave like one thing:
//
//   * Placement is scaled down to a sane size and never upscaled.
//   * A whole add action (drop / paste / pick) is ONE undo step, because its
//     placeholders are created in ONE LOCAL_ORIGIN transaction. Status updates
//     (`markImageReady` / `markImageFailed`) run under `UPLOAD_ORIGIN`, which
//     the UndoManager does NOT track, so an upload finishing later is never a
//     separate undo step.
//
// Everything here is framework- and DOM-free: it runs in Node against a real
// Y.Doc in the unit tests and in the browser unchanged.

import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Point, Rect } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';

/** A footprint size, in world units. Deliberately local so this shared module
 * does not depend on the client camera module. */
export interface Size {
  width: number;
  height: number;
}

/** Transaction origin for image status updates. Deliberately NOT in the
 * UndoManager's tracked origins, so an upload that lands (or fails) seconds
 * after its placeholder is created never becomes its own undo step. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
/** What the renderer shows. `unfinished` is never stored: it is derived at
 * render time from how long an `uploading` image has been waiting. */
export type DisplayStatus = ImageStatus | 'unfinished';

/** The render-time projection of one image (see board-model's snapshot path). */
export interface ImageSnap {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  /** The R2 key `boardId/assetId`, or null until the upload returns it. */
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

/**
 * The board size to place an image at: its natural pixel dimensions, scaled
 * down proportionally so the LONGEST side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
 * An image smaller than that keeps its exact size (never upscaled). A
 * non-positive / non-finite input yields a zero size, which the caller skips.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Lay a row of footprints out left to right. `start` is either the row's
 * top-left corner (`anchor: 'top-left'`, used by a drop, so the first image's
 * top-left lands exactly under the pointer and the tops line up with it) or the
 * centre of the visible area (`anchor: 'centre'`, used by paste and the picker,
 * where the whole row is centred on that point). Images are separated by
 * IMAGE_LAYOUT_GAP_WORLD. An empty list yields an empty layout.
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  const n = sizes.length;
  if (n === 0) return [];
  let totalWidth = 0;
  let maxHeight = 0;
  for (let i = 0; i < n; i += 1) {
    totalWidth += sizes[i].width;
    if (i < n - 1) totalWidth += IMAGE_LAYOUT_GAP_WORLD;
    if (sizes[i].height > maxHeight) maxHeight = sizes[i].height;
  }
  let x = start.x;
  let top = start.y;
  if (anchor === 'centre') {
    x = start.x - totalWidth / 2;
    top = start.y - maxHeight / 2;
  }
  const rects: Rect[] = [];
  for (const size of sizes) {
    rects.push({ x, y: top, width: size.width, height: size.height });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/** The stack value a new image gets: on top of everything already on the board. */
function topZ(doc: Y.Doc): number {
  let z = 0;
  doc.getMap<Y.Map<unknown>>('objects').forEach((obj) => {
    const value = obj.get('z');
    if (typeof value === 'number' && value > z) z = value;
  });
  return z;
}

/** One placeholder entry. `rect` is the image's final footprint (already
 * scaled by `placementSize` + laid out by `layoutRow`), so the placeholder is
 * the size the image will be (image.uploading). */
export interface ImagePlaceholder {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Create one placeholder object per entry, in a SINGLE LOCAL_ORIGIN transaction:
 * the whole drop / paste / pick is therefore ONE undo step, and every connected
 * person renders the uploading state straight from these fields. Entries whose
 * footprint is not finite (or non-positive) are skipped, so a corrupt decode
 * cannot write a broken object. Returns the new ids in the order given; an empty
 * or fully-skipped batch creates nothing and returns [].
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholder[],
  uploaderId: string,
  now: number,
): string[] {
  const usable = items.filter(
    (item) =>
      Number.isFinite(item.rect.x) &&
      Number.isFinite(item.rect.y) &&
      Number.isFinite(item.rect.width) &&
      Number.isFinite(item.rect.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0,
  );
  if (usable.length === 0) return [];
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const ids: string[] = [];
  doc.transact(() => {
    // One z bump for the whole batch: the images of one add action share the
    // same stacking band, in the order they were laid out.
    let z = topZ(doc);
    for (const item of usable) {
      const id = crypto.randomUUID();
      z += 1;
      const record = new Y.Map<unknown>();
      record.set('type', 'image');
      record.set('x', item.rect.x);
      record.set('y', item.rect.y);
      record.set('width', item.rect.width);
      record.set('height', item.rect.height);
      record.set('z', z);
      record.set('createdAt', now);
      record.set('assetKey', null);
      record.set('contentType', item.contentType);
      record.set('naturalWidth', item.naturalWidth);
      record.set('naturalHeight', item.naturalHeight);
      record.set('status', 'uploading');
      record.set('uploadStartedAt', now);
      record.set('uploaderId', uploaderId);
      objects.set(id, record);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/** The image record for `id`, or null for a stale / non-image id. */
function imageRecord(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const record = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (record === undefined || record.get('type') !== 'image') return null;
  return record;
}

/**
 * Mark an image's bytes as uploaded and hand everyone the key to fetch them
 * (image.shared). A stale or non-image id returns false and writes nothing.
 * Runs under UPLOAD_ORIGIN so completing an upload is not an undo step.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const record = imageRecord(doc, id);
  if (record === null) return false;
  if (record.get('status') === 'ready' && record.get('assetKey') === assetKey) return false;
  doc.transact(() => {
    record.set('assetKey', assetKey);
    record.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image's upload as failed (image.upload_failure). A stale or non-image
 * id returns false and writes nothing. Runs under UPLOAD_ORIGIN.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const record = imageRecord(doc, id);
  if (record === null) return false;
  doc.transact(() => {
    record.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Start a retry: back to `uploading` with a fresh clock, so the placeholder
 * shows progress again instead of "Upload failed". A stale / non-image id
 * returns false. Runs under UPLOAD_ORIGIN.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const record = imageRecord(doc, id);
  if (record === null) return false;
  doc.transact(() => {
    record.set('status', 'uploading');
    record.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The status to render: the stored status, except that an upload still marked
 * `uploading` after IMAGE_UPLOAD_STALE_MS is shown as `unfinished` (image.unfinished).
 * Exactly at the timeout is still `uploading`; one millisecond past is
 * `unfinished` (that boundary is tested).
 */
export function displayStatus(img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
