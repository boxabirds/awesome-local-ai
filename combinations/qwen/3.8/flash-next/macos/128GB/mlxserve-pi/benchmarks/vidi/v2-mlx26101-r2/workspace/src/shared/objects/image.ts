/**
 * The `image` object (`src/shared/objects/image.ts`).
 *
 * Story 12 adds a second kind of object that lives somewhere other than the text
 * map, and it inherits story 11's lesson about how that has to be done: *the type
 * registers its reader, and everything else in the application learns about images
 * by going through the registry.* `board-model.ts` does not know what an asset key
 * is; neither does the room, the undo history, the marquee, the selection toolbar
 * or the clipboard. Adding this file to the registry is the only reason any of them
 * know that images exist at all.
 *
 * What an image object holds, and what it does not:
 *
 * ```
 * { type: 'image', x, y, z, createdAt, width, height,
 *   assetKey: `${boardId}/${assetId}` | null, contentType, naturalWidth, naturalHeight,
 *   status: 'uploading' | 'ready' | 'failed', uploadStartedAt, uploaderId }
 * ```
 *
 * The bytes are not in the document, and that is the point. Story 11 found that
 * *storing* an object's content on the shared map is what breaks text - a whole
 * image would be a megabyte inside every update, in every peer's history, forever.
 * An image keeps a *name*: twelve bytes of "where the file is". The file goes to R2
 * over an ordinary HTTP route, which is also why story 10's relay does not change.
 *
 * ## The status field, and why it is shared while the progress is not
 *
 * Three of the five states in the PRD are a fact about the image and travel:
 * `uploading`, `ready`, `failed`. Upload *progress* is not one of them - it is a
 * fact about one person's connection, and it lives in that tab's memory
 * (`uploadImage`'s `onProgress`, held in `useImageInsert`'s React state). If
 * percentages were shared, every peer would watch someone else's network, and
 * two people uploading at once would see each other's numbers move.
 *
 * `uploading` needs two more fields than the others do, because an upload is the
 * board's first object state that something outside the document is supposed to
 * finish. If the tab that held the file closes halfway through, the object would sit
 * there claiming to be uploading forever, and the room would offer no way to get rid
 * of it: `uploadStartedAt` is when the attempt began and `uploaderId` is who was
 * making it, which between them turn that lie into something the board can show and
 * a person can act on. Neither is ever rewritten except by the person retrying.
 *
 * ## The clock
 *
 * `IMAGE_UPLOAD_STALE_MS` is *not* a timer, a timeout or a scheduled cleanup - three
 * things the document cannot have, because a document is not a process and cannot be
 * woken up. It is a comparison, made whenever somebody looks:
 * {@link displayStatus} is given "now" and answers with what should be shown. The
 * board's only clock is a 30-second interval in one hook, and the granularity that
 * buys is invisible: the state it produces is a sentence that was already true.
 */

import * as Y from 'yjs';

import { LOCAL_ORIGIN, objectSnapshot, type ObjectSnapshot } from '../board-model.js';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config.js';
import type { Point, Rect } from '../geometry.js';
import { registerBoardObjectType, registerDefaultObjectSize, registerObjectSnapshotReader } from '../object-registry.js';

export const IMAGE_TYPE = 'image';

/**
 * The origin of a status update, which is deliberately **not** this tab's writing
 * origin.
 *
 * The PRD's rule is that undo/redo works "as if the images had been added already":
 * one add is one step, and an upload finishing afterwards is not a step of its own.
 * `Y.UndoManager` decides what is and is not a step by looking at the origin of the
 * transaction that made the change, so "is not a step" has to be written as an origin
 * the history does not track - there is no other way to say it to Yjs.
 *
 * It is a symbol, not a string, so that it cannot collide with a string origin some
 * other part of the system (or another library) uses for a transaction: a collision
 * here would quietly put upload completions into the history, which is a bug that
 * only shows up as Ctrl+Z behaving strangely two seconds after a drop.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload');

/** What the document says an image is doing. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/**
 * What the board should say about an image, which is the status plus the one state
 * nobody wrote down: `unfinished`, an `uploading` that has outlived whoever was
 * doing it.
 */
export type ImageDisplayStatus = ImageStatus | 'unfinished';

/** A width and a height, for the layout functions that do not care where. */
export interface Size {
  width: number;
  height: number;
}

/** An image, read out of the document. */
export interface ImageSnap extends ObjectSnapshot {
  type: typeof IMAGE_TYPE;
  /** `${boardId}/${assetId}` once the file is stored, `null` while it is not. */
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  uploadStartedAt: number;
  uploaderId: string;
}

/** One image of an add action: where it goes, and what its pixels measured. */
export interface ImagePlacement {
  rect: Rect;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Numbers read out of a document are not trusted: a field that is missing, or that
 * arrived as something else, becomes the fallback rather than `NaN` spreading into a
 * position, a size or a comparison with the clock.
 */
const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const stringOr = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

function readImageSnapshot(id: string, map: Y.Map<unknown>): ImageSnap | undefined {
  const x = map.get('x');
  const y = map.get('y');
  const z = map.get('z');
  const status = map.get('status');
  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y) ||
    typeof z !== 'number' ||
    !Number.isFinite(z) ||
    (status !== 'uploading' && status !== 'ready' && status !== 'failed')
  ) {
    return undefined;
  }
  const assetKey = map.get('assetKey');
  const createdAt = map.get('createdAt');
  return {
    id,
    type: IMAGE_TYPE,
    x,
    y,
    z,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : null,
    width: map.get('width'),
    height: map.get('height'),
    assetKey: typeof assetKey === 'string' && assetKey.length > 0 ? assetKey : null,
    contentType: stringOr(map.get('contentType'), ''),
    naturalWidth: numberOr(map.get('naturalWidth'), 0),
    naturalHeight: numberOr(map.get('naturalHeight'), 0),
    status,
    uploadStartedAt: numberOr(map.get('uploadStartedAt'), Number.NEGATIVE_INFINITY),
    uploaderId: stringOr(map.get('uploaderId'), ''),
  };
}

registerBoardObjectType(IMAGE_TYPE, IMAGE_MIN_SIZE_WORLD);
registerObjectSnapshotReader(IMAGE_TYPE, readImageSnapshot);
// An image always carries its own width and height, so this is only ever a last
// resort for a record that lost them; the floor is the smallest the board allows.
registerDefaultObjectSize(IMAGE_TYPE, IMAGE_MIN_SIZE_WORLD);

/* ------------------------------------------------------------------- the size */

/**
 * How big an image is on the board, from how big its pixels are
 * (`image.placement_size`).
 *
 * One natural pixel is one board unit - a 400 x 300 screenshot is a 400 x 300 object
 * - and an image bigger than {@link IMAGE_MAX_PLACE_SIZE_WORLD} on its longest side
 * is scaled down so its longest side *is* that, with the ratio kept exactly.
 *
 * Two details are load-bearing rather than cosmetic. Nothing is ever enlarged: a
 * 40 x 40 icon is 40 units, because inventing size for a picture would be the board
 * deciding what a person meant to show. And the side that sets the scale is computed
 * as `other * MAX / longest` with the longest side set to `MAX` itself, rather than
 * both sides multiplied by a ratio - which is what makes a 4032 x 3024 photo come
 * out as exactly 800 x 600 instead of 800.0000000000001 x 600.0000000000001, sizes
 * that end up in the shared document, in everybody's history, for the life of the
 * board.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  const width = numberOr(naturalWidth, 0);
  const height = numberOr(naturalHeight, 0);
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };

  const longest = Math.max(width, height);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) return { width, height };

  const scale = IMAGE_MAX_PLACE_SIZE_WORLD / longest;
  return width >= height
    ? { width: IMAGE_MAX_PLACE_SIZE_WORLD, height: round(height * scale) }
    : { width: round(width * scale), height: IMAGE_MAX_PLACE_SIZE_WORLD };
}

/**
 * Whole board units, to one decimal.
 *
 * A number with seventeen significant digits has no business being written into a
 * shared document, where it will be replicated, kept in history and compared for
 * equality by every peer that ever opens the board. A tenth of a board unit is far
 * below what a person can see at any zoom this board has, so nothing is lost by
 * rounding it away and a great deal is gained in what the document has to carry.
 */
const round = (value: number): number => Math.round(value * 10) / 10;

/** How the row is anchored to the point it was laid out from. */
export type RowAnchor = 'top-left' | 'centre';

/**
 * Lay a row of images out from one point (`image.layout_row`), returning the rect of
 * each in the order it was given.
 *
 * The first image is at the point, the rest follow to its right with
 * {@link IMAGE_LAYOUT_GAP_WORLD} between neighbours, and the tops are all aligned -
 * so a batch arrives as a row a person can see the shape of, rather than as a pile
 * in which everything after the first image is invisible (and unresizable, and
 * unremovable) until they find it.
 *
 * `anchor` is where the point sits relative to the row: `'top-left'` for a drop,
 * where the row starts under the cursor that was holding the files; `'centre'` for a
 * pick or a paste, where there is no pointer to place it and the middle of the view
 * is the only "here" the board has - and centring it there means the row is *in* the
 * view whatever its total width turns out to be.
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: RowAnchor): Rect[] {
  const list = Array.isArray(sizes) ? sizes.filter((size) => numberOr(size?.width, 0) > 0 && numberOr(size?.height, 0) > 0) : [];
  if (list.length === 0) return [];

  const gap = Math.max(0, numberOr(IMAGE_LAYOUT_GAP_WORLD, 0));
  const total = list.reduce((sum, size) => sum + size.width, 0) + gap * (list.length - 1);
  const tallest = list.reduce((tallestSoFar, size) => Math.max(tallestSoFar, size.height), 0);

  let x = start.x;
  let y = start.y;
  if (anchor === 'centre') {
    x = start.x - total / 2;
    y = start.y - tallest / 2;
  }

  const rects: Rect[] = [];
  for (const size of list) {
    rects.push({ x, y, width: size.width, height: size.height });
    x += size.width + gap;
  }
  return rects;
}

/* --------------------------------------------------------------- the lifecycle */

/**
 * Add one add action's worth of images to the document, and return their ids.
 *
 * Every image of the action goes in **one transaction**, which is what makes "one
 * add is one undo step" true at the level Yjs decides it on: the history groups a
 * transaction, not a call, so three images written in one go are one thing to undo
 * and three writes in three goes are three. A person who dropped six screenshots
 * undoes the drop, not the sixth screenshot.
 *
 * Each record says `status: 'uploading'` with no asset key, because the file is on
 * its way and there is nothing to show yet - the placeholder is what lets the board
 * be honest about that instead of showing nothing for as long as the file takes.
 * The rect is the one the caller decided, so the image never moves when its upload
 * finishes: the position is a thing the person chose, and the upload is not allowed
 * to revise it.
 *
 * An item whose pixels were never measured (0 x 0, or anything that is not a
 * positive finite number) is skipped, and its absence is the caller's to report: a
 * placeholder with no size would be an object no one can see, select or remove.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlacement[],
  uploaderId: string,
  now: number,
): string[] {
  const objects = objectsOf(doc);
  const usable = (Array.isArray(items) ? items : []).filter(
    (item) =>
      item !== null &&
      item !== undefined &&
      Number.isFinite(item.rect?.x) &&
      Number.isFinite(item.rect?.y) &&
      item.rect.width > 0 &&
      item.rect.height > 0 &&
      numberOr(item.naturalWidth, 0) > 0 &&
      numberOr(item.naturalHeight, 0) > 0,
  );
  if (usable.length === 0) return [];

  const created = now === undefined || !Number.isFinite(now) ? Date.now() : now;
  const ids: string[] = [];
  doc.transact(() => {
    // Above everything on the board when it arrives (PRD `image.layout_row`: "the
    // first is placed at z = maxExistingZ + 1"), and stacked in the order they were
    // added so the row reads left to right in the stacking order too.
    let z = maxZ(objects) + 1;
    for (const item of usable) {
      const id = newImageId();
      const map = new Y.Map<unknown>();
      map.set('type', IMAGE_TYPE);
      map.set('x', item.rect.x);
      map.set('y', item.rect.y);
      map.set('width', item.rect.width);
      map.set('height', item.rect.height);
      map.set('z', z);
      map.set('createdAt', created);
      // Where the file will be, and what its bytes turned out to be: the natural
      // sizes are what makes a resize able to keep the proportions later, when the
      // box on the board has long since been dragged away from them.
      map.set('assetKey', null);
      map.set('contentType', typeof item.contentType === 'string' && item.contentType.length > 0 ? item.contentType : FALLBACK_CONTENT_TYPE);
      map.set('naturalWidth', item.naturalWidth);
      map.set('naturalHeight', item.naturalHeight);
      map.set('status', 'uploading' satisfies ImageStatus);
      map.set('uploadStartedAt', created);
      map.set('uploaderId', typeof uploaderId === 'string' ? uploaderId : '');
      objects.set(id, map);
      ids.push(id);
      z += 1;
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * An image's own content type, when the caller did not bring one: the bytes have
 * already been judged by then, and a placeholder does not get to invent an answer the
 * file did not give. PNG is the fallback for a file that claimed nothing, because it
 * is the type this board can always encode and always decode.
 */
const FALLBACK_CONTENT_TYPE = 'image/png';


/** The file has been stored. Show it. */
export function markImageReady(
  doc: Y.Doc,
  id: string,
  assetKey: string,
  contentType?: string,
): boolean {
  return writeStatus(doc, id, (map) => {
    map.set('assetKey', typeof assetKey === 'string' && assetKey.length > 0 ? assetKey : null);
    // What the Worker said the bytes *are*, from their signature, replaces what the
    // browser claimed they were: a file that called itself a PNG and turned out to be
    // a JPEG is a JPEG, and the document should end up holding the true answer.
    if (typeof contentType === 'string' && contentType.length > 0) map.set('contentType', contentType);
    map.set('status', 'ready' satisfies ImageStatus);
  });
}

/**
 * The upload ended badly.
 *
 * The object stays, with its position and its size: the image is not removed, because
 * what went wrong was the transport and not the thing the person put on the board,
 * and deleting their work would turn a failed network into a lost image. What is
 * lost is the *file*, which is why the state is a question to the person - Retry, or
 * Remove - rather than a broken picture.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  return writeStatus(doc, id, (map) => {
    map.set('assetKey', null);
    map.set('status', 'failed' satisfies ImageStatus);
  });
}

/**
 * The uploader is trying again: back to `uploading`, and the clock starts over.
 *
 * Rewriting `uploadStartedAt` is the whole point of this function existing
 * separately from {@link markImageFailed}: without it, an image that failed five
 * minutes ago and is retried now would still look five minutes stale to every peer,
 * and would be called unfinished again before the second attempt had barely begun.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  return writeStatus(doc, id, (map) => {
    map.set('assetKey', null);
    map.set('status', 'uploading' satisfies ImageStatus);
    map.set('uploadStartedAt', Number.isFinite(now) ? now : Date.now());
  });
}

/**
 * One status change, in one transaction, behind an origin the undo history does not
 * track - and *nothing at all* if there is no image with that id to change.
 *
 * The "nothing at all" is the part that is easy to get wrong and impossible to notice
 * in a browser: an upload that finishes two seconds after the person pressed Delete,
 * or after another person on another machine removed the image, is an update that
 * would go out to every peer, and into this tab's history, describing an object that
 * is not there. So the id is checked *before* the transaction is opened, not inside
 * it: a stale id produces no transaction, no update event and no bytes on the wire.
 */
function writeStatus(doc: Y.Doc, id: string, write: (map: Y.Map<unknown>) => void): boolean {
  const existing = objectsOf(doc).get(id);
  if (!(existing instanceof Y.Map) || existing.get('type') !== IMAGE_TYPE) return false;

  let written = false;
  doc.transact(() => {
    // The type is checked again in here, because a transaction is not a lock: between
    // deciding to write and writing, this document may have been updated from the
    // network - and the update that arrives in between is exactly the delete we are
    // not going to write into.
    const map = objectsOf(doc).get(id);
    if (!(map instanceof Y.Map) || map.get('type') !== IMAGE_TYPE) return;
    write(map);
    written = true;
  }, UPLOAD_ORIGIN);
  return written;
}

/**
 * What to show for an image, right now (`image.stale_upload` lives here).
 *
 * A pure function of the object and the clock, which is the only way to have a rule
 * about time in a document: nothing schedules anything, nothing wakes up, nothing
 * needs to be cancelled when a tab closes. The board asks what to show when it looks,
 * and the answer changes by itself.
 *
 * The comparison is `>` and not `>=`, which puts the boundary a millisecond on the
 * "still uploading" side - an upload that started exactly five minutes ago is still
 * an upload, and the difference is invisible either way except to a test that cares
 * where the edge is (`image.stale_upload`).
 */
export function displayStatus(image: ImageSnap, now: number): ImageDisplayStatus {
  if (image.status === 'uploading') {
    const started = image.uploadStartedAt;
    if (!Number.isFinite(started)) return 'failed';
    return now - started > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
  }
  if (image.status === 'ready') {
    // 'ready' claims there is a file to show. If the key is gone, the claim is not
    // true, and a peer is better off being told the image did not finish than being
    // handed an address that will 404.
    return image.assetKey === null ? 'unfinished' : 'ready';
  }
  if (image.status === 'failed') return 'failed';
  // A status this file never wrote: the least misleading thing to do with it is say
  // the upload did not happen, which is the one state that offers a way out.
  return 'failed';
}

/* -------------------------------------------------------------------- plumbing */

/** The images of a document, in z order like everything else that is listed. */
export function imageSnapshots(doc: Y.Doc): ImageSnap[] {
  const images: ImageSnap[] = [];
  for (const object of objectSnapshot(doc)) {
    if (object.type === IMAGE_TYPE) images.push(object as ImageSnap);
  }
  return images;
}

/**
 * The `objects` map, read as a map of maps: the fields inside are this module's
 * business, and nobody outside it looks in.
 */
function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((map) => {
    if (!(map instanceof Y.Map)) return;
    const z = map.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/**
 * An id for one image. 16 random bytes, base64url, 22 characters - the same shape as
 * a board id and an asset id, because an id that has to survive being pasted into a
 * URL, embedded in a key and printed in a log has the same requirements wherever it
 * is used.
 */
const IMAGE_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** How many random bytes are behind one image id: 128 bits, so a guess is not a strategy. */
export const ID_BYTES = 16;

export function newImageId(): string {
  const bytes = new Uint8Array(ID_BYTES);
  crypto.getRandomValues(bytes);
  let id = '';
  // 64 characters in the alphabet, 256 values in a byte: four bytes to three
  // characters, and nothing that needs escaping to put into an address.
  for (const byte of bytes) id += IMAGE_ID_ALPHABET[byte % 64];
  return id;
}
