// Image object model (see spec: image.model).
//
// An image is a board object of type 'image':
//   objects/<id>: Y.Map {
//     type: 'image', x, y, width, height, z, createdAt,
//     assetKey: string | null,     // null while uploading; "<boardId>/<assetId>" when ready
//     contentType: string,         // sniffed/stored MIME type
//     naturalWidth: number,        // natural pixel dimensions (info for story 17)
//     naturalHeight: number,
//     status: 'uploading' | 'ready' | 'failed',
//     uploadStartedAt: number,     // epoch ms; the "unfinished" state derives from it
//     uploaderId: string
//   }
//
// Undo (design decision): placeholder creation is ONE LOCAL_ORIGIN
// transaction for the whole add action (one undo step per action, per the
// PRD undo constraint). Status updates use UPLOAD_ORIGIN, which the
// UndoManager does not track, so upload completion/failure is never its own
// undo step.
//
// 'unfinished' is not stored — it is derived at render time
// (displayStatus) when an uploading object is older than IMAGE_UPLOAD_STALE_MS.

import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Point, Rect } from '../geometry';

/** A width/height pair (placement sizes). */
export interface Size {
  width: number;
  height: number;
}
import {
  LOCAL_ORIGIN,
  registerObjectTypeName,
  type ObjectSnapshot,
} from '../board-model';

/** Transaction origin for upload status updates (NOT tracked by the UndoManager). */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.image.upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
/** Stored status plus the render-time 'unfinished' derivation. */
export type DisplayStatus = ImageStatus | 'unfinished';

/** An image object (ObjectSnapshot with the image fields present). */
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

// The model owns its type name so documents with images can be snapshotted
// even before the client registry loads (unit tests, worker).
registerObjectTypeName('image');

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** Highest z among all objects (0 when the board is empty). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const object of objects(doc).values()) {
    const z = object.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

function finiteRect(r: Rect): boolean {
  return [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
}

/**
 * Placement size (image.placement_size): natural pixel dimensions as board
 * units, scaled down proportionally so the longest side is at most
 * IMAGE_MAX_PLACE_SIZE_WORLD. Never upscales.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

/**
 * A row of rects, left to right, separated by IMAGE_LAYOUT_GAP_WORLD
 * (image.drop). `top-left` anchors the first rect's top-left at `start`
 * (drops); `centre` centres the whole row on `start` (picker, paste).
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const totalWidth = sizes.reduce(
    (acc, s) => acc + s.width + IMAGE_LAYOUT_GAP_WORLD,
    -IMAGE_LAYOUT_GAP_WORLD,
  );
  let x = anchor === 'top-left' ? start.x : start.x - totalWidth / 2;
  return sizes.map((s) => {
    const rect: Rect = { x, y: start.y, width: s.width, height: s.height };
    x += s.width + IMAGE_LAYOUT_GAP_WORLD;
    return rect;
  });
}

export interface ImagePlaceholderItem {
  /** Placement rect in world units (from placementSize + layoutRow). */
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Create one placeholder object per item in ONE LOCAL_ORIGIN transaction
 * (one undo step for the whole add action, PRD undo constraint). Items with
 * non-finite or non-positive dimensions are skipped; z increases per item.
 * Returns the new ids (skipped items produce no id).
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (it) =>
      finiteRect(it.rect) &&
      Number.isFinite(it.naturalWidth) &&
      Number.isFinite(it.naturalHeight) &&
      it.naturalWidth > 0 &&
      it.naturalHeight > 0,
  );
  if (valid.length === 0) return [];
  const ids: string[] = [];
  const z0 = maxZ(doc);
  doc.transact(() => {
    valid.forEach((it, i) => {
      const id = crypto.randomUUID();
      ids.push(id);
      const object = new Y.Map();
      object.set('type', 'image');
      object.set('x', it.rect.x);
      object.set('y', it.rect.y);
      object.set('width', it.rect.width);
      object.set('height', it.rect.height);
      object.set('assetKey', null);
      object.set('contentType', it.contentType);
      object.set('naturalWidth', it.naturalWidth);
      object.set('naturalHeight', it.naturalHeight);
      object.set('status', 'uploading');
      object.set('uploadStartedAt', now);
      object.set('uploaderId', uploaderId);
      object.set('z', z0 + i + 1);
      object.set('createdAt', now);
      objects(doc).set(id, object);
    });
  }, LOCAL_ORIGIN);
  return ids;
}

function imageObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const object = objects(doc).get(id);
  if (object === undefined || object.get('type') !== 'image') return undefined;
  return object;
}

/**
 * Upload succeeded: set the assetKey for everyone and flip to 'ready'
 * (image.shared). One UPLOAD_ORIGIN transaction (not an undo step).
 * Stale id → false, no update.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const object = imageObject(doc, id);
  if (object === undefined) return false;
  doc.transact(() => {
    object.set('assetKey', assetKey);
    object.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/** Upload failed (image.upload_failure). Stale id → false, no update. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const object = imageObject(doc, id);
  if (object === undefined) return false;
  doc.transact(() => {
    object.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The uploader clicked Retry: back to 'uploading' with a fresh clock
 * (image.upload_failure). Stale id → false, no update.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const object = imageObject(doc, id);
  if (object === undefined) return false;
  doc.transact(() => {
    object.set('status', 'uploading');
    object.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Render-time status (image.unfinished): an upload older than
 * IMAGE_UPLOAD_STALE_MS displays as 'unfinished' for everyone; the stored
 * status stays 'uploading'.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
