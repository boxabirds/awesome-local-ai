import * as Y from 'yjs';
import type { Point, Size } from '@client/canvas/camera';
import type { Rect } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';

export const UPLOAD_ORIGIN: unique symbol = Symbol('upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

export interface ImageSnap {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy: string;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getImageMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsMap(doc).get(id);
  if (!m || !(m instanceof Y.Map) || m.get('type') !== 'image') return undefined;
  return m;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((m) => {
    if (m instanceof Y.Map) {
      const z = m.get('z');
      if (isFiniteNumber(z) && z > max) max = z;
    }
  });
  return max;
}

export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  if (sizes.length === 0) return [];

  const totalWidth = sizes.reduce((sum, s) => sum + s.width, 0) + (sizes.length - 1) * IMAGE_LAYOUT_GAP_WORLD;
  const totalHeight = Math.max(...sizes.map((s) => s.height));

  let x: number;
  let y: number;

  if (anchor === 'top-left') {
    x = start.x;
    y = start.y;
  } else {
    // centre anchor: centre the row on the point
    x = start.x - totalWidth / 2;
    y = start.y - totalHeight / 2;
  }

  const rects: Rect[] = [];
  let curX = x;
  for (const size of sizes) {
    rects.push({ x: curX, y, width: size.width, height: size.height });
    curX += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  // Filter out items with non-finite sizes
  const valid = items.filter(
    (item) =>
      isFiniteNumber(item.rect.x) &&
      isFiniteNumber(item.rect.y) &&
      isFiniteNumber(item.rect.width) &&
      isFiniteNumber(item.rect.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0 &&
      isFiniteNumber(item.naturalWidth) &&
      isFiniteNumber(item.naturalHeight),
  );
  if (valid.length === 0) return [];

  const ids: string[] = [];
  doc.transact(() => {
    let z = maxZ(doc);
    for (const item of valid) {
      const id = crypto.randomUUID();
      ids.push(id);
      z += 1;
      const m = new Y.Map<unknown>();
      m.set('type', 'image');
      m.set('x', item.rect.x);
      m.set('y', item.rect.y);
      m.set('width', item.rect.width);
      m.set('height', item.rect.height);
      m.set('z', z);
      m.set('createdAt', now);
      m.set('createdBy', uploaderId);
      m.set('assetKey', null);
      m.set('contentType', item.contentType);
      m.set('naturalWidth', item.naturalWidth);
      m.set('naturalHeight', item.naturalHeight);
      m.set('status', 'uploading');
      m.set('uploadStartedAt', now);
      m.set('uploaderId', uploaderId);
      objectsMap(doc).set(id, m);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const m = getImageMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    m.set('status', 'ready');
    m.set('assetKey', assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const m = getImageMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    m.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const m = getImageMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    m.set('status', 'uploading');
    m.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading') {
    if (now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
      return 'unfinished';
    }
    return 'uploading';
  }
  return img.status;
}

export function snapshotImage(doc: Y.Doc): readonly ImageSnap[] {
  const result: ImageSnap[] = [];
  objectsMap(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map) || m.get('type') !== 'image') return;
    const x = m.get('x');
    const y = m.get('y');
    const width = m.get('width');
    const height = m.get('height');
    const z = m.get('z');
    const createdAt = m.get('createdAt');
    const createdBy = m.get('createdBy');
    const assetKey = m.get('assetKey');
    const contentType = m.get('contentType');
    const naturalWidth = m.get('naturalWidth');
    const naturalHeight = m.get('naturalHeight');
    const status = m.get('status');
    const uploadStartedAt = m.get('uploadStartedAt');
    const uploaderId = m.get('uploaderId');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return;
    result.push({
      id,
      type: 'image',
      x,
      y,
      width: isFiniteNumber(width) ? width : 100,
      height: isFiniteNumber(height) ? height : 100,
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      createdBy: typeof createdBy === 'string' ? createdBy : '',
      assetKey: typeof assetKey === 'string' ? assetKey : null,
      contentType: typeof contentType === 'string' ? contentType : 'image/png',
      naturalWidth: isFiniteNumber(naturalWidth) ? naturalWidth : 100,
      naturalHeight: isFiniteNumber(naturalHeight) ? naturalHeight : 100,
      status: status === 'ready' || status === 'failed' || status === 'uploading' ? status : 'uploading',
      uploadStartedAt: isFiniteNumber(uploadStartedAt) ? uploadStartedAt : 0,
      uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
    });
  });
  result.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
