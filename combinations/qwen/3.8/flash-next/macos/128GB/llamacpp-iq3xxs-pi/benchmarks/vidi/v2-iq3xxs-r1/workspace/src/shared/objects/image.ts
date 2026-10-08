import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  type ObjectSnapshot,
} from '../board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Point, Rect } from '../geometry';

/**
 * An image on the board (story 12).
 *
 * The bytes are not in the document — they are in storage, at `assetKey` — so an
 * image object is a small claim about a file: where it sits, how big it was placed,
 * and how the upload that was asked to store it went. `status` is that claim, and it
 * is the only field that changes after the object is created.
 *
 * Stored schema (`objects/<id>`):
 *   type: 'image', x, y, width, height, z, createdAt,
 *   assetKey: string | null   // `<boardId>/<assetId>`; null until the upload lands
 *   contentType: string       // what the bytes were sniffed as
 *   naturalWidth, naturalHeight  // pixels the file itself reported
 *   status: 'uploading' | 'ready' | 'failed'
 *   uploadStartedAt: number   // when this attempt began (PRD image.unfinished)
 *   uploaderId: string         // the tab that asked for the upload
 *
 * A placeholder is created at its final size and position, so a board does not jump
 * about when an upload finishes (PRD image.uploading), and the resize rules are
 * story 7's generic ones, with the proportions locked (PRD image.aspect_resize).
 *
 * `abandonImagePlaceholders` is the one function here that no person asks for: it takes
 * back placeholders whose upload storage refused to take the file at all (a 413, a 415),
 * which means they were never added and must not stay on the board.
 */
export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
  /** The box on the board, always present: it is where the picture will sit. */
  width: number;
  height: number;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

/** What an image says about itself: the only truth is that an upload is in progress. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';
/** `status`, plus the state a stuck `uploading` is read as at render time. */
export type DisplayStatus = ImageStatus | 'unfinished';

/**
 * Transaction origin for upload bookkeeping. It is deliberately *not* in the
 * `Y.UndoManager`'s tracked origins (story 8): an add is one undo step, and an
 * upload finishing ten seconds later is not a second one (PRD undo.steps).
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6.upload');

/** A width and a height, before either has a place to sit. */
export interface Size {
  width: number;
  height: number;
}

/** Is this snapshot an image? Story 7's generic paths ask without importing the type. */
export function isImageSnap(obj: ObjectSnapshot): obj is ImageSnap {
  return obj.type === 'image';
}

type AnyMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<AnyMap> {
  return doc.getMap<AnyMap>(OBJECTS_MAP);
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readStatus(value: unknown): ImageStatus {
  return value === 'ready' || value === 'failed' ? value : 'uploading';
}

function readImage(id: string, m: AnyMap): ImageSnap {
  const assetKey = m.get('assetKey');
  const contentType = m.get('contentType');
  const uploaderId = m.get('uploaderId');
  return {
    id,
    type: 'image',
    x: asFiniteNumber(m.get('x')),
    y: asFiniteNumber(m.get('y')),
    width: Math.max(asFiniteNumber(m.get('width')), 0),
    height: Math.max(asFiniteNumber(m.get('height')), 0),
    z: asFiniteNumber(m.get('z')),
    assetKey: typeof assetKey === 'string' ? assetKey : null,
    contentType: typeof contentType === 'string' ? contentType : '',
    naturalWidth: asFiniteNumber(m.get('naturalWidth')),
    naturalHeight: asFiniteNumber(m.get('naturalHeight')),
    status: readStatus(m.get('status')),
    uploadStartedAt: asFiniteNumber(m.get('uploadStartedAt')),
    uploaderId: typeof uploaderId === 'string' ? uploaderId : '',
  };
}

/**
 * Every image on the board in paint order (ascending `(z, id)`), so two images
 * added at the same moment land in the same order on every screen.
 */
export function imageSnapshots(doc: Y.Doc): readonly ImageSnap[] {
  const out: ImageSnap[] = [];
  for (const [id, m] of objectsOf(doc)) {
    if (!(m instanceof Y.Map)) continue;
    if (m.get('type') !== 'image') continue;
    out.push(readImage(id, m));
  }
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Highest `z` of *any* object, so a new image lands above notes, text, shapes and strokes. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsOf(doc).values()) {
    if (m instanceof Y.Map) max = Math.max(max, asFiniteNumber(m.get('z')));
  }
  return max;
}

/** A size a picture could really have: two finite, positive numbers. */
function isUsableSize(size: Size | undefined | null): size is Size {
  return (
    !!size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

/**
 * The box an image is placed at (PRD image.placement_size).
 *
 * Pixels are board units, so an image is placed at its natural size — unless its
 * longest side is over `IMAGE_MAX_PLACE_SIZE_WORLD`, in which case both sides come
 * down by the same factor and the longest side lands exactly on the limit. Nothing is
 * ever enlarged: a 40×30 icon stays a 40×30 icon.
 *
 * A natural size that is not two positive finite numbers has no box, and `{0, 0}`
 * says so to the caller, which then adds nothing.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  if (!isUsableSize({ width: naturalWidth, height: naturalHeight })) return { width: 0, height: 0 };
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) return { width: naturalWidth, height: naturalHeight };
  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * A row of boxes, left to right, `IMAGE_LAYOUT_GAP_WORLD` apart (PRD image.drop).
 *
 * `top-left` puts the first box's top-left corner on `start` — that is a drop, where
 * the pointer asked for the corner — and every box hangs from the same top edge.
 * `centre` puts the *row* on `start`, which is what a paste or a pick does with the
 * middle of the view. A box with no usable size stops the row there rather than
 * leaving a hole in it.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre',
): Rect[] {
  const usable = (sizes ?? []).filter((size) => isUsableSize(size));
  if (!Number.isFinite(start.x) || !Number.isFinite(start.y) || usable.length === 0) return [];

  const widths = usable.map((size) => size.width);
  const rowWidth =
    widths.reduce((total, width) => total + width, 0) + IMAGE_LAYOUT_GAP_WORLD * (usable.length - 1);
  const rowHeight = Math.max(...usable.map((size) => size.height));
  const x = anchor === 'centre' ? start.x - rowWidth / 2 : start.x;
  const y = anchor === 'centre' ? start.y - rowHeight / 2 : start.y;

  const out: Rect[] = [];
  let at = x;
  for (const size of usable) {
    out.push({ x: at, y, width: size.width, height: size.height });
    at += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return out;
}

/** One file that is ready to be placed on the board. */
export interface PlacementItem {
  /** Where and how big: already the image's final box. */
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

function isUsableItem(item: PlacementItem | undefined | null): item is PlacementItem {
  return (
    !!item &&
    Number.isFinite(item.rect?.x) &&
    Number.isFinite(item.rect?.y) &&
    item.rect.width > 0 &&
    item.rect.height > 0 &&
    Number.isFinite(item.naturalWidth) &&
    Number.isFinite(item.naturalHeight) &&
    item.naturalWidth > 0 &&
    item.naturalHeight > 0 &&
    typeof item.contentType === 'string'
  );
}

/**
 * Add every image of one action to the board as a placeholder (PRD image.uploading).
 *
 * All of them go in inside a single `LOCAL_ORIGIN` transaction: one person's drop of
 * three files is one thing they did, and one thing undo takes back (PRD undo.steps).
 * Each placeholder already carries its final box, its uploader and the clock time the
 * attempt began, which is what lets anyone, on any screen, tell "still uploading"
 * from "never finished" later (see `displayStatus`).
 *
 * Items without a real box are skipped, and an action with nothing left in it writes
 * nothing at all. Returns the ids that were created, in the order they were given.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly PlacementItem[],
  uploaderId: string,
  now: number,
): string[] {
  const usable = (items ?? []).filter(isUsableItem);
  if (usable.length === 0) return [];

  const ids: string[] = [];
  const createdAt = now;
  const z0 = maxZ(doc);
  doc.transact(() => {
    const objects = objectsOf(doc);
    usable.forEach((item, i) => {
      const id = crypto.randomUUID();
      const m = new Y.Map<unknown>();
      m.set('type', 'image');
      m.set('x', item.rect.x);
      m.set('y', item.rect.y);
      m.set('width', item.rect.width);
      m.set('height', item.rect.height);
      m.set('z', z0 + i + 1);
      m.set('createdAt', createdAt);
      m.set('assetKey', null);
      m.set('contentType', item.contentType);
      m.set('naturalWidth', item.naturalWidth);
      m.set('naturalHeight', item.naturalHeight);
      m.set('status', 'uploading');
      m.set('uploadStartedAt', createdAt);
      m.set('uploaderId', typeof uploaderId === 'string' ? uploaderId : '');
      objects.set(id, m);
      ids.push(id);
    });
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * The one place any status change is written: an image that is still on the board is
 * changed, in one untracked transaction; an image that has been deleted or undone is
 * simply not there, and nothing is written or sent for it.
 */
function setImageStatus(doc: Y.Doc, id: string, body: (m: AnyMap) => void): boolean {
  const m = objectsOf(doc).get(id);
  if (!(m instanceof Y.Map) || m.get('type') !== 'image') return false;
  doc.transact(() => {
    // Re-read inside the transaction: the object may have gone while we looked at it.
    const present = objectsOf(doc).get(id);
    if (!(present instanceof Y.Map) || present.get('type') !== 'image') return;
    body(present);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The bytes are in storage at `assetKey`: everyone's placeholder becomes the image
 * (PRD image.shared). `false` when the id is gone — the upload succeeded, but the
 * board no longer has anywhere to put that fact.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  if (typeof assetKey !== 'string' || assetKey === '') return false;
  return setImageStatus(doc, id, (m) => {
    m.set('status', 'ready');
    m.set('assetKey', assetKey);
  });
}

/**
 * The upload failed (PRD image.upload_failure). The placeholder stays, at its size
 * and in its place, so the person can retry or remove it instead of guessing where
 * their image went. `false` when the id is gone.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return setImageStatus(doc, id, (m) => {
    m.set('status', 'failed');
  });
}

/**
 * Try again with the same file (PRD image.upload_failure): back to `uploading`, with
 * the clock restarted so the five-minute wait for "didn't finish" is measured from
 * this attempt. `false` when the id is gone.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const at = Number.isFinite(now) ? now : Date.now();
  return setImageStatus(doc, id, (m) => {
    m.set('status', 'uploading');
    m.set('uploadStartedAt', at);
  });
}

/**
 * Take back placeholders that were created a moment ago in this very tab and should
 * never have been: storage answered 413 or 415, so the file is not addable at all, and
 * PRD `image.types`/`image.size_limit` say such a file is not added.
 *
 * The delete goes out under the upload origin rather than the local one, for two
 * reasons. Nobody pressed Remove, so it is not an action of theirs that the history
 * should keep a step for — and a person's Remove (story 7's `deleteObjects`, under the
 * local origin) stays the only way an image leaves the board as an undo step of its own.
 *
 * @returns how many were really there, and are now not
 */
export function abandonImagePlaceholders(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsOf(doc);
  const present = (ids ?? []).filter((id) => {
    const m = objects.get(id);
    // The same test `setImageStatus` uses: an image on the board, and nothing else that
    // might be sitting under the id.
    return m instanceof Y.Map && m.get('type') === 'image';
  });
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, UPLOAD_ORIGIN);
  return present.length;
}

/**
 * What an image should be *shown* as, which is not always what it says it is.
 *
 * A placeholder that has been `uploading` for longer than `IMAGE_UPLOAD_STALE_MS`
 * has no upload behind it any more — the tab that started it was closed or reloaded,
 * and nothing will ever mark it (PRD image.unfinished). It is called unfinished, and
 * everyone is offered Remove. A snapshot with a `status` this file has never heard of
 * is treated as `uploading`, which is the state the writer intended.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  const status = img.status === 'ready' || img.status === 'failed' ? img.status : 'uploading';
  if (status !== 'uploading') return status;
  const elapsed = Number.isFinite(now) ? now - img.uploadStartedAt : NaN;
  return elapsed > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
}
