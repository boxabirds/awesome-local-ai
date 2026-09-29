// The image object model (story 12): the Yjs schema for one picture on the board, and the
// handful of operations on it that the generic object operations cannot do.
//
// Schema (one entry in the shared `objects` map; `shared/board-model.ts` owns the map and the
// generic fields, this module owns the rest of the entry):
//   objects/<id>: Y.Map {
//     type: 'image', x, y, width, height, z, createdAt, createdBy,
//     assetKey: string | null,   // '<boardId>/<assetId>' into the asset bucket; null until it
//                                // is known, which is the moment the bytes arrived
//     contentType: string,       // what the bytes turned out to be, as the server named them
//     naturalWidth, naturalHeight, // the picture's own pixel size, which is what the box's
//                                  // proportions come from
//     status: 'uploading' | 'ready' | 'failed',
//     uploadStartedAt: number,   // when this upload last began being this upload's business
//     uploaderId: string         // whose tab this upload is happening in
//   }
//
// ## Why the record and the bytes are separate
//
// A picture is far too big to live in a document that every client syncs on connect, so the
// bytes go to a bucket and the document keeps an address. That split is the whole reason this
// module has states at all: for a moment the board knows about an image it cannot show, and
// somebody has to be asked what to do about it. The answer this board gives is that the record
// is honest about the gap ('uploading'), the screen that is closing it says so in detail, and
// everybody else says the plainer thing.
//
// ## Why the address is null before the upload answers
//
// The address of a picture is minted by the server that stores it, so a placeholder cannot
// know one. Keeping the field rather than leaving it out is what makes the states readable: an
// image with no address is an image whose bytes are not there yet, and an image with one is an
// image a screen can go and fetch. A record that mixed the two — an address guessed at in
// advance — would be a board pointing at nothing, on every screen, for as long as the upload
// took.
//
// ## Why nobody is ever *told* about a failure
//
// The uploader's tab learns that an upload failed from the network request it made, and writes
// that into the record, so the message a failure sends is a board fact and not a browser
// detail — but the record never stores *why*, because nobody else can do anything with a
// reason. The two messages that come out of it differ only in what the reader can act on: the
// tab holding the file is offered a retry, and everyone else is told the picture is not there.
// That is why `displayStatus` does not take the reader: the record already says who the file
// is with, and comparing those two is one line at the place that has both.
//
// ## Why 'unfinished' is read and never written
//
// An abandoned upload leaves no trace on the wire: the tab that would have finished it is gone,
// and there is nobody left to write a state. A Worker cannot notice it either — noticing would
// mean being woken on a timer to look at every board that nobody is looking at, with an empty
// presence list and a queue outliving the file it was meant for. So the timestamp is the state:
// `displayStatus` compares it with the moment of asking, and the same record is 'uploading' for
// four minutes and 'unfinished' in the fifth, on every screen at once and with nothing to run.
//
// ## Why undo stops at the placeholder
//
// Creating images is something a user did, so it is written with `LOCAL_ORIGIN` and is one undo
// step per add. An upload *finishing* is not something a user did; it is the network catching
// up with them. Those writes carry `UPLOAD_ORIGIN`, which the undo history does not track —
// otherwise undoing the note you typed thirty seconds after dropping a photo would put the
// photo back to a grey box, and redo would be expected to go and fetch it again.

import * as Y from 'yjs';
import { LOCAL_ORIGIN, objectSnapshots, type ObjectSnapshot } from '../board-model.ts';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config.ts';
import type { Point, Rect } from '../geometry.ts';

/** A box's measurements with no position: what a row of images is laid out from. */
export interface Size {
  width: number;
  height: number;
}

/** The object type name, as it is stored and as the registry knows it. */
export const IMAGE_OBJECT_TYPE = 'image';

/**
 * The origin of the writes that follow an upload's progress.
 *
 * It is a distinct symbol rather than `LOCAL_ORIGIN` for the reason in the header: the undo
 * history tracks `LOCAL_ORIGIN` and has to walk straight past these writes. It is not the
 * provider's origin either, because these writes *are* local — they are just not local
 * *actions*.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-image-upload');

/** What the record says about its own upload. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/**
 * What a screen says about an image: the record's own states, plus 'unfinished', which is the
 * same record read five minutes later and is never written down.
 *
 * 'unavailable' — this picture is not here, and you are not the one who was going to bring it
 * — is deliberately not in here. It is that same 'failed' plus the reader's own identity, and
 * putting the reader into the type would mean every caller had to decide what to say to
 * somebody before it could ask what the board said.
 */
export type DisplayStatus = ImageStatus | 'unfinished';

/** An image as the board renders it: the generic fields plus the picture's own. */
export interface ImageSnapshot extends ObjectSnapshot {
  type: 'image';
  /** The address of the bytes, or null while they are still on their way. */
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
  width: number;
  height: number;
}

/** The short name the design's contract uses for the same thing. */
export type ImageSnap = ImageSnapshot;

/** What one image placeholder is created from: where its box goes, and what it will hold. */
export interface ImagePlacement {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

function imageMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const o = doc.getMap<Y.Map<unknown>>('objects').get(id);
  return o && o.get('type') === IMAGE_OBJECT_TYPE ? o : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positive(value: unknown): number | undefined {
  const n = finite(value);
  return n !== undefined && n > 0 ? n : undefined;
}

/**
 * The size an image is laid out at, in board units: its natural pixel size, scaled down so its
 * longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD.
 *
 * Pixels and board units are the same number on purpose — a 1440 x 900 screenshot is placed at
 * 800 x 500 board units, which is 800 x 500 screen pixels at zoom 1 — so a screenshot dropped on
 * a board is the size of the window it was taken from, and nothing has to be converted.
 *
 * Nothing is scaled *up*, and nothing else is decided here: a 40 x 4000 screenshot becomes an
 * 8 x 800 strip and stays one, because the proportions of somebody's picture are not the board's
 * to change, and a floor on the placement size would change them the moment a picture was long
 * and thin. The smallest a picture may be *resized* to is a different setting
 * (`IMAGE_MIN_SIZE_WORLD`) and belongs to the resize gesture. Returns null for a file that
 * reports no usable dimensions, which is what makes it skippable.
 */
export function placementSize(
  naturalWidth: number,
  naturalHeight: number,
): Size | null {
  const w = positive(naturalWidth);
  const h = positive(naturalHeight);
  if (w === undefined || h === undefined) return null;

  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** How much room a laid-out row takes: what centring a row in the view is measured against. */
export function rowExtent(sizes: readonly Size[]): Size {
  if (sizes.length === 0) return { width: 0, height: 0 };
  let width = -IMAGE_LAYOUT_GAP_WORLD;
  let height = 0;
  for (const size of sizes) {
    width += size.width + IMAGE_LAYOUT_GAP_WORLD;
    height = Math.max(height, size.height);
  }
  return { width, height };
}

/**
 * Where a row of images goes: left to right, IMAGE_LAYOUT_GAP_WORLD apart, the tops of them
 * level with each other.
 *
 * One row, whatever the sizes: a drop of five files is a strip the user then moves about, not a
 * puzzle the board arranges for them, and the tops lining up is what makes it read as the
 * result of one action.
 *
 * `top-left` anchors the row's own top-left corner at `start`, which is where a drop happened;
 * `centre` puts the row's middle at `start`, which is the middle of the visible area, so
 * pictures dropped from a picker or a paste land in front of the person who asked for them
 * rather than under the pointer that was nowhere near them.
 */
export function layoutRow(
  sizes: readonly Size[],
  start: Point,
  anchor: 'top-left' | 'centre' = 'top-left',
): Rect[] {
  const extent = rowExtent(sizes);
  const x = anchor === 'centre' ? start.x - extent.width / 2 : start.x;
  const y = anchor === 'centre' ? start.y - extent.height / 2 : start.y;

  const rects: Rect[] = [];
  let at = x;
  for (const size of sizes) {
    rects.push({ x: at, y, width: size.width, height: size.height });
    at += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/**
 * Turn a generic object snapshot into the typed one, or null when the object is not an image or
 * its own record is unusable.
 *
 * An image with dimensions that are not numbers is not an image of size zero: there is nothing
 * to size a box by. Dropping it here is what lets every consumer assume the fields it reads are
 * there; the object itself is still on the board and still deletable, it just has no picture.
 *
 * A `ready` image with no address is kept rather than dropped. That record claims a picture
 * exists and cannot say where, which is exactly the state a screen should answer with "Image
 * unavailable" — the honest reading of it is a broken address, not an absent object.
 */
export function asImageSnapshot(obj: ObjectSnapshot | null | undefined): ImageSnapshot | null {
  if (!obj || obj.type !== IMAGE_OBJECT_TYPE) return null;
  const record = obj as ObjectSnapshot & Partial<ImageSnapshot>;

  const naturalWidth = positive(record.naturalWidth);
  const naturalHeight = positive(record.naturalHeight);
  const uploadStartedAt = finite(record.uploadStartedAt);
  const status = record.status;
  if (naturalWidth === undefined || naturalHeight === undefined) return null;
  if (uploadStartedAt === undefined) return null;
  if (status !== 'uploading' && status !== 'ready' && status !== 'failed') return null;
  if (record.assetKey !== null && typeof record.assetKey !== 'string') return null;

  return {
    ...obj,
    type: 'image',
    status,
    assetKey: typeof record.assetKey === 'string' ? record.assetKey : null,
    contentType: typeof record.contentType === 'string' ? record.contentType : '',
    naturalWidth,
    naturalHeight,
    uploadStartedAt,
    uploaderId: typeof record.uploaderId === 'string' ? record.uploaderId : '',
    width: obj.width ?? naturalWidth,
    height: obj.height ?? naturalHeight,
  };
}

/** Is this snapshot a usable image? */
export function isImageSnapshot(obj: ObjectSnapshot | null | undefined): obj is ImageSnapshot {
  return asImageSnapshot(obj) !== null;
}

/** Every image on the board, in the order they stack. */
export function imageSnapshots(doc: Y.Doc): readonly ImageSnapshot[] {
  const out: ImageSnapshot[] = [];
  for (const o of objectSnapshots(doc)) {
    const image = asImageSnapshot(o);
    if (image) out.push(image);
  }
  return out;
}

/**
 * One image's snapshot, or null for an id that is gone, is not an image, or is an image whose
 * record cannot be rendered.
 */
export function imageSnapshot(doc: Y.Doc, id: string): ImageSnapshot | null {
  return asImageSnapshot(objectSnapshots(doc).find((o) => o.id === id));
}

/** What the record says its upload is doing, or null when there is no such image. */
export function imageStatus(doc: Y.Doc, id: string): ImageStatus | null {
  const status = imageMap(doc, id)?.get('status');
  return status === 'uploading' || status === 'ready' || status === 'failed' ? status : null;
}

/**
 * Create the placeholders for images that are about to be uploaded, and return their ids.
 *
 * One transaction whatever the number of files: one update on the wire, one set of objects
 * arriving on every other screen at the same moment, and one undo step for the whole add
 * (undo.image_insert). An add of nothing opens no transaction, so it is not an undo step either.
 *
 * Each placeholder's box is the box the picture will have when it arrives — the caller lays
 * that out with `placementSize` and `layoutRow` — which is the point of a placeholder: the
 * layout does not move when the upload finishes, and a board does not rearrange itself in front
 * of somebody while their file is still travelling.
 *
 * An item whose sizes or box are not numbers is skipped rather than created at zero: an image
 * that reports no dimensions has no proportions to keep, and a box with no size is an object
 * nobody can select, move or delete.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlacement[],
  uploaderId: string,
  now: number = Date.now(),
): string[] {
  const usable = items.filter((item) => {
    if (!item) return false;
    const { rect } = item;
    return (
      !!rect &&
      placementSize(item.naturalWidth, item.naturalHeight) !== null &&
      [rect.x, rect.y, rect.width, rect.height].every((n) => Number.isFinite(n))
    );
  });
  if (usable.length === 0) return [];

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const startedAt = Number.isFinite(now) ? now : Date.now();
  const ids: string[] = [];

  doc.transact(() => {
    let z = 0;
    for (const o of objects.values()) {
      const current = o.get('z');
      if (typeof current === 'number' && current > z) z = current;
    }
    for (const item of usable) {
      const id = crypto.randomUUID();
      const o = new Y.Map<unknown>();
      o.set('type', IMAGE_OBJECT_TYPE);
      o.set('x', item.rect.x);
      o.set('y', item.rect.y);
      o.set('width', item.rect.width);
      o.set('height', item.rect.height);
      o.set('z', ++z);
      o.set('createdAt', startedAt);
      o.set('createdBy', uploaderId);
      o.set('assetKey', null);
      o.set('contentType', item.contentType);
      o.set('naturalWidth', item.naturalWidth);
      o.set('naturalHeight', item.naturalHeight);
      o.set('status', 'uploading');
      o.set('uploadStartedAt', startedAt);
      o.set('uploaderId', uploaderId);
      objects.set(id, o);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/**
 * A write about an upload rather than a thing a user did: applied untracked, so the undo
 * history walks straight over it. Returns false when the image is not there to write about —
 * deleted, undone, or never an image — and writes nothing in that case.
 */
function writeStatus(doc: Y.Doc, id: string, write: (o: Y.Map<unknown>) => void): boolean {
  const map = imageMap(doc, id);
  if (!map) return false;
  doc.transact(() => write(map), UPLOAD_ORIGIN);
  return true;
}

/**
 * The bytes arrived, and here is where they are.
 *
 * The address comes from the server that stored them, and writing it is the moment the picture
 * becomes everybody's: from here, any screen holding the board's link can fetch it.
 * `contentType` is taken from the same answer, so what the board says a picture is comes from
 * the bytes rather than from the name the file happened to have.
 */
export function markImageReady(
  doc: Y.Doc,
  id: string,
  assetKey: string,
  contentType?: string,
): boolean {
  if (typeof assetKey !== 'string' || assetKey === '') return false;
  return writeStatus(doc, id, (o) => {
    o.set('status', 'ready');
    o.set('assetKey', assetKey);
    if (typeof contentType === 'string' && contentType !== '') o.set('contentType', contentType);
  });
}

/** The bytes did not arrive. The reason is not stored: nobody else can use it. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return writeStatus(doc, id, (o) => {
    o.set('status', 'failed');
  });
}

/**
 * Try again with the same file: back to uploading, and the clock restarted.
 *
 * The clock is the whole reason this function exists. A retry that kept the original
 * `uploadStartedAt` would read as 'unfinished' the moment it began — an upload that had only
 * just started reported as abandoned, to a user who had just been offered the retry.
 *
 * The uploader changes with the retry, because the tab that pressed the button is the tab that
 * has the file, and it is that tab's screen that should be showing the progress.
 */
export function markImageRetrying(
  doc: Y.Doc,
  id: string,
  uploaderId: string,
  now: number = Date.now(),
): boolean {
  const startedAt = Number.isFinite(now) ? now : Date.now();
  return writeStatus(doc, id, (o) => {
    o.set('status', 'uploading');
    o.set('uploadStartedAt', startedAt);
    o.set('uploaderId', uploaderId);
    // The address of an attempt that has not happened yet is not known; keeping the old one
    // would have a screen pointing its <img> at the bytes a retry just replaced.
    o.set('assetKey', null);
  });
}

/**
 * What this board says about this image at this moment.
 *
 * There is one of these functions rather than one per message because the inputs have to be
 * read together: the same record is a progress bar here, a broken-image box there and an
 * abandoned-upload notice everywhere, and the difference is not in the record.
 *
 * `now` is a parameter for the same reason the board clock is one in the tests: the answer for
 * a five-minute-old upload depends on the moment it is asked, and a test that had to wait for
 * that moment would be a test that takes five minutes.
 *
 * Who is asking is not a parameter: 'failed' and 'unfinished' are in the record and its clock,
 * and the one place that shows a Retry button is the place that already knows whether the file
 * is in its own memory — see `isUploaderView`.
 */
export function displayStatus(
  image: ImageSnapshot | null | undefined,
  now: number,
): DisplayStatus | null {
  if (!image) return null;
  switch (image.status) {
    case 'ready':
      return 'ready';
    case 'failed':
      return 'failed';
    case 'uploading': {
      const age = Number.isFinite(now) ? now - image.uploadStartedAt : 0;
      return age > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
    }
    default:
      return null;
  }
}

/**
 * Whether the file behind this image is in the memory of the screen asking.
 *
 * This is the whole of the difference between "Upload failed" and "Image unavailable", and
 * between a Retry button and no Retry button: one screen has the bytes and can put them up
 * again, and the rest are looking at somebody else's unfinished business.
 */
export function isUploaderView(image: ImageSnapshot | null | undefined, identityId: string): boolean {
  return !!image && image.uploaderId !== '' && image.uploaderId === identityId;
}

/**
 * Where a browser fetches this picture from. The key already begins with the board's id, so the
 * address is the key — which is also why the address cannot be pointed at another board's file
 * by editing it: the route checks the id in the path against the id in the key.
 */
export function assetUrl(assetKey: string): string {
  const slash = assetKey.indexOf('/');
  const board = slash === -1 ? assetKey : assetKey.slice(0, slash);
  const asset = slash === -1 ? '' : assetKey.slice(slash + 1);
  return `/api/assets/${encodeURIComponent(board)}/${encodeURIComponent(asset)}`;
}
