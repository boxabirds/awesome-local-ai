// The image object: what an added picture is on the board and on the wire.
//
// An image is an object like any other - id, type, x, y, width, height, z - so selecting,
// moving, resizing, deleting, undoing and syncing all come to it for free. What it adds is
// the pair of states a picture needs: where its bytes are (`assetKey`, null until the
// upload lands) and what they really measure (`naturalWidth`/`naturalHeight`, so every
// client can hold the box in proportion without downloading anything).
//
// The byte-level truth is not stored here. `assetKey` is a bucket location - `<boardId>/
// <assetId>`, see `image-format.ts` - never a URL of somebody's machine, and the bytes
// themselves live in the bucket. That is what lets a colleague on another machine see the
// same picture, and what makes a paste of an image that never left the sender's clipboard
// impossible to share by accident.
//
// ## The two origins, and why an upload is not an undo step
//
// `createImagePlaceholders` writes with `LOCAL_ORIGIN`, like every other local edit, so a
// row of placeholders is one undo step: "Undo once removes all placeholders from one
// multi-drop" (PRD). The status writes do not: they use `UPLOAD_ORIGIN`, which no
// `Y.UndoManager` tracks. An upload that lands is not something the user typed, it cannot
// be undone, and the bytes are in the bucket either way - were it tracked, one Ctrl+Z after
// a drop of three images would undo an upload instead of the addition, or leave the three
// placeholders it is meant to remove. The separation is the whole reason `markImageReady`
// needs an origin of its own.
//
// ## `unfinished` is never written
//
// See `displayStatus`. A tab that was closed cannot fail an upload it never finished, so an
// upload that has been going for longer than any upload goes is called `unfinished` at
// render time, and nothing is deleted for it.
//
// Like the other object models, every reader is defensive: an entry that is not a readable
// image is not rendered rather than throwing, because a Y.Doc is shared and may hold
// anything.

import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
  TYPE_IMAGE,
} from '../config';
import { LOCAL_ORIGIN, newObjectId, type ObjectSnapshot } from '../board-model';
import { assetUrlFor } from '../image-format';
import type { Point, Rect } from '../geometry';

export type { Point };

/**
 * The origin of the status writes. Nothing is asked to track it, which is the point - see
 * the note at the top of this file.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-image-upload');

/** What the board stores. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** What a viewer is told, which adds the one state nobody wrote (see `displayStatus`). */
export type ImageDisplayStatus = ImageStatus | 'unfinished';

/** Where an image's bytes are, and what they measure. */
export interface ImageSnapshot extends ObjectSnapshot {
  type: typeof TYPE_IMAGE;
  /** `<boardId>/<assetId>`, or null while the bytes are still on their way. */
  assetKey: string | null;
  /** The Content-Type the bytes are served under - one of the four accepted ones. */
  contentType: string;
  /** The real pixel size, so proportions survive a resize on every client. */
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  /** When this image last began uploading, on the clock of the client that began it. */
  uploadStartedAt: number;
  /** Who began the upload: only that person is offered a retry. */
  uploaderId: string;
  /** Both always present: a placeholder has its box before it has its bytes. */
  width: number;
  height: number;
  createdAt: number;
}

export interface PlacementSize {
  width: number;
  height: number;
}

/** One image to place: where its file measured, and the box it is being put in. */
export interface PlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** The z above every object on the board, of any type. */
function topZ(objects: Y.Map<Y.Map<unknown>>): number {
  let top = 0;
  for (const object of objects.values()) {
    const z = object.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > top) top = z;
  }
  return top;
}

/**
 * The order the board's object lists are in everywhere: oldest first. A tie is left as the
 * document holds it, which is the order they were added in - the same reliance the other
 * object lists make, and the reason one row of placeholders reads left to right.
 */
function byCreation(a: { createdAt: number }, b: { createdAt: number }): number {
  return a.createdAt - b.createdAt;
}

/**
 * The box an image is placed at: its natural size scaled down until the longest edge is
 * `IMAGE_MAX_PLACE_SIZE_WORLD`, and never scaled up.
 *
 * 400x300 stays 400x300; 1600x1200 becomes 800x600; 300x3200 becomes 75x800 - the tall one is
 * capped on its long edge and so comes out narrow, which is what a tall screenshot looks
 * like on a board. A size that is not a usable number gives a box of nothing, which
 * `createImagePlaceholders` skips: a file whose dimensions nobody knows is a fact about the
 * file, not a programming error, and this function never throws.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): PlacementSize {
  if (!finite(naturalWidth) || !finite(naturalHeight)) return { width: 0, height: 0 };
  if (naturalWidth <= 0 || naturalHeight <= 0) return { width: 0, height: 0 };
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > IMAGE_MAX_PLACE_SIZE_WORLD ? IMAGE_MAX_PLACE_SIZE_WORLD / longest : 1;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * The boxes of one row, laid out from `point`: left to right with
 * `IMAGE_LAYOUT_GAP_WORLD` between them, every box's top edge on the row's top so the row
 * reads as a row.
 *
 * `top-left` puts the first box's top-left corner on the point - a drop, where the pointer
 * says where the picture begins. `centre` puts the whole row centred on it - a paste, where
 * there is no drop point and the middle of the view is the honest answer. The row's height is
 * its tallest box, and a shorter box keeps its own proportions rather than being stretched to
 * the row. No sizes gives no boxes.
 */
export function layoutRow(
  sizes: readonly PlacementSize[],
  point: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const usable = sizes.filter((size) => finite(size.width) && finite(size.height) && size.width > 0 && size.height > 0);
  if (usable.length === 0) return [];

  const rowWidth = usable.reduce((total, size) => total + size.width, 0) + IMAGE_LAYOUT_GAP_WORLD * (usable.length - 1);
  const rowHeight = Math.max(...usable.map((size) => size.height));
  const x = anchor === 'centre' ? point.x - rowWidth / 2 : point.x;
  const y = anchor === 'centre' ? point.y - rowHeight / 2 : point.y;

  const rects: Rect[] = [];
  let left = x;
  for (const size of usable) {
    rects.push({ x: left, y, width: size.width, height: size.height });
    left += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/**
 * One transaction: a placeholder per item, in the row layout, with the next z-indices in
 * order. Returns the ids it created, so the caller can upload into them.
 *
 * This is the only image write an undo manager is asked to see, and it holds the whole
 * addition: dropping three images is one Ctrl+Z that removes three placeholders.
 *
 * Items whose box or size is not usable are skipped, so a partially undecodable batch still
 * gets the images it can.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly PlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const usable = items.filter(
    (item) =>
      finite(item.rect.x) &&
      finite(item.rect.y) &&
      finite(item.rect.width) &&
      finite(item.rect.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0 &&
      finite(item.naturalWidth) &&
      finite(item.naturalHeight) &&
      item.naturalWidth > 0 &&
      item.naturalHeight > 0 &&
      typeof item.contentType === 'string' &&
      typeof uploaderId === 'string' &&
      finite(now),
  );
  if (usable.length === 0) return [];

  const created: string[] = [];
  doc.transact(() => {
    const objects = objectsOf(doc);
    let z = topZ(objects);
    for (const item of usable) {
      const id = newObjectId();
      z += 1;
      const object = new Y.Map<unknown>();
      object.set('type', TYPE_IMAGE);
      object.set('x', item.rect.x);
      object.set('y', item.rect.y);
      // the box is the placement as laid out: never widened to a minimum, because that
      // would break the proportions the box exists to keep
      object.set('width', item.rect.width);
      object.set('height', item.rect.height);
      object.set('z', z);
      object.set('createdAt', now);
      object.set('assetKey', null);
      object.set('contentType', item.contentType);
      object.set('naturalWidth', item.naturalWidth);
      object.set('naturalHeight', item.naturalHeight);
      object.set('status', 'uploading' satisfies ImageStatus);
      object.set('uploadStartedAt', now);
      object.set('uploaderId', uploaderId);
      objects.set(id, object);
      created.push(id);
    }
  }, LOCAL_ORIGIN);
  return created;
}

/**
 * Whether a status write may happen at all - checked before opening a transaction, so a
 * refused write writes nothing, not even an empty update for other clients to be told about.
 */
function isImage(doc: Y.Doc, id: string): boolean {
  const object = objectsOf(doc).get(id);
  return object instanceof Y.Map && object.get('type') === TYPE_IMAGE;
}

/**
 * The bytes landed. The box does not move and does not resize: only where the bytes are and
 * what to show change.
 *
 * False when the object is gone, or is not an image - a placeholder its uploader deleted
 * while its upload was in flight is a thing that happened, not an error to throw about.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  if (typeof assetKey !== 'string' || !isImage(doc, id)) return false;
  doc.transact(() => {
    const object = objectsOf(doc).get(id);
    if (!(object instanceof Y.Map)) return;
    object.set('assetKey', assetKey);
    object.set('status', 'ready' satisfies ImageStatus);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The upload failed. The image stays, box and all, because the person who made it may want
 * to try again and everyone else deserves to see that it did not land.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  if (!isImage(doc, id)) return false;
  doc.transact(() => {
    const object = objectsOf(doc).get(id);
    if (!(object instanceof Y.Map)) return;
    object.set('status', 'failed' satisfies ImageStatus);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * A retry began: back to `uploading`, and the clock starts again on the retrying client's
 * `now`, which is how a `failed` image - or one that had been called `unfinished` - gets its
 * chance to become ready. Undo never sees it, for the same reason the other status writes
 * don't.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  if (!finite(now) || !isImage(doc, id)) return false;
  doc.transact(() => {
    const object = objectsOf(doc).get(id);
    if (!(object instanceof Y.Map)) return;
    object.set('status', 'uploading' satisfies ImageStatus);
    object.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The state a viewer is shown.
 *
 * `unfinished` is computed and never stored: an upload that began more than
 * `IMAGE_UPLOAD_STALE_MS` ago has no client left to report it. Nothing may be deleted for it,
 * and the image stays fetchable by anyone who opens the board again. The boundary is strict:
 * at exactly the stale time the image is still `uploading`, one millisecond past it is not.
 */
export function displayStatus(image: ImageSnapshot, now: number): ImageDisplayStatus {
  if (image.status !== 'uploading') return image.status;
  if (!finite(now) || !finite(image.uploadStartedAt)) return 'uploading';
  return now - image.uploadStartedAt > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
}

/** One image as plain JSON, or null when the id is gone, is not an image, or is damaged. */
export function readImage(id: string, object: Y.Map<unknown>): ImageSnapshot | null {
  if (object.get('type') !== TYPE_IMAGE) return null;
  const x = object.get('x');
  const y = object.get('y');
  const z = object.get('z');
  const width = object.get('width');
  const height = object.get('height');
  const createdAt = object.get('createdAt');
  const contentType = object.get('contentType');
  const naturalWidth = object.get('naturalWidth');
  const naturalHeight = object.get('naturalHeight');
  const status = object.get('status');
  const uploadStartedAt = object.get('uploadStartedAt');
  const uploaderId = object.get('uploaderId');
  const assetKey = object.get('assetKey');
  if (
    !finite(x) ||
    !finite(y) ||
    !finite(z) ||
    !finite(width) ||
    !finite(height) ||
    !finite(createdAt) ||
    !finite(naturalWidth) ||
    !finite(naturalHeight) ||
    !finite(uploadStartedAt) ||
    width <= 0 ||
    height <= 0 ||
    typeof contentType !== 'string' ||
    typeof uploaderId !== 'string' ||
    (status !== 'uploading' && status !== 'ready' && status !== 'failed') ||
    !(assetKey === null || typeof assetKey === 'string')
  ) {
    return null;
  }
  return {
    id,
    type: TYPE_IMAGE,
    x,
    y,
    z,
    width,
    height,
    createdAt,
    assetKey: assetKey as string | null,
    contentType,
    naturalWidth,
    naturalHeight,
    status: status as ImageStatus,
    uploadStartedAt,
    uploaderId,
  };
}

export function imageSnapshot(doc: Y.Doc, id: string): ImageSnapshot | null {
  const object = objectsOf(doc).get(id);
  if (!(object instanceof Y.Map)) return null;
  return readImage(id, object);
}

/** Every image on the board, oldest first, exactly as the other object lists are ordered. */
export function imageSnapshots(doc: Y.Doc): readonly ImageSnapshot[] {
  const images: ImageSnapshot[] = [];
  objectsOf(doc).forEach((object: Y.Map<unknown>, id: string) => {
    const image = readImage(id, object);
    if (image !== null) images.push(image);
  });
  return images.sort(byCreation);
}

/**
 * The URL an image's bytes are served at, or null while it has no bytes. A path, never an
 * absolute URL: the asset route is same-origin, so there is no cross-origin rule to work
 * around and nothing to leak.
 */
export function imageUrl(image: Pick<ImageSnapshot, 'assetKey'>): string | null {
  return image.assetKey === null ? null : assetUrlFor(image.assetKey);
}
