/**
 * Images on the board (story 12).
 *
 * An image is the first object on this board whose *content* is not in the document. A sticky note is its
 * words, a shape is its label, a stroke is its points — all of them bytes that Yjs can carry and undo. A
 * screenshot is three million bytes, which is not something to put through a CRDT: the document holds a
 * pointer to the picture (`assetKey`) and everything a board needs in order to draw a box around it while the
 * bytes are still on their way.
 *
 * That choice is what the rest of this file is built on:
 *
 *  1. **The placeholder is created before the bytes are uploaded**, in a local transaction, so it appears for
 *     everybody on the board immediately and not only on the screen of the person who dropped the file.
 *  2. **The upload's result is written in its own origin (`UPLOAD_ORIGIN`), never in `LOCAL_ORIGIN`.** An
 *     upload finishing is something that happens *to* the board seconds after the drop, on its own schedule;
 *     if it were written in the local origin it would land in the person's history, and Undo would then mean
 *     undoing an event rather than an action (design decision 3, and the reason `tests/component/ImageObject`
 *     has a test with the words "it is not something that happens *to* you" in it).
 *  3. **`status` is a fact about the upload, not a promise about the bytes.** `ready` means there is a key to
 *     fetch; it does not mean the picture will load when anybody asks for it. Whether it does is discovered by
 *     the `<img>` and drawn as "image unavailable" — the split is asserted by name in the design and by test in
 *     `tests/component/ImageObject.test.tsx`.
 */

import * as Y from 'yjs';

import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
  isAcceptedImageType,
  type AcceptedImageType,
} from '../config';
import type { Point, Rect } from '../geometry';
import {
  LOCAL_ORIGIN,
  registerKnownObjectType,
  registerObjectReader,
  snapshot,
  type ObjectSnapshot,
} from '../board-model';

/** The object type id. */
export const IMAGE_OBJECT_TYPE = 'image';

/** What the board says an image is, to a person who cannot see it. */
export const IMAGE_ARIA_LABEL = 'Image';

/**
 * The transaction origin every upload result is written in: `markImageReady`, `markImageFailed` and
 * `markImageRetrying`, and nothing else.
 *
 * `LOCAL_ORIGIN` means "this tab's user did this", which is what the board's undo history listens to and what
 * the room treats as a confirmation boundary. An upload completing is neither: it is the arrival of an HTTP
 * response, and it is written here so that both of those can ignore it.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

/** How far an upload has got, as stored in the document. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** What the board draws for an image: the three stored states plus the one nobody wrote. */
export type ImageDisplayStatus = ImageStatus | 'unfinished';

/** A size, in whatever units the sentence is about — pixels for a picture, world units for a box. */
export interface Size {
  width: number;
  height: number;
}

/** An image, as the board reads it. */
export interface ImageSnap extends ObjectSnapshot {
  readonly type: 'image';
  /** Where the stored picture is (`<board id>/<asset id>`), or `null` while it is still being uploaded. */
  readonly assetKey: string | null;
  /** What the file said it was. The server confirmed it from the bytes before it stored anything. */
  readonly contentType: AcceptedImageType;
  /** The picture's own size in pixels — what the proportions of the box are kept to. */
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly status: ImageStatus;
  /** When this attempt started, in milliseconds. The only clock the unfinished state has. */
  readonly uploadStartedAt: number;
  /** Whose tab is uploading it: `String(doc.clientID)`, which is per tab and stable for the upload. */
  readonly uploaderId: string;
}

/** One image to place: the box it goes in, and the picture it is standing in for. */
export interface ImageItem {
  readonly rect: Rect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly contentType: AcceptedImageType;
}

function numberOr(object: Y.Map<unknown>, key: string, fallback: number): number {
  const value = object.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function storedStatus(object: Y.Map<unknown>): ImageStatus | null {
  const status = object.get('status');
  return status === 'uploading' || status === 'ready' || status === 'failed' ? status : null;
}

function storedAssetKey(object: Y.Map<unknown>): string | null {
  const key = object.get('assetKey');
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/**
 * Is this snapshot an image?
 *
 * Every number has to be a number: an image whose `naturalWidth` arrived as a string from an older document
 * cannot be drawn at a size, cannot be resized proportionally and cannot be talked about by a screen reader,
 * so it is not an image as far as the board is concerned.
 */
export function isImageSnapshot(snapshot: ObjectSnapshot): snapshot is ImageSnap {
  const image = snapshot as Partial<ImageSnap>;
  const statusIsKnown = image.status === 'uploading' || image.status === 'ready' || image.status === 'failed';
  return (
    image.type === IMAGE_OBJECT_TYPE &&
    (image.assetKey === null || (typeof image.assetKey === 'string' && image.assetKey.length > 0)) &&
    isAcceptedImageType(image.contentType) &&
    typeof image.naturalWidth === 'number' &&
    Number.isFinite(image.naturalWidth) &&
    image.naturalWidth > 0 &&
    typeof image.naturalHeight === 'number' &&
    Number.isFinite(image.naturalHeight) &&
    image.naturalHeight > 0 &&
    typeof image.uploadStartedAt === 'number' &&
    Number.isFinite(image.uploadStartedAt) &&
    typeof image.uploaderId === 'string' &&
    statusIsKnown
  );
}

/** The fields this type adds to the generic snapshot. */
function imageFields(object: Y.Map<unknown>): Record<string, unknown> {
  return {
    assetKey: storedAssetKey(object),
    contentType: isAcceptedImageType(object.get('contentType')) ? object.get('contentType') : 'image/png',
    naturalWidth: numberOr(object, 'naturalWidth', 0),
    naturalHeight: numberOr(object, 'naturalHeight', 0),
    status: storedStatus(object) ?? 'uploading',
    uploadStartedAt: numberOr(object, 'uploadStartedAt', 0),
    uploaderId: typeof object.get('uploaderId') === 'string' ? object.get('uploaderId') : '',
  };
}

// Making the type known is what lets an image appear in a selection at all: an unknown type is skipped when
// the document is read, so a placeholder would be invisible to the board until the upload finished.
registerObjectReader(IMAGE_OBJECT_TYPE, { fields: (object, _boxes, _id) => imageFields(object) });
registerKnownObjectType(IMAGE_OBJECT_TYPE);

/** The objects map, in this file's own terms. The document model keeps its own copy of this name. */
function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** An image by id, or `null` for an id that holds no image. */
export function readImage(doc: Y.Doc, id: string): ImageSnap | null {
  for (const object of snapshot(doc)) {
    if (object.id === id) return isImageSnapshot(object) ? object : null;
  }
  return null;
}

/** Every image on the board, in stacking order — the order the board draws them in. */
export function imageSnapshots(doc: Y.Doc): readonly ImageSnap[] {
  return snapshot(doc).filter(isImageSnapshot);
}

/**
 * The box a picture of this size is placed at.
 *
 * A 4032 pixel photo is not four thousand board units wide: sixteen screens of a photo nobody asked to scroll
 * through. Anything larger than `IMAGE_MAX_PLACE_SIZE_WORLD` on its longest side is scaled down to fit, both
 * sides by the same factor, so a photo keeps its proportions and a board keeps a shape. A picture that is
 * already smaller is placed at its own size — a 64 pixel icon does not become 800 units of icon.
 *
 * `null` for a picture with no size, because there is no box to draw for one.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size | null {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return null;
  if (naturalWidth <= 0 || naturalHeight <= 0) return null;
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > IMAGE_MAX_PLACE_SIZE_WORLD ? IMAGE_MAX_PLACE_SIZE_WORLD / longest : 1;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * A row of images, laid out left to right starting at `start`.
 *
 * Files from one drop become a row rather than a pile at one point because a pile of three is one image and
 * two hints: the person who dropped three screenshots has to be able to see that there are three of them. The
 * gap is one grid cell, the tops are in a line, and each image keeps the size `placementSize` gave it.
 *
 * With `top-left` the row starts at the point the files were dropped, so a picture lands where the pointer
 * was; with `centre` the whole row is centred on the point, which is what a paste wants — the clipboard has no
 * position, and the middle of the screen is the only place a paste can be looked for.
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  if (sizes.length === 0) return [];

  const widest = sizes.reduce((total, size) => total + size.width, 0) + IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);
  const tallest = sizes.reduce((tallestSoFar, size) => Math.max(tallestSoFar, size.height), 0);
  let x = anchor === 'centre' ? start.x - widest / 2 : start.x;
  const y = anchor === 'centre' ? start.y - tallest / 2 : start.y;

  const rects: Rect[] = [];
  for (const size of sizes) {
    rects.push({ x, y, width: size.width, height: size.height });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

function isFiniteRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/** How far above everybody else the next object goes, of everything in the map. */
function highestZOf(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const object of objects.values()) {
    if (!(object instanceof Y.Map)) continue;
    const z = object.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

/** `crypto.randomUUID()`, with a fallback for environments without WebCrypto. */
function newImageId(): string {
  const cryptoRef = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  return `image-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
}

/**
 * Put one placeholder per file on the board, in a single local transaction.
 *
 * One transaction, because dropping three files is one action: it is one entry in the undo history, so one
 * undo takes all three away (TC-07), and everybody else on the board sees three images arrive at once rather
 * than one at a time as three uploads were started.
 *
 * The returned ids are in the order the files came in, which is the order the uploads are started in and the
 * order the row is laid out in. An item with no size is skipped rather than placed: a box with no width cannot
 * be drawn, hit or resized, and an image with no dimensions cannot be scaled to anything.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImageItem[],
  uploaderId: string,
  now: number,
): string[] {
  const objects = objectsOf(doc);
  const ids: string[] = [];
  let z = highestZOf(objects) + 1;

  doc.transact(() => {
    for (const item of items) {
      if (!isFiniteRect(item.rect)) continue;
      if (!Number.isFinite(item.naturalWidth) || !Number.isFinite(item.naturalHeight)) continue;
      if (item.naturalWidth <= 0 || item.naturalHeight <= 0) continue;

      const id = newImageId();
      const object = new Y.Map<unknown>();
      object.set('type', IMAGE_OBJECT_TYPE);
      object.set('x', item.rect.x);
      object.set('y', item.rect.y);
      object.set('width', item.rect.width);
      object.set('height', item.rect.height);
      object.set('z', z++);
      object.set('createdAt', now);
      object.set('assetKey', null);
      object.set('contentType', item.contentType);
      object.set('naturalWidth', item.naturalWidth);
      object.set('naturalHeight', item.naturalHeight);
      object.set('status', 'uploading' satisfies ImageStatus);
      object.set('uploadStartedAt', now);
      object.set('uploaderId', uploaderId);
      objects.set(id, object);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/** The image with this id, written in the origin uploads have. `null` if there is no image to write to. */
function writeImage(doc: Y.Doc, id: string, write: (object: Y.Map<unknown>) => boolean): boolean {
  const object = objectsOf(doc).get(id);
  if (!(object instanceof Y.Map)) return false;
  if (object.get('type') !== IMAGE_OBJECT_TYPE) return false;

  let written = false;
  doc.transact(() => {
    if (write(object)) written = true;
  }, UPLOAD_ORIGIN);
  return written;
}

/**
 * The bytes are stored: here is the key.
 *
 * `false` when there is nothing to write it into — which is not an error. A person who deleted the image while
 * it was in flight was making a decision about the board, and the upload finishing after that is not a reason
 * to put it back (design decision 10). `false` also when this exact result is already recorded, because an
 * update that changes nothing should not be sent to anybody.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  return writeImage(doc, id, (object) => {
    if (object.get('assetKey') === assetKey && storedStatus(object) === 'ready') return false;
    object.set('assetKey', assetKey);
    object.set('status', 'ready' satisfies ImageStatus);
    return true;
  });
}

/** The upload did not make it. The key stays absent; there is nothing to fetch. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return writeImage(doc, id, (object) => {
    if (storedStatus(object) === 'failed') return false;
    object.set('status', 'failed' satisfies ImageStatus);
    return true;
  });
}

/**
 * Trying again, now.
 *
 * The timestamp is written with the status because the unfinished state is measured from when *this attempt*
 * started: an upload that is retried four minutes into the first attempt would otherwise be reported as having
 * not finished the moment it was retried.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return writeImage(doc, id, (object) => {
    if (storedStatus(object) === 'uploading' && object.get('uploadStartedAt') === now) return false;
    object.set('status', 'uploading' satisfies ImageStatus);
    object.set('uploadStartedAt', now);
    return true;
  });
}

/**
 * What to draw for this image right now.
 *
 * `uploading` becomes `unfinished` once `IMAGE_UPLOAD_STALE_MS` has gone by since the attempt started, and that
 * is the whole of how the board knows: there is no message when an uploader goes away, no lease and no heartbeat
 * — a placeholder left by a tab that was closed has a timestamp and nothing else, and any reader with a clock
 * can see what that timestamp has become. The document's clock (`doc.getCollection('objects')`'s own notion of
 * time being a different thing) is not involved; the caller passes the time it is drawing at.
 */
export function displayStatus(image: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): ImageDisplayStatus {
  if (image.status !== 'uploading') return image.status;
  const age = now - image.uploadStartedAt;
  return Number.isFinite(age) && age > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
}

/** Where a stored picture is fetched from, or `null` for an image that has nothing stored yet. */
export function assetUrl(assetKey: string | null): string | null {
  return assetKey === null ? null : `/api/assets/${assetKey}`;
}

/** An image's own proportions, or `null` when they cannot be known. */
export function imageAspectRatio(image: Pick<ImageSnap, 'naturalWidth' | 'naturalHeight'>): number | null {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
  return image.naturalWidth / image.naturalHeight;
}
