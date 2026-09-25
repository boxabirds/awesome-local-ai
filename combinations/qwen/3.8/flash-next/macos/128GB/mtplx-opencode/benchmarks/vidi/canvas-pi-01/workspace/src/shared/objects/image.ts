/**
 * Story 12 · the image object model (design "Image object model",
 * `image.model`).
 *
 * An image is one board object, sized to its natural pixels at insertion and
 * then treated like any other object by the generic move / resize / delete code
 * (story 7). This module owns only the *model* — placing placeholders, moving
 * them into a row, and the status transitions an upload drives — so it is a set
 * of pure-ish functions over a real `Y.Doc`, testable in Node with no DOM.
 *
 * Undo is decided here (PRD undo + design "Decision on undo"): the whole batch
 * of placeholders for one add action is written in **one `LOCAL_ORIGIN`
 * transaction**, so it is a single personal-undo step (one Ctrl+Z removes the
 * whole row). The later status changes — an upload completing or failing — are
 * written under {@link UPLOAD_ORIGIN}, which the `Y.UndoManager` does *not*
 * track, so a completed upload never becomes a second undo step and undoing the
 * insertion removes the images rather than resurrecting a stale placeholder.
 *
 * Like every model module this never throws for user input: a stale id, a
 * non-finite size or a missing record returns `false` (or skips the item) and
 * opens no transaction, costing no sync traffic.
 */
import * as Y from 'yjs';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import type { Point, Rect } from '../geometry';
import {
  LOCAL_ORIGIN,
  finite,
  newId,
  objectsOf,
  recordIsType,
  topZ,
  type ObjectRecord,
} from '../doc';

/** The object type string, the registry key and the snapshot discriminator. */
export const IMAGE_TYPE = 'image';

/**
 * Transaction origin for upload status changes. Deliberately *not*
 * {@link LOCAL_ORIGIN}: the story-8 undo manager tracks only that one symbol,
 * so a `ready` / `failed` update written under this origin syncs to everyone
 * but is not itself an undoable step (PRD undo, design Decision on undo).
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

/** The persisted upload state of an image object. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** The state the renderer shows: the persisted status plus the derived `unfinished`. */
export type DisplayStatus = ImageStatus | 'unfinished';

/**
 * An image as the render layer sees it: the generic object fields plus the
 * stored upload fields. `assetKey` is `null` until an upload succeeds; it is
 * what every participant's `ImageObject` turns into an `<img>`.
 */
export interface ImageSnap {
  id: string;
  type: typeof IMAGE_TYPE;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
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
 * The size an image is placed at: its natural pixel dimensions in board units,
 * scaled down (never up) so the longest side is at most
 * {@link IMAGE_MAX_PLACE_SIZE_WORLD} (PRD image.placement_size). A factor of
 * exactly `1` leaves an image under the limit untouched, so a 400×300 screenshot
 * stays 400×300 while a 1600×1200 photo becomes 800×600. A non-finite or
 * zero dimension yields a 0×0 box, which {@link createImagePlaceholders} then
 * skips.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
    return { width: 0, height: 0 };
  }
  if (naturalWidth <= 0 || naturalHeight <= 0) return { width: 0, height: 0 };
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Lay a row of sizes out left to right with a {@link IMAGE_LAYOUT_GAP_WORLD}
 * gap (PRD image.drop). Two anchors:
 *
 *  - `'top-left'` (a drop): the first image's top-left sits on `start` and the
 *    row runs right, every top aligned at `start.y`;
 *  - `'centre'` (picker and paste): the *whole* row is centred on `start`, so
 *    its bounding box — total width including the gaps, and the tallest image —
 *    has `start` at its centre.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const n = sizes.length;
  if (n === 0) return [];
  const totalWidth =
    sizes.reduce((sum, size) => sum + size.width, 0) + IMAGE_LAYOUT_GAP_WORLD * (n - 1);
  const tallest = sizes.reduce((max, size) => Math.max(max, size.height), 0);

  let firstLeft: number;
  let top: number;
  if (anchor === 'centre') {
    firstLeft = start.x - totalWidth / 2;
    top = start.y - tallest / 2;
  } else {
    firstLeft = start.x;
    top = start.y;
  }

  const rects: Rect[] = [];
  let x = firstLeft;
  for (const size of sizes) {
    rects.push({ x, y: top, width: size.width, height: size.height });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/** A `{ width, height }` pair, as {@link layoutRow} takes it. */
export interface Size {
  width: number;
  height: number;
}

/** One placeholder to create: its final box plus the metadata it is rendered from. */
export interface PlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

function isImageRecord(record: ObjectRecord | undefined): record is ObjectRecord {
  return recordIsType(record, IMAGE_TYPE);
}

/**
 * Create the placeholders for one add action in a single `LOCAL_ORIGIN`
 * transaction — one undo step (PRD undo). Items whose box has any non-finite
 * component are skipped, so a corrupt file that produced a `0×0` or `NaN` size
 * never becomes an object. Returns the ids actually written, in the given
 * order. The whole batch raises to `topZ + 1, +2, …` so a freshly added row
 * sits above what was already on the board.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly PlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const usable = items.filter(
    (item) =>
      finite(item.rect.x, item.rect.y, item.rect.width, item.rect.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0,
  );
  if (usable.length === 0) return [];

  const ids: string[] = [];
  for (const _item of usable) ids.push(newId());

  doc.transact(() => {
    const objects = objectsOf(doc);
    // The base z is read once so the whole row stacks above the board, in order.
    let z = topZ(doc);
    for (let i = 0; i < usable.length; i++) {
      const item = usable[i];
      const record = new Y.Map<unknown>();
      record.set('type', IMAGE_TYPE);
      record.set('x', item.rect.x);
      record.set('y', item.rect.y);
      record.set('width', item.rect.width);
      record.set('height', item.rect.height);
      record.set('z', ++z);
      record.set('createdAt', now);
      record.set('assetKey', null);
      record.set('contentType', item.contentType);
      record.set('naturalWidth', item.naturalWidth);
      record.set('naturalHeight', item.naturalHeight);
      record.set('status', 'uploading' satisfies ImageStatus);
      record.set('uploadStartedAt', now);
      record.set('uploaderId', uploaderId);
      objects.set(ids[i], record);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * Mark an image `ready` with its asset key, under {@link UPLOAD_ORIGIN} (no undo
 * step). A stale or non-image id is a no-op returning `false`; so is an id that
 * is not currently `uploading` (a completed or failed image is not silently
 * re-completed). Writing the key is what lets every client switch to the
 * rendered image (PRD image.shared).
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const record = objectsOf(doc).get(id);
  if (!isImageRecord(record)) return false;
  if (record.get('status') !== 'uploading') return false;
  doc.transact(() => {
    record.set('assetKey', assetKey);
    record.set('status', 'ready' satisfies ImageStatus);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Mark an image `failed` (PRD image.upload_failure). Allowed from `uploading`
 * and from a `ready` image whose file later fails to load is *not* this path —
 * that stays a render-only `unavailable`. A stale id or an already-failed image
 * returns `false` and opens no transaction.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const record = objectsOf(doc).get(id);
  if (!isImageRecord(record)) return false;
  if (record.get('status') !== 'uploading') return false;
  doc.transact(() => {
    record.set('status', 'failed' satisfies ImageStatus);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Return a failed image to `uploading` for a Retry (PRD image.upload_failure):
 * the status goes back to `uploading` and `uploadStartedAt` is reset to `now`,
 * so the 5-minute unfinished clock restarts. Only valid from `failed`; any
 * other state (or a stale id) is a no-op. Still under {@link UPLOAD_ORIGIN}.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const record = objectsOf(doc).get(id);
  if (!isImageRecord(record)) return false;
  if (record.get('status') !== 'failed') return false;
  doc.transact(() => {
    record.set('status', 'uploading' satisfies ImageStatus);
    record.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The state to render (design state diagram). `unfinished` is derived, not
 * stored: an upload that has been in `uploading` for strictly more than
 * {@link IMAGE_UPLOAD_STALE_MS} is assumed abandoned (the uploader reloaded or
 * closed the page) and shown as "Image upload didn't finish" to everyone
 * (PRD image.unfinished). Exactly at the boundary it is still `uploading`; one
 * millisecond past it is `unfinished`.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status !== 'uploading') return img.status;
  const age = now - img.uploadStartedAt;
  if (age > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
  return 'uploading';
}