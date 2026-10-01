import * as Y from 'yjs';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

/** Status updates use this origin; the UndoManager tracks LOCAL_ORIGIN only, so completion is never an undo step. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';
export interface Size { width: number; height: number }

export interface ImageSnap extends ObjectSnapshot {
  type: 'image'; assetKey: string | null; contentType: string; naturalWidth: number; naturalHeight: number;
  status: ImageStatus; uploadStartedAt: number; uploaderId: string;
}

const HALF = 2;
const objectsOf = (doc: Y.Doc) => doc.getMap('objects') as Y.Map<Y.Map<unknown>>;

export const isImageStatus = (s: unknown): s is ImageStatus => s === 'uploading' || s === 'ready' || s === 'failed';

/** Natural pixel size in board units, scaled down (never up) so the longest side is at most the placement limit. */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/** Left-to-right row; `top-left` puts the first image's corner at `start`, `centre` centres the whole row on it. */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  const total = sizes.reduce((sum, s) => sum + s.width, 0) + IMAGE_LAYOUT_GAP_WORLD * Math.max(0, sizes.length - 1);
  const tallest = sizes.reduce((m, s) => Math.max(m, s.height), 0);
  let x = anchor === 'centre' ? start.x - total / HALF : start.x;
  const top = anchor === 'centre' ? start.y - tallest / HALF : start.y;
  return sizes.map((s) => {
    const rect = { x, y: top, width: s.width, height: s.height };
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
    return rect;
  });
}

/** One LOCAL_ORIGIN transaction for the whole add action (one undo step); non-finite items are skipped. */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string, now: number,
): string[] {
  const valid = items.filter((i) => [i.rect.x, i.rect.y, i.rect.width, i.rect.height].every(Number.isFinite)
    && i.rect.width > 0 && i.rect.height > 0);
  if (valid.length === 0) return [];
  const ids: string[] = [];
  doc.transact(() => {
    let max = 0;
    objectsOf(doc).forEach((o) => {
      const z = o instanceof Y.Map ? o.get('z') : 0;
      if (typeof z === 'number') max = Math.max(max, z);
    });
    valid.forEach((item) => {
      const id = crypto.randomUUID();
      const obj = new Y.Map<unknown>();
      objectsOf(doc).set(id, obj);
      obj.set('type', 'image');
      obj.set('x', item.rect.x); obj.set('y', item.rect.y);
      obj.set('width', item.rect.width); obj.set('height', item.rect.height);
      obj.set('z', ++max);
      obj.set('createdAt', now);
      obj.set('createdBy', uploaderId);
      obj.set('assetKey', null);
      obj.set('contentType', item.contentType);
      obj.set('naturalWidth', item.naturalWidth); obj.set('naturalHeight', item.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      ids.push(id);
    });
  }, LOCAL_ORIGIN);
  return ids;
}

function imageObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map && obj.get('type') === 'image' ? obj : undefined;
}

function update(doc: Y.Doc, id: string, fields: Record<string, unknown>): boolean {
  const obj = imageObject(doc, id);
  if (!obj) return false;
  doc.transact(() => Object.entries(fields).forEach(([k, v]) => obj.set(k, v)), UPLOAD_ORIGIN);
  return true;
}

export const markImageReady = (doc: Y.Doc, id: string, assetKey: string): boolean =>
  update(doc, id, { assetKey, status: 'ready' });

export const markImageFailed = (doc: Y.Doc, id: string): boolean => update(doc, id, { status: 'failed' });

export const markImageRetrying = (doc: Y.Doc, id: string, now: number): boolean =>
  update(doc, id, { status: 'uploading', uploadStartedAt: now });

export function displayStatus(img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
  return img.status;
}
