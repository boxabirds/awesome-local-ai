/**
 * Story 12 — image object model (shared: client + tests).
 *
 * An image object is created as an 'uploading' placeholder (the file is
 * measured first, so the placeholder already has its final rect) and
 * transitions to 'ready' (assetKey set) or 'failed' when the upload
 * settles. Ready images never change afterwards, so their asset is
 * immutable and cached for a year.
 *
 * Schema per image item under the `objects` Y.Map:
 *   type: 'image'
 *   x, y, width, height   (world units; width/height are the placed size,
 *                          always set for images)
 *   assetKey: string | null   (R2 key <boardId>/<assetId>, null until ready)
 *   contentType: string       (sniffed/stated MIME of the uploaded image)
 *   naturalWidth, naturalHeight (device pixels; kept for future zoom-quality)
 *   status: 'uploading' | 'ready' | 'failed'
 *   uploadStartedAt: number   (epoch ms; staleness → 'unfinished')
 *   uploaderId: string        (client identity that owns the file bytes)
 */
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { ObjectSnapshot } from '../board-model';
import { LOCAL_ORIGIN } from '../board-model';
import type { Point, Rect } from '../geometry';

export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** What the UI shows for an image at time `now` (stale uploads become 'unfinished'). */
export type ImageDisplayStatus = ImageStatus | 'unfinished';

/** An image object as read from the doc (type-specific fields always present). */
export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
  width: number;
  height: number;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

/** UPLOAD_ORIGIN: upload-settle writes are not undo steps (story 8: an add is
 * one step, its settle is not). Untracked origins are ignored by UndoManager. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('UPLOAD_ORIGIN');

/**
 * The rect an image is placed with from its natural pixel size: natural
 * size, unless the longest side exceeds IMAGE_MAX_PLACE_SIZE_WORLD, in which
 * case both sides scale down proportionally to keep it at most that.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const f = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return { width: naturalWidth * f, height: naturalHeight * f };
}

/**
 * Lay `sizes` out left-to-right in one row with IMAGE_LAYOUT_GAP_WORLD
 * between boxes:
 *  - 'top-left': the first box's top-left corner is `start`, tops aligned;
 *  - 'centre': the whole row (total width × tallest box) is centred on
 *    `start`.
 * Returns one world Rect per size, in order.
 */
export function layoutRow(
  sizes: readonly { width: number; height: number }[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const out: Rect[] = [];
  if (anchor === 'centre') {
    const totalWidth =
      sizes.reduce((a, s) => a + s.width, 0) +
      IMAGE_LAYOUT_GAP_WORLD * Math.max(0, sizes.length - 1);
    const tallest = sizes.reduce((a, s) => Math.max(a, s.height), 0);
    let x = start.x - totalWidth / 2;
    const y = start.y - tallest / 2;
    for (const s of sizes) {
      out.push({ x, y, width: s.width, height: s.height });
      x += s.width + IMAGE_LAYOUT_GAP_WORLD;
    }
    return out;
  }
  let x = start.x;
  for (const s of sizes) {
    out.push({ x, y: start.y, width: s.width, height: s.height });
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return out;
}

export interface ImagePlaceholderInput {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Create one 'uploading' placeholder per item in a single LOCAL_ORIGIN
 * transaction (one undo step for the whole add action). Invalid items
 * (non-finite rect) are skipped; all invalid → no transaction, [].
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholderInput[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (it) =>
      Number.isFinite(it.rect.x) &&
      Number.isFinite(it.rect.y) &&
      Number.isFinite(it.rect.width) &&
      Number.isFinite(it.rect.height) &&
      it.rect.width > 0 &&
      it.rect.height > 0 &&
      Number.isFinite(it.naturalWidth) &&
      Number.isFinite(it.naturalHeight) &&
      typeof it.contentType === 'string',
  );
  if (valid.length === 0) return [];
  const obj = doc.getMap('objects');
  let max = 0;
  obj.forEach((item) => {
    if (!(item instanceof Y.Map)) return;
    const z = item.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  const ids: string[] = [];
  doc.transact(
    () => {
      for (const it of valid) {
        const id = crypto.randomUUID();
        const item = new Y.Map();
        item.set('type', 'image');
        item.set('x', it.rect.x);
        item.set('y', it.rect.y);
        item.set('width', it.rect.width);
        item.set('height', it.rect.height);
        item.set('assetKey', null);
        item.set('contentType', it.contentType);
        item.set('naturalWidth', it.naturalWidth);
        item.set('naturalHeight', it.naturalHeight);
        item.set('status', 'uploading');
        item.set('uploadStartedAt', now);
        item.set('uploaderId', uploaderId);
        item.set('z', max + 1 + ids.length);
        item.set('createdAt', now);
        obj.set(id, item);
        ids.push(id);
      }
    },
    LOCAL_ORIGIN,
  );
  return ids;
}

function imageItem(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const item = doc.getMap('objects').get(id);
  if (!(item instanceof Y.Map) || item.get('type') !== 'image') return undefined;
  return item as Y.Map<unknown>;
}

/** Set assetKey + status 'ready' (UPLOAD_ORIGIN — not an undo step). */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  if (typeof assetKey !== 'string' || assetKey.length === 0) return false;
  const item = imageItem(doc, id);
  if (!item) return false;
  doc.transact(
    () => {
      item.set('assetKey', assetKey);
      item.set('status', 'ready');
    },
    UPLOAD_ORIGIN,
  );
  return true;
}

/** Mark an image 'failed' (UPLOAD_ORIGIN — not an undo step). */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const item = imageItem(doc, id);
  if (!item) return false;
  doc.transact(() => {
    item.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/** Move a failed image back to 'uploading' for a retry (UPLOAD_ORIGIN). */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  if (!Number.isFinite(now)) return false;
  const item = imageItem(doc, id);
  if (!item) return false;
  doc.transact(
    () => {
      item.set('status', 'uploading');
      item.set('uploadStartedAt', now);
    },
    UPLOAD_ORIGIN,
  );
  return true;
}

/**
 * The display status at time `now`: an 'uploading' image whose
 * uploadStartedAt is older than IMAGE_UPLOAD_STALE_MS is 'unfinished'
 * (the uploader's tab closed or the network died mid-upload; everyone sees
 * the same thing and can Remove it).
 */
export function displayStatus(img: ImageSnap, now: number): ImageDisplayStatus {
  if (
    img.status === 'uploading' &&
    Number.isFinite(now) &&
    now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS
  ) {
    return 'unfinished';
  }
  return img.status;
}
