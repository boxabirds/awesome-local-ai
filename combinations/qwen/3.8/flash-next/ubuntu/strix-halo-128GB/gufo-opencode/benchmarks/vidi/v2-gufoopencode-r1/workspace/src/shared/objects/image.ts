import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import type { Point, Rect } from '../geometry';

// Story 12: image objects. Placeholder creation is a single LOCAL_ORIGIN
// transaction (one undo step); upload status updates use UPLOAD_ORIGIN, which
// is deliberately not tracked by the UndoManager (design image.model).

export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

export interface Size {
  width: number;
  height: number;
}

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

export interface PlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const value of doc.getMap('objects').values()) {
    const z = (value as Y.Map<unknown>).get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

// Natural pixels are board units; images larger than the cap scale down
// proportionally and are never enlarged (image.placement_size).
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > IMAGE_MAX_PLACE_SIZE_WORLD ? IMAGE_MAX_PLACE_SIZE_WORLD / longest : 1;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

// Left-to-right row separated by IMAGE_LAYOUT_GAP_WORLD. 'top-left' puts the
// first image's top-left corner on the start point; 'centre' centres the whole
// row (and its tallest image) on it.
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre'
): Rect[] {
  if (sizes.length === 0) return [];
  let totalWidth = (sizes.length - 1) * IMAGE_LAYOUT_GAP_WORLD;
  let tallest = 0;
  for (const size of sizes) {
    totalWidth += size.width;
    if (size.height > tallest) tallest = size.height;
  }
  let x = start.x;
  let y = start.y;
  if (anchor === 'centre') {
    x = start.x - totalWidth / 2;
    y = start.y - tallest / 2;
  }
  const rects: Rect[] = [];
  for (const size of sizes) {
    rects.push({ x, y, width: size.width, height: size.height });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

// One transaction for the whole add action: all placeholders land together as
// a single undo step. Items with non-finite geometry are skipped (contract).
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly PlaceholderItem[],
  uploaderId: string,
  now: number
): string[] {
  const usable = items.filter(
    (item) =>
      isFiniteNumber(item.rect.x) &&
      isFiniteNumber(item.rect.y) &&
      isFiniteNumber(item.rect.width) &&
      isFiniteNumber(item.rect.height) &&
      isFiniteNumber(item.naturalWidth) &&
      isFiniteNumber(item.naturalHeight) &&
      item.rect.width > 0 &&
      item.rect.height > 0
  );
  if (usable.length === 0) return [];
  const ids: string[] = [];
  const objects = doc.getMap('objects');
  doc.transact(() => {
    let z = maxZ(doc);
    for (const item of usable) {
      const id = newId();
      const entry = new Y.Map<unknown>();
      entry.set('type', 'image');
      entry.set('x', item.rect.x);
      entry.set('y', item.rect.y);
      entry.set('width', item.rect.width);
      entry.set('height', item.rect.height);
      entry.set('assetKey', null);
      entry.set('contentType', item.contentType);
      entry.set('naturalWidth', item.naturalWidth);
      entry.set('naturalHeight', item.naturalHeight);
      entry.set('status', 'uploading');
      entry.set('uploadStartedAt', now);
      entry.set('uploaderId', uploaderId);
      entry.set('z', (z += 1));
      entry.set('createdAt', Date.now());
      objects.set(id, entry);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

function setStatus(
  doc: Y.Doc,
  id: string,
  mutate: (entry: Y.Map<unknown>) => void
): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const entry = objects.get(id);
  if (entry === undefined || entry.get('type') !== 'image') return false;
  doc.transact(() => {
    mutate(entry);
  }, UPLOAD_ORIGIN);
  return true;
}

export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  return setStatus(doc, id, (entry) => {
    entry.set('assetKey', assetKey);
    entry.set('status', 'ready');
  });
}

export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return setStatus(doc, id, (entry) => {
    entry.set('status', 'failed');
  });
}

export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return setStatus(doc, id, (entry) => {
    entry.set('status', 'uploading');
    entry.set('uploadStartedAt', now);
  });
}

// 'unfinished' is derived at render time so abandoned uploads (uploader
// reloaded or closed the page) stop claiming to be in flight (image.unfinished).
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}

export function readImage(id: string, entry: Y.Map<unknown>): ImageSnap | null {
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const width = entry.get('width');
  const height = entry.get('height');
  const assetKey = entry.get('assetKey');
  const contentType = entry.get('contentType');
  const naturalWidth = entry.get('naturalWidth');
  const naturalHeight = entry.get('naturalHeight');
  const status = entry.get('status');
  const uploadStartedAt = entry.get('uploadStartedAt');
  const uploaderId = entry.get('uploaderId');
  const createdAt = entry.get('createdAt');
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(z) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    (assetKey !== null && typeof assetKey !== 'string') ||
    typeof contentType !== 'string' ||
    !isFiniteNumber(naturalWidth) ||
    !isFiniteNumber(naturalHeight) ||
    (status !== 'uploading' && status !== 'ready' && status !== 'failed') ||
    !isFiniteNumber(uploadStartedAt) ||
    typeof uploaderId !== 'string'
  ) {
    return null;
  }
  return {
    id,
    type: 'image',
    x,
    y,
    width,
    height,
    assetKey,
    contentType,
    naturalWidth,
    naturalHeight,
    status,
    uploadStartedAt,
    uploaderId,
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0
  };
}

export function isImageObject(obj: ObjectSnapshot): obj is ImageSnap {
  const candidate = obj as Partial<ImageSnap>;
  return (
    obj.type === 'image' &&
    (candidate.assetKey === null || typeof candidate.assetKey === 'string') &&
    typeof candidate.contentType === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.uploaderId === 'string'
  );
}
