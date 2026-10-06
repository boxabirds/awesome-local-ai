/**
 * The picture's life inside the document (story 12, TC-03 … TC-07).
 *
 * This suite is about the two ideas the whole story stands on, and both of them are about time rather
 * than space.
 *
 * The first is that **an image arrives in halves**: a size and a position now, bytes later. Everything in
 * `src/shared/objects/image.ts` follows from that — a placeholder that is drawn at the size the picture
 * will turn out to be (`placementSize`, so the board does not jump when the bytes land), a status that
 * says what the upload is doing, and a timestamp that eventually stops being believable
 * (`displayStatus`, which is a question about a clock and so is tested at its boundary rather than near
 * it). The second is that **an upload is not something a person did**, which is what
 * {@link UPLOAD_ORIGIN} exists to keep true, and which this suite measures the only way it can be
 * measured: by counting the transactions the document sees, and by pressing undo.
 *
 * As in the other model suites, `doc.on('update')` is the instrument. "One undo step" is a statement
 * about one transaction, and an update event is the only outward sign a transaction has.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { initDoc, LOCAL_ORIGIN, OBJECTS_MAP, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import { assetKeyFor } from '../../src/shared/image-format';
import { createUndo } from '../../src/client/board/undo';
import {
  createImagePlaceholders,
  displayStatus,
  isImageSnapshot,
  isImageStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  UPLOAD_ORIGIN,
  type ImagePlacement,
  type ImageSnap,
} from '../../src/shared/objects/image';

/** Every upload in these tests belongs to this person. */
const UPLOADER = 'Anna';

/** A board with nothing on it. */
const board = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

/** The count of transactions the document has seen, each one a number in the list it grows. */
const updates = (doc: Y.Doc): number[] => {
  const counts: number[] = [];
  let count = 0;
  doc.on('update', () => {
    count += 1;
    counts.push(count);
  });
  return counts;
};

/** The picture with this id, or the failure of the test that asked for it. */
const imageOf = (doc: Y.Doc, id: string | null): ImageSnap => {
  if (id === null) throw new Error('the picture was never created');
  const found = snapshot(doc).find((object) => object.id === id);
  if (!isImageSnapshot(found)) throw new Error(`picture ${id} is not on the board`);
  return found;
};

/** One picture to place, at a rect of the caller's choosing. */
const placement = (over: Partial<ImagePlacement> = {}): ImagePlacement => ({
  rect: { x: 0, y: 0, width: 800, height: 600 },
  naturalWidth: 1600,
  naturalHeight: 1200,
  contentType: 'image/png',
  ...over,
});

/** A row of `count` pictures of the same size, laid out the way a drop lays them out. */
const row = (doc: Y.Doc, count: number, now = 1_000): string[] =>
  createImagePlaceholders(
    doc,
    Array.from({ length: count }, () => placement()),
    UPLOADER,
    now,
  );

describe('a picture is placed at the size it will be drawn at (TC-03)', () => {
  it('scales a big screenshot down to the limit and keeps its proportion', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    // The PRD's own example: a 4032 × 3024 photograph becomes a board-sized one, four to three still.
    const photo = placementSize(4032, 3024);
    expect(Math.max(photo.width, photo.height)).toBe(IMAGE_MAX_PLACE_SIZE_WORLD);
    expect(photo.width / photo.height).toBeCloseTo(4032 / 3024, 6);
  });

  it('scales the longest side, whichever way the picture is turned', () => {
    // 300 × 3200 is a phone screenshot: the tall one is the same multiplication from the other side.
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(3200, 300)).toEqual({ width: 800, height: 75 });
  });

  it('never scales up, because a small icon blown to 800 units is not a bigger icon', () => {
    expect(placementSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(placementSize(40, 30)).toEqual({ width: 40, height: 30 });
    expect(placementSize(16, 16)).toEqual({ width: 16, height: 16 });
  });

  it('says nothing rather than something untrue about a picture it cannot measure', () => {
    // A decoder that gives back no dimensions is the failure mode of a file that is a picture according to
    // its name and not one according to its bytes. `createImagePlaceholders` reads 0 × 0 as "do not add
    // this", which is the honest answer; an infinity or a NaN would have been a board with an object on it
    // that nothing can draw, move or select.
    for (const size of [[0, 100], [100, 0], [0, 0], [-40, 30], [Number.NaN, 100], [100, Number.POSITIVE_INFINITY]]) {
      expect(placementSize(size[0] as number, size[1] as number)).toEqual({ width: 0, height: 0 });
    }
  });
});

describe('a batch is laid out in a row (TC-04)', () => {
  const sizes = [
    { width: 800, height: 600 },
    { width: 400, height: 400 },
    { width: 200, height: 300 },
  ];

  it('starts a dropped row at the point it was dropped on and runs it to the right', () => {
    const rects = layoutRow(sizes, { x: 100, y: 50 }, 'top-left');
    // "Here" means here: the first picture's top-left corner is where the cursor was, because a drop is
    // somebody pointing at a place.
    expect(rects[0]).toEqual({ x: 100, y: 50, width: 800, height: 600 });
    expect(rects[1]).toEqual({ x: 100 + 800 + IMAGE_LAYOUT_GAP_WORLD, y: 50, width: 400, height: 400 });
    expect(rects[2]?.x).toBe(100 + 800 + IMAGE_LAYOUT_GAP_WORLD + 400 + IMAGE_LAYOUT_GAP_WORLD);
    // Tops aligned: a row is a row because its top edge is one line.
    expect(rects.map((rect) => rect.y)).toEqual([50, 50, 50]);
  });

  it('centres a pasted row on the middle of what the person can see', () => {
    // A paste has no point of its own, so the board's visible middle is handed to it and the *row* is
    // centred on that — not each picture, which would have them all in one pile.
    const rects = layoutRow(sizes, { x: 1000, y: 500 }, 'centre');
    const rowWidth = 800 + 400 + 200 + IMAGE_LAYOUT_GAP_WORLD * 2;
    expect(rects[0]?.x).toBe(1000 - rowWidth / 2);
    expect(rects[2]?.x! + 200).toBe(1000 + rowWidth / 2);
    // Centred on the tallest picture, so a row of mixed heights sits on one line rather than above it.
    expect(rects[0]?.y).toBe(500 - 600 / 2);
    expect(rects.map((rect) => rect.y)).toEqual([200, 200, 200]);
  });

  it('puts a single picture in the middle when the row is asked to be centred', () => {
    const [only] = layoutRow([{ width: 800, height: 600 }], { x: 0, y: 0 }, 'centre');
    expect(only).toEqual({ x: -400, y: -300, width: 800, height: 600 });
  });

  it('places nothing when given nothing, and places what it was given unchanged otherwise', () => {
    expect(layoutRow([], { x: 0, y: 0 })).toEqual([]);
    // This function places; the question of whether a zero-sized picture belongs on a board is answered
    // one function further down, and answering it here would be two places deciding the same thing.
    expect(layoutRow([{ width: 0, height: 0 }], { x: 5, y: 5 })).toEqual([{ x: 5, y: 5, width: 0, height: 0 }]);
  });

  it('defaults to the drop anchor, because a drop is the gesture that has a point', () => {
    expect(layoutRow(sizes, { x: 7, y: 3 })).toEqual(layoutRow(sizes, { x: 7, y: 3 }, 'top-left'));
  });
});

describe('adding pictures is one action (TC-05)', () => {
  it('writes three placeholders in one transaction', () => {
    const doc = board();
    const seen = updates(doc);
    const before = seen.length;
    const ids = createImagePlaceholders(
      doc,
      [placement(), placement({ rect: { x: 900, y: 0, width: 400, height: 400 } }), placement({ rect: { x: 1400, y: 0, width: 200, height: 300 } })],
      UPLOADER,
      1_000,
    );
    expect(ids).toHaveLength(3);
    // Three objects, one transaction. The two writes this test can see are the board's own initialisation
    // and this batch; nothing else went through.
    expect(seen.length - before).toBe(1);
  });

  it('writes each placeholder with everything the upload will need', () => {
    const doc = board();
    const [id] = row(doc, 1, 1234);
    const image = imageOf(doc, id ?? null);
    expect(image.status).toBe('uploading');
    // There is no address to write yet, and `null` is what says so. An empty string would have been a
    // string, and a `/api/assets/` is a request somebody would eventually make.
    expect(image.assetKey).toBeNull();
    expect(image.uploaderId).toBe(UPLOADER);
    expect(image.uploadStartedAt).toBe(1234);
    expect(image.contentType).toBe('image/png');
    expect(image.naturalWidth).toBe(1600);
    expect(image.naturalHeight).toBe(1200);
    expect(image.type).toBe('image');
  });

  it('stacks a row so every picture in it is visible', () => {
    const doc = board();
    const ids = row(doc, 3);
    const z = ids.map((id) => imageOf(doc, id).z);
    expect(new Set(z).size).toBe(3);
    expect(z[1]! > z[0]!).toBe(true);
    expect(z[2]! > z[1]!).toBe(true);
    // A row that arrived in a stack would be a row of which one picture is visible.
    expect(z[2]! - z[0]!).toBe(2);
  });

  it('gives every picture in the batch the same start time', () => {
    // Not a detail: `displayStatus` compares against this number, and a batch written across a minute of
    // a slow machine would have gone stale one picture at a time.
    const doc = board();
    const ids = row(doc, 4, 5_000);
    expect(new Set(ids.map((id) => imageOf(doc, id).uploadStartedAt))).toEqual(new Set([5_000]));
  });

  it('takes one undo step for a batch of three, and that step removes all three', () => {
    const doc = board();
    const undo = createUndo(doc);
    const ids = row(doc, 3);
    expect(snapshot(doc)).toHaveLength(3);

    markImageReady(doc, ids[0] as string, assetKeyFor(newBoardId(), newBoardId()));
    // The picture arrived. Undo is still one press deep, because the arrival is not something anybody did.
    expect(undo.canUndo()).toBe(true);

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    // One step, and no half-state in which two of the three are left on the board — which is what three
    // separate steps would have meant, and what a person would have had to press their way out of.
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  it('skips a picture it cannot give a size to, and adds the rest', () => {
    const doc = board();
    const seen = updates(doc);
    const before = seen.length;
    const ids = createImagePlaceholders(
      doc,
      [placement(), placement({ rect: { x: 10, y: 10, width: 0, height: 600 }, naturalWidth: 0, naturalHeight: 0 })],
      UPLOADER,
      1,
    );
    // One id for two requests: the file whose decoder said nothing is not put on the board at all, because
    // an object with a zero in it is drawn nowhere, picked by nothing and stays there for ever.
    expect(ids).toHaveLength(1);
    expect(snapshot(doc)).toHaveLength(1);
    expect(seen.length - before).toBe(1);
  });

  it('writes nothing at all when the whole batch is unusable', () => {
    const doc = board();
    const seen = updates(doc);
    const before = seen.length;
    expect(createImagePlaceholders(doc, [placement({ rect: { x: 0, y: 0, width: Number.NaN, height: 600 } })], UPLOADER, 1)).toEqual([]);
    expect(seen.length).toBe(before);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('keeps a type it does not recognise out of the document', () => {
    // The boundary is crossed in one place, in one direction: a caller that handed in `text/html` would put
    // a board in a position to serve a document out of an `<img>`. This is where the string is stopped.
    const doc = board();
    const [id] = createImagePlaceholders(doc, [placement({ contentType: 'text/html' })], UPLOADER, 1);
    expect(imageOf(doc, id ?? null).contentType).toBe('image/png');
  });

  it('is a picture the snapshot can describe and another replica can read', () => {
    const doc = board();
    const [id] = row(doc, 1, 42);
    const replica = new Y.Doc();
    initDoc(replica);
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    const image = imageOf(replica, id ?? null);
    expect(image.status).toBe('uploading');
    expect(image.assetKey).toBeNull();
    expect(image.uploadStartedAt).toBe(42);
    // The smallest board on which a picture can be drawn is a size, not a size plus a promise: the object is
    // placed at its own size when it is small enough and must still be selectable when it is not.
    expect(IMAGE_MIN_SIZE_WORLD).toBeLessThan(IMAGE_MAX_PLACE_SIZE_WORLD);
  });
});

describe('an upload that stopped being believable says so (TC-06)', () => {
  /** A placeholder in the state a test is asking about. */
  const placeholder = (over: Partial<ImageSnap>): ImageSnap => ({
    id: 'x',
    type: 'image',
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    z: 1,
    createdAt: 0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 1600,
    naturalHeight: 1200,
    status: 'uploading',
    uploadStartedAt: 0,
    uploaderId: UPLOADER,
    ...over,
  });

  it('calls an upload in progress uploading, up to and including the moment it stops being believable', () => {
    const uploading = placeholder({});
    expect(displayStatus(uploading, 0)).toBe('uploading');
    expect(displayStatus(uploading, IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(uploading, IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    // One millisecond later, the sentence changes: the browser that knew how this upload was going has had
    // five minutes to answer and has not. Nobody is coming with the bytes.
    expect(displayStatus(uploading, IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(displayStatus(uploading, IMAGE_UPLOAD_STALE_MS * 10)).toBe('unfinished');
    expect(IMAGE_UPLOAD_STALE_MS).toBe(5 * 60 * 1000);
  });

  it('never calls a finished upload unfinished, and never calls a failed one anything else', () => {
    // The two states that already say how they ended: an upload that arrived has nothing left to wait for,
    // and one that failed has already said so. `unfinished` is only ever a stale `uploading`.
    expect(displayStatus(placeholder({ status: 'ready', assetKey: 'a/b' }), IMAGE_UPLOAD_STALE_MS * 100)).toBe('ready');
    expect(displayStatus(placeholder({ status: 'failed' }), IMAGE_UPLOAD_STALE_MS * 100)).toBe('failed');
  });

  it('is a state nobody wrote, which is the point', () => {
    // Nothing in the document says `unfinished`; there is no browser left that could have written it. A
    // person who joins this board tomorrow sees the same box the person who gave up sees today, and both
    // of them are shown a way to clear it.
    const doc = board();
    const [id] = row(doc, 1, 0);
    const image = imageOf(doc, id ?? null);
    expect(image.status).toBe('uploading');
    expect(displayStatus(image, 0)).toBe('uploading');
    expect(displayStatus(image, IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    // Reading it never changes it.
    expect(imageOf(doc, id ?? null).status).toBe('uploading');
  });
});

describe('an upload’s outcome is not something the person did (TC-07)', () => {
  it('marks a picture ready without adding an undo step', () => {
    const doc = board();
    const undo = createUndo(doc);
    const [id] = row(doc, 1)!;
    const key = assetKeyFor(newBoardId(), newBoardId());

    expect(markImageReady(doc, id as string, key)).toBe(true);
    const image = imageOf(doc, id as string);
    expect(image.status).toBe('ready');
    expect(image.assetKey).toBe(key);

    // The only step in the history is the adding. One press and the picture is gone — it does not take two,
    // the first of which un-writes an arrival nobody asked to un-write.
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  it('writes the outcome with an origin of its own, which is how it stays off the stack', () => {
    const doc = board();
    const seen = updates(doc);
    const origins: unknown[] = [];
    const history = new Y.UndoManager(doc.getMap(OBJECTS_MAP), { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });
    const [id] = row(doc, 1)!;
    const before = seen.length;
    // The write happens — the document is not told to forget it, and every other client must be told.
    markImageReady(doc, id as string, assetKeyFor(newBoardId(), newBoardId()));
    expect(seen.length).toBe(before + 1);
    // …and it carries the upload's origin, not the person's. That distinction is the whole of the previous
    // test: the undo manager watches one origin and this write is not made with it, so it is not a step.
    // `LOCAL_ORIGIN` and `UPLOAD_ORIGIN` are two different values, which is the one thing the undo manager
    // can tell about a transaction, and the only thing it cares about.
    const statusOrigin = origins[origins.length - 1];
    expect(statusOrigin).toBe(UPLOAD_ORIGIN);
    expect(statusOrigin).not.toBe(LOCAL_ORIGIN);
    // A history that has been watching since before either write holds one step: the adding.
    expect(history.undoStack).toHaveLength(1);
    history.destroy();
  });

  it('marks a picture failed and takes its address away with it', () => {
    const doc = board();
    const [id] = row(doc, 1)!;
    markImageReady(doc, id as string, assetKeyFor(newBoardId(), newBoardId()));
    expect(markImageFailed(doc, id as string)).toBe(true);
    const image = imageOf(doc, id as string);
    expect(image.status).toBe('failed');
    // A key belongs to a stored picture and a failed upload has none. Left in place, the next render would
    // draw a picture on the strength of an upload that did not happen.
    expect(image.assetKey).toBeNull();
  });

  it('starts a new upload with a clock that starts again', () => {
    const doc = board();
    const undo = createUndo(doc);
    const [id] = row(doc, 1, 0)!;
    markImageFailed(doc, id as string);

    // Six minutes old: the box says "unfinished" and the button next to it says Retry.
    expect(displayStatus(imageOf(doc, id as string), IMAGE_UPLOAD_STALE_MS * 2)).toBe('failed');
    markImageRetrying(doc, id as string, IMAGE_UPLOAD_STALE_MS * 3);
    const retrying = imageOf(doc, id as string);
    expect(retrying.status).toBe('uploading');
    expect(retrying.assetKey).toBeNull();
    // The new start time is the part that makes the button visibly do something: had it stayed at zero, the
    // next render would still have called it unfinished and the person would have pressed a button that
    // changed nothing they could see.
    expect(retrying.uploadStartedAt).toBe(IMAGE_UPLOAD_STALE_MS * 3);
    expect(displayStatus(retrying, IMAGE_UPLOAD_STALE_MS * 3 + 1000)).toBe('uploading');
    expect(undo.canUndo()).toBe(true);
    undo.undo();
    expect(snapshot(doc)).toHaveLength(0);
    undo.destroy();
  });

  it('says nothing happened when the picture is not there any more', () => {
    // A slow upload in front of a fast person: the file lands in the bucket and the placeholder has been
    // deleted underneath it. `false` is the whole of the answer, and no toast goes with it.
    const doc = board();
    const key = assetKeyFor(newBoardId(), newBoardId());
    expect(markImageReady(doc, 'missing', key)).toBe(false);
    expect(markImageFailed(doc, 'missing')).toBe(false);
    expect(markImageRetrying(doc, 'missing', 1)).toBe(false);

    // And a picture's id pointed at a sticky note is not a picture either: an upload that lands late has to
    // find the object it was promised, not whatever happens to be standing at that address.
    const other = board();
    other.getMap<Y.Map<unknown>>(OBJECTS_MAP).set('foreign', new Y.Map([['type', 'sticky']]));
    expect(markImageFailed(other, 'foreign')).toBe(false);
    expect(markImageReady(other, 'foreign', key)).toBe(false);
  });

  it('does not write twice for the same outcome', () => {
    // An upload that reports itself ready twice — a retry whose first attempt also landed, a response
    // replayed after a reconnect — is one change and not two, and the second one does not reach the
    // document at all.
    const doc = board();
    const [id] = row(doc, 1)!;
    const key = assetKeyFor(newBoardId(), newBoardId());
    expect(markImageReady(doc, id as string, key)).toBe(true);
    const seen = updates(doc);
    const before = seen.length;
    expect(markImageReady(doc, id as string, key)).toBe(false);
    expect(seen.length).toBe(before);
    expect(markImageFailed(doc, id as string)).toBe(true);
    expect(markImageFailed(doc, id as string)).toBe(false);
    expect(seen.length).toBe(before + 1);
  });

  it('knows which strings are statuses', () => {
    expect(isImageStatus('uploading')).toBe(true);
    expect(isImageStatus('ready')).toBe(true);
    expect(isImageStatus('failed')).toBe(true);
    expect(isImageStatus('unfinished')).toBe(false);
    expect(isImageStatus(null)).toBe(false);
  });
});
