/** Image object model for story 12 — schema, placement, layout, status helpers */

import * as Y from 'yjs';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '@shared/config';
import { LOCAL_ORIGIN } from '../board-model';

/** Unique symbol for upload completion / failure updates — not tracked by UndoManager. */
export const UPLOAD_ORIGIN: unique symbol = Symbol('upload-origin');

// ─── Types ────────────────────────────────────────────────────────────────

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

export interface ImageSnapshot {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
  z: number;
  createdAt: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect { x: number; y: number; width: number; height: number; }

// ─── Placement size ───────────────────────────────────────────────────────

/**
 * Compute placement dimensions so that the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
 * Never enlarges smaller images; always keeps proportions.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
    return { width: 0, height: 0 };
  }

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

// ─── Row layout ───────────────────────────────────────────────────────────

/**
 * Place rectangles left-to-right in a row with gaps, anchored at a start point.
 * For `'top-left'`, each rectangle's top-left corner starts at the computed position.
 * For `'centre'`, the whole row is centred on the start point.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  if (sizes.length === 0) return [];

  // Build rects with tops aligned at start.y
  const rects: Rect[] = [];
  let cx = start.x;
  for (const s of sizes) {
    rects.push({ x: cx, y: start.y, width: s.width, height: s.height });
    cx += s.width + IMAGE_LAYOUT_GAP_WORLD;
  }

  // If centre-anchored, shift everything so the row is centred on start.x
  if (anchor === 'centre') {
    const firstRect = rects[0];
    const lastRect = rects[rects.length - 1];
    const rowCenterX = firstRect.x + (firstRect.width + lastRect.width) / 2 + ((rects.length - 1) * IMAGE_LAYOUT_GAP_WORLD) / 2;
    // Actually: row spans from rects[0].x to rects[last].x + rects[last].width
    const rowStartX = rects[0].x;
    const rowEndX = rects[rects.length - 1].x + rects[rects.length - 1].width;
    const rowMidX = (rowStartX + rowEndX) / 2;
    const offset = start.x - rowMidX;
    for (const r of rects) {
      r.x += offset;
    }
  }

  return rects;
}

// ─── Object CRUD helpers ──────────────────────────────────────────────────

function getObjects(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('objects');
}

function getDataMap(objs: Y.Map<unknown>, id: string): Y.Map<unknown> | null {
  const val = objs.get(id);
  return val instanceof Y.Map ? val : null;
}

function getMaxZ(objects: Y.Map<unknown>): number {
  let max = 0;
  for (const val of objects.values()) {
    if (!(val instanceof Y.Map)) continue;
    const z = Number((val as any).get('z') ?? 0);
    if (z > max) max = z;
  }
  return max;
}

/**
 * Create image placeholder objects for multiple files.
 * All placeholders are created in one LOCAL_ORIGIN transaction (one undo step).
 * Returns array of created ids (skips non-finite sizes).
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[],
  uploaderId: string,
  now: number,
): string[] {
  const objects = getObjects(doc);
  const ids: string[] = [];
  let baseZ = getMaxZ(objects);

  const filtered = items.filter(
    (item) =>
      Number.isFinite(item.rect.x) &&
      Number.isFinite(item.rect.y) &&
      Number.isFinite(item.rect.width) &&
      Number.isFinite(item.rect.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0,
  );

  if (filtered.length === 0) return ids;

  doc.transact(() => {
    for (const item of filtered) {
      const id = crypto.randomUUID();
      const dataMap = new Y.Map();
      dataMap.set('type', 'image');
      dataMap.set('x', item.rect.x);
      dataMap.set('y', item.rect.y);
      dataMap.set('width', item.rect.width);
      dataMap.set('height', item.rect.height);
      dataMap.set('assetKey', null);
      dataMap.set('contentType', item.contentType);
      dataMap.set('naturalWidth', item.naturalWidth);
      dataMap.set('naturalHeight', item.naturalHeight);
      dataMap.set('status', 'uploading' as const);
      dataMap.set('uploadStartedAt', now);
      dataMap.set('uploaderId', uploaderId);
      dataMap.set('z', baseZ + 1);
      dataMap.set('createdAt', now);

      objects.set(id, dataMap);
      ids.push(id);
      baseZ++;
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/**
 * Mark an image as ready (upload succeeded). Uses UPLOAD_ORIGIN so it's not an undo step.
 * Returns false if the id doesn't exist.
 */
export function markImageReady(
  doc: Y.Doc,
  id: string,
  assetKey: string,
): boolean {
  const objects = getObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return false;

  doc.transact(() => {
    dm.set('assetKey', assetKey);
    dm.set('status', 'ready' as const);
  }, UPLOAD_ORIGIN);

  return true;
}

/**
 * Mark an image as failed (upload error). Uses UPLOAD_ORIGIN.
 * Returns false if the id doesn't exist.
 */
export function markImageFailed(
  doc: Y.Doc,
  id: string,
): boolean {
  const objects = getObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return false;

  doc.transact(() => {
    dm.set('status', 'failed' as const);
  }, UPLOAD_ORIGIN);

  return true;
}

/**
 * Prepare an image for retry: reset status to uploading with a fresh timestamp.
 * Uses UPLOAD_ORIGIN. Returns false if stale.
 */
export function markImageRetrying(
  doc: Y.Doc,
  id: string,
  now: number,
): boolean {
  const objects = getObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return false;

  doc.transact(() => {
    dm.set('status', 'uploading' as const);
    dm.set('uploadStartedAt', now);
  }, UPLOAD_ORIGIN);

  return true;
}

/**
 * Derive the display status used for rendering.
 * 'uploading' becomes 'unfinished' after IMAGE_UPLOAD_STALE_MS without completing.
 */
export function displayStatus(img: ImageSnapshot, now: number): DisplayStatus {
  if (img.status === 'ready') return 'ready';
  if (img.status === 'failed') return 'failed';
  // uploading
  if (now - img.uploadStartedAt >= IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return 'uploading';
}
