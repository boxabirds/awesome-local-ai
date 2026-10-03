// The image object model (story 12). See the image.model contract.
//
// An image object is a plain `image` entry in the shared `objects` map, and it is written twice:
// once when the file is accepted (a *placeholder*, status 'uploading', sized from the picture's
// natural pixels, no bytes yet) and once when the upload answers (status 'ready' with an asset key,
// or 'failed'). Both writes are ordinary shared-document writes, which is what makes an image
// appear on every other board immediately and vanish again on undo.
//
// The bytes are never in the document: the placeholder only carries `assetKey`, the key the picture
// is stored under. That is why a board full of photographs costs the same to sync as a board full of
// sticky notes, and why a board that is saved without images (the Durable Object's own rule) still
// keeps every image anyone added — the objects are in the document, the pixels are in the bucket.
//
// Two origins, deliberately:
//   - LOCAL_ORIGIN for the placeholder, so adding an image is one undo step like creating a note;
//   - UPLOAD_ORIGIN for the upload's own outcome, because "the upload finished" is not something a
//     person can undo, and an undo must never be able to un-store a stored picture.
// The consequence is that undoing the add leaves the asset in the bucket, which is the trade the
// design accepts: nothing is ever served that a document does not point at.
//
// `displayStatus` is a *read*, not a field: 'unfinished' is derived from the wall clock, so nothing
// has to notice a dead upload and no timer has to be synced.

import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

const OBJECTS = 'objects';

type ObjectMap = Y.Map<unknown>;
type Objects = Y.Map<Y.Map<unknown>>;

function objects(doc: Y.Doc): Objects {
  return doc.getMap<Y.Map<unknown>>(OBJECTS);
}

/**
 * The origin of "this upload finished / gave up". Deliberately not LOCAL_ORIGIN, so it is outside
 * the per-person undo history.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** What a viewer is shown: the stored status, plus what the clock says about a stuck one. */
export type DisplayStatus = ImageStatus | 'unfinished';

export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
  /** `<boardId>/<assetId>` once stored; null while uploading, and stays null when it failed. */
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  /** When this upload started, in wall-clock ms; the clock `displayStatus` reads. */
  uploadStartedAt: number;
  /** Who started the upload, and who created the object — the same person, always. */
  uploaderId: string;
  /** The field every object carries, so story 6 can attribute it like any other edit. */
  createdBy: string;
  width: number;
  height: number;
}

/** A width and height, as placed on the board. */
export interface PlacementSize {
  width: number;
  height: number;
}

/** One image to place: where it goes (`layoutRow`'s rect) and the pixels it came from. */
export interface Placement {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  /** The media type the file claimed; the Worker's sniff is what actually got stored. */
  contentType?: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}`;
}

/** Highest `z` across every object, so a new image lands on top like any other object. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/** The object's Y.Map only when `id` is an existing image object. */
function getImageMap(doc: Y.Doc, id: string): ObjectMap | undefined {
  const map = objects(doc).get(id);
  if (!map || map.get('type') !== 'image') return undefined;
  return map;
}

/**
 * The box an image is placed at (image.place_size): its natural size in board units, with the
 * longest side brought down to IMAGE_MAX_PLACE_SIZE_WORLD and the other side along for the ride.
 * A picture smaller than the cap is placed exactly as big as it is.
 *
 * Non-finite input comes back non-finite, and `createImagePlaceholders` refuses to write that —
 * this function's job is the arithmetic, not the judgement.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): PlacementSize {
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= 0) return { width: naturalWidth, height: naturalHeight };
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  if (scale >= 1) return { width: naturalWidth, height: naturalHeight };
  // Multiply before dividing, so whole-number pixels come back as whole numbers (4032 x 3024 is
  // 800 x 600, not 799.99998 x 599.99998), and never round: a 1 x 4000 strip still has to be placed
  // somewhere, and a box of 0 x 800 could not be clicked.
  return {
    width: (naturalWidth * IMAGE_MAX_PLACE_SIZE_WORLD) / longest,
    height: (naturalHeight * IMAGE_MAX_PLACE_SIZE_WORLD) / longest,
  };
}

/**
 * Lay boxes out in a row, left to right, tops aligned, IMAGE_LAYOUT_GAP_WORLD apart
 * (image.drop_multiple). `anchor` says what `start` means: the top-left corner of the row, or the
 * point the row is centred on (paste goes at the middle of the view). Heights differ from image to
 * image, so the row is centred on the tallest of them.
 */
export function layoutRow(
  sizes: readonly PlacementSize[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];
  const gaps = IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);
  const rowWidth = sizes.reduce((sum, size) => sum + size.width, 0) + gaps;
  const tallest = sizes.reduce((max, size) => Math.max(max, size.height), 0);
  let x = anchor === 'centre' ? start.x - rowWidth / 2 : start.x;
  const y = anchor === 'centre' ? start.y - tallest / 2 : start.y;
  const rects: Rect[] = [];
  for (const size of sizes) {
    rects.push({ x, y, width: size.width, height: size.height });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/**
 * Write the placeholders for a set of accepted images, all of them in ONE transaction: one undo step
 * for one drop, and one synced update for one gesture (image.model). Returns the ids written, in
 * placement order.
 *
 * An item whose numbers are not finite is skipped — a box cannot exist at `NaN` — and skipping it
 * does not stop its neighbours, which is the "partial batch" the contract asks about. Nothing at all
 * is written, and nothing is returned, when the whole batch is unusable.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly Placement[],
  uploaderId: string,
  now: number,
): string[] {
  const placed = items.filter((item) => isPlacementUsable(item));
  if (placed.length === 0) return [];

  const ids: string[] = [];
  const startedAt = isFiniteNumber(now) ? now : Date.now();
  doc.transact(() => {
    let z = maxZ(doc);
    for (const item of placed) {
      const id = newId();
      const obj = new Y.Map<unknown>();
      obj.set('type', 'image');
      obj.set('x', item.rect.x);
      obj.set('y', item.rect.y);
      obj.set('width', item.rect.width);
      obj.set('height', item.rect.height);
      obj.set('naturalWidth', item.naturalWidth);
      obj.set('naturalHeight', item.naturalHeight);
      obj.set('contentType', typeof item.contentType === 'string' ? item.contentType : '');
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', startedAt);
      obj.set('uploaderId', uploaderId);
      obj.set('z', (z += 1));
      obj.set('createdAt', startedAt);
      obj.set('createdBy', uploaderId);
      objects(doc).set(id, obj);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * A placeholder needs a real box: four finite numbers and a positive area. Everything else is a
 * picture whose size nobody can know, and an object with no box cannot be selected, moved or drawn.
 */
function isPlacementUsable(item: Placement): boolean {
  const { rect } = item;
  return (
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height) &&
    rect.width > 0 &&
    rect.height > 0 &&
    isFiniteNumber(item.naturalWidth) &&
    isFiniteNumber(item.naturalHeight)
  );
}

/**
 * The upload stored the bytes: record the key and let the picture show. False for a stale id — an
 * upload that finishes after its image was deleted writes nothing, which is the "upload finishing
 * late is harmless" case (image.delete_while_uploading). One UPLOAD_ORIGIN transaction, so no undo
 * step is created and undoing the add still removes the object.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = getImageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The upload gave up. The placeholder stays (image.failed), so everyone can see that this image did
 * not make it and the uploader can try again. False for a stale id, like every other write here.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = getImageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Try again: back to 'uploading', with a fresh start time. The stale clock starts over, and so does
 * the uploader's progress bar (which is keyed on the id, not on the attempt).
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = getImageMap(doc, id);
  if (!obj) return false;
  const startedAt = isFiniteNumber(now) ? now : Date.now();
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', startedAt);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The status a board actually shows (image.unfinished). A placeholder older than
 * IMAGE_UPLOAD_STALE_MS that never got an answer is reported as 'unfinished' without anything
 * writing to the document — so it reads the same for everyone looking at it, on every board.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status !== 'uploading') return img.status;
  if (!isFiniteNumber(now)) return img.status;
  return now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : img.status;
}

/** Read one image object from the shared map, or undefined when it is gone / not an image. */
export function imageFromMap(id: string, obj: ObjectMap): ImageSnap | undefined {
  if (obj.get('type') !== 'image') return undefined;
  const x = obj.get('x');
  const y = obj.get('y');
  const width = obj.get('width');
  const height = obj.get('height');
  const naturalWidth = obj.get('naturalWidth');
  const naturalHeight = obj.get('naturalHeight');
  const assetKey = obj.get('assetKey');
  const status = obj.get('status');
  const uploadStartedAt = obj.get('uploadStartedAt');
  const uploaderId = obj.get('uploaderId');
  const contentType = obj.get('contentType');
  const z = obj.get('z');
  const createdAt = obj.get('createdAt');
  const createdBy = obj.get('createdBy');
  // An image with no box cannot be drawn or selected, so a malformed one is left out of the
  // snapshot entirely rather than rendered at a size nobody chose.
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return undefined;
  }
  return {
    id,
    type: 'image',
    x,
    y,
    width,
    height,
    naturalWidth: isFiniteNumber(naturalWidth) ? naturalWidth : width,
    naturalHeight: isFiniteNumber(naturalHeight) ? naturalHeight : height,
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : '',
    status: status === 'ready' || status === 'failed' ? status : 'uploading',
    uploadStartedAt: isFiniteNumber(uploadStartedAt) ? uploadStartedAt : 0,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
    z: isFiniteNumber(z) ? z : 0,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}

/** Read one image object by id. */
export function readImage(doc: Y.Doc, id: string): ImageSnap | undefined {
  const obj = objects(doc).get(id);
  return obj ? imageFromMap(id, obj) : undefined;
}

/**
 * Is this object an image? `ObjectSnapshot.type` is a string rather than a union — an unknown type has
 * to survive a read — so narrowing a snapshot to `ImageSnap` has to be said out loud somewhere, and
 * this is that somewhere: the one place that knows the type name and the shape of its fields
 * together.
 */
export function isImageSnapshot(obj: ObjectSnapshot): obj is ImageSnap {
  return obj.type === 'image';
}

/**
 * Where a stored image is read from. The path is the key, and the Worker serves the bytes it belongs
 * to at this exact path, with the type it sniffed.
 */
export function imageSourceUrl(key: string): string {
  return `/api/assets/${key}`;
}
