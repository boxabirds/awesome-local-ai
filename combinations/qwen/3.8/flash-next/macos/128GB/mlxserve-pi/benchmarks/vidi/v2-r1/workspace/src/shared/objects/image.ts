// The image object's part of the board document (`image.model`).
//
// An image is added in two beats, and the whole of this file is about keeping them
// apart. The first beat happens entirely on the person's own screen and is a real,
// undoable change: `createImagePlaceholders` writes one object per accepted file, each
// already at its final size and position, in a single `LOCAL_ORIGIN` transaction — so
// one add is one undo step, and one undo takes the whole add back (undo.history keeps
// this per-person, story 8). The second beat is the upload finishing, and it happens a
// moment later, for reasons of the network rather than of intent: `markImageReady` and
// `markImageFailed` write the result under `UPLOAD_ORIGIN`.
//
// That origin is the whole trick. The undo manager tracks `LOCAL_ORIGIN` and nothing
// else, so a status change from `uploading` to `ready` is *not* its own undo step:
// undoing an insertion removes the images whether or not their uploads have finished,
// and finishing an upload never lands a "step" in someone's history they never took
// (PRD: "completion of an upload is not a separate undo step", TC-05).
//
// Schema of one image (design.md, "Schema addition"):
//   objects/<id>: Y.Map {
//     type: 'image', x, y, width, height, z,
//     assetKey: string | null,     // null until the upload answers 201
//     contentType: string,
//     naturalWidth, naturalHeight, // the file's own pixel size
//     status: 'uploading' | 'ready' | 'failed',
//     uploadStartedAt: number, uploaderId: string
//   }
//
// Like the rest of `src/shared`, this file may not touch the DOM — the Durable Object
// imports it, and `displayStatus` in particular is a plain function of stored numbers
// against a clock handed in, not of `Date.now`.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Image object model".
import * as Y from 'yjs';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
  MAX_OBJECT_SIZE_WORLD,
} from '../config';
import {
  LOCAL_ORIGIN,
  registerObjectTypeModel,
  registerObjectTypeReader,
  type BoardObject,
  type ObjectSnapshot,
} from '../board-model';
import type { Point, Rect, Size } from '../geometry';

/**
 * The origin an upload's status change is written under. It is *not* the undo
 * manager's tracked origin (which is `LOCAL_ORIGIN` alone), and that is the point:
 * a status change is something the network made true, not something a person did.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

/** The stored status of an image object. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/**
 * What an image is shown as, which is the stored status plus one state that is never
 * stored: `unfinished`, derived at render time once an `uploading` image has been
 * waiting longer than IMAGE_UPLOAD_STALE_MS. Nothing ever writes `unfinished` — that
 * is what lets it become true on its own, with the uploader gone, with nobody
 * touching the document (image.unfinished).
 */
export type DisplayStatus = ImageStatus | 'unfinished';

/** The four statuses a read may ever hand back. */
const isImageStatus = (value: unknown): value is ImageStatus =>
  value === 'uploading' || value === 'ready' || value === 'failed';

/** An image as the board reads it. */
export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
  /** An image always has a box: it is the placeholder's own final size. */
  width: number;
  height: number;
  /** The stored key `<boardId>/<assetId>`, or null while still uploading. */
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects');

const isImage = (value: unknown): value is Y.Map<unknown> =>
  value instanceof Y.Map && value.get('type') === 'image';

/**
 * Tell the shared model that an `image` object exists and how small it may go, and how
 * it is read. The client registry does the same registration next to the component that
 * draws it; doing it here too is what lets a unit test, or the Durable Object, read an
 * image with no DOM and no React in sight — and it is why a board holding an image this
 * screen has no code for still knows the type exists.
 */
registerObjectTypeModel('image', IMAGE_MIN_SIZE_WORLD);
registerObjectTypeReader('image', readImageObject);

/**
 * The box an image of `naturalWidth` × `naturalHeight` pixels is placed at
 * (`image.placement_size`). One pixel is one board unit, except that an image whose
 * longest side is over IMAGE_MAX_PLACE_SIZE_WORLD is scaled down — both sides by the
 * same factor — so its longest side is exactly that limit and its proportions are
 * kept. An image smaller than the limit keeps its natural size and is *never* made
 * bigger: a 400×300 screenshot does not blow up to fill the board.
 *
 * Non-finite sizes return null: there is no box to put such an image in, and the
 * caller skips it rather than writing a placeholder with no size.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } | null {
  if (!isFiniteNumber(naturalWidth) || !isFiniteNumber(naturalHeight)) return null;
  if (naturalWidth <= 0 || naturalHeight <= 0) return null;
  const longest = Math.max(naturalWidth, naturalHeight);
  // The scale never exceeds 1: this only ever shrinks, never enlarges.
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

/**
 * Lay a row of images out left to right, separated by IMAGE_LAYOUT_GAP_WORLD
 * (`image.drop`, `image.paste`, `image.pick`). Their tops are always aligned — a row
 * sits on a line — and the only question is where that line starts:
 *
 *   - `top-left` puts the *first* image's top-left corner at `start`: this is a drop,
 *     where the pointer says "here" and the row runs away from it (image.drop);
 *   - `centre` puts the *middle of the whole row* at `start`: this is a paste or a
 *     pick, which have no drop point and so fill the middle of the view with the row
 *     as a unit (image.paste, image.pick).
 *
 * A size that is not finite is skipped, and the row closes up without it.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const usable = sizes.filter(
    (size) => isFiniteNumber(size.width) && isFiniteNumber(size.height),
  );
  if (usable.length === 0) return [];

  // The row's own width and height, worked out before anything is positioned, so a
  // centred row is centred on the whole and a `top-left` row still aligns to the line.
  let rowWidth = 0;
  let rowHeight = 0;
  for (const size of usable) {
    rowWidth += size.width + IMAGE_LAYOUT_GAP_WORLD;
    if (size.height > rowHeight) rowHeight = size.height;
  }
  rowWidth -= IMAGE_LAYOUT_GAP_WORLD; // no gap after the last one

  const originX =
    anchor === 'centre' ? start.x - rowWidth / 2 : start.x;
  const originY =
    anchor === 'centre' ? start.y - rowHeight / 2 : start.y;

  const rects: Rect[] = [];
  let x = originX;
  for (const size of usable) {
    rects.push({ x, y: originY, width: size.width, height: size.height });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/** One image a `createImagePlaceholders` call has been asked to place. */
export interface ImagePlaceholder {
  /** Where and how big: already the final size, from `layoutRow`/`placementSize`. */
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Place a batch of images as placeholders, in one `LOCAL_ORIGIN` transaction
 * (`image.uploading`, undo.history). Each becomes an object already at its final
 * size and position, `status: 'uploading'`, carrying the uploader and the moment the
 * upload started — everything `ImageObject` needs to show the right thing to the
 * right person without waiting for the network at all.
 *
 * The whole batch is one transaction, so it is one undo step: one Ctrl/Cmd+Z takes
 * back a three-image drop in one motion, and one undo of a drop that has already
 * finished uploading still takes back all three (the `ready` status rides along with
 * the object it belongs to — TC-05).
 *
 * An item whose rectangle or natural size is not finite is skipped — a placeholder
 * with no size could not be drawn or resized — and `z` climbs once per created object,
 * so the row lands above what is already there without any two sharing a draw order.
 * Returns the ids created, in the order handed in.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholder[],
  uploaderId: string,
  now: number,
): string[] {
  const created: Array<{ id: string; object: Y.Map<unknown> }> = [];
  let maxZ = 0;
  objectsMap(doc).forEach((value) => {
    const z = value instanceof Y.Map ? value.get('z') : undefined;
    if (isFiniteNumber(z) && z > maxZ) maxZ = z;
  });

  doc.transact(() => {
    const objects = objectsMap(doc);
    let z = maxZ;
    for (const item of items) {
      const { rect, naturalWidth, naturalHeight } = item;
      if (
        !isFiniteNumber(rect.x) ||
        !isFiniteNumber(rect.y) ||
        !isFiniteNumber(rect.width) ||
        !isFiniteNumber(rect.height) ||
        !isFiniteNumber(naturalWidth) ||
        !isFiniteNumber(naturalHeight)
      ) {
        continue;
      }
      const id = crypto.randomUUID();
      const object = new Y.Map<unknown>();
      object.set('type', 'image');
      object.set('x', Math.min(rect.x, MAX_OBJECT_SIZE_WORLD));
      object.set('y', Math.min(rect.y, MAX_OBJECT_SIZE_WORLD));
      object.set(
        'width',
        Math.min(Math.max(rect.width, IMAGE_MIN_SIZE_WORLD), MAX_OBJECT_SIZE_WORLD),
      );
      object.set(
        'height',
        Math.min(Math.max(rect.height, IMAGE_MIN_SIZE_WORLD), MAX_OBJECT_SIZE_WORLD),
      );
      object.set('z', (z += 1));
      // No key yet: the upload has only started. `assetKey` goes in with `markImageReady`.
      object.set('assetKey', null);
      object.set('contentType', typeof item.contentType === 'string' ? item.contentType : '');
      object.set('naturalWidth', naturalWidth);
      object.set('naturalHeight', naturalHeight);
      object.set('status', 'uploading' as ImageStatus);
      object.set('uploadStartedAt', isFiniteNumber(now) ? now : 0);
      object.set('uploaderId', typeof uploaderId === 'string' ? uploaderId : '');
      objects.set(id, object);
      created.push({ id, object });
    }
  }, LOCAL_ORIGIN);

  return created.map((entry) => entry.id);
}

/**
 * A placeholder object whose image has finished uploading and can be fetched from
 * `assetKey`. Written under `UPLOAD_ORIGIN`, so it is never its own undo step (TC-05).
 * Returns false, and writes nothing, for an id that is gone or belongs to another
 * kind — "the uploader undone or someone deleted it while the upload was in flight"
 * (TC-07).
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const object = objectsMap(doc).get(id);
  if (!isImage(object)) return false;
  if (object.get('assetKey') === assetKey && object.get('status') === 'ready') return false;
  doc.transact(() => {
    object.set('assetKey', assetKey);
    object.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * A placeholder object whose upload failed. Also `UPLOAD_ORIGIN`: a failure is not
 * something to undo either, and the uploader's way back is the Retry button, not
 * Ctrl/Cmd+Z. Returns false for a gone id or another kind.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const object = objectsMap(doc).get(id);
  if (!isImage(object)) return false;
  if (object.get('status') === 'failed') return false;
  doc.transact(() => {
    object.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The uploader pressed Retry: the object goes back to `uploading` with a fresh
 * `uploadStartedAt`, so the "didn't finish" clock starts over and the placeholder
 * shows progress again. `UPLOAD_ORIGIN`, and it clears `assetKey` in case a Retry
 * follows a ready state (it should not, but the state is then coherent). Returns
 * false for a gone id or another kind.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const object = objectsMap(doc).get(id);
  if (!isImage(object)) return false;
  doc.transact(() => {
    object.set('status', 'uploading');
    object.set('uploadStartedAt', isFiniteNumber(now) ? now : 0);
    object.set('assetKey', null);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * What an image is shown as, from its stored status and a clock handed in.
 *
 * The only derived state is `unfinished`: an image still marked `uploading` whose
 * `uploadStartedAt` is more than IMAGE_UPLOAD_STALE_MS in the past is one whose
 * uploader has reloaded or closed the page, and a permanent "Uploading…" would lie
 * about something in motion when nothing is. Exactly `IMAGE_UPLOAD_STALE_MS` is still
 * `uploading`; the state flips on the first millisecond past it (TC-06).
 */
export function displayStatus(image: ImageSnap, now: number): DisplayStatus {
  if (image.status !== 'uploading') return image.status;
  if (!isFiniteNumber(now) || !isFiniteNumber(image.uploadStartedAt)) return 'uploading';
  return now - image.uploadStartedAt > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
}

/** Read one image out of its `Y.Map` — the reader `snapshotObjects` uses. */
export function readImageObject(
  id: string,
  object: Y.Map<unknown> | undefined,
): ImageSnap | null {
  if (!isImage(object)) return null;
  const assetKey = object.get('assetKey');
  const status = object.get('status');
  const contentType = object.get('contentType');
  const uploaderId = object.get('uploaderId');
  const snap: ImageSnap = {
    id,
    type: 'image',
    x: isFiniteNumber(object.get('x')) ? (object.get('x') as number) : 0,
    y: isFiniteNumber(object.get('y')) ? (object.get('y') as number) : 0,
    z: isFiniteNumber(object.get('z')) ? (object.get('z') as number) : 0,
    width: isFiniteNumber(object.get('width')) ? (object.get('width') as number) : IMAGE_MIN_SIZE_WORLD,
    height: isFiniteNumber(object.get('height')) ? (object.get('height') as number) : IMAGE_MIN_SIZE_WORLD,
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : '',
    naturalWidth: isFiniteNumber(object.get('naturalWidth'))
      ? (object.get('naturalWidth') as number)
      : 0,
    naturalHeight: isFiniteNumber(object.get('naturalHeight'))
      ? (object.get('naturalHeight') as number)
      : 0,
    status: isImageStatus(status) ? status : 'uploading',
    uploadStartedAt: isFiniteNumber(object.get('uploadStartedAt'))
      ? (object.get('uploadStartedAt') as number)
      : 0,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
  };
  return snap;
}

/** Read one image out of the document by id, or null for a gone / other-kind id. */
export function readImageSnapshot(doc: Y.Doc, id: string): ImageSnap | null {
  return readImageObject(id, objectsMap(doc).get(id));
}

/** True for the kind that carries an asset key, a natural size and an upload status. */
export const isImageSnapshot = (object: BoardObject): object is ImageSnap =>
  object.type === 'image';
