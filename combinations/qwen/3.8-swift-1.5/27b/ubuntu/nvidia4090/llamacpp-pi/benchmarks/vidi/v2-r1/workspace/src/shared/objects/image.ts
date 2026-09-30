/**
 * Story 12: image object model (image.model).
 *
 * Schema (per object id in the `objects` Y.Map):
 * ```
 * Y.Map {
 *   type: 'image', x, y, width, height, z, createdAt,
 *   assetKey: string | null,   // null while uploading
 *   contentType: string,       // sniffed/stored type (e.g. image/png)
 *   naturalWidth: number,      // decoded pixel dimensions
 *   naturalHeight: number,
 *   status: 'uploading' | 'ready' | 'failed',
 *   uploadStartedAt: number,   // epoch ms
 *   uploaderId: string
 * }
 * ```
 *
 * Undo: placeholder creation is one LOCAL_ORIGIN transaction (one undo
 * step per add action, PRD image.upload_failure / story 8). Status updates
 * use UPLOAD_ORIGIN, which the UndoManager does not track, so upload
 * completion is never its own undo step.
 *
 * (board-model does not import this module, so importing LOCAL_ORIGIN /
 * nextZ from it is cycle-free.)
 */
import * as Y from 'yjs';
import type { Point, Rect } from '../geometry';
import type { ObjectSnapshot } from '../board-model';
import { LOCAL_ORIGIN } from '../board-model';
import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';

/** Origin for upload status updates — NOT tracked by the UndoManager. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('UPLOAD_ORIGIN');

export type ImageStatus = 'uploading' | 'ready' | 'failed';

/** `unfinished` is derived at render time from uploadStartedAt. */
export type DisplayStatus = ImageStatus | 'unfinished';

export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

export interface ImagePlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Placement size: the image's natural pixel size, scaled down (never up) so
 * the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD (800), keeping the
 * aspect ratio (image.sizing).
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const longest = Math.max(naturalWidth, naturalHeight);
  if (!Number.isFinite(longest) || longest <= 0) {
    return { width: 1, height: 1 };
  }
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Row layout for a multi-file add (image.multi):
 *
 * - `top-left`: first image's top-left corner at `start`; images flow
 *   left→right with IMAGE_LAYOUT_GAP_WORLD between them; tops aligned.
 * - `centre`: the whole row (total width incl. gaps, height of the tallest
 *   image) is centred on `start`.
 */
export function layoutRow(
  sizes: readonly { width: number; height: number }[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const rects: Rect[] = [];
  if (sizes.length === 0) return rects;

  const totalWidth =
    sizes.reduce((sum, s) => sum + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);
  const rowHeight = sizes.reduce((max, s) => Math.max(max, s.height), 0);

  let cursorX = anchor === 'centre' ? start.x - totalWidth / 2 : start.x;
  const y = anchor === 'centre' ? start.y - rowHeight / 2 : start.y;

  for (const size of sizes) {
    rects.push({ x: cursorX, y, width: size.width, height: size.height });
    cursorX += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/** Next z-index above all current objects (story 7 z-order). */
function nextZOf(objects: Y.Map<unknown>): number {
  let max = 0;
  objects.forEach((value) => {
    const z = ((value as Y.Map<unknown>).get?.('z') as number | undefined) ?? 0;
    if (typeof z === 'number' && z > max) max = z;
  });
  return max + 1;
}

/** 22-char base64url object id (same alphabet as board ids). */
function newObjectId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Create all placeholders for one add action in a SINGLE doc transaction on
 * LOCAL_ORIGIN, so the whole action is exactly one undo step (TC-05).
 * Returns the new object ids in layout order.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const ids: string[] = [];
  if (items.length === 0) return ids;

  const objects = doc.getMap('objects');
  doc.transact(() => {
    for (const item of items) {
      const id = newObjectId();
      const map = new Y.Map<unknown>();
      map.set('type', 'image');
      map.set('x', item.rect.x);
      map.set('y', item.rect.y);
      map.set('width', item.rect.width);
      map.set('height', item.rect.height);
      map.set('z', nextZOf(objects));
      map.set('createdAt', now);
      map.set('assetKey', null);
      map.set('contentType', item.contentType);
      map.set('naturalWidth', item.naturalWidth);
      map.set('naturalHeight', item.naturalHeight);
      map.set('status', 'uploading');
      map.set('uploadStartedAt', now);
      map.set('uploaderId', uploaderId);
      objects.set(id, map);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

function imageMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
}

/** Set status 'ready' + assetKey. False if the object no longer exists. */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const map = imageMap(doc, id);
  if (map === undefined) return false;
  doc.transact(() => {
    map.set('status', 'ready');
    map.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/** Set status 'failed'. False if the object no longer exists. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const map = imageMap(doc, id);
  if (map === undefined) return false;
  doc.transact(() => {
    map.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Put a failed placeholder back to 'uploading' with a fresh timestamp (the
 * retry button re-enters the upload flow, PRD image.upload_failure).
 * False if the object no longer exists.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const map = imageMap(doc, id);
  if (map === undefined) return false;
  doc.transact(() => {
    map.set('status', 'uploading');
    map.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Display status (image.upload_failure): 'uploading' becomes 'unfinished'
 * once now - uploadStartedAt exceeds IMAGE_UPLOAD_STALE_MS. 'ready' and
 * 'failed' pass through.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
