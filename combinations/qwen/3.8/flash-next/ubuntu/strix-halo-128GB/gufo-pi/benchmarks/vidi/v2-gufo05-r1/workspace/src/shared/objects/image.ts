/**
 * The image object: a picture stored outside the document, shown inside it
 * (`image.model`).
 *
 * An image is the one board object whose bytes do not live in the `Y.Doc`. The document
 * holds a reference — an `assetKey`, the type, the natural size and where the upload got
 * to — and the bytes live in the bucket behind `/api/assets/<key>`. That has one consequence
 * this module is entirely about: an object can exist before the picture does. So every image
 * starts as a placeholder (`status: 'uploading'`) that everybody can see, and the upload
 * either finishes (`ready`, and the picture appears for everyone), or does not (`failed`, for
 * the person who was uploading it), or is never finished at all — the uploader's tab went
 * away, and `displayStatus` says so after `IMAGE_UPLOAD_STALE_MS` rather than leaving a
 * permanent "Uploading…" on five screens.
 *
 * Undo is the other reason this file is careful about origins. The placeholders of one drop
 * are written in a single `LOCAL_ORIGIN` transaction, so they are one undo step
 * (`undo.steps`); the status updates that follow are written with `UPLOAD_ORIGIN`, which the
 * undo manager does not track, so "the upload finished" is never a separate step a person has
 * to undo twice — and undoing an add action takes the whole row away at once, placeholders and
 * all (`image.add_one_step`).
 *
 * A note is read back whole; an image is read back as a claim about bytes that might not be
 * there. Nothing in this file assumes those bytes exist, and nothing here deletes them: an
 * object removed from a board leaves its key behind, which is what lets a reload bring the
 * picture back (`image.reload_persistent`).
 */
import * as Y from 'yjs';

import { highestZ, LOCAL_ORIGIN, OBJECTS_KEY, type ObjectSnapshot } from '../board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Point, Rect, Size } from '../geometry';
import { isFiniteNumber } from '../util';

/** The string this object writes to `type`. */
export const IMAGE_TYPE = 'image';

/**
 * Origin of the status writes an upload makes.
 *
 * It is deliberately *not* one of the origins the undo manager tracks: completing an upload
 * is the tail of an add action that has already been recorded, not a change of its own.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

/** Where an image's upload got to, as the document stores it. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** What a screen shows: the stored status, plus `unfinished` derived from the clock. */
export type DisplayStatus = ImageStatus | 'unfinished';

/** The statuses the document is allowed to hold. Anything else is a document problem. */
const STATUSES: readonly ImageStatus[] = ['uploading', 'ready', 'failed'];

/** An immutable view of one image, as React renders it. */
export interface ImageSnapshot extends ObjectSnapshot {
  readonly type: 'image';
  /** The stored key, or `null` while the bytes have not landed. */
  readonly assetKey: string | null;
  readonly contentType: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly status: ImageStatus;
  readonly uploadStartedAt: number;
  readonly uploaderId: string;
}

/** Round to two decimals: below that a world unit is smaller than a pixel at any zoom. */
const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * The size an image with these natural dimensions is placed at.
 *
 * The longest side is brought down to `IMAGE_MAX_PLACE_SIZE_WORLD` and nothing else
 * (`image.placement_size`): a 4032×3024 photo becomes 800×600 so it is a picture on a board
 * rather than a wall, and a 300×200 icon stays 300×200 because enlarging a small image only
 * makes it blurry.
 *
 * Returns `null` for dimensions that are not usable — zero, negative or not a number — which
 * is how a document written by an older or stranger client is refused rather than drawn as an
 * infinitely large rectangle.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size | null {
  if (!isFiniteNumber(naturalWidth) || !isFiniteNumber(naturalHeight)) return null;
  if (naturalWidth <= 0 || naturalHeight <= 0) return null;
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return { width: round(naturalWidth * scale), height: round(naturalHeight * scale) };
}

/**
 * Lay a row of sizes out from a point, left to right (`image.layout`).
 *
 * One add action of three images is one row: the first sits at `start` (or is centred on it,
 * for a paste, where the point is where the clipboard picture was put), and each image after
 * it sits `IMAGE_LAYOUT_GAP_WORLD` past the right edge of the previous. All of them share the
 * row's top edge, so the row reads as one object being placed rather than as three
 * coincidences.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];
  const totalWidth =
    sizes.reduce((sum, size) => sum + size.width, 0) +
    IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);
  const tallest = sizes.reduce((tallestSoFar, size) => Math.max(tallestSoFar, size.height), 0);

  let x = anchor === 'centre' ? start.x - totalWidth / 2 : start.x;
  const y = anchor === 'centre' ? start.y - tallest / 2 : start.y;

  const rects: Rect[] = [];
  for (const size of sizes) {
    rects.push({ x, y, width: size.width, height: size.height });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/** Is this item usable enough to become an object? */
function isPlaceable(item: { rect: Rect; naturalWidth: number; naturalHeight: number }): boolean {
  const { rect } = item;
  return (
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height) &&
    rect.width > 0 &&
    rect.height > 0 &&
    isFiniteNumber(item.naturalWidth) &&
    isFiniteNumber(item.naturalHeight) &&
    item.naturalWidth > 0 &&
    item.naturalHeight > 0
  );
}

/**
 * Write the placeholders of one add action, and return their ids in order.
 *
 * One `doc.transact` for the whole batch, on purpose: it is one sync message to everybody
 * else and one undo step for the person who dropped the files, which is what makes undo of a
 * three-image drop take the three away together (`undo.steps`).
 *
 * The items are stacked from the current top of the board, so a drop lands above what is
 * already there the same way a new note does. Items that are not usable are skipped, and a
 * batch of nothing but unusable items writes nothing at all — not an empty transaction, which
 * would still be an empty step in the undo history.
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
  const usable = items.filter(isPlaceable);
  if (usable.length === 0) return [];

  const objects = doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>;
  const ids = usable.map(() => crypto.randomUUID());
  const baseZ = highestZ(doc);

  doc.transact(() => {
    usable.forEach((item, index) => {
      const map = new Y.Map<unknown>();
      map.set('type', IMAGE_TYPE);
      map.set('x', item.rect.x);
      map.set('y', item.rect.y);
      map.set('width', item.rect.width);
      map.set('height', item.rect.height);
      map.set('z', baseZ + index + 1);
      map.set('createdAt', now);
      map.set('assetKey', null);
      map.set('contentType', item.contentType);
      map.set('naturalWidth', item.naturalWidth);
      map.set('naturalHeight', item.naturalHeight);
      map.set('status', 'uploading' satisfies ImageStatus);
      map.set('uploadStartedAt', now);
      map.set('uploaderId', uploaderId);
      objects.set(ids[index] as string, map);
    });
  }, LOCAL_ORIGIN);

  return ids;
}

/** The map of one image, only if it is an image. */
function imageMap(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const map = (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).get(id);
  if (!map || map.get('type') !== IMAGE_TYPE) return null;
  return map;
}

/**
 * Write a status, outside the undo history.
 *
 * Every status change is one field on one object, and the whole point of `UPLOAD_ORIGIN` is
 * that this is not a step: a person who undoes a drop while its upload is still running
 * removes the object, and the upload then has nothing to write to (`markImageReady` answers
 * `false`, and the bytes it uploaded are left behind unreferenced rather than resurrecting a
 * deleted object).
 */
function writeStatus(doc: Y.Doc, id: string, write: (map: Y.Map<unknown>) => void): boolean {
  const map = imageMap(doc, id);
  if (!map) return false;
  doc.transact(() => write(map), UPLOAD_ORIGIN);
  return true;
}

/** The upload finished: show these bytes to everybody. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  if (!assetKey) return false;
  return writeStatus(doc, id, (map) => {
    map.set('assetKey', assetKey);
    map.set('status', 'ready' satisfies ImageStatus);
  });
}

/** The upload did not, for the person who was doing it. Nobody else sees a change. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return writeStatus(doc, id, (map) => {
    map.set('status', 'failed' satisfies ImageStatus);
  });
}

/** Try again: back to `uploading`, with the clock restarted so `unfinished` cannot fire. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  if (!isFiniteNumber(now)) return false;
  return writeStatus(doc, id, (map) => {
    map.set('status', 'uploading' satisfies ImageStatus);
    map.set('uploadStartedAt', now);
  });
}

/**
 * What a screen should show for this image right now.
 *
 * Three of the four answers are stored. The fourth, `unfinished`, is not: it is what an
 * `uploading` image becomes once `IMAGE_UPLOAD_STALE_MS` has gone by
 * (`image.unfinished`), and computing it from the clock instead of storing it means there is
 * no timer to run, nothing to synchronise, and no way for a client that joined five minutes
 * late to be told the upload is still going on.
 *
 * Exactly stale is not stale. The uploader is allowed the full window.
 */
export function displayStatus(image: ImageSnapshot, now: number): DisplayStatus {
  if (image.status !== 'uploading') return image.status;
  if (!isFiniteNumber(image.uploadStartedAt) || !isFiniteNumber(now)) return 'uploading';
  return now - image.uploadStartedAt > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
}

/** Is this stored status one of the three we know? */
export function isImageStatus(value: unknown): value is ImageStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/**
 * Read one `Y.Map` as an image, or return `null` when it is not one.
 *
 * The geometry is checked like every other object's, and so is the status: an image whose
 * `status` is nonsense is not shown at all, because every status has a different body and a
 * guessed one would show a spinner for bytes that are already there. A missing `assetKey` is
 * not nonsense — it is the state before the upload lands.
 */
export function snapshotFrom(id: string, map: Y.Map<unknown>): ImageSnapshot | null {
  const x = map.get('x');
  const y = map.get('y');
  const width = map.get('width');
  const height = map.get('height');
  const z = map.get('z');
  const createdAt = map.get('createdAt');
  const naturalWidth = map.get('naturalWidth');
  const naturalHeight = map.get('naturalHeight');
  const uploadStartedAt = map.get('uploadStartedAt');
  const status = map.get('status');
  const assetKey = map.get('assetKey');
  const contentType = map.get('contentType');
  const uploaderId = map.get('uploaderId');
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    !isFiniteNumber(z) ||
    !isFiniteNumber(createdAt) ||
    !isFiniteNumber(naturalWidth) ||
    !isFiniteNumber(naturalHeight) ||
    !isFiniteNumber(uploadStartedAt) ||
    !isImageStatus(status)
  ) {
    return null;
  }
  return {
    id,
    type: 'image',
    x,
    y,
    width,
    height,
    z,
    createdAt,
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : 'application/octet-stream',
    naturalWidth,
    naturalHeight,
    status,
    uploadStartedAt,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
  };
}

/**
 * Do two image snapshots differ in a way a screen has to notice?
 *
 * `board-model` compares snapshots to decide whether to re-render. The status and the key are
 * the whole of what an upload changes, and both change *after* creation — so a comparison that
 * left either out would leave a finished picture invisible until the board reloaded.
 */
export function sameAs(previous: ImageSnapshot, next: ImageSnapshot): boolean {
  return (
    previous.assetKey === next.assetKey &&
    previous.contentType === next.contentType &&
    previous.naturalWidth === next.naturalWidth &&
    previous.naturalHeight === next.naturalHeight &&
    previous.status === next.status &&
    previous.uploadStartedAt === next.uploadStartedAt &&
    previous.uploaderId === next.uploaderId
  );
}
