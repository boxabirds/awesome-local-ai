import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS
} from '../config';
import type { Point, Rect } from '../geometry';

// Upload-completion writes use this origin so the UndoManager (which tracks
// only LOCAL_ORIGIN, story 8) never turns "the upload finished" into an extra
// undo step; undoing an add removes the whole placeholder set in one step.
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload');

export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export interface ImageSnap extends ObjectSnapshot {
  readonly type: 'image';
  readonly assetKey: string | null;
  readonly contentType: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly status: ImageStatus;
  readonly uploadStartedAt: number;
  readonly uploaderId: string;
}

// image.placement_size: natural pixels are board units; scale down (never
// up) so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
export function placementSize(
  naturalWidth: number,
  naturalHeight: number
): ImageSize {
  const longest = Math.max(naturalWidth, naturalHeight);
  if (!Number.isFinite(longest) || longest <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

// Left-to-right row separated by IMAGE_LAYOUT_GAP_WORLD. 'top-left' anchors
// the first image's top-left corner at the start point (drops); 'centre'
// centres the whole row on the point (paste, picker).
export function layoutRow(
  sizes: readonly ImageSize[],
  start: Point,
  anchor: 'top-left' | 'centre'
): Rect[] {
  if (sizes.length === 0) return [];
  const totalWidth =
    sizes.reduce((sum, s) => sum + s.width, 0) +
    IMAGE_LAYOUT_GAP_WORLD * (sizes.length - 1);
  const tallest = Math.max(...sizes.map((s) => s.height));
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

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function imageMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'image') return undefined;
  return obj;
}

function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const obj of objectsMap(doc).values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

function validItem(item: {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
}): boolean {
  return (
    Number.isFinite(item.rect.x) &&
    Number.isFinite(item.rect.y) &&
    Number.isFinite(item.rect.width) &&
    Number.isFinite(item.rect.height) &&
    Number.isFinite(item.naturalWidth) &&
    Number.isFinite(item.naturalHeight)
  );
}

// The whole add action is one LOCAL_ORIGIN transaction: one undo step.
// Items with non-finite sizes or rects are skipped.
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly {
    rect: Rect;
    naturalWidth: number;
    naturalHeight: number;
    contentType: string;
  }[],
  uploaderId: string,
  now: number
): string[] {
  const usable = items.filter(validItem);
  if (usable.length === 0) return [];
  const ids: string[] = [];
  doc.transact(() => {
    let z = maxZ(doc);
    for (const item of usable) {
      const id = crypto.randomUUID();
      const obj = new Y.Map<unknown>();
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
      objectsMap(doc).set(id, obj);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

// Returns false for stale ids (deleted or wrong type) and for no-op writes,
// so no empty update is emitted. Status writes never run inside a
// LOCAL_ORIGIN transaction: they use UPLOAD_ORIGIN, untracked by the
// UndoManager.
function setImageStatus(
  doc: Y.Doc,
  id: string,
  changed: (obj: Y.Map<unknown>) => boolean,
  apply: (obj: Y.Map<unknown>) => void
): boolean {
  const obj = imageMap(doc, id);
  if (obj === undefined) return false;
  if (!changed(obj)) return false;
  doc.transact(() => {
    apply(obj);
  }, UPLOAD_ORIGIN);
  return true;
}

export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  return setImageStatus(
    doc,
    id,
    (obj) => obj.get('status') !== 'ready' || obj.get('assetKey') !== assetKey,
    (obj) => {
      obj.set('status', 'ready');
      obj.set('assetKey', assetKey);
    }
  );
}

export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return setImageStatus(
    doc,
    id,
    (obj) => obj.get('status') !== 'failed',
    (obj) => {
      obj.set('status', 'failed');
    }
  );
}

export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return setImageStatus(
    doc,
    id,
    (obj) => obj.get('status') !== 'uploading' || obj.get('uploadStartedAt') !== now,
    (obj) => {
      obj.set('status', 'uploading');
      obj.set('uploadStartedAt', now);
    }
  );
}

export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (
    img.status === 'uploading' &&
    now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS
  ) {
    return 'unfinished';
  }
  return img.status;
}

export function getImageFields(
  doc: Y.Doc,
  id: string
): Omit<ImageSnap, keyof ObjectSnapshot> | undefined {
  const obj = imageMap(doc, id);
  if (obj === undefined) return undefined;
  const assetKey = obj.get('assetKey');
  const status = obj.get('status');
  if (
    status !== 'uploading' &&
    status !== 'ready' &&
    status !== 'failed'
  ) {
    return undefined;
  }
  return {
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof obj.get('contentType') === 'string' ? (obj.get('contentType') as string) : '',
    naturalWidth: typeof obj.get('naturalWidth') === 'number' ? (obj.get('naturalWidth') as number) : 0,
    naturalHeight: typeof obj.get('naturalHeight') === 'number' ? (obj.get('naturalHeight') as number) : 0,
    status,
    uploadStartedAt:
      typeof obj.get('uploadStartedAt') === 'number' ? (obj.get('uploadStartedAt') as number) : 0,
    uploaderId: typeof obj.get('uploaderId') === 'string' ? (obj.get('uploaderId') as string) : ''
  };
}

// Snapshot view of every image object, used by rendering and test hooks.
export function collectImageSnapshots(doc: Y.Doc): readonly ImageSnap[] {
  const out: ImageSnap[] = [];
  for (const [id, obj] of objectsMap(doc)) {
    if (obj.get('type') !== 'image') continue;
    const fields = getImageFields(doc, id);
    if (fields === undefined) continue;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    const width = obj.get('width');
    const height = obj.get('height');
    out.push({
      id,
      type: 'image',
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
      z: typeof z === 'number' ? z : 0,
      width: typeof width === 'number' ? width : 0,
      height: typeof height === 'number' ? height : 0,
      ...fields
    });
  }
  return out;
}
