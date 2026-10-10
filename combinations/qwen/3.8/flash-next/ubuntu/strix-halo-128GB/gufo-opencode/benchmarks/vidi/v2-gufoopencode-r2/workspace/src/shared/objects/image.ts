// Story 12: the `image` object type's model layer. Placeholder creation is a
// LOCAL_ORIGIN transaction (one undo step per add); the upload-driven
// transitions (ready/failed/retrying) use UPLOAD_ORIGIN, which the
// UndoManager does not track, so upload completion never becomes its own
// undo step.

import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import { LOCAL_ORIGIN, isImageStatus } from '../board-model';
import type { Point } from '../geometry';

export type { ImageSnap, ImageStatus } from '../board-model';

export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload');

export interface PlacementSize {
  width: number;
  height: number;
}

// World placement for a newly added image: natural pixels 1:1 until the
// longest side reaches IMAGE_MAX_PLACE_SIZE_WORLD, then scaled down
// proportionally, never below IMAGE_MIN_SIZE_WORLD per side.
export function placementSize(naturalWidth: number, naturalHeight: number): PlacementSize {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > IMAGE_MAX_PLACE_SIZE_WORLD ? IMAGE_MAX_PLACE_SIZE_WORLD / longest : 1;
  return {
    width: Math.max(IMAGE_MIN_SIZE_WORLD, naturalWidth * scale),
    height: Math.max(IMAGE_MIN_SIZE_WORLD, naturalHeight * scale),
  };
}

// Left-to-right row starting at `point`: gap between neighbours, tops
// aligned at point.y.
export function layoutRow(sizes: readonly PlacementSize[], point: Point): Point[] {
  const out: Point[] = [];
  let x = point.x;
  for (const size of sizes) {
    out.push({ x, y: point.y });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return out;
}

export interface ImagePlacement extends PlacementSize {
  x: number;
  y: number;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
}

// Creates one placeholder per placement inside a single LOCAL_ORIGIN
// transaction (the undo step). Returns the new ids in input order.
export function createImagePlaceholders(
  doc: Y.Doc,
  placements: readonly ImagePlacement[],
  uploaderId: string,
  now = Date.now(),
): string[] {
  if (placements.length === 0) return [];
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  const ids = placements.map(() => crypto.randomUUID());
  doc.transact(() => {
    placements.forEach((placement, i) => {
      const obj = new Y.Map<unknown>();
      obj.set('type', 'image');
      obj.set('x', placement.x);
      obj.set('y', placement.y);
      obj.set('width', placement.width);
      obj.set('height', placement.height);
      obj.set('assetKey', null);
      obj.set('contentType', placement.contentType);
      obj.set('naturalWidth', placement.naturalWidth);
      obj.set('naturalHeight', placement.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      obj.set('z', ++max);
      obj.set('createdAt', now);
      obj.set('createdBy', uploaderId);
      objects.set(ids[i], obj);
    });
  }, LOCAL_ORIGIN);
  return ids;
}

function imageMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!obj || obj.get('type') !== 'image') return undefined;
  return obj;
}

export function markImageReady(doc: Y.Doc, id: string, assetKey: string, contentType: string): boolean {
  const obj = imageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('contentType', contentType);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = imageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

// Uploader pressed Retry and the file is still in memory: back to
// uploading with a fresh clock start so the stale timer restarts.
export function markImageRetrying(doc: Y.Doc, id: string, now = Date.now()): boolean {
  const obj = imageMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('assetKey', null);
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

// What the UI shows: the stored status, except a still-uploading object
// whose upload started more than IMAGE_UPLOAD_STALE_MS ago reads as
// `unfinished` for everyone (the uploader's tab is gone or froze).
export type ImageDisplayStatus = 'uploading' | 'ready' | 'failed' | 'unfinished';

export function displayStatus(
  snap: { status: 'uploading' | 'ready' | 'failed'; uploadStartedAt: number },
  now = Date.now(),
  staleMs = IMAGE_UPLOAD_STALE_MS,
): ImageDisplayStatus {
  if (snap.status === 'uploading' && now - snap.uploadStartedAt > staleMs) return 'unfinished';
  return snap.status;
}
