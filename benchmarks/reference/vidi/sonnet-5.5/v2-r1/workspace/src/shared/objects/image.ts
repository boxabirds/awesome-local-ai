import * as Y from 'yjs';
import { LOCAL_ORIGIN, maxZ, objectsOf } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import type { Point, Rect } from '../geometry';

export type Size = { width: number; height: number };
export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

/** Status updates use this origin, which the UndoManager does not track: completion is never its own undo step. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('upload');

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

const HALF = 2;

/** Natural pixel size as board units, scaled down (never up) so the longest side is at most the placement limit. */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const longest = Math.max(naturalWidth, naturalHeight);
  const factor = longest > IMAGE_MAX_PLACE_SIZE_WORLD ? IMAGE_MAX_PLACE_SIZE_WORLD / longest : 1;
  return { width: naturalWidth * factor, height: naturalHeight * factor };
}

/** Left-to-right row; `top-left` puts the first image's corner on `start`, `centre` centres the whole row on it. */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  const total = sizes.reduce((sum, s) => sum + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * Math.max(0, sizes.length - 1);
  const tallest = sizes.reduce((max, s) => Math.max(max, s.height), 0);
  let x = anchor === 'centre' ? start.x - total / HALF : start.x;
  const top = anchor === 'centre' ? start.y - tallest / HALF : start.y;
  return sizes.map((s) => {
    const rect = { x, y: top, width: s.width, height: s.height };
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
    return rect;
  });
}

/** One LOCAL_ORIGIN transaction (one undo step) for the whole add action. Items with non-finite sizes are skipped. */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (i) => [i.rect.x, i.rect.y, i.rect.width, i.rect.height, i.naturalWidth, i.naturalHeight].every(Number.isFinite),
  );
  if (valid.length === 0) return [];
  const ids: string[] = [];
  doc.transact(() => {
    let z = maxZ(doc);
    for (const item of valid) {
      const id = crypto.randomUUID();
      const obj = new Y.Map<unknown>();
      objectsOf(doc).set(id, obj);
      obj.set('type', 'image');
      obj.set('x', item.rect.x);
      obj.set('y', item.rect.y);
      obj.set('width', item.rect.width);
      obj.set('height', item.rect.height);
      obj.set('assetKey', null);
      obj.set('contentType', item.contentType);
      obj.set('naturalWidth', item.naturalWidth);
      obj.set('naturalHeight', item.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      obj.set('z', ++z);
      obj.set('createdAt', now);
      obj.set('createdBy', uploaderId);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

function imageObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj && obj.get('type') === 'image' ? obj : undefined;
}

export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = imageObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = imageObj(doc, id);
  if (!obj) return false;
  doc.transact(() => obj.set('status', 'failed'), UPLOAD_ORIGIN);
  return true;
}

export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = imageObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

export function displayStatus(img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
  return img.status;
}
