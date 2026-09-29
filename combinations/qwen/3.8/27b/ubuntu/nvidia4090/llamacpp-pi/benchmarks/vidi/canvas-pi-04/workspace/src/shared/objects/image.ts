// Story 12: the image object model (anchor: image.model).
//
// An image board object is created as a PLACEHOLDER (`status: 'uploading'`) at
// its final placement size, so every participant immediately sees a box of the
// right size and position; the uploader then uploads the bytes and flips the
// object to `ready` (assetKey set) or `failed`. `unfinished` is not stored —
// it is derived at render time when an upload is older than
// IMAGE_UPLOAD_STALE_MS (image.unfinished).
//
// Undo: creating the placeholders is ONE LOCAL_ORIGIN transaction (one undo
// step, image undo). The ready/failed/retiring status updates use
// UPLOAD_ORIGIN, which is NOT in the UndoManager's tracked origins, so
// completing an upload is never its own undo step (TC-05 negative).
//
// All mutations follow the story 7/9/10 conventions: invalid input is rejected
// with false and NO transaction; a successful mutation is exactly one
// transaction on the appropriate origin; missing ids are rejected.

import * as Y from 'yjs';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../config';
import type { Point, Rect } from '../geometry';
import { LOCAL_ORIGIN, objectMap, type ObjectSnapshot } from '../board-model';

/**
 * Origin for image status transitions (ready / failed / retrying). Distinct
 * from LOCAL_ORIGIN and deliberately NOT tracked by the Y.UndoManager, so an
 * upload completing never becomes a separate undo step (image undo).
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.image-upload-origin');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
/** Stored status plus the derived `unfinished` (image.unfinished). */
export type DisplayStatus = ImageStatus | 'unfinished';

/** A width/height pair (natural pixels, or a placement size). */
export interface Size {
  width: number;
  height: number;
}

/** Immutable view of one image, as rendered by React. */
export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
  /** `<boardId>/<assetId>`; null while the upload is still in flight. */
  assetKey: string | null;
  /** Sniffed content type (image/png, image/jpeg, image/gif, image/webp). */
  contentType: string;
  /** Natural pixel dimensions at insertion (for placement; not stored scaled). */
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  /** Epoch ms the upload started (or was retried). */
  uploadStartedAt: number;
  /** The identity that is (or was) uploading this image. */
  uploaderId: string;
}

/** One placeholder to create (image.model). */
export interface ImagePlaceholderItem {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width > 0 &&
    r.height > 0
  );
}

function isImageObj(obj: unknown): obj is Y.Map<unknown> {
  return obj instanceof Y.Map && obj.get('type') === 'image';
}

function asNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nextZ(map: Y.Map<Y.Map<unknown>>): number {
  let z = 1;
  for (const o of map.values()) {
    const existing = asNum(o.get('z'), 0);
    if (existing >= z) z = existing + 1;
  }
  return z;
}

/**
 * A placement size: the natural pixel dimensions scaled down proportionally so
 * the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD, never upscaled
 * (image.placement_size).
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * Lay a row of images left to right with IMAGE_LAYOUT_GAP_WORLD gaps (image.drop
 * / image.pick / image.paste). `top-left` anchors the first image's top-left at
 * `start` (a drop); `centre` centres the whole row (its bounding box) on
 * `start` (picker and paste). Tops are always aligned.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const gap = IMAGE_LAYOUT_GAP_WORLD;
  const offsets: number[] = [];
  let cursor = 0;
  for (let i = 0; i < sizes.length; i++) {
    offsets.push(cursor);
    cursor += sizes[i]!.width + gap;
  }
  const totalWidth = cursor - gap;
  const maxHeight = sizes.reduce((m, s) => Math.max(m, s.height), 0);
  const originX = anchor === 'centre' ? start.x - totalWidth / 2 : start.x;
  const originY = anchor === 'centre' ? start.y - maxHeight / 2 : start.y;
  return sizes.map((s, i) => ({
    x: originX + offsets[i]!,
    y: originY,
    width: s.width,
    height: s.height,
  }));
}

/**
 * Create one placeholder object per item in a SINGLE LOCAL_ORIGIN transaction
 * (one undo step for the whole add action). Items with non-finite sizes are
 * skipped. Returns the created ids (in order), empty when nothing was added.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlaceholderItem[],
  uploaderId: string,
  now: number,
): string[] {
  const valid = items.filter(
    (it) =>
      isFiniteRect(it.rect) &&
      Number.isFinite(it.naturalWidth) &&
      Number.isFinite(it.naturalHeight) &&
      it.naturalWidth > 0 &&
      it.naturalHeight > 0,
  );
  if (valid.length === 0) return [];

  const map = objectMap(doc);
  const ids: string[] = [];
  doc.transact(() => {
    let z = nextZ(map);
    for (const it of valid) {
      const id = crypto.randomUUID();
      const obj = new Y.Map<unknown>();
      obj.set('type', 'image');
      obj.set('x', it.rect.x);
      obj.set('y', it.rect.y);
      obj.set('width', it.rect.width);
      obj.set('height', it.rect.height);
      obj.set('assetKey', null);
      obj.set('contentType', it.contentType);
      obj.set('naturalWidth', it.naturalWidth);
      obj.set('naturalHeight', it.naturalHeight);
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
      obj.set('uploaderId', uploaderId);
      obj.set('z', z);
      obj.set('createdAt', now);
      obj.set('createdBy', uploaderId);
      map.set(id, obj);
      z += 1;
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/** Mark a placeholder's upload as complete (assetKey set, for everyone). */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const obj = objectMap(doc).get(id);
  if (!isImageObj(obj)) return false;
  doc.transact(() => {
    obj.set('assetKey', assetKey);
    obj.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/** Mark a placeholder's upload as failed (image.upload_failure). */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const obj = objectMap(doc).get(id);
  if (!isImageObj(obj)) return false;
  doc.transact(() => {
    obj.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/** Restart a failed upload: back to uploading with a fresh start time. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const obj = objectMap(doc).get(id);
  if (!isImageObj(obj)) return false;
  doc.transact(() => {
    obj.set('status', 'uploading');
    obj.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The status to render: stored status, except an upload older than
 * IMAGE_UPLOAD_STALE_MS is shown as `unfinished` (image.unfinished).
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'uploading' && now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return img.status;
}
