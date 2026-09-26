/**
 * The image object model (story 12).
 *
 * An image is an ordinary board object plus the facts a renderer needs that
 * are *not* the pixels: where its bytes are stored (`assetKey`, null until
 * the upload answers), what they are (`contentType`, `naturalWidth`,
 * `naturalHeight`), and where the upload is (`status`, `uploadStartedAt`,
 * `uploaderId`). The document carries the placeholder and the picture
 * through the same Yjs map every other object uses, which is what makes
 * "everyone sees the same board" true of images without a second protocol.
 *
 * ## The two transaction origins
 *
 * Placeholder creation is a `LOCAL_ORIGIN` transaction: adding three photos
 * is one action, so it is one undo step, and one undo removes all three.
 * Status updates — the upload landing, failing, or being retried — are
 * `UPLOAD_ORIGIN`, which the UndoManager does not track: nobody presses
 * undo because a server finished a download, and "completion is not a
 * separate undo step" is only true because the origin says so.
 */
import * as Y from 'yjs';
import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import { LOCAL_ORIGIN, objectsMap } from '../board-model';
import type { Point, Rect } from '../geometry';

/** Origin for upload-driven writes; deliberately absent from the undo scope. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6:upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** `failed` plus the render-time derivation for a dead upload. */
export type DisplayStatus = ImageStatus | 'unfinished';

/** One image as the render pass sees it. */
export interface ImageSnap {
  id: string;
  type: 'image';
  /** Top-left corner, world units. */
  x: number;
  y: number;
  /** The box the image occupies — its placed or resized size. */
  width: number;
  height: number;
  z: number;
  createdAt: number;
  /** `boardId/assetId` once uploaded; null while the bytes are still in flight. */
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

/** An image as the document stores it. */
type ImageMap = Y.Map<unknown>;

function asImageMap(value: unknown): ImageMap | undefined {
  return value instanceof Y.Map && value.get('type') === 'image'
    ? (value as ImageMap)
    : undefined;
}

/** True for any stored image object, whether or not its upload is alive. */
export function isImageObject(value: unknown): value is ImageMap {
  return asImageMap(value) !== undefined;
}

function finiteNumber(...values: unknown[]): boolean {
  return values.every((value) => typeof value === 'number' && Number.isFinite(value));
}

/**
 * The size an image is placed at: its natural pixels as board units, scaled
 * down so the longest side is at most `IMAGE_MAX_PLACE_SIZE_WORLD`.
 *
 * Only down, never up — a 400×300 screenshot stays 400×300. Enlarging small
 * images would turn a 64px icon into an 800-unit wall, and a photo already
 * at the cap stays exactly at the cap (the boundary is inclusive).
 *
 * Row placement — which slot each entry of a batch lands in — is the client
 * row's `placeImageRow` (design §"Image placement"), one function for drop
 * and paste alike; this file stays the document layer.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  if (!finiteNumber(naturalWidth, naturalHeight)) return { width: 0, height: 0 };
  if (naturalWidth <= 0 || naturalHeight <= 0) return { width: 0, height: 0 };
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/** Highest `z` among all board objects, images included. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((value) => {
    const map = asImageMap(value);
    const z = map ? map.get('z') : (value as Y.Map<unknown>)?.get?.('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/** One placeholder entry: where it goes, what it holds, in input order. */
export interface ImagePlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Create the placeholders for one add action, in one transaction.
 *
 * One transaction is the undo contract (story 8): the whole drop is one step
 * and one undo clears it. The transaction runs under `LOCAL_ORIGIN`, and the
 * caller has already ended any capture group before it, so the step does not
 * merge into whatever came before either.
 *
 * An item with a non-finite or empty rect is skipped — a placeholder with no
 * size would be an object nothing can select or draw — and its id is simply
 * absent from the result.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const usable = items.filter(
    (item) =>
      finiteNumber(item.rect.x, item.rect.y, item.rect.width, item.rect.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0,
  );
  if (usable.length === 0) return [];
  const objects = objectsMap(doc);
  const ids: string[] = [];
  const baseZ = maxZ(doc);
  doc.transact(() => {
    usable.forEach((item, index) => {
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `image-${Math.random().toString(36).slice(2)}`;
      const image = new Y.Map<unknown>();
      image.set('type', 'image');
      image.set('x', item.rect.x);
      image.set('y', item.rect.y);
      image.set('width', item.rect.width);
      image.set('height', item.rect.height);
      image.set('z', baseZ + index + 1);
      image.set('createdAt', now);
      image.set('assetKey', null);
      image.set('contentType', item.contentType);
      image.set('naturalWidth', item.naturalWidth);
      image.set('naturalHeight', item.naturalHeight);
      image.set('status', 'uploading');
      image.set('uploadStartedAt', now);
      image.set('uploaderId', uploaderId);
      objects.set(id, image);
      ids.push(id);
    });
  }, LOCAL_ORIGIN);
  return ids;
}

/** One image's map, live, for a status update. */
function readImage(doc: Y.Doc, id: string): ImageMap | undefined {
  return asImageMap(objectsMap(doc).get(id));
}

/**
 * A status update under the untracked origin: a stale id answers `false` and
 * writes nothing, and a live image changes in exactly one transaction —
 * exactly one — so the change never becomes its own undo step.
 */
function updateImage(doc: Y.Doc, id: string, write: (image: ImageMap) => void): boolean {
  const image = readImage(doc, id);
  if (!image) return false;
  doc.transact(() => write(image), UPLOAD_ORIGIN);
  return true;
}

/** The upload landed: show the picture. False for a stale id. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  return updateImage(doc, id, (image) => {
    image.set('assetKey', assetKey);
    image.set('status', 'ready');
  });
}

/** The upload failed (or was refused): show the failed state. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return updateImage(doc, id, (image) => {
    image.set('status', 'failed');
  });
}

/** Retry restarts the clock so the placeholder reads as uploading again. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return updateImage(doc, id, (image) => {
    image.set('status', 'uploading');
    image.set('uploadStartedAt', now);
  });
}

/**
 * What the render pass shows. An upload that has been "uploading" for longer
 * than `IMAGE_UPLOAD_STALE_MS` did not finish: somebody closed the tab. It
 * is derived at render, not stored, because nobody is there to store it —
 * the browser that started the upload may be gone.
 */
export function displayStatus(image: ImageSnap, now: number): DisplayStatus {
  if (image.status === 'uploading' && now - image.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return image.status;
}
