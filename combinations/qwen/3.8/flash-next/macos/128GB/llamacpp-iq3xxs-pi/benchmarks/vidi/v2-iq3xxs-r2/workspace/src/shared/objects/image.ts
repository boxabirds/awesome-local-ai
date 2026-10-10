import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { isAssetKey } from '../image-format';
import {
  LOCAL_ORIGIN,
  newObjectId,
  OBJECTS_MAP,
  topZ,
  type ObjectSnapshotBase,
} from '../board-model';
import type { Point, Rect, Size } from '../geometry';

/**
 * The image object (story 12).
 *
 * An image on the board is a *reference*: its bytes live in R2 under a key the board can
 * spell, and the document holds that key, the box it is drawn at, and how the upload got on.
 * Three things follow from that, and they are the three things this module is careful about.
 *
 * **A ready image and an image still waiting for its bytes are the same object.** Both have a
 * box; only `status` and `assetKey` differ. That is what lets a placeholder reach every other
 * participant inside a second with no new sync code — and it is why the size an image will be
 * drawn at is written at creation rather than after the bytes land: a placeholder that
 * resized itself into place on completion would shove the row apart a second after everybody
 * had got used to it (`image.placement_size`).
 *
 * **`uploading` is a claim about somebody else's tab.** Only the tab that started an upload
 * can finish it, and there is no way to ask that tab whether it still exists. So `displayStatus`
 * ages the claim against `IMAGE_UPLOAD_STALE_MS` instead of trusting it for ever
 * (`image.unfinished`) — the judgement presence makes about a person, made about an upload.
 *
 * **The bytes are never here.** Nothing in this module touches R2; it stores keys of the form
 * `<boardId>/<assetId>`, which `src/worker/assets.ts` serves back.
 */

/** The object type this module owns. */
export const IMAGE_TYPE = 'image';

/**
 * The origin of every write an upload makes — ready, failed, retrying.
 *
 * It is deliberately not one of the origins the UndoManager tracks, so an upload finishing
 * cannot become an undo step: whoever dropped three images has exactly one thing to undo, and
 * Ctrl+Z must not cost them two more (TC-05). The writes are still ordinary document changes,
 * so they sync like any other and are stored with the board.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

/** Where an image's upload has got to, as the document records it. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/**
 * What a viewer should draw: `ImageStatus` plus what the viewer's own clock says about an
 * upload that has not landed. `unfinished` is never stored — it is `uploading` with a clock
 * behind it, so nobody watches a spinner for a tab that has gone.
 */
export type DisplayStatus = ImageStatus | 'unfinished';

/** An image object as the document holds it. */
export interface ImageSnap extends ObjectSnapshotBase {
  type: typeof IMAGE_TYPE;
  /** `<boardId>/<assetId>` once the bytes are stored; null while they are still travelling. */
  assetKey: string | null;
  /** The MIME type the bytes were accepted as, recorded when the placeholder was made. */
  contentType: string;
  /** Natural pixel size, so an aspect-locked resize still works after a reload. */
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  /** Doc-clock ms when the upload began — what `IMAGE_UPLOAD_STALE_MS` is measured from. */
  uploadStartedAt: number;
  /** Who queued the upload: who may retry it, and whose upload this tab should expect. */
  uploaderId: string;
  known: true;
}

/** One image to place: its box (already measured and laid out) and what it is. */
export interface ImagePlacement {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/* ------------------------------------------------------------------ sizing */

/**
 * The box an image is placed at, given the pixels the file reported — one pixel to one board
 * unit, until the longest side reaches `IMAGE_MAX_PLACE_SIZE_WORLD`, at which point both
 * sides shrink by the same factor and the picture keeps its shape (`image.placement_size`).
 *
 * The ceiling exists because a screenshot's own pixels are a rectangle that does not fit: a
 * 1440x900 screenshot dropped at 100% is wider than the window, and the first thing the
 * person does after adding it is zoom out to find the rest of the board. Nothing is ever
 * enlarged — a 40-pixel icon is a 40-pixel icon, and making it 800 units wide is not what
 * anybody asked for.
 *
 * Bytes that are not a picture have no size, and `{ width: 0, height: 0 }` means exactly
 * that: an invisible object on the board is worse than no object, so callers skip it.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const width = wholePixels(naturalWidth);
  const height = wholePixels(naturalHeight);
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) return { width, height };
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  // Rounding each side separately is what keeps 1600x1200 at exactly 800x600, and the
  // longest side exact, which is the number a person measures a row of images by.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The boxes of a row of images: left to right, separated by `IMAGE_LAYOUT_GAP_WORLD`, tops
 * aligned. `'top-left'` puts the row's own top-left corner at `start` (a drop, where the
 * first image lands under the cursor); `'centre'` centres the row on `start` (a paste or a
 * pick, where there is no point in the board the person was aiming at).
 *
 * Tops are aligned rather than middles because a row of images is read as a row: middles
 * would leave the short ones floating at odd heights, and one tall image would push its
 * neighbours' tops about. The tallest image is what the row is centred vertically on.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const placed: Rect[] = [];
  let x = start.x;
  let tallest = 0;
  for (const size of sizes) {
    const width = Math.max(0, size.width);
    const height = Math.max(0, size.height);
    placed.push({ x, y: start.y, width, height });
    x += width + IMAGE_LAYOUT_GAP_WORLD;
    tallest = Math.max(tallest, height);
  }
  if (placed.length === 0) return placed;
  if (anchor === 'centre') {
    // `x` is now one gap past the end of the row; the gap is taken back before halving.
    const width = x - IMAGE_LAYOUT_GAP_WORLD - start.x;
    const dx = -width / 2;
    const dy = -tallest / 2;
    for (const rect of placed) {
      rect.x += dx;
      rect.y += dy;
    }
  }
  return placed;
}

/* ------------------------------------------------------------- the document */

type YObject = Y.Map<unknown>;

/** The object `id`, when it is an image; undefined for a stale id or another type. */
function imageItem(doc: Y.Doc, id: string): YObject | undefined {
  if (id.length === 0) return undefined;
  const item = (doc.getMap(OBJECTS_MAP) as Y.Map<unknown>).get(id);
  if (!(item instanceof Y.Map) || item.get('type') !== IMAGE_TYPE) return undefined;
  return item as YObject;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A pixel count as a whole number; anything that is not a number at all is 0. */
function wholePixels(value: number): number {
  return isFiniteNumber(value) ? Math.round(value) : 0;
}

function statusOf(item: YObject): ImageStatus {
  const status = item.get('status');
  return status === 'ready' || status === 'failed' ? status : 'uploading';
}

function assetKeyOf(item: YObject): string | null {
  const key = item.get('assetKey');
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/**
 * Create the placeholders for one add action, all in one transaction: the whole drop is one
 * undo step and one update to everybody else's board (`image.insert`, TC-05).
 *
 * Each one is already the size and place it will keep, because a placeholder that grew into
 * shape when the bytes landed would shove the row apart a moment after everybody had got used
 * to where things were. An item whose natural size is not a number is skipped rather than
 * guessed at — a placeholder nobody can see would be left behind as an object to explain.
 *
 * Returns the new ids in the order they were asked for, skipping any that were not usable.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlacement[],
  uploaderId: string,
  now: number,
): string[] {
  const usable = items.filter((item) => {
    const size = placementSize(item.naturalWidth, item.naturalHeight);
    return (
      size.width > 0 &&
      size.height > 0 &&
      isFiniteNumber(item.rect.x) &&
      isFiniteNumber(item.rect.y) &&
      isFiniteNumber(item.rect.width) &&
      isFiniteNumber(item.rect.height)
    );
  });
  const ids: string[] = [];
  if (usable.length === 0) return ids;
  const startedAt = isFiniteNumber(now) ? now : 0;
  doc.transact(() => {
    const objects = doc.getMap(OBJECTS_MAP) as Y.Map<YObject>;
    let z = topZ(doc);
    for (const item of usable) {
      const id = newObjectId();
      const object = new Y.Map<unknown>();
      object.set('type', IMAGE_TYPE);
      object.set('x', item.rect.x);
      object.set('y', item.rect.y);
      object.set('width', item.rect.width);
      object.set('height', item.rect.height);
      object.set('z', (z += 1));
      object.set('assetKey', null);
      object.set('contentType', typeof item.contentType === 'string' ? item.contentType : '');
      object.set('naturalWidth', item.naturalWidth);
      object.set('naturalHeight', item.naturalHeight);
      object.set('status', 'uploading' satisfies ImageStatus);
      // The stale clock starts here, so a viewer's `displayStatus` measures the upload from
      // the moment the person asked for it, not from when this tab noticed.
      object.set('uploadStartedAt', startedAt);
      object.set('uploaderId', typeof uploaderId === 'string' ? uploaderId : '');
      objects.set(id, object);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * The bytes are stored: point this image at `assetKey` and call it ready.
 *
 * `UPLOAD_ORIGIN`, so this is not an undo step — the drop is the thing that can be undone —
 * but an ordinary document change otherwise, which is what makes the finished image appear
 * for everybody and for whoever opens the board next week (`image.shared`). False for a stale
 * or foreign id, and for a key that could never be served: storing an unservable key would
 * turn a visible failure into an image-shaped hole.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const item = imageItem(doc, id);
  if (!item || !isAssetKey(assetKey)) return false;
  doc.transact(() => {
    item.set('assetKey', assetKey);
    item.set('status', 'ready' satisfies ImageStatus);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The upload did not land. The box stays where it is, in the state `image.object` calls
 * "Upload failed" for the person who can do something about it and "Image unavailable" for
 * everybody else.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const item = imageItem(doc, id);
  if (!item) return false;
  doc.transact(() => {
    item.set('status', 'failed' satisfies ImageStatus);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * A retry, which is the same object going back to `uploading` with a fresh clock: the old
 * attempt's `uploadStartedAt` has to be replaced, or the other viewers would go on reading
 * the abandoned upload they were already right about.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const item = imageItem(doc, id);
  if (!item) return false;
  doc.transact(() => {
    item.set('status', 'uploading' satisfies ImageStatus);
    item.set('uploadStartedAt', isFiniteNumber(now) ? now : 0);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * What to draw for an image, given the viewer's clock.
 *
 * `uploading` is the only interesting one: it is a claim that some tab is uploading, and this
 * viewer cannot see that tab. So it is believed for `IMAGE_UPLOAD_STALE_MS` and then drawn as
 * `unfinished`, which is the same thing the uploader's own tab would show if it had reloaded —
 * the honest reading of an upload nobody is watching any more (`image.unfinished`).
 */
export function displayStatus(image: ImageSnap, now: number): DisplayStatus {
  if (image.status === 'ready') return 'ready';
  if (image.status === 'failed') return 'failed';
  const age = now - image.uploadStartedAt;
  return age > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
}

/**
 * The image object `id`, or null when it is gone or is not an image. Fields that arrived
 * wrong from another client fall back to the closest thing that draws: an image whose natural
 * size is missing falls back to its box, because the box is what the person sees.
 */
export function readImage(doc: Y.Doc, id: string): ImageSnap | null {
  const item = imageItem(doc, id);
  if (!item) return null;
  const x = item.get('x');
  const y = item.get('y');
  const width = item.get('width');
  const height = item.get('height');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return null;
  }
  const z = item.get('z');
  const naturalWidth = item.get('naturalWidth');
  const naturalHeight = item.get('naturalHeight');
  const contentType = item.get('contentType');
  const uploaderId = item.get('uploaderId');
  const uploadStartedAt = item.get('uploadStartedAt');
  return {
    id,
    type: IMAGE_TYPE,
    x,
    y,
    width,
    height,
    z: isFiniteNumber(z) ? z : 0,
    assetKey: assetKeyOf(item),
    contentType: typeof contentType === 'string' ? contentType : '',
    naturalWidth: isFiniteNumber(naturalWidth) ? naturalWidth : width,
    naturalHeight: isFiniteNumber(naturalHeight) ? naturalHeight : height,
    status: statusOf(item),
    uploadStartedAt: isFiniteNumber(uploadStartedAt) ? uploadStartedAt : 0,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
    known: true,
  };
}
