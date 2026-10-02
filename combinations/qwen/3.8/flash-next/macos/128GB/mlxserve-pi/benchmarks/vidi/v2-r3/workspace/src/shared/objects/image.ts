/*! The image object (story 12).
 *
 * An image on the board is a small amount of Yjs and a key: the bytes live in the
 * object store, and this object says where they are once they are there. It is a
 * `type: 'image'` object like any other, so the selection, the move, the resize,
 * the delete and the undo of story 7 all work on it without knowing it holds a
 * picture (design: *Reuse, do not re-implement*).
 *
 * ## The states, and who may say what
 *
 * `uploading → ready` is the only success path, and only the tab holding the file
 * can say it; `uploading → failed` likewise. `ready` never leaves. A `failed`
 * object can go back to `uploading` — but only for the tab which still has the
 * file, which is why the retry lives in a client ref rather than in the document
 * (image.retry).
 *
 * `unfinished` is not a state. It is what the fourth line says about an object that
 * is still `uploading` after {@link IMAGE_UPLOAD_STALE_MS}: a tab which closed, or
 * crashed, or has been offline for six minutes does not update anything, and the
 * board would otherwise show a bar stuck at 45 % forever.
 *
 * ## The one thing this file exists to get right
 *
 * A placeholder is written with the *local* origin, so undoing an image is one step
 * (image.status_machine: *the undo of an image insertion removes its placeholder in
 * one step*). Its completion is written with {@link UPLOAD_ORIGIN}, which the undo
 * manager does not track: a completion is what happened to a file, not something
 * anybody did to the board. So one undo removes the image, and no number of undo
 * presses ever rewinds an upload that finished (TC-05).
 */
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { getObjects, isFiniteNumber, LOCAL_ORIGIN, maxZ, newId } from '../board-model';
import type { Point, Rect, Size } from '../geometry';

/** What the document says about an upload. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** What the board shows, which adds the state nobody wrote. */
export type DisplayStatus = ImageStatus | 'unfinished';

/** A snapshot of an image object: the box the board draws, plus the upload. */
export interface ImageSnap {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  /** `<boardId>/<assetId>`, or null while nothing is stored. */
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
  createdBy?: string;
}

/** One image to put on the board, at the place and size it is going to occupy. */
export interface ImageItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * The origin a completion is written under.
 *
 * It is a symbol of its own rather than {@link LOCAL_ORIGIN} or `undefined`
 * because neither of those would do: `undefined` would put completions into every
 * person's undo stack, and LOCAL_ORIGIN would make an image's upload its own undo
 * step, which is exactly what the story says it is not.
 *
 * It is exported for the tests, which is the only place it is used — the object
 * store, not this document, is what a completion is about.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

/** The status a stored value holds, or null when it holds none the board knows. */
function asStatus(value: unknown): ImageStatus | null {
  return value === 'uploading' || value === 'ready' || value === 'failed' ? value : null;
}

/**
 * The size an image is placed at: its own size, with its ratio kept, with the
 * longer side no more than {@link IMAGE_MAX_PLACE_SIZE_WORLD} board units, and
 * never blown up.
 *
 * A 1440x900 screenshot becomes 800x500 and a 4032x3024 photo becomes 800x600 —
 * both are 800 units wide because 800 units is the longest side the board places —
 * and a 400x300 picture stays 400x300, because making a small picture bigger is
 * not something anybody asked for.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  if (!isFiniteNumber(naturalWidth) || !isFiniteNumber(naturalHeight)) {
    return { width: NaN, height: NaN };
  }
  if (naturalWidth <= 0 || naturalHeight <= 0) return { width: NaN, height: NaN };
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * A row of boxes laid out left to right from `start`, with the gap between them
 * {@link IMAGE_LAYOUT_GAP_WORLD} board units.
 *
 * The tops are in line, which is what a row is, and the row's height is the tallest
 * box in it. `anchor` says what `start` means: `'top-left'` places the row's top-left
 * corner there, which is where a drop happened; `'centre'` puts the row's middle
 * there, which is where the view is.
 *
 * The order of `sizes` is the order of the row, so twenty files go on the board in
 * the order they were dropped (TC-04).
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const usable = sizes.filter(
    (size) => isFiniteNumber(size.width) && isFiniteNumber(size.height) && size.width > 0 && size.height > 0,
  );
  if (usable.length === 0) return [];
  const gap = IMAGE_LAYOUT_GAP_WORLD;
  const totalWidth =
    usable.reduce((sum, size) => sum + size.width, 0) + gap * (usable.length - 1);
  const tallest = usable.reduce((tallest, size) => Math.max(tallest, size.height), 0);
  let x = anchor === 'centre' ? start.x - totalWidth / 2 : start.x;
  const top = anchor === 'centre' ? start.y - tallest / 2 : start.y;
  const rects: Rect[] = [];
  for (const size of usable) {
    rects.push({ x, y: top, width: size.width, height: size.height });
    x += size.width + gap;
  }
  return rects;
}

/**
 * Put one placeholder per item on the board and give back their ids, in order.
 *
 * All of them are written in a single transaction, so twenty files dropped together
 * arrive as one update for everyone else and are undone as one step by the person
 * who dropped them. Each placeholder carries the size it was placed at, so the
 * placeholder has the picture's proportions from the first frame — nobody watches a
 * box change shape while bytes arrive — and the three fields that say who is
 * uploading and since when, which is what every other board needs in order to say
 * anything sensible about it.
 *
 * An item whose rect or natural size is not a number is skipped: it is not put on
 * the board at all, rather than put on it as a box nobody can see or move.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImageItem[],
  uploaderId: string,
  now: number,
): string[] {
  const objects = getObjects(doc);
  const usable = items.filter(
    (item) =>
      isFiniteNumber(item.rect.x) &&
      isFiniteNumber(item.rect.y) &&
      isFiniteNumber(item.rect.width) &&
      isFiniteNumber(item.rect.height) &&
      isFiniteNumber(item.naturalWidth) &&
      isFiniteNumber(item.naturalHeight),
  );
  const ids: string[] = [];
  if (usable.length === 0) return ids;
  doc.transact(() => {
    // Measured once: everything in this transaction is a new thing on top of what
    // is already there, and must not land under somebody's foot.
    let z = maxZ(objects);
    for (const item of usable) {
      const id = newId();
      const map = new Y.Map<unknown>();
      map.set('type', 'image');
      map.set('x', item.rect.x);
      map.set('y', item.rect.y);
      map.set('width', item.rect.width);
      map.set('height', item.rect.height);
      map.set('z', ++z);
      map.set('assetKey', null);
      map.set('contentType', item.contentType);
      map.set('naturalWidth', item.naturalWidth);
      map.set('naturalHeight', item.naturalHeight);
      map.set('status', 'uploading' satisfies ImageStatus);
      map.set('uploadStartedAt', now);
      map.set('uploaderId', uploaderId);
      map.set('createdAt', now);
      objects.set(id, map);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * Change one image object and return whether it is still there to change.
 *
 * Every completion is written the same way: only an object of this type is
 * touched, an object that went away in the meantime is reported as gone rather
 * than resurrected, and the write is untracked so that it is not a step anybody
 * can undo.
 */
function updateImage(doc: Y.Doc, id: string, write: (map: Y.Map<unknown>) => void): boolean {
  const objects = getObjects(doc);
  const map = objects.get(id);
  if (!map || map.get('type') !== 'image') return false;
  doc.transact(() => {
    // Re-read inside the transaction: the object could have gone away while this
    // call was being made, and an upload that comes back for a deleted image
    // finds nothing to write to (TC-20).
    const current = objects.get(id);
    if (!current || current.get('type') !== 'image') return;
    write(current);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The bytes are in the store under `assetKey`: the image is ready.
 *
 * Returns false when the object is gone — a deleted image, or never an image — and
 * writes nothing in that case. It does not say *who* finished: the tab holding the
 * file is the only one that calls this, and the uploader the placeholder was made
 * with is left alone, so a retry by the same tab keeps its history.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  if (typeof assetKey !== 'string' || assetKey === '') return false;
  return updateImage(doc, id, (map) => {
    map.set('status', 'ready' satisfies ImageStatus);
    map.set('assetKey', assetKey);
  });
}

/** The upload could not be done. The key stays empty, so nothing is served. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return updateImage(doc, id, (map) => {
    map.set('status', 'failed' satisfies ImageStatus);
    map.set('assetKey', null);
  });
}

/**
 * A second attempt at an upload that failed: back to `uploading`, and the clock for
 * the unfinished line starts again.
 *
 * Only the tab with the file ever calls this, and it is the only way a `failed`
 * object moves — the rule that failed never recovers is about the *document* being
 * able to recover itself, not about a person being unable to try again.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return updateImage(doc, id, (map) => {
    map.set('status', 'uploading' satisfies ImageStatus);
    map.set('uploadStartedAt', now);
  });
}

/**
 * What to show for an image, which is the stored status plus the one state that is
 * not stored: an upload which started more than {@link IMAGE_UPLOAD_STALE_MS} ago
 * is a thing that did not finish, and says so.
 *
 * `now` comes from the caller rather than from a clock of its own, because a state
 * that depends on the time has to be re-evaluated as time passes and that belongs to
 * the renderer (the shared tick in ImageObject), not to the model. Exactly
 * `IMAGE_UPLOAD_STALE_MS` is still uploading: the line is *after* five minutes
 * (TC-06).
 */
export function displayStatus(image: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (image.status !== 'uploading') return image.status;
  if (!isFiniteNumber(image.uploadStartedAt) || !isFiniteNumber(now)) return 'uploading';
  return now - image.uploadStartedAt > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
}

/**
 * Read a stored image. Exported for `board-model`, which owns the reading of every
 * object and so is the only place that decides what a damaged image means.
 *
 * The box is read as stored — the selection, the resize and the delete all work on
 * it — and an image that cannot be measured is not on the board: an image whose
 * natural size is missing has no ratio to keep, which is the one thing an image
 * object has to have.
 */
export function readImage(map: Y.Map<unknown>, id: string): ImageSnap | null {
  const x = map.get('x');
  const y = map.get('y');
  const z = map.get('z');
  const createdAt = map.get('createdAt');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z) || !isFiniteNumber(createdAt)) {
    return null;
  }
  const width = map.get('width');
  const height = map.get('height');
  if (!isFiniteNumber(width) || width <= 0 || !isFiniteNumber(height) || height <= 0) return null;
  const naturalWidth = map.get('naturalWidth');
  const naturalHeight = map.get('naturalHeight');
  if (!isFiniteNumber(naturalWidth) || naturalWidth <= 0) return null;
  if (!isFiniteNumber(naturalHeight) || naturalHeight <= 0) return null;
  const status = asStatus(map.get('status'));
  if (status === null) return null;
  const uploadStartedAt = map.get('uploadStartedAt');
  const uploaderId = map.get('uploaderId');
  if (typeof uploaderId !== 'string' || uploaderId === '') return null;
  const contentType = map.get('contentType');
  const storedKey = map.get('assetKey');
  // A ready object with no key has nothing to show and is not worth keeping, but
  // it is not this function's call to delete: it is reported with no key, and the
  // renderer says the picture is unavailable.
  const assetKey = typeof storedKey === 'string' && storedKey !== '' ? storedKey : null;
  const createdBy = map.get('createdBy');

  return {
    id,
    type: 'image',
    x,
    y,
    width,
    height,
    z,
    createdAt,
    assetKey,
    contentType: typeof contentType === 'string' ? contentType : 'application/octet-stream',
    naturalWidth,
    naturalHeight,
    // `ready` is the one status that must not survive without a key: a document
    // which says the bytes are there when nothing says where they are is damaged,
    // and the honest reading of it is the failure the board then shows.
    status: status === 'ready' && assetKey === null ? 'failed' : status,
    uploadStartedAt: isFiniteNumber(uploadStartedAt) ? uploadStartedAt : createdAt,
    uploaderId,
    ...(typeof createdBy === 'string' ? { createdBy } : {}),
  };
}
