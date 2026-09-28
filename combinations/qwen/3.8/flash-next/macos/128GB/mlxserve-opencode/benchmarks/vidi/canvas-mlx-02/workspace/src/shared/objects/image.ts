// The image object (story 12, design `image.model`): a picture somebody dropped,
// pasted or picked onto the board. It lives in the SAME `objects` map as the sticky
// note, the shape, the arrow and the drawing, so story 7's select / move / resize /
// z-order and story 8's undo act on it without ever having heard of an upload.
//
// What makes an image unlike a sticky is that its bytes do NOT live in the Y.Doc -
// the doc holds a PLACEHOLDER (a box, the intrinsic pixel size, and a status), and
// the bytes live in R2 behind an assetKey. The placeholder is created in ONE
// LOCAL_ORIGIN transaction (so a whole add of three images is ONE undo step,
// TC-05); the status changes that follow (ready / failed / retrying) are written
// under UPLOAD_ORIGIN, which the story 8 UndoManager does NOT track, so an upload
// finishing never becomes its own undo step.
//
// The box's SIZE is decided before upload by `placementSize` (the longest side fits
// IMAGE_MAX_PLACE_SIZE_WORLD, never upscaled) and its ASPECT is locked from then on
// (the registry marks the type aspect-locked), so a photo resized stays a photo.
import * as Y from 'yjs';
import type { Point, Rect, Size } from '../geometry.ts';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config.ts';
import { LOCAL_ORIGIN, objectsMapOf } from '../board-model.ts';
import type { ObjectSnapshot } from '../board-model.ts';

/** The one type string an image is stored under. */
export const IMAGE_TYPE = 'image';

/**
 * The origin every upload-driven status write goes out under. It is deliberately
 * NOT `LOCAL_ORIGIN`, so it is not in the story 8 UndoManager's tracked origins:
 * an upload completing must never become a separate undo step (TC-05, image.undo).
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

/** The persisted lifecycle of an image placeholder. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';
/** What a viewer sees: the persisted status, or `unfinished` derived at render. */
export type DisplayStatus = ImageStatus | 'unfinished';

export interface ImageSnapshot extends ObjectSnapshot {
  type: 'image';
  /** `<boardId>/<assetId>` once stored in R2, null while still uploading. */
  assetKey: string | null;
  /** the sniffed content type the asset is served with. */
  contentType: string;
  /** intrinsic pixel size - the source of the box's locked aspect ratio. */
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  /** wall clock (ms) the upload began, for the stale (`unfinished`) sweep. */
  uploadStartedAt: number;
  /** clientId of the tab that uploaded it (whose progress to show). */
  uploaderId: string;
}

/** The design's shorter name for the same snapshot. */
export type ImageSnap = ImageSnapshot;

const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Is this snapshot an image, with the fields an image needs? The board model reader
 * validates every one of them, so this is the cast the registry and the components
 * narrow through instead of asserting.
 */
export function isImageSnapshot(obj: ObjectSnapshot | null | undefined): obj is ImageSnapshot {
  return (
    !!obj &&
    obj.type === IMAGE_TYPE &&
    (obj.status === 'uploading' || obj.status === 'ready' || obj.status === 'failed') &&
    isCoord(obj.naturalWidth) &&
    isCoord(obj.naturalHeight)
  );
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMapOf(doc).forEach((m) => {
    const z = Number(m.get('z'));
    if (Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/**
 * The box an image of `naturalWidth` x `naturalHeight` is placed at: scaled so its
 * LONGEST side is at most IMAGE_MAX_PLACE_SIZE_WORLD, never upscaled (a small image
 * stays its own size, aspect kept), and never smaller than one world unit a side.
 * This is the "it doesn't cover the board in a huge square" rule.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  if (!isCoord(naturalWidth) || !isCoord(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  // Only ever shrink: the scale is the smaller of "fits the box" and 1, so a small
  // image is never blown up to the maximum.
  const scale = longest > IMAGE_MAX_PLACE_SIZE_WORLD ? IMAGE_MAX_PLACE_SIZE_WORLD / longest : 1;
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

/**
 * Lay `sizes` out in one horizontal row starting at `start`, left to right, tops
 * aligned, with IMAGE_LAYOUT_GAP_WORLD of space between neighbours.
 *
 * `start` means different things by anchor: `top-left` (a drop) puts the FIRST box's
 * top-left at the point the cursor was over; `centre` (a pick or paste) centres the
 * whole row - horizontally AND vertically - on the point (usually the view's centre),
 * so an image added from a toolbar or the clipboard lands under the eye, not at the
 * top-left corner of everything.
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  const list = sizes.filter((s) => s && isCoord(s.width) && isCoord(s.height) && s.width > 0 && s.height > 0);
  if (list.length === 0) return [];

  // The row's full span, so the centre anchor can hang it on the point.
  const totalWidth =
    list.reduce((sum, s) => sum + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * (list.length - 1);
  const tallest = list.reduce((m, s) => Math.max(m, s.height), 0);

  let cursorX: number;
  let topY: number;
  if (anchor === 'centre') {
    cursorX = start.x - totalWidth / 2;
    topY = start.y - tallest / 2;
  } else {
    cursorX = start.x;
    topY = start.y;
  }

  const rects: Rect[] = [];
  for (const s of list) {
    rects.push({ x: cursorX, y: topY, width: s.width, height: s.height });
    cursorX += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

export interface ImagePlaceholderInput {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Create the whole batch of placeholders in ONE LOCAL_ORIGIN transaction - which is
 * what makes "add 3 images, one Ctrl+Z" remove all 3 (TC-05, image.undo). Each comes
 * back with `status: 'uploading'`, its `uploadStartedAt` and `uploaderId`, so every
 * participant (not just the uploader) sees the uploading state (image.uploading).
 *
 * An item whose rect or dimensions are not finite is skipped (it never becomes a
 * broken object); when nothing survives, NO transaction is opened at all and the
 * result is empty. `z` climbs so a later image lands on top of an earlier one.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholderInput[],
  uploaderId: string,
  now: number,
): string[] {
  const usable = items.filter(
    (it) =>
      it &&
      it.rect &&
      isCoord(it.rect.x) &&
      isCoord(it.rect.y) &&
      isCoord(it.rect.width) &&
      isCoord(it.rect.height) &&
      it.rect.width > 0 &&
      it.rect.height > 0 &&
      isCoord(it.naturalWidth) &&
      isCoord(it.naturalHeight),
  );
  if (usable.length === 0) return [];

  const ids: string[] = [];
  doc.transact(
    () => {
      const objects = objectsMapOf(doc);
      let z = maxZ(doc);
      for (const it of usable) {
        const id = crypto.randomUUID();
        const m = new Y.Map<unknown>();
        m.set('type', IMAGE_TYPE);
        m.set('x', it.rect.x);
        m.set('y', it.rect.y);
        m.set('width', it.rect.width);
        m.set('height', it.rect.height);
        m.set('z', ++z);
        m.set('createdAt', now);
        m.set('assetKey', null);
        m.set('contentType', it.contentType);
        m.set('naturalWidth', it.naturalWidth);
        m.set('naturalHeight', it.naturalHeight);
        m.set('status', 'uploading');
        m.set('uploadStartedAt', now);
        m.set('uploaderId', uploaderId);
        objects.set(id, m);
        ids.push(id);
      }
    },
    LOCAL_ORIGIN,
  );
  return ids;
}

/** Run `write` on a still-present image under UPLOAD_ORIGIN; false if it is gone. */
function writeStatus(doc: Y.Doc, id: string, write: (m: Y.Map<unknown>) => void): boolean {
  const m = objectsMapOf(doc).get(id);
  if (!m || m.get('type') !== IMAGE_TYPE) return false; // stale id: refused, no update
  doc.transact(() => write(m), UPLOAD_ORIGIN);
  return true;
}

/** Mark uploaded: attach the assetKey and go ready. False if `id` is gone (TC-07). */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  return writeStatus(doc, id, (m) => {
    m.set('assetKey', assetKey);
    m.set('status', 'ready');
  });
}

/** Mark an upload failure. The object STAYS (image.upload_failure), false if gone. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return writeStatus(doc, id, (m) => {
    m.set('status', 'failed');
  });
}

/** Start a retry: back to uploading with a fresh `uploadStartedAt`. False if gone. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return writeStatus(doc, id, (m) => {
    m.set('assetKey', null);
    m.set('status', 'uploading');
    m.set('uploadStartedAt', now);
  });
}

/**
 * What a viewer sees for this image, at wall clock `now`:
 *   - ready  -> ready
 *   - failed -> failed
 *   - uploading for longer than IMAGE_UPLOAD_STALE_MS -> unfinished (the uploader
 *     vanished before finishing; image.unfinished), otherwise still uploading.
 * The threshold is STRICTLY greater than the stale span, so the stale boundary is
 * exactly IMAGE_UPLOAD_STALE_MS (TC-06).
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'ready') return 'ready';
  if (img.status === 'failed') return 'failed';
  // 'uploading': unfinished once it has sat there past the stale span.
  if (isCoord(img.uploadStartedAt) && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return 'uploading';
}
