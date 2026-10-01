import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ImageSnapshot } from '../board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import type { Point, Rect } from '../geometry';

export type ImageSnap = ImageSnapshot;
export type ImageStatus = ImageSnapshot['status'];
export type DisplayStatus = ImageStatus | 'unfinished';
export interface Size { readonly width: number; readonly height: number }

/** Status updates use this origin, which the UndoManager does not track: completing an upload is no undo step. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('upload');

const HALF = 2;

/** Natural size in board units, scaled down (never up) so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD. */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > IMAGE_MAX_PLACE_SIZE_WORLD ? IMAGE_MAX_PLACE_SIZE_WORLD / longest : 1;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/** Left to right with a gap; 'top-left' starts the row at `start`, 'centre' centres the whole row on it. */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  const total = sizes.reduce((sum, s) => sum + s.width, 0) + Math.max(0, sizes.length - 1) * IMAGE_LAYOUT_GAP_WORLD;
  const tallest = sizes.reduce((max, s) => Math.max(max, s.height), 0);
  let x = anchor === 'centre' ? start.x - total / HALF : start.x;
  const top = anchor === 'centre' ? start.y - tallest / HALF : start.y;
  return sizes.map((s) => {
    const rect = { x, y: top, width: s.width, height: s.height };
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
    return rect;
  });
}

const objectsOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap('objects') as Y.Map<unknown>;
const finite = (...v: number[]): boolean => v.every((n) => Number.isFinite(n));

/** One LOCAL_ORIGIN transaction (one undo step) for the whole add action; items with non-finite sizes are skipped. */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const objects = objectsOf(doc);
  let z = 0;
  objects.forEach((o) => {
    const v = o instanceof Y.Map ? o.get('z') : 0;
    if (typeof v === 'number' && Number.isFinite(v)) z = Math.max(z, v);
  });
  const ids: string[] = [];
  doc.transact(() => {
    for (const item of items) {
      const { rect } = item;
      if (!finite(rect.x, rect.y, rect.width, rect.height, item.naturalWidth, item.naturalHeight)
        || rect.width <= 0 || rect.height <= 0) continue;
      const id = crypto.randomUUID();
      const m = new Y.Map<unknown>();
      objects.set(id, m);
      m.set('type', 'image');
      m.set('x', rect.x);
      m.set('y', rect.y);
      m.set('width', rect.width);
      m.set('height', rect.height);
      m.set('assetKey', null);
      m.set('contentType', item.contentType);
      m.set('naturalWidth', item.naturalWidth);
      m.set('naturalHeight', item.naturalHeight);
      m.set('status', 'uploading');
      m.set('uploadStartedAt', now);
      m.set('uploaderId', uploaderId);
      m.set('z', ++z);
      m.set('createdAt', now);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

function update(doc: Y.Doc, id: string, apply: (m: Y.Map<unknown>) => void): boolean {
  const m = objectsOf(doc).get(id);
  if (!(m instanceof Y.Map) || m.get('type') !== 'image') return false;
  doc.transact(() => apply(m), UPLOAD_ORIGIN);
  return true;
}

export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  return update(doc, id, (m) => {
    m.set('assetKey', assetKey);
    m.set('status', 'ready');
  });
}

export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return update(doc, id, (m) => m.set('status', 'failed'));
}

export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return update(doc, id, (m) => {
    m.set('status', 'uploading');
    m.set('uploadStartedAt', now);
  });
}

export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) return 'unfinished';
  return img.status;
}
