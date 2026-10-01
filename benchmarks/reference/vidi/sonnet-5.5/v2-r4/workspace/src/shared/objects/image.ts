import * as Y from 'yjs';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

/** Status updates use this origin; the UndoManager does not track it, so completion is never an undo step. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';
export type Size = { width: number; height: number };

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

export function isImage(o: ObjectSnapshot): o is ImageSnap {
  return o.type === 'image';
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

const finite = (...v: number[]) => v.every((n) => Number.isFinite(n));

/** Natural size in board units, scaled down (never up) so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD. */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const longest = Math.max(naturalWidth, naturalHeight);
  const k = longest > IMAGE_MAX_PLACE_SIZE_WORLD ? IMAGE_MAX_PLACE_SIZE_WORLD / longest : 1;
  return { width: naturalWidth * k, height: naturalHeight * k };
}

/** Left to right with a gap; `top-left` puts the first top-left corner at `start`, `centre` centres the row on it. */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  const total = sizes.reduce((s, z) => s + z.width, 0) + Math.max(0, sizes.length - 1) * IMAGE_LAYOUT_GAP_WORLD;
  const tallest = sizes.reduce((m, z) => Math.max(m, z.height), 0);
  let x = anchor === 'centre' ? start.x - total / 2 : start.x;
  const top = anchor === 'centre' ? start.y - tallest / 2 : start.y;
  return sizes.map((z) => {
    const r = { x, y: top, width: z.width, height: z.height };
    x += z.width + IMAGE_LAYOUT_GAP_WORLD;
    return r;
  });
}

/** One LOCAL_ORIGIN transaction (one undo step) for the whole add; items with non-finite sizes are skipped. */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const ids: string[] = [];
  doc.transact(() => {
    let z = 0;
    objects(doc).forEach((o) => {
      const v = o.get('z');
      if (typeof v === 'number' && Number.isFinite(v)) z = Math.max(z, v);
    });
    for (const it of items) {
      const { x, y, width, height } = it.rect;
      if (!finite(x, y, width, height, it.naturalWidth, it.naturalHeight) || width <= 0 || height <= 0) continue;
      const id = crypto.randomUUID();
      const obj = new Y.Map<unknown>();
      objects(doc).set(id, obj);
      obj.set('type', 'image');
      obj.set('x', x);
      obj.set('y', y);
      obj.set('width', width);
      obj.set('height', height);
      obj.set('assetKey', null);
      obj.set('contentType', it.contentType);
      obj.set('naturalWidth', it.naturalWidth);
      obj.set('naturalHeight', it.naturalHeight);
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

function update(doc: Y.Doc, id: string, fn: (o: Y.Map<unknown>) => void): boolean {
  const obj = objects(doc).get(id);
  if (!obj || obj.get('type') !== 'image') return false;
  doc.transact(() => fn(obj), UPLOAD_ORIGIN);
  return true;
}

export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  return update(doc, id, (o) => {
    o.set('assetKey', assetKey);
    o.set('status', 'ready');
  });
}

export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return update(doc, id, (o) => o.set('status', 'failed'));
}

export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return update(doc, id, (o) => {
    o.set('status', 'uploading');
    o.set('uploadStartedAt', now);
  });
}

export function displayStatus(img: Pick<ImageSnap, 'status' | 'uploadStartedAt'>, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
  return img.status;
}
