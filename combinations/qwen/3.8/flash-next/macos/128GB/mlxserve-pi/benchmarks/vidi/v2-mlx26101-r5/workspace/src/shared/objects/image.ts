/**
 * An image on the board: where it will be drawn, and what the bytes sitting behind it are doing.
 *
 * Everything about a picture that is worth sharing fits in nine fields, and it is worth being exact
 * about why those nine are the ones the document carries. The bytes themselves are not among them — a
 * picture's bytes have no business inside a CRDT, whose whole job is merging edits to the same value,
 * and nobody has ever edited the bytes of a screenshot. They go to R2 under a key, and the key is what
 * the board shares: a board holds a *reference* and a size, which means adding a picture is one small
 * write that everyone sees at once, and the megabytes travel only between the browser that has them and
 * the bucket that keeps them.
 *
 * The other seven fields exist because of one fact: **an image arrives in two halves.** The size and the
 * position are known before the bytes are, and the bytes arrive some time later — or never. That is not a
 * detail the UI wraps in a spinner, it is the shape of the data:
 *
 * - `assetKey` is `null` until the upload answers, because there is genuinely no address to write yet;
 * - `status` and `uploadStartedAt` say what the *upload* is doing, which is a different question from
 *   what the *picture* is doing;
 * - `uploaderId` says whose browser has the bytes, because only that browser can retry an upload —
 *   everybody else can only wait, or give up and remove the placeholder (PRD `image.upload_failure`);
 * - `naturalWidth`/`naturalHeight` are stored rather than re-read, because a placeholder is drawn at the
 *   size the picture will be *before* anybody but the uploader has ever seen it, and a placeholder that is
 *   the wrong size moves the layout when the real thing arrives.
 *
 * The origin every status change is written with is {@link UPLOAD_ORIGIN}, and that single choice is what
 * makes PRD `image.undo` true. An upload finishing is not a thing a person *did*; it is a thing that
 * happened to them, between one keystroke and the next. Were it written with the local origin, pressing
 * undo once after a picture arrived would undo the arrival — and then, since the placeholder is gone, a
 * second undo would undo the *adding* of it, and the board would have eaten a picture and a keystroke
 * would be needed to find out that the keystroke was not the problem. So: one add is one undo step
 * (TC-05), an arrival is not a step at all, and a removal is a step of its own because that one a person
 * really did do.
 */

import * as Y from 'yjs';

import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import type { Point, Rect } from '../geometry';
import { LOCAL_ORIGIN, OBJECTS_MAP, type ObjectSnapshot } from '../board-model';
import { isAcceptedImageType } from '../image-format';

/** The registry key and the document's name for this kind of object. */
export const IMAGE_OBJECT_TYPE = 'image';

/** What the upload itself is doing. `ready` is the only state in which `assetKey` means anything. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/**
 * What a person is told about a picture: the status the document holds, plus the one state nobody's
 * upload is ever actually in. See {@link displayStatus}.
 */
export type DisplayStatus = ImageStatus | 'unfinished';

/**
 * Writes that change an upload's status, as opposed to a picture's place on the board.
 *
 * Deliberately *not* {@link LOCAL_ORIGIN}, and this is the origin story 8's undo manager is configured
 * not to see: a board's undo stack is a record of this person's actions, and "the bytes arrived" is not
 * one. It belongs on the same side of that line as a remote person's edit — which is exactly what it is,
 * from the undo manager's point of view, since on somebody else's screen it arrives with no origin at all.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload');

/** A size in board units. Structurally the camera's `Size`, which is what a decoder reports too. */
export interface Size {
  width: number;
  height: number;
}

/**
 * One picture, as the board holds it and as the object that draws it receives it.
 *
 * `width`/`height` come from {@link ObjectSnapshot} and are always written: they are the box the picture
 * is drawn in and resized in, and after a resize they are no longer the picture's own proportions — which
 * is why the natural pair below is kept beside them and never replaced by them.
 */
export interface ImageSnap extends ObjectSnapshot {
  type: 'image';
  /** `boardId/assetId` once stored; `null` for as long as it is still being uploaded. */
  assetKey: string | null;
  /** The type the bytes were stored as — the type the sniffer found, never the one that was claimed. */
  contentType: string;
  /** The picture's own size in pixels; the board's size is this one scaled, and may be resized freely. */
  naturalWidth: number;
  naturalHeight: number;
  status: ImageStatus;
  /** When this upload last started, on the clock of the browser that started it. */
  uploadStartedAt: number;
  /** Whose browser holds the file: only that person can retry it. */
  uploaderId: string;
}

/** Is this snapshot one of our pictures? (Narrowing, for code that walks a mixed selection.) */
export const isImageSnapshot = (object: ObjectSnapshot | null | undefined): object is ImageSnap =>
  object !== null && object !== undefined && object.type === IMAGE_OBJECT_TYPE;

/** Is this string one of the three statuses an object may carry? */
export function isImageStatus(value: unknown): value is ImageStatus {
  return value === 'uploading' || value === 'ready' || value === 'failed';
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The size a picture is placed at: its own pixel size, scaled *down* so its longest side is
 * {@link IMAGE_MAX_PLACE_SIZE_WORLD} and never scaled up.
 *
 * The "never up" half is the difference between a placement rule and a stretch. A 40 × 30 icon placed 800
 * units wide would fill the screen and be unreadable at any zoom; a 4032 × 3024 photo placed at its own
 * size would be a board you scroll along for a mile. Both are answered by one scale factor capped at 1,
 * and the proportion is exact because there is only ever one factor (TC-03: 1600×1200 → 800×600, and the
 * 300×3200 that becomes 75×800 is the same multiplication seen from the other side).
 *
 * A size that is not a size — 0, NaN, a decoder that said nothing — comes back as 0 × 0 rather than as an
 * exception or an infinity, because the caller's question is "how big is this", and 0 × 0 is the answer
 * that {@link createImagePlaceholders} already knows how to act on: an object with no size is not added.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  if (!finite(naturalWidth) || !finite(naturalHeight)) return { width: 0, height: 0 };
  if (naturalWidth <= 0 || naturalHeight <= 0) return { width: 0, height: 0 };
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/** Which part of a row {@link layoutRow}'s point is: the first picture's corner, or the middle of the row. */
export type RowAnchor = 'top-left' | 'centre';

/**
 * Lays a row of pictures out left to right, {@link IMAGE_LAYOUT_GAP_WORLD} apart, and returns the rect
 * each one is placed at.
 *
 * The two anchors are the two ways a row gets asked for. A **drop** says "here" — the files came from
 * that spot on the screen, so the first one's top-left goes exactly there and the row runs away to the
 * right, the way the person's eye was already travelling. A **paste** or a **picker** says "put it on the
 * board" and means the middle of what I can see, so the whole row is centred on the point given (TC-04:
 * tops aligned at the point for a drop, a row centred on it for a paste).
 *
 * Vertically a centred row is centred on its tallest picture, which is the only choice that makes a row of
 * mixed heights look like a row: aligned tops sit a short picture high, aligned bottoms bury one under
 * the line.
 *
 * The rects carry the sizes they were given, unchanged — this function places, it does not scale. A size
 * of 0 × 0 survives as a rect of 0 × 0 and is dropped by {@link createImagePlaceholders}, which is where
 * the question "should this be on the board" is answered.
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: RowAnchor = 'top-left'): Rect[] {
  if (sizes.length === 0) return [];
  const gap = IMAGE_LAYOUT_GAP_WORLD;
  const rowWidth = sizes.reduce((total, size) => total + size.width, 0) + gap * (sizes.length - 1);
  const tallest = sizes.reduce((tallestSoFar, size) => Math.max(tallestSoFar, size.height), 0);
  let x = anchor === 'centre' ? start.x - rowWidth / 2 : start.x;
  const y = anchor === 'centre' ? start.y - tallest / 2 : start.y;
  return sizes.map((size) => {
    const rect = { x, y, width: size.width, height: size.height };
    x += size.width + gap;
    return rect;
  });
}

/** One picture to put on the board: where it goes, how big it is, and what it is made of. */
export interface ImagePlacement {
  /** Position and size, from {@link layoutRow} and {@link placementSize} together. */
  rect: Rect;
  /** The file's own pixel size, kept so the box can be resized away from it and still be described. */
  naturalWidth: number;
  naturalHeight: number;
  /** The MIME type the bytes will be stored as. Anything outside the four is stored as a PNG. */
  contentType: string;
}

/**
 * Puts placeholders on the board, **all of them in one transaction**, and returns their ids in order.
 *
 * One transaction is the whole of "undoing an image insertion removes it in one step" for a batch. Three
 * screenshots dropped together are one action — one drag, one intention — and three undo steps for one
 * drag would mean a person has to press the key three times to take back the thing they did once, with
 * two intermediate states of the board that were never anybody's intention. So the loop lives inside the
 * transaction and the undo manager sees one step (TC-05), and `now` is passed in rather than read here so
 * that every placeholder in the batch shares one start time — and so that a test can put a row of
 * placeholders five minutes in the past without waiting for them.
 *
 * `uploaderId` is one argument for the whole batch for the same reason: a batch is one person's action,
 * and an object that could name a different uploader from its neighbours would be a batch that could
 * split in half when it came to who is allowed to press Retry.
 *
 * A rect with no size is skipped rather than written: an object with a zero or a NaN in it would be drawn
 * nowhere, picked by nothing and sit on the board for ever, which is a worse outcome by a wide margin than
 * the one file out of a batch that does not appear.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlacement[],
  uploaderId: string,
  now: number,
): string[] {
  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
  const usable = items.filter(
    (item) =>
      finite(item.rect.x) &&
      finite(item.rect.y) &&
      finite(item.rect.width) &&
      finite(item.rect.height) &&
      item.rect.width > 0 &&
      item.rect.height > 0 &&
      finite(item.naturalWidth) &&
      finite(item.naturalHeight),
  );
  if (usable.length === 0) return [];

  const startedAt = finite(now) ? now : Date.now();
  let top = 0;
  for (const value of objects.values()) {
    if (value instanceof Y.Map) {
      const z = value.get('z');
      if (typeof z === 'number' && Number.isFinite(z) && z > top) top = z;
    }
  }

  const ids: string[] = [];
  doc.transact(() => {
    let z = top;
    for (const item of usable) {
      const id = crypto.randomUUID();
      const map = new Y.Map<unknown>();
      map.set('type', IMAGE_OBJECT_TYPE);
      map.set('x', item.rect.x);
      map.set('y', item.rect.y);
      map.set('width', item.rect.width);
      map.set('height', item.rect.height);
      // Each new picture goes on top of the last, in the order it was given: a row that arrived in a
      // stack would be a row of which only the last one is visible.
      map.set('z', (z += 1));
      map.set('createdAt', startedAt);
      map.set('assetKey', null);
      // A type outside the four is stored as a PNG rather than as a hole in the object: the object has to
      // be drawable whatever happened to the string a caller passed, and this is the one place the
      // boundary is crossed. (`validateFiles` and the Worker's sniffer are where it is defended.)
      map.set('contentType', isAcceptedImageType(item.contentType) ? item.contentType : 'image/png');
      map.set('naturalWidth', item.naturalWidth);
      map.set('naturalHeight', item.naturalHeight);
      map.set('status', 'uploading');
      map.set('uploadStartedAt', startedAt);
      map.set('uploaderId', typeof uploaderId === 'string' ? uploaderId : '');
      objects.set(id, map);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

/**
 * The bytes are stored: this object is the picture now.
 *
 * Written with {@link UPLOAD_ORIGIN}, so it is not an undo step, and returning false for an id that is not
 * here any more — which is the ordinary outcome of a slow upload in front of a fast person, and not an
 * error anybody needs to hear about. The file is in the bucket and nothing points at it; that is the PRD's
 * own non-behaviour ("deleting an image from the board does not guarantee removal of the stored file"), and
 * the reason it is a non-behaviour is that a bucket object with no reader costs nobody anything, while a
 * delete that raced an upload would sometimes have thrown away a picture somebody is still looking at.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const map = imageOf(doc, id);
  if (map === null) return false;
  if (map.get('assetKey') === assetKey && map.get('status') === 'ready') return false;
  doc.transact(() => {
    map.set('assetKey', assetKey);
    map.set('status', 'ready');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * The upload failed.
 *
 * `assetKey` goes back to null with it, because a key belongs to a stored picture and a failed upload has
 * no stored picture — the placeholder must not be drawn as an image on the strength of an upload that did
 * not happen. Not an undo step, for the reason given at the top of this file: this is something that
 * happened to a placeholder, not something a person did to a board.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const map = imageOf(doc, id);
  if (map === null) return false;
  if (map.get('status') === 'failed' && map.get('assetKey') === null) return false;
  doc.transact(() => {
    map.set('assetKey', null);
    map.set('status', 'failed');
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * Begins again: back to `uploading`, with a fresh start time and no address.
 *
 * The new `now` is the part that matters. A placeholder that has been sitting there for six minutes is
 * being rendered as *unfinished*, and a Retry that only flipped the status would still be six minutes old
 * — so the next render would call it unfinished again and the button would appear to do nothing at all.
 * Rewinding the clock is what makes Retry visibly restart the upload, and it is why this write takes the
 * time as an argument instead of reading one.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const map = imageOf(doc, id);
  if (map === null) return false;
  const startedAt = finite(now) ? now : Date.now();
  doc.transact(() => {
    map.set('assetKey', null);
    map.set('status', 'uploading');
    map.set('uploadStartedAt', startedAt);
  }, UPLOAD_ORIGIN);
  return true;
}

/** The object's own map, when this id is here and is a picture. */
function imageOf(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const value: unknown = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get(id);
  if (!(value instanceof Y.Map)) return null;
  if (value.get('type') !== IMAGE_OBJECT_TYPE) return null;
  return value;
}

/**
 * What a person is told this picture is doing, which is not quite what the document says it is doing.
 *
 * `uploading`, `ready` and `failed` are statuses; **`unfinished` is not** — it is what `uploading` has
 * meant for long enough that nobody believes it any more. An upload whose browser was closed in the middle
 * stays `uploading` in the document for as long as the board exists, because there is nobody left who could
 * write anything else to it: the browser that knew the outcome is gone. So the state is *derived*, at
 * {@link IMAGE_UPLOAD_STALE_MS}, from a timestamp that was written honestly at the time: "the bytes are on
 * their way" stops being the truth after five minutes, and the box says so and offers a Remove button
 * (TC-06, TC-22, PRD `image.unfinished`).
 *
 * `now` is a parameter rather than a `Date.now()` inside, because the alternative is a function that
 * cannot be tested at its boundary — and this one has exactly one interesting moment.
 */
export function displayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'ready') return 'ready';
  if (img.status === 'failed') return 'failed';
  // Only an upload in progress can go stale: a failed one already said so, and a ready one arrived.
  return now - img.uploadStartedAt > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
}
