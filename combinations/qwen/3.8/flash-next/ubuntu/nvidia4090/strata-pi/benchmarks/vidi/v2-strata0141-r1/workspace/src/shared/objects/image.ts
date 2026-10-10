import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  registerSelectableType,
  registerSnapshotReader,
  type ObjectSnapshot,
} from '../board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Point, Rect } from '../geometry';
import { isAssetKey } from '../image-format';

/**
 * The image object model (`image.placeholders`, `image.status`, `image.schema`).
 *
 * Schema (`objects/<id>`):
 *
 * ```
 * { type: 'image', x, y, width, height, z, createdAt, createdBy,
 *   assetKey: string | null,     // <boardId>/<assetId>, never a URL
 *   contentType: string | null,  // what the server stored it as
 *   naturalWidth, naturalHeight, // the picture's own size, for the ratio
 *   status: 'uploading' | 'ready' | 'failed' | 'unfinished' | 'unavailable',
 *   uploadStartedAt: number | null,
 *   uploaderId: string | null }  // whose upload this was, not who made the object
 * ```
 *
 * Two rules hold this together.
 *
 * **No URL is stored** (`image.schema`). The object carries the asset *key* only:
 * a key is meaningless without this board and this origin, so the same document
 * loaded from another host renders that host's assets. `width`/`height` are
 * always present - an image's box exists before its bytes do, which is what lets
 * a placeholder be moved and resized while it is still uploading.
 *
 * **An upload is not this person's edit** (Key decision 10). Object creation is
 * one transaction with `LOCAL_ORIGIN`, so a drop is one undo step. Every later
 * status change - ready, failed, retry - is written with `UPLOAD_ORIGIN`, an
 * origin no `Y.UndoManager` here tracks. Undoing the insert therefore takes the
 * whole image with it, ready or not, and a status arriving from *someone else's*
 * upload cannot be undone by the person watching it.
 *
 * ```mermaid
 * stateDiagram-v2
 *   [*] --> uploading : placeholder created
 *   uploading --> ready : markImageReady
 *   uploading --> failed : markImageFailed
 *   uploading --> unfinished : clock, IMAGE_UPLOAD_STALE_MS passed
 *   failed --> uploading : markImageRetrying
 *   failed --> unavailable : asset known to be gone
 *   uploading --> [*] : undo of the insert
 *   ready --> [*] : remove
 *   failed --> [*] : remove
 *   unfinished --> [*] : remove
 *   unavailable --> [*] : remove
 * ```
 *
 * `unfinished` is never stored by the uploader: it is what `displayStatus`
 * computes from `uploadStartedAt`, because the uploader's page may be gone and
 * both sides still have to agree on what the board shows.
 *
 * Nothing here throws for bad input: a stale id, a malformed key, a non-finite
 * box is refused before the transaction opens, so no `update` event is emitted
 * and nobody is told about a change that did not happen (`TC-07`).
 */

/** What an image object is doing, as stored. */
export type ImageStatus = 'uploading' | 'ready' | 'failed' | 'unfinished' | 'unavailable';

const STATUSES = new Set<ImageStatus>([
  'uploading',
  'ready',
  'failed',
  'unfinished',
  'unavailable',
]);

/** The transaction origin every status update is written with (`image.status`). */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload-origin');

/** One image, as the board reads it. */
export interface ImageSnap extends ObjectSnapshot {
  readonly type: 'image';
  /** An image always has a box: the placeholder has one before the bytes do. */
  readonly width: number;
  readonly height: number;
  /** `<boardId>/<assetId>`, or `null` while nothing is stored yet. Never a URL. */
  readonly assetKey: string | null;
  /** The MIME type the asset was stored as, `null` until it is stored. */
  readonly contentType: string | null;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly status: ImageStatus;
  /** When this upload began - the clock `displayStatus` measures. */
  readonly uploadStartedAt: number | null;
  /** Whose upload this is: the only id allowed to Retry. */
  readonly uploaderId: string | null;
  readonly createdBy: string;
}

/** Where and how big one placeholder goes. */
export interface ImagePlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The picture's own size; defaults to the placed size. */
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
}

/** A size the row layout can work with. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** Where a batch of images is laid out from. */
export type LayoutAnchor = 'top-left' | 'centre';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const objectsOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>('objects');

const asObjectMap = (value: unknown): Y.Map<unknown> | undefined =>
  value instanceof Y.Map ? value : undefined;

/** UUIDs, so two people dropping at the same moment cannot collide (story 3). */
function randomId(): string {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  const bytes = new Uint8Array(16);
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10)
    .join('')}-${hex.slice(10, 16).join('')}`;
}

/** Highest `z` in the document (0 when it holds nothing). */
function maxZ(objects: Y.Map<unknown>): number {
  let highest = 0;
  objects.forEach((value) => {
    const z = asObjectMap(value)?.get('z');
    if (isFiniteNumber(z) && z > highest) {
      highest = z;
    }
  });
  return highest;
}

/* ------------------------------------------------------------------ size and layout */

/**
 * The box a newly placed image gets (`images.place`, TC-03).
 *
 * Scale to fit within `IMAGE_MAX_PLACE_SIZE_WORLD` on both sides with the aspect
 * ratio intact; leave anything that already fits at its natural size. The longer
 * side is set to the limit exactly rather than scaled and rounded, so 4032x3024
 * is 800x600 and not 799.9999999999999 - a stored size that is off by a rounding
 * error is a ratio the tests cannot compare.
 *
 * `null` is the refusal: a size that cannot describe a picture places nothing.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): ImageSize | null {
  if (
    !isFiniteNumber(naturalWidth) ||
    !isFiniteNumber(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return null;
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const factor = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return {
    width: naturalWidth === longest ? IMAGE_MAX_PLACE_SIZE_WORLD : naturalWidth * factor,
    height: naturalHeight === longest ? IMAGE_MAX_PLACE_SIZE_WORLD : naturalHeight * factor,
  };
}

/**
 * Lay images out left to right (`TC-04`).
 *
 * A `'top-left'` anchor aligns every top at `start` and steps `x` by the previous
 * image's width plus `IMAGE_LAYOUT_GAP_WORLD` - the row hangs from the point
 * where the files were dropped. A `'centre'` anchor lays out the same row and
 * slides it so the bounding box of the whole row sits on `start`, which is what
 * an add from the picker uses: an image appearing where the pointer is not is
 * the whole point of picking a file.
 *
 * Sizes are never changed here - the layout positions boxes, it does not resize
 * them.
 */
export function layoutRow(sizes: readonly ImageSize[], start: Point, anchor: LayoutAnchor): Rect[] {
  const rects: Rect[] = [];
  if (!Array.isArray(sizes) || sizes.length === 0) {
    return rects;
  }
  if (!start || !isFiniteNumber(start.x) || !isFiniteNumber(start.y)) {
    return rects;
  }

  let x = start.x;
  for (const size of sizes) {
    if (!size || !isFiniteNumber(size.width) || !isFiniteNumber(size.height)) {
      continue;
    }
    if (rects.length > 0) {
      x += IMAGE_LAYOUT_GAP_WORLD;
    }
    rects.push({ x, y: start.y, width: size.width, height: size.height });
    x += size.width;
  }

  if (rects.length === 0) {
    return rects;
  }
  if (anchor === 'top-left') {
    return rects;
  }

  const left = Math.min(...rects.map((rect) => rect.x));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const top = Math.min(...rects.map((rect) => rect.y));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  const dx = start.x - (left + right) / 2;
  const dy = start.y - (top + bottom) / 2;
  return rects.map((rect) => ({ ...rect, x: rect.x + dx, y: rect.y + dy }));
}

/* ------------------------------------------------------------------ placeholders */

/** Is `item` a box a placeholder can be written at? */
const usablePlacement = (item: ImagePlacement | undefined): boolean =>
  !!item &&
  isFiniteNumber(item.x) &&
  isFiniteNumber(item.y) &&
  isFiniteNumber(item.width) &&
  isFiniteNumber(item.height) &&
  item.width > 0 &&
  item.height > 0;

/**
 * Write the placeholders of one add (`TC-05`).
 *
 * **One transaction, `LOCAL_ORIGIN`, all of them** - that is what makes a drop of
 * three files one undo step rather than three, and what makes the row appear for
 * everyone at once instead of file by file. The ids come back in the order they
 * were given, so the caller can pair each one with the file it stands for.
 *
 * A placement with a non-finite box is skipped: an image nobody can see is not
 * something to insert, and writing it would make the row a hole.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlacement[],
  uploaderId: string,
  now: number,
): string[] {
  const placements = (items ?? []).filter(usablePlacement);
  if (placements.length === 0) {
    return [];
  }
  if (typeof uploaderId !== 'string' || uploaderId.length === 0) {
    return [];
  }
  const startedAt = isFiniteNumber(now) ? now : Date.now();

  const ids = placements.map(() => randomId());
  doc.transact(() => {
    const objects = objectsOf(doc);
    let z = maxZ(objects);
    placements.forEach((placement, index) => {
      const naturalWidth = isFiniteNumber(placement.naturalWidth) ? placement.naturalWidth : placement.width;
      const naturalHeight =
        isFiniteNumber(placement.naturalHeight) ? placement.naturalHeight : placement.height;
      const entry = new Y.Map<unknown>();
      entry.set('type', 'image');
      entry.set('x', placement.x);
      entry.set('y', placement.y);
      entry.set('width', placement.width);
      entry.set('height', placement.height);
      entry.set('naturalWidth', naturalWidth);
      entry.set('naturalHeight', naturalHeight);
      entry.set('z', ++z);
      entry.set('createdAt', startedAt);
      entry.set('createdBy', uploaderId);
      entry.set('assetKey', null);
      entry.set('contentType', null);
      entry.set('status', 'uploading' satisfies ImageStatus);
      entry.set('uploadStartedAt', startedAt);
      entry.set('uploaderId', uploaderId);
      objects.set(ids[index]!, entry);
    });
  }, LOCAL_ORIGIN);
  return ids;
}

/* ------------------------------------------------------------------ status */

/** The entry of a live image, `undefined` when `id` no longer names one (`TC-07`). */
function imageEntryOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id.length === 0) {
    return undefined;
  }
  const entry = asObjectMap(objectsOf(doc).get(id));
  return entry?.get('type') === 'image' ? entry : undefined;
}

/**
 * One status write, opened only when something actually changes, and written with
 * `UPLOAD_ORIGIN` so it is outside this person's undo history (`image.own`).
 */
function writeImage(
  doc: Y.Doc,
  id: string,
  fields: Record<string, unknown>,
  requireLiveStatus?: ImageStatus,
): boolean {
  const entry = imageEntryOf(doc, id);
  if (!entry) {
    return false;
  }
  if (requireLiveStatus !== undefined && entry.get('status') !== requireLiveStatus) {
    return false;
  }
  const changed = Object.entries(fields).some(([key, value]) => entry.get(key) !== value);
  if (!changed) {
    return false;
  }
  doc.transact(() => {
    for (const [key, value] of Object.entries(fields)) {
      entry.set(key, value);
    }
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The upload finished: store the key, and only the key (`image.schema`).
 *
 * A malformed key is refused the same way a stale id is, because a key that
 * cannot be served would leave an object that can never render.
 */
export function markImageReady(
  doc: Y.Doc,
  id: string,
  assetKey: string,
  contentType?: string,
): boolean {
  if (!isAssetKey(assetKey)) {
    return false;
  }
  const fields: Record<string, unknown> = { status: 'ready' satisfies ImageStatus, assetKey };
  if (typeof contentType === 'string' && contentType.length > 0) {
    fields.contentType = contentType;
  }
  return writeImage(doc, id, fields);
}

/** Retry this upload: `uploading` again, with a clock that starts now (`TC-07`). */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return writeImage(doc, id, {
    status: 'uploading' satisfies ImageStatus,
    uploadStartedAt: isFiniteNumber(now) ? now : Date.now(),
    assetKey: null,
  });
}

/** This upload did not make it (`image.failed`). */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return writeImage(doc, id, { status: 'failed' satisfies ImageStatus, assetKey: null });
}

/** The stored asset is gone (`image.status`): nobody who sees it can fix that. */
export function markImageUnavailable(doc: Y.Doc, id: string): boolean {
  return writeImage(doc, id, { status: 'unavailable' satisfies ImageStatus });
}

/**
 * What this image shows right now (`image.status`, TC-06).
 *
 * The stored status is taken as-is except for `uploading`, which ages: after
 * `IMAGE_UPLOAD_STALE_MS` every viewer - the uploader included - sees
 * `unfinished`, because the page that was uploading may simply be gone and a
 * board cannot keep saying "uploading" forever.
 */
export function displayStatus(image: ImageSnap, now: number): ImageStatus {
  if (!image || !STATUSES.has(image.status)) {
    return 'unavailable';
  }
  if (image.status !== 'uploading') {
    return image.status;
  }
  const startedAt = isFiniteNumber(image.uploadStartedAt) ? image.uploadStartedAt : null;
  if (startedAt === null) {
    return 'unfinished';
  }
  if (!isFiniteNumber(now)) {
    return 'uploading';
  }
  return now - startedAt > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
}

/* ------------------------------------------------------------------ reading */

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asNullableString = (value: unknown): string | null | undefined =>
  value === null ? null : asString(value);

const asNullableNumber = (value: unknown): number | null | undefined =>
  value === null ? null : typeof value === 'number' ? value : undefined;

/** Does `candidate` match the stored field list exactly (`image.schema`)? */
export function isImageSchema(candidate: unknown): candidate is ImageSnap {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const value = candidate as Record<string, unknown>;
  const keys = Object.keys(value);
  const required = [
    'id',
    'type',
    'x',
    'y',
    'width',
    'height',
    'z',
    'createdAt',
    'createdBy',
    'assetKey',
    'contentType',
    'naturalWidth',
    'naturalHeight',
    'status',
    'uploadStartedAt',
    'uploaderId',
  ];
  if (keys.length !== required.length || !required.every((key) => keys.includes(key))) {
    return false;
  }
  if (value.type !== 'image') return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return false;
  if (!isFiniteNumber(value.width) || !isFiniteNumber(value.height)) return false;
  if (!isFiniteNumber(value.naturalWidth) || !isFiniteNumber(value.naturalHeight)) return false;
  if (!isFiniteNumber(value.z) || !isFiniteNumber(value.createdAt)) return false;
  if (typeof value.createdBy !== 'string') return false;
  if (!STATUSES.has(value.status as ImageStatus)) return false;

  const assetKey = value.assetKey;
  if (!(assetKey === null || (typeof assetKey === 'string' && isAssetKey(assetKey)))) {
    return false;
  }
  const contentType = value.contentType;
  if (!(contentType === null || (typeof contentType === 'string' && contentType.length > 0))) {
    return false;
  }
  const started = value.uploadStartedAt;
  if (!(started === null || isFiniteNumber(started))) {
    return false;
  }
  const uploader = value.uploaderId;
  if (!(uploader === null || typeof uploader === 'string')) {
    return false;
  }
  return true;
}

/** Read one document entry as an image, or `undefined` when it is not one. */
function imageFrom(id: string, value: unknown): ImageSnap | undefined {
  const entry = asObjectMap(value);
  if (!entry || entry.get('type') !== 'image') {
    return undefined;
  }
  const x = entry.get('x');
  const y = entry.get('y');
  const width = entry.get('width');
  const height = entry.get('height');
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
  const createdBy = asString(entry.get('createdBy'));
  const status = entry.get('status');
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    !isFiniteNumber(z) ||
    !isFiniteNumber(createdAt) ||
    createdBy === undefined ||
    !STATUSES.has(status as ImageStatus)
  ) {
    return undefined;
  }
  const storedKey = asNullableString(entry.get('assetKey'));
  const contentType = asNullableString(entry.get('contentType'));
  const naturalWidth = entry.get('naturalWidth');
  const naturalHeight = entry.get('naturalHeight');
  const uploadStartedAt = asNullableNumber(entry.get('uploadStartedAt'));
  const uploaderId = asNullableString(entry.get('uploaderId'));

  return {
    id,
    type: 'image',
    x,
    y,
    width,
    height,
    z,
    createdAt,
    createdBy,
    // A stored key that is not a key renders as nothing rather than as garbage.
    assetKey: storedKey !== null && storedKey !== undefined && isAssetKey(storedKey) ? storedKey : null,
    contentType: contentType ?? null,
    naturalWidth: isFiniteNumber(naturalWidth) ? naturalWidth : width,
    naturalHeight: isFiniteNumber(naturalHeight) ? naturalHeight : height,
    status: status as ImageStatus,
    uploadStartedAt: isFiniteNumber(uploadStartedAt) ? uploadStartedAt : null,
    uploaderId: uploaderId ?? null,
  };
}

/** This person's own image with `id`, or `null`. */
export function readImage(doc: Y.Doc, id: string): ImageSnap | null {
  return imageFrom(id, objectsOf(doc).get(id)) ?? null;
}

/** Is this snapshot an image? */
export function isImageSnapshot(obj: ObjectSnapshot): obj is ImageSnap {
  return obj.type === 'image';
}

registerSelectableType('image');
registerSnapshotReader('image', imageFrom);
