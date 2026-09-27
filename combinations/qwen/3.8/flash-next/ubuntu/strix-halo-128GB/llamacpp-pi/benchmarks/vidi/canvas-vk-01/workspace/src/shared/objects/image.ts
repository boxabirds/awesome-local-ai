import * as Y from 'yjs';

import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

/**
 * The image object (story 12, `image.placeholder_survives`).
 *
 * An image is one record in the shared `objects` map, and the record is written
 * before the upload finishes: it is what the board shows while the bytes travel,
 * so a reload or a second collaborator sees the same thing. `assetKey` is null
 * until the upload succeeds, which is the whole difference between "still going"
 * and "there to look at"; `status` and `uploadStartedAt` say how far it got.
 *
 * Which origin a write uses matters. Inserting placeholders is a local edit — one
 * undoable step, `undo` removing the whole batch whichever way their uploads then
 * went. Recording an outcome uses `UPLOAD_ORIGIN`, which undo does not track: an
 * upload completing on its own must never be folded into the user's next undo, and
 * must never appear as a change to undo on *any* client.
 *
 * The object holds its own geometry, so a later `setObjectZ`, a group move or a
 * delete all treat it like any other object.
 */

/** Where an image is in its upload. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** `status` as the reader sees it: an abandoned upload is its own case. */
export type DisplayStatus = ImageStatus | 'unfinished';

/** What a reader sees of an image object. */
export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
  /** The bucket key once uploaded; null while the bytes have not arrived. */
  assetKey: string | null;
  contentType: string;
  /** The picture's own pixel size, which is what keeps its proportions. */
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  /** When this upload began; a retry restamps it (`image.placeholder_survives`). */
  uploadStartedAt: number;
  /** The client that started the upload, so only they are offered Retry. */
  uploaderId: string;
  width: number;
  height: number;
}

/**
 * An image to place: what the browser measured before uploading, and the
 * rectangle it was laid out into (`layoutRow` + `placementSize` are what produce
 * the rect, so this function neither decides sizes nor arranges rows).
 */
export interface ImageItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  /** The MIME type of the decoded picture. */
  contentType: string;
}

/**
 * The origin of the outcome writes. Deliberately *not* `LOCAL_ORIGIN`: undo tracks
 * local edits, and an upload finishing is not one (task 5).
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload-origin');

/** The only statuses a record may hold. */
const STATUSES: readonly ImageStatus[] = ['uploading', 'ready', 'failed'];

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The size an image lands at (`image.place_size`): never wider or taller than
 * `IMAGE_MAX_PLACE_SIZE_WORLD`, never with a side under `IMAGE_MIN_SIZE_WORLD`,
 * and otherwise in the picture's own proportions. A picture whose aspect is too
 * extreme to satisfy both gives the maximum side priority, since the floor exists
 * so the object stays grabbable.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  if (!finite(naturalWidth) || !finite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: IMAGE_MIN_SIZE_WORLD, height: IMAGE_MIN_SIZE_WORLD };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return {
    width: Math.max(IMAGE_MIN_SIZE_WORLD, Math.round(naturalWidth * scale)),
    height: Math.max(IMAGE_MIN_SIZE_WORLD, Math.round(naturalHeight * scale)),
  };
}

/**
 * Rectangles for a batch: left to right from `start`, tops aligned,
 * `IMAGE_LAYOUT_GAP_WORLD` apart (`image.row_layout`). With the 'centre' anchor the
 * row as a whole is centred horizontally on `start`.
 */
export function layoutRow(
  sizes: ReadonlyArray<{ width: number; height: number }>,
  start: Point,
  anchor: 'top-left' | 'centre' = 'top-left',
): Rect[] {
  if (sizes.length === 0) return [];
  const rowWidth =
    sizes.reduce((total, size) => total + size.width, 0) + IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);
  let x = anchor === 'centre' ? start.x - rowWidth / 2 : start.x;
  const rects: Rect[] = [];
  for (const size of sizes) {
    rects.push({ x, y: start.y, width: size.width, height: size.height });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

const topZ = (objects: Y.Map<Y.Map<unknown>>): number => {
  let top = 0;
  objects.forEach((record) => {
    const z = record.get('z');
    if (finite(z) && z > top) top = z;
  });
  return top;
};

/**
 * Insert one placeholder per image — in a single `LOCAL_ORIGIN` transaction, which
 * is what makes the batch one undo step — and return their ids in the order given.
 * An image with no readable pixel size, or no rectangle to sit in, is skipped
 * rather than placed as a placeholder nothing can draw.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImageItem[],
  uploaderId: string,
  now: number,
): string[] {
  const placed = items.filter(
    (item) =>
      finite(item.naturalWidth) &&
      finite(item.naturalHeight) &&
      item.naturalWidth > 0 &&
      item.naturalHeight > 0 &&
      finite(item.rect?.x) &&
      finite(item.rect?.y) &&
      finite(item.rect?.width) &&
      finite(item.rect?.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0,
  );
  if (placed.length === 0) return [];

  const rects = placed.map((item) => item.rect);
  const ids = placed.map(() => crypto.randomUUID());
  const objects = objectsOf(doc);
  const baseZ = topZ(objects);
  const startedAt = finite(now) ? now : Date.now();

  doc.transact(() => {
    placed.forEach((item, index) => {
      const rect = rects[index]!;
      const record = new Y.Map<unknown>();
      record.set('id', ids[index]);
      record.set('type', 'image');
      record.set('x', rect.x);
      record.set('y', rect.y);
      record.set('width', rect.width);
      record.set('height', rect.height);
      record.set('z', baseZ + index + 1);
      record.set('assetKey', null);
      record.set('contentType', item.contentType);
      record.set('naturalWidth', item.naturalWidth);
      record.set('naturalHeight', item.naturalHeight);
      record.set('status', 'uploading' satisfies ImageStatus);
      record.set('uploadStartedAt', startedAt);
      record.set('uploaderId', uploaderId);
      objects.set(ids[index]!, record);
    });
  }, LOCAL_ORIGIN);

  return ids;
}

/**
 * Move a record to a new status, and only from a status that allows it: an outcome
 * is recorded once, while the upload is still running. Returns false when the
 * object is gone or already settled, so a late callback is a no-op.
 */
function setImageStatus(
  doc: Y.Doc,
  id: string,
  from: ImageStatus,
  to: ImageStatus,
  extra?: Record<string, unknown>,
  now?: number,
): boolean {
  const objects = objectsOf(doc);
  const record = objects.get(id);
  if (record === undefined) return false;
  if (record.get('status') !== from) return false;
  doc.transact(() => {
    const current = objects.get(id);
    if (current === undefined || current.get('status') !== from) return;
    current.set('status', to satisfies ImageStatus);
    if (to === 'ready') current.set('assetKey', extra?.assetKey ?? null);
    if (now !== undefined) current.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return record.get('status') === to;
}

/** The upload arrived: the object now points at stored bytes. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  return setImageStatus(doc, id, 'uploading', 'ready', { assetKey });
}

/** The upload gave up, and will not retry by itself. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return setImageStatus(doc, id, 'uploading', 'failed');
}

/** Try again: back to uploading, with a clock that makes the wait theirs again. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return setImageStatus(doc, id, 'failed', 'uploading', undefined, now);
}

/**
 * `status` as the board should show it (`image.placeholder_survives`): an image
 * still marked uploading long after it began belonged to a tab that went away, and
 * says so instead of spinning for ever. The record is left alone — this is a
 * reader's judgement, and the next reader may be online.
 */
export function displayStatus(image: ImageSnap, now: number): DisplayStatus {
  if (image.status !== 'uploading') return image.status;
  if (!finite(image.uploadStartedAt) || !finite(now)) return image.status;
  return now - image.uploadStartedAt > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
}

/** The raw record, for the shared snapshot builder. */
export function imageSnapshotFrom(id: string, z: number, obj: Y.Map<unknown>): ImageSnap | null {
  const x = obj.get('x');
  const y = obj.get('y');
  if (!finite(x) || !finite(y)) return null;
  const naturalWidth = finite(obj.get('naturalWidth')) ? (obj.get('naturalWidth') as number) : 0;
  const naturalHeight = finite(obj.get('naturalHeight')) ? (obj.get('naturalHeight') as number) : 0;
  // Width and height are the placed size; a record whose own size is unusable
  // falls back to the natural size scaled to fit, so it is still drawn.
  const width = finite(obj.get('width')) ? (obj.get('width') as number) : undefined;
  const height = finite(obj.get('height')) ? (obj.get('height') as number) : undefined;
  const placed =
    width !== undefined && height !== undefined
      ? { width, height }
      : placementSize(naturalWidth, naturalHeight);
  const assetKey = obj.get('assetKey');
  const status = obj.get('status');
  const contentType = obj.get('contentType');
  const uploaderId = obj.get('uploaderId');
  const uploadStartedAt = obj.get('uploadStartedAt');
  return {
    id,
    type: 'image',
    x,
    y,
    z,
    width: placed.width,
    height: placed.height,
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : 'application/octet-stream',
    naturalWidth,
    naturalHeight,
    status: STATUSES.includes(status as ImageStatus) ? (status as ImageStatus) : 'uploading',
    uploadStartedAt: finite(uploadStartedAt) ? uploadStartedAt : 0,
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
  };
}
