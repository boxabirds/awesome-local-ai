/**
 * The image object: a picture a person dropped, pasted or picked (story 12).
 *
 * ```
 * objects/<id>: Y.Map {
 *   type: 'image', x, y, width, height, z, createdAt,
 *   assetKey: string | null,      // null until the upload answers with one
 *   contentType: string,          // the sniffed media type the bytes were stored as
 *   naturalWidth, naturalHeight,  // the file's own pixels, kept for the proportions
 *   status: 'uploading' | 'ready' | 'failed',
 *   uploadStartedAt: number,      // epoch ms of the current (or last) attempt
 *   uploaderId: string            // whose screen started it, so only they get Retry
 * }
 * ```
 *
 * An image is an ordinary box for everything story 7 does - move, marquee, resize, delete, undo -
 * and carries two facts of its own: where its bytes live, and whether they have arrived yet. The
 * placeholder is written before the upload starts, so the space it will fill appears immediately on
 * every screen, and the completion only fills that space in.
 *
 * That split is also the undo rule: creating the placeholders is a `LOCAL_ORIGIN` transaction (one
 * step, for the whole batch), while a status change carries `UPLOAD_ORIGIN`, which the UndoManager
 * does not track - so "the upload finished" is never a step somebody has to step over to get back
 * to what they were doing.
 */
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Point, Rect, Size } from '../geometry';
import { LOCAL_ORIGIN } from '../y-origin';

/** The document map holding every object, by id. */
const OBJECTS = 'objects';

/** The ceiling on `z`, so a long-lived board cannot run out of room above the top. */
const MAX_Z = Number.MAX_SAFE_INTEGER - 1;

/**
 * The origin of a write that reports what a transfer did rather than what a person did.
 *
 * It is deliberately *not* in the UndoManager's tracked origins: a placeholder becoming ready must
 * not become an undo step, and it must not merge into the step that created it either.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload');

/** What an image object holds, as stored. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** What a screen shows, which adds the state nobody stored: an upload that never came back. */
export type DisplayStatus = ImageStatus | 'unfinished';

/** One image, as rendered by React. */
export interface ImageSnapshot {
  readonly id: string;
  readonly type: 'image';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  readonly createdAt: number;
  /** Where the bytes live once they have been stored; `null` while they have not. */
  readonly assetKey: string | null;
  readonly contentType: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly status: ImageStatus;
  readonly uploadStartedAt: number;
  readonly uploaderId: string;
}

/** The short name the design uses for the same snapshot. */
export type ImageSnap = ImageSnapshot;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS);
}

/** Is this one of the three states an upload can be in? */
export function isImageStatus(value: unknown): value is ImageStatus {
  return value === 'uploading' || value === 'ready' || value === 'failed';
}

/**
 * The status a stored object reports.
 *
 * A value this build does not understand means the upload cannot have succeeded and nobody is
 * watching it any more, which is what `failed` says on every screen: the uploader is offered Retry
 * and Remove again, and everyone else sees an unavailable image instead of a permanent
 * "Uploading…".
 */
function statusOf(value: unknown): ImageStatus {
  return isImageStatus(value) ? value : 'failed';
}

/**
 * Reads one `Y.Map` into an `ImageSnapshot`, or `undefined` when it cannot be drawn at all.
 *
 * An image whose box is not a box is skipped rather than crashing the board, exactly like every
 * other type; a status this build does not know is not a reason to hide a person's image, so it is
 * normalised instead (see `statusOf`).
 */
export function readImageObject(id: string, raw: Y.Map<unknown>): ImageSnapshot | undefined {
  const x = raw.get('x');
  const y = raw.get('y');
  const width = raw.get('width');
  const height = raw.get('height');
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return undefined;
  const z = raw.get('z');
  const createdAt = raw.get('createdAt');
  const assetKey = raw.get('assetKey');
  const contentType = raw.get('contentType');
  const naturalWidth = raw.get('naturalWidth');
  const naturalHeight = raw.get('naturalHeight');
  const uploadStartedAt = raw.get('uploadStartedAt');
  const uploaderId = raw.get('uploaderId');
  return Object.freeze({
    id,
    type: 'image' as const,
    x,
    y,
    width,
    height,
    z: finite(z) ? z : 0,
    createdAt: finite(createdAt) ? createdAt : 0,
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : 'application/octet-stream',
    naturalWidth: finite(naturalWidth) ? naturalWidth : width,
    naturalHeight: finite(naturalHeight) ? naturalHeight : height,
    status: statusOf(raw.get('status')),
    uploadStartedAt: finite(uploadStartedAt) ? uploadStartedAt : 0,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
  });
}

/** The highest `z` on the board, so a new object lands on top of everything. */
function topZ(doc: Y.Doc): number {
  let top = 0;
  for (const raw of objectsOf(doc).values()) {
    const z = raw.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > top) top = z;
  }
  return top;
}

/**
 * The size an image is placed at, in board units.
 *
 * One pixel of the file is one board unit, so a screenshot keeps the size it was drawn at - until
 * its longest side passes `IMAGE_MAX_PLACE_SIZE_WORLD`, when both sides shrink by the same factor
 * and that side becomes exactly the limit. Nothing is ever enlarged: a 40×30 icon stays a 40×30
 * icon (PRD image.placement_size).
 *
 * Returns `null` for a size that is not two positive finite numbers, which is how a file that would
 * not decode is dropped from a batch without stopping the rest of it.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } | null {
  if (!finite(naturalWidth) || !finite(naturalHeight)) return null;
  if (naturalWidth <= 0 || naturalHeight <= 0) return null;
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > IMAGE_MAX_PLACE_SIZE_WORLD ? IMAGE_MAX_PLACE_SIZE_WORLD / longest : 1;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Boxes for a row of images, left to right, separated by `IMAGE_LAYOUT_GAP_WORLD`.
 *
 * `top-left` puts the first box's top-left corner exactly on `start` - where a drop happened - and
 * every other box beside it with its top in line. `centre` puts the whole row's centre on `start`,
 * which is what a paste or a picked file wants: the middle of what the person can see. Heights are
 * not normalised, only aligned at the top, because an image's height is its own.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (!start || !finite(start.x) || !finite(start.y)) return [];
  const boxes: { width: number; height: number }[] = [];
  for (const size of sizes) {
    if (!size || !finite(size.width) || !finite(size.height)) continue;
    if (size.width <= 0 || size.height <= 0) continue;
    boxes.push({ width: size.width, height: size.height });
  }
  if (boxes.length === 0) return [];

  const gap = IMAGE_LAYOUT_GAP_WORLD;
  const totalWidth =
    boxes.reduce((sum, box) => sum + box.width, 0) + gap * (boxes.length - 1);
  const tallest = boxes.reduce((tallest_, box) => Math.max(tallest_, box.height), 0);

  let x = anchor === 'centre' ? start.x - totalWidth / 2 : start.x;
  const y = anchor === 'centre' ? start.y - tallest / 2 : start.y;

  const rects: Rect[] = [];
  for (const box of boxes) {
    rects.push({ x, y, width: box.width, height: box.height });
    x += box.width + gap;
  }
  return rects;
}

/** One file that has become a box on the board and is waiting for its bytes. */
export interface ImagePlaceholderInput {
  readonly rect: Rect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly contentType: string;
}

/**
 * Writes the placeholders for one add action and returns their ids, in order.
 *
 * The whole batch is one `LOCAL_ORIGIN` transaction, so undoing an add removes every image it added
 * in a single step (PRD Constraints/Undo). An item whose box is not a box is skipped; nothing is
 * written at all when nothing is usable, so a refused batch costs nobody an update.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholderInput[],
  uploaderId: string,
  now: number,
): string[] {
  const usable = items.filter(
    (item) =>
      item &&
      finite(item.rect?.x) &&
      finite(item.rect?.y) &&
      finite(item.rect?.width) &&
      finite(item.rect?.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0 &&
      finite(item.naturalWidth) &&
      finite(item.naturalHeight) &&
      typeof item.contentType === 'string',
  );
  if (usable.length === 0) return [];

  const createdAt = finite(now) ? now : 0;
  const ids: string[] = [];
  doc.transact(() => {
    const objects = objectsOf(doc);
    let z = Math.min(topZ(doc) + 1, MAX_Z);
    for (const item of usable) {
      const id = crypto.randomUUID();
      const record = new Y.Map<unknown>();
      record.set('type', 'image');
      record.set('x', item.rect.x);
      record.set('y', item.rect.y);
      record.set('width', item.rect.width);
      record.set('height', item.rect.height);
      record.set('z', z);
      record.set('createdAt', createdAt);
      record.set('assetKey', null);
      record.set('contentType', item.contentType);
      record.set('naturalWidth', item.naturalWidth);
      record.set('naturalHeight', item.naturalHeight);
      record.set('status', 'uploading');
      record.set('uploadStartedAt', createdAt);
      record.set('uploaderId', uploaderId);
      objects.set(id, record);
      ids.push(id);
      z = Math.min(z + 1, MAX_Z);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/** The `Y.Map` of an image, or undefined for a stale id or another object type. */
function imageRecord(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const raw = objectsOf(doc).get(id);
  if (!(raw instanceof Y.Map)) return undefined;
  return raw.get('type') === 'image' ? raw : undefined;
}

/**
 * One status write, under `UPLOAD_ORIGIN`, or nothing at all when the id has gone.
 *
 * A placeholder that has been deleted - undone, removed, or deleted by someone else - is not coming
 * back, and the upload that is still in flight must not resurrect it.
 */
function writeStatus(id: string, doc: Y.Doc, write: (record: Y.Map<unknown>) => void): boolean {
  const record = imageRecord(doc, id);
  if (!record) return false;
  doc.transact(() => write(record), UPLOAD_ORIGIN);
  return true;
}

/** The bytes have arrived: fill the placeholder in with the stored image. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  if (typeof assetKey !== 'string' || assetKey === '') return false;
  return writeStatus(id, doc, (record) => {
    record.set('status', 'ready');
    record.set('assetKey', assetKey);
  });
}

/** The upload did not: the person who started it is offered Retry and Remove. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return writeStatus(id, doc, (record) => {
    record.set('status', 'failed');
  });
}

/** The person pressed Retry: the same box is uploading again, with the clock restarted. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return writeStatus(id, doc, (record) => {
    record.set('status', 'uploading');
    record.set('uploadStartedAt', finite(now) ? now : 0);
  });
}

/**
 * What a screen should show for an image, at time `now`.
 *
 * `unfinished` is the one state that is not stored: an upload whose screen went away mid-transfer
 * never says so, so after `IMAGE_UPLOAD_STALE_MS` everybody stops waiting and is offered Remove
 * (PRD image.unfinished). A retry restarts the clock, which is why the state can only be derived.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  // a status this build does not know cannot be a live upload (see `statusOf`)
  const status = isImageStatus(img.status) ? img.status : 'failed';
  if (status !== 'uploading') return status;
  const age = finite(now) ? now - img.uploadStartedAt : 0;
  return age > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
}
