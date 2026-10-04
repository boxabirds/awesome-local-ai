/**
 * Images (story 12): what a picture on the board is, and the writes that change it.
 *
 * An image is the one object on this board whose bytes are not in the document. A sticky's words, a
 * shape's label and a stroke's points are all in the Y.Doc, because they are small and because being
 * there is what makes them sync; forty photographs are neither small nor wanted twice, so the document
 * holds a *reference* - `assetKey` - and the bytes come from the bucket when somebody asks for them.
 * That single decision is why the object has a status at all: there is a window, usually under a second
 * and sometimes forever, in which the board knows there is a picture at a place and does not yet have the
 * picture. Everything in this file is about that window - how wide it is made at creation
 * ({@link createImagePlaceholders}), how it closes ({@link markImageReady}, {@link markImageFailed}), how
 * it is admitted to have never closed ({@link displayStatus}), and how big the thing is drawn while it is
 * open ({@link placementSize}).
 *
 * The other thing here is placement. A dropped file has a natural size in pixels, and one pixel is one
 * board unit, which is a rule that works until somebody drops a 4032x3024 photograph and it covers the
 * board. {@link placementSize} is the scaling that keeps such a thing in proportion, and {@link layoutRow}
 * is the reason a batch of five dropped files arrives as a row rather than as five images in the same
 * pixel.
 */
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../config';
import {
  IMAGE_TYPE,
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  isImageUploadStatus,
  registerObjectReader,
  snapshot,
  type ImageSnapshot,
  type ImageUploadStatus,
  type ObjectSnapshot,
} from '../board-model';
import { ASSET_KEY_PATTERN } from '../image-format';
import type { Point, Rect, Size } from '../geometry';

/**
 * The shape of an image, said from the module that owns images. It is declared next to `ObjectSnapshot`,
 * because that is where a reader that knows nothing about images has to say what an unknown object is;
 * it is said again here because the name belongs to this story.
 */
export type { ImageSnapshot, ImageUploadStatus } from '../board-model';

/**
 * Let the model read images.
 *
 * The client's object registry calls this too, when it registers the component that draws an image; the
 * module does it for itself as well, because an image model that could not read its own objects in a test
 * - or on a server - would be a model whose document is invisible to it.
 */
registerObjectReader(IMAGE_TYPE);

/**
 * The origin of the transactions that only report an upload's progress.
 *
 * It exists so that it can be *excluded*. Story 8's undo tracks {@link LOCAL_ORIGIN} alone, which is what
 * makes one drop one undo step: the placeholder is written locally, by hand, at the moment the person let
 * go of the files, and that is the thing they meant to undo. What happens afterwards - the upload
 * finishing, the picture appearing - is not a thing anybody did, and an undo stack in which "the network
 * was quick" is a step is a stack nobody can use. So the status writes carry this origin, and the
 * UndoManager does not see them.
 *
 * It is not a substitute for {@link LOCAL_ORIGIN} in any other place: an update tagged with it is an
 * update no undo will ever take back, which is only ever the right thing for a status.
 */
export const UPLOAD_ORIGIN: unique symbol = Symbol('vidi6-upload');

/** What the person sees where the picture should be. See {@link ImageUploadStatus} for what is stored. */
export type ImageStatus = 'uploading' | 'ready' | 'failed';

/*
 * The private helpers of a board model, repeated here as they are repeated in `shape.ts`, `stroke.ts`,
 * `text.ts` and `connector.ts`: an object model reaches into the same `objects` map as its neighbours and
 * does it with its own hands, so that no story has to re-read another story's file to know what a write
 * looks like.
 */
type YObject = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>(OBJECTS_MAP);
}

/** A member of `objects` that is an image. Anything else - a note, an arrow, nothing - is `null`. */
function imageObject(objects: Y.Map<YObject>, id: string): YObject | null {
  const object = objects.get(id);
  return object instanceof Y.Map && object.get('type') === IMAGE_TYPE ? object : null;
}

function readZ(object: YObject): number {
  const z = object.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

/** Highest stacking order of any object on the board; 0 for an empty one. */
function maxZ(objects: Y.Map<YObject>): number {
  let max = 0;
  for (const object of objects.values()) {
    if (object instanceof Y.Map) {
      max = Math.max(max, readZ(object));
    }
  }
  return max;
}

/** Ids are `crypto.randomUUID()`, so images added by two peers at once (story 3) cannot collide. */
function newId(): string {
  const cryptoObject: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (typeof cryptoObject?.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

/** A number small enough to store exactly, and large enough to not be a rounding artefact. */
function stored(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** A box that can be drawn: four finite numbers, and a width and height above zero. */
function isDrawable(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/** A picture's size, as a pair of finite positive numbers - which is not every pair of numbers. */
function isNaturalSize(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}


/**
 * What is shown, which is what is stored plus one thing nobody stores: `unfinished`, an upload that
 * started and never came back. See {@link displayStatus}.
 */
export type DisplayStatus = ImageStatus | 'unfinished';

/**
 * How big an image is drawn when it is added, in board units.
 *
 * One pixel is one board unit - a 400x300 screenshot is a 400x300 box on the board, which is what makes a
 * dropped screenshot the size it was on the screen it was taken from - until the longest side goes past
 * {@link IMAGE_MAX_PLACE_SIZE_WORLD}, at which point both sides come down by the same factor and the
 * longest side lands exactly on the limit.
 *
 * "By the same factor" is the whole of the promise, and it is why there is no rounding here: a
 * 4032x3024 photograph becomes 800x600 exactly (a factor of 20.16, and 4032/20.16 is 200 - the arithmetic
 * comes out exact for the sizes cameras make, and where it does not, a fraction of a board unit is what
 * keeps the ratio true). An image is never *enlarged* to reach the limit: a 40x40 icon is a 40x40 icon on
 * the board, and the person who wants it bigger drags a handle, which is a thing they chose.
 *
 * @returns the box to draw at, or `{ width: 0, height: 0 }` for a size that is not a picture's - not a
 * finite positive pair of numbers - which is what {@link createImagePlaceholders} tests before it skips
 * an item.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): Size {
  if (!isNaturalSize(naturalWidth, naturalHeight)) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= IMAGE_MAX_PLACE_SIZE_WORLD) {
    return { width: naturalWidth, height: naturalHeight };
  }
  // One factor, both ways: dividing the longest side by itself makes the limit exact on the long side and
  // leaves the short side whatever the ratio says, which is the only way both promises - "exactly 800" and
  // "the same picture" - are kept at the same time.
  const factor = longest / IMAGE_MAX_PLACE_SIZE_WORLD;
  return { width: naturalWidth / factor, height: naturalHeight / factor };
}

/**
 * A row of boxes, left to right, from `start`.
 *
 * A drop of five files is five images, and putting all five at the drop point would be five images in one
 * pile - a person would see one and conclude four had been lost. So they go out in a row: the first at
 * `start`, each next one a {@link IMAGE_LAYOUT_GAP_WORLD} further along, all sharing a top edge.
 *
 * Two anchors, because there are two ways to be given a place. A *drop* names the top-left corner,
 * because the pointer is pointing at where the thing should begin; a *paste* or the Image tool names the
 * middle of the view, because there is no pointer over the board to take a corner from and the view's
 * centre is the only place there is. With `centre` the whole row - widths and gaps included - is centred
 * on the point, and the row's height is the tallest of them.
 *
 * A row is one row: it does not wrap. A person who drops twenty images gets a row twenty wide and pans
 * out to see it, which is what a whiteboard is for; a layout that wrapped at some number of columns would
 * be a layout with an opinion about their window.
 */
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[] {
  // The row's total width, gaps included, is needed before the first box can be placed - with the `centre`
  // anchor there is nothing to start from except the middle of the whole thing.
  let rowWidth = 0;
  let tallest = 0;
  for (const size of sizes) {
    rowWidth += size.width + (rowWidth > 0 ? IMAGE_LAYOUT_GAP_WORLD : 0);
    tallest = Math.max(tallest, size.height);
  }
  const anchorX = anchor === 'centre' ? start.x - rowWidth / 2 : start.x;
  const anchorY = anchor === 'centre' ? start.y - tallest / 2 : start.y;

  const rects: Rect[] = [];
  let x = anchorX;
  for (const size of sizes) {
    if (rects.length > 0) {
      x += IMAGE_LAYOUT_GAP_WORLD;
    }
    rects.push({ x, y: anchorY, width: size.width, height: size.height });
    x += size.width;
  }
  return rects;
}

/** One image to be added: where it goes and what it turned out to be when it was decoded. */
export interface ImagePlacement {
  readonly rect: Rect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly contentType: string;
}

/**
 * Write the placeholders, in one transaction, and hand back their ids.
 *
 * This is the moment a dropped file becomes a board object, and it happens *before* a byte has been
 * uploaded: the picture gets its place, its size and its natural dimensions from a decode of the file the
 * browser already has, and the board can draw it - as a placeholder, with the uploader's own progress on
 * it - immediately. Everything after this is the bytes catching up with the object.
 *
 * One transaction for the whole call, which is the same thing as one undo step, which is what the PRD
 * asks for: twenty images dropped together come from one gesture and come off together. It is also why
 * this function takes a batch rather than being called in a loop - a loop would be twenty transactions
 * and twenty undo steps, and nothing about the person's hand suggested they wanted twenty of anything.
 *
 * An item whose natural size is not a pair of positive finite numbers is skipped, and the others go
 * through: half an image is not a thing that can be drawn at any size, but the other four files were
 * dropped and are fine.
 *
 * @returns the ids of the objects that were created, in the order they were given
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlacement[],
  uploaderId: string,
  now: number,
): string[] {
  const objects = objectsOf(doc);
  const created: string[] = [];
  if (items.length === 0 || typeof uploaderId !== 'string' || uploaderId === '') {
    return created;
  }

  // The whole batch in one transaction, which is one update on the wire, one entry in somebody else's
  // undo history and - because {@link LOCAL_ORIGIN} is the only origin story 8's UndoManager watches - one
  // undo step for the person who dropped the files.
  doc.transact(() => {
    // z is read once, before anything is written, and then counted up: the whole batch goes on top of
    // whatever was already there, in the order it was given, which is what makes a five-image drop five
    // images you can all see rather than five images stacked behind one another.
    let z = maxZ(objects);
    for (const item of items) {
      if (!isDrawable(item.rect) || !isNaturalSize(item.naturalWidth, item.naturalHeight)) {
        continue;
      }
      const object = new Y.Map<unknown>();
      object.set('type', IMAGE_TYPE);
      object.set('x', stored(item.rect.x));
      object.set('y', stored(item.rect.y));
      object.set('width', stored(item.rect.width));
      object.set('height', stored(item.rect.height));
      // The picture's own size, kept for the same reason a stroke keeps the box it was drawn at: every
      // later resize is measured against this ratio, and the file it came from is not here to be asked
      // again. It is also the only size information that survives a reload of a board whose upload never
      // finished.
      object.set('naturalWidth', stored(item.naturalWidth));
      object.set('naturalHeight', stored(item.naturalHeight));
      object.set('contentType', item.contentType);
      object.set('assetKey', null);
      object.set('status', 'uploading');
      object.set('uploadStartedAt', now);
      object.set('uploaderId', uploaderId);
      object.set('z', z + 1);
      object.set('createdAt', now);
      object.set('createdBy', uploaderId);
      z += 1;
      const id = newId();
      objects.set(id, object);
      created.push(id);
    }
  }, LOCAL_ORIGIN);

  return created;
}

/**
 * The bytes are in the bucket: point the object at them.
 *
 * `assetKey` is written here and nowhere else, and it is the only field of an image that this file does
 * not know in advance - it comes from the upload's answer, which is the first moment anybody on the board
 * has a place to fetch the picture from. The status goes to `ready` in the same transaction, because an
 * object that names bytes it has not got would be drawn as a broken picture for as long as it took the
 * next write to arrive.
 *
 * Everything is tagged {@link UPLOAD_ORIGIN}: this is news about the network, not something the person
 * did, and it must not be its own undo step.
 *
 * @returns `false` when there is no image with that id to mark - the tab was closed, somebody else
 * removed it, undo took it back - and writes nothing in that case.
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  // The key is checked before it is believed, and before anything is written. It arrives over the network
  // from a Worker response, and a document that names a place in a bucket is a document that will be read
  // back by every client that opens this board - so the one field of an image that this module does not
  // invent is the one field it refuses to take on trust.
  if (!ASSET_KEY_PATTERN.test(assetKey)) {
    return false;
  }
  const objects = objectsOf(doc);
  const waiting = imageObject(objects, id);
  if (waiting === null || alreadySays(waiting, 'assetKey', assetKey, 'status', 'ready')) {
    return false;
  }

  let written = false;
  doc.transact(() => {
    // Re-read inside the transaction: an id is not a promise that the object is still there, and undo or
    // somebody else's Remove can have taken it in the time since the upload started - which is however
    // long a ten megabyte file takes to cross a network.
    const object = imageObject(objects, id);
    if (object === null || alreadySays(object, 'assetKey', assetKey, 'status', 'ready')) {
      return;
    }
    object.set('assetKey', assetKey);
    object.set('status', 'ready');
    written = true;
  }, UPLOAD_ORIGIN);
  return written;
}

/**
 * The upload did not work.
 *
 * `failed`, which the uploader is offered a Retry against and everybody else is told "Upload failed"
 * about. The bytes may or may not be in the bucket - a 500 on a slow connection may well have landed - and
 * it does not matter: the object names no key, so nothing is fetched either way, and a retry writes a new
 * key for the new upload.
 *
 * @returns `false` when there is no image with that id any more.
 */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (!isWaitingForBytes(imageObject(objects, id))) {
    return false;
  }

  let written = false;
  doc.transact(() => {
    const object = imageObject(objects, id);
    if (!isWaitingForBytes(object)) {
      return;
    }
    object!.set('status', 'failed');
    written = true;
  }, UPLOAD_ORIGIN);
  return written;
}

/**
 * Try that upload again: back to `uploading`, with a clock that started now.
 *
 * The clock is the point. A failed image from an upload that started an hour ago, marked `uploading`
 * again without a new timestamp, would be read by {@link displayStatus} as five minutes stale on the first
 * tick and would say "Image upload didn't finish" over the top of an upload that had just begun - to
 * everybody, including the person watching their own progress bar.
 *
 * @returns `false` for an id that is gone, and for an image that is not waiting for bytes - `ready` needs
 * no retry, and a second upload of one already in flight would be two answers about one object.
 */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const objects = objectsOf(doc);
  if (!isFailed(imageObject(objects, id))) {
    return false;
  }

  let written = false;
  doc.transact(() => {
    const object = imageObject(objects, id);
    if (!isFailed(object)) {
      return;
    }
    object!.set('status', 'uploading');
    object!.set('uploadStartedAt', now);
    // The key stays null. A retry is a second attempt at getting bytes into the bucket, and whatever the
    // first one left behind is not referred to by anything - which is the same as not existing, and is why
    // a bucket can be written to without ever having to be corrected.
    written = true;
  }, UPLOAD_ORIGIN);
  return written;
}

/** The object is an image that is waiting for bytes, and nothing else. */
function isWaitingForBytes(object: YObject | null): boolean {
  return object !== null && object.get('status') === 'uploading';
}

/** The object is an image whose upload was told had failed. */
function isFailed(object: YObject | null): boolean {
  return object !== null && object.get('status') === 'failed';
}

/** Nothing would be written by this call, because the document already says exactly that. */
function alreadySays(
  object: YObject,
  first: string,
  firstValue: unknown,
  second: string,
  secondValue: unknown,
): boolean {
  return object.get(first) === firstValue && object.get(second) === secondValue;
}

/**
 * What to show for this image, right now.
 *
 * The stored status has three values and the screen has four, and the missing one is the interesting
 * part. An upload that never finishes leaves no marker: the tab was closed, the laptop lid was shut, the
 * phone was locked, and the object sits `uploading` forever while everybody waits for a picture that is
 * never coming. Waiting is the wrong answer, and so is saying "failed" - the upload may still be running
 * somewhere, and a person who is told failed may delete the one object that was about to get its bytes.
 * So the fourth state is *read*, not written: an upload older than {@link IMAGE_UPLOAD_STALE_MS} is
 * "unfinished", by every client at once, from the timestamp the placeholder already carried. Nobody sends
 * a timeout message, because nobody has to: the clock does it, and it says the same thing to everybody.
 *
 * The comparison is strict, so that the boundary is the number in the config and not one tick off it: at
 * exactly five minutes the upload is still not overdue, and one millisecond past it, it is.
 *
 * `ready` and `failed` answer for themselves - the clock is not consulted, because a `ready` image from an
 * upload that started yesterday is a picture, not a stale one.
 */
export function displayStatus(image: ImageSnapshot, now: number): DisplayStatus {
  switch (image.status) {
    case 'ready':
    case 'failed':
      // A fact about the upload, and the clock has nothing to add to it: a picture that arrived is a
      // picture, and one that was refused is still refused however long ago it was refused.
      return image.status;
    case 'uploading':
      return now - image.uploadStartedAt > IMAGE_UPLOAD_STALE_MS ? 'unfinished' : 'uploading';
  }
}

/**
 * Narrow a board object to the image it is, with every field the renderer needs filled in.
 *
 * The board model keeps an image's fields optional, so that a client which knows nothing about images can
 * still read a board that has them on it; this is where a client that *does* know says what a missing
 * field means. A natural size that never arrived is not a picture at any size, so those two are the one
 * thing that can make this return `null` - everything else has a fallback that draws something honest.
 */
export function asImageSnapshot(object: ObjectSnapshot): ImageSnapshot | null {
  if (object.type !== IMAGE_TYPE) {
    return null;
  }
  // The one field this module cannot invent: an image with no ratio is not a picture drawn slightly
  // wrong, it is a box with no shape at all, and there is no default that would be honest about it.
  const naturalWidth = object.naturalWidth;
  const naturalHeight = object.naturalHeight;
  if (naturalWidth === undefined || naturalHeight === undefined) {
    return null;
  }

  const assetKey = object.assetKey ?? null;
  // A status that is missing or unreadable - which means a document written before this story, or by a
  // client that is not this one - is read from the only evidence there is: an object that names bytes is
  // treated as having them, and one that names none is treated as still waiting. Guessing "uploading" for
  // both would leave a board full of pictures saying "Uploading…" at people forever.
  const status: ImageUploadStatus = isImageUploadStatus(object.status)
    ? object.status
    : assetKey === null
      ? 'uploading'
      : 'ready';
  const uploaderId = object.uploaderId ?? object.createdBy;

  return {
    ...object,
    type: IMAGE_TYPE,
    assetKey,
    // What the bytes were found to be is not something the object can know if the field went missing, and
    // nothing draws anything with it: the browser asks the serving route, and the serving route knows.
    contentType: object.contentType ?? 'application/octet-stream',
    naturalWidth,
    naturalHeight,
    status,
    // The next best thing to an upload's start time is the moment the object was made, which for a
    // placeholder is the same instant. With neither, the wait is measured from the beginning of the clock,
    // and "Image upload didn't finish" is the honest answer about a thing nobody can date.
    uploadStartedAt: object.uploadStartedAt ?? object.createdAt ?? 0,
    ...(uploaderId === undefined || uploaderId === '' ? {} : { uploaderId }),
  };
}

/** Every image on the board, in the order the board holds them. */
export function imageSnapshots(doc: Y.Doc): ImageSnapshot[] {
  const images: ImageSnapshot[] = [];
  for (const object of snapshot(doc)) {
    const image = asImageSnapshot(object);
    if (image !== null) {
      images.push(image);
    }
  }
  return images;
}

/** What the registry declares as the smallest an image may be resized, in board units. */
export const IMAGE_MIN_SIZE = IMAGE_MIN_SIZE_WORLD;
