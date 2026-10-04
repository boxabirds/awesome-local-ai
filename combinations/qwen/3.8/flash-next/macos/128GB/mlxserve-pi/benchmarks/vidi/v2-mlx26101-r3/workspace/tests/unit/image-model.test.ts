/**
 * Story 12, task 2 (TC-03 … TC-07): the image object model, against a real `Y.Doc`.
 *
 * The idiom is the one story 2, 9 and 11 established for a model test: the document is the thing under
 * test, so nothing about it is mocked, and every write is counted as well as checked - one `update` event
 * per change that happened, none for a change that was refused, because story 3 turns each one into sync
 * traffic and an origin that says who did it.
 *
 * The origin matters more here than anywhere else in this repository. An image is the first object whose
 * own state changes after it is created and *not* because a person did something: the upload finishing is
 * news, not an edit, and story 8's undo must not have a step for it. TC-05 is mostly about that - it is
 * the test that would notice an implementation that wrote statuses with {@link LOCAL_ORIGIN} and gave a
 * dropped batch of twenty images twenty-one undo steps.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import {
  IMAGE_TYPE,
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  createSticky,
  deleteObjects,
  initDoc,
  snapshot,
  type ImageSnapshot,
} from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { assetKeyFor } from '../../src/shared/image-format';
import {
  UPLOAD_ORIGIN,
  asImageSnapshot,
  createImagePlaceholders,
  displayStatus,
  imageSnapshots,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImagePlacement,
} from '../../src/shared/objects/image';

/** The moment the drop happened, in epoch ms. A fixed clock, because these tests compare against it. */
const NOW = 1_700_000_000_000;

interface Counted<T> {
  result: T;
  updates: number;
  origins: unknown[];
}

/** Run `run` while counting the doc's `update` events and the origins that caused them. */
function countUpdates<T>(doc: Y.Doc, run: () => T): Counted<T> {
  let updates = 0;
  const origins: unknown[] = [];
  const observer = (_update: Uint8Array, origin: unknown): void => {
    updates += 1;
    origins.push(origin);
  };
  doc.on('update', observer);
  try {
    return { result: run(), updates, origins };
  } finally {
    doc.off('update', observer);
  }
}

/** A document with nothing on it but a schema version. */
function board(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** A placement at `x`, of a picture this wide and tall. */
function placement(x: number, width = 400, height = 300): ImagePlacement {
  return {
    rect: { x, y: 100, width, height },
    naturalWidth: width,
    naturalHeight: height,
    contentType: 'image/png',
  };
}

/** The image with this id; throws when the board has no image of that name. */
function imageOf(doc: Y.Doc, id: string): ImageSnapshot {
  for (const object of snapshot(doc)) {
    if (object.id === id) {
      const image = asImageSnapshot(object);
      if (image === null) {
        throw new Error(`object ${id} is not an image the model can read`);
      }
      return image;
    }
  }
  throw new Error(`the board has no object ${id}`);
}

/** An asset key, of the kind the upload would have handed back. */
function key(): string {
  return assetKeyFor(newBoardId(), newBoardId());
}

/* --------------------------------------------------------------------------- TC-03 */

describe('placementSize', () => {
  it('leaves an image that already fits alone', () => {
    // A 400x300 screenshot is dropped at the size it was on the screen it came from: one pixel, one unit.
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('scales an image whose longest side is over the limit down to it', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('scales a portrait by the same rule, on its own long side', () => {
    // 3200 is the side that is too long, so the height lands on 800 and the width comes along with it.
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('leaves an image whose longest side is exactly the limit', () => {
    // The boundary: "more than 800" scales, "800" does not. Off by one here and every square image on the
    // board is silently half the size it should be.
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
    expect(IMAGE_MAX_PLACE_SIZE_WORLD).toBe(800);
  });

  it('scales the photograph a phone camera makes without asking', () => {
    // 4032x3024 is the fixture's size, and the reason this function exists: without it, one dropped
    // photograph is a board you have to pan for a minute to get off of.
    expect(placementSize(4032, 3024)).toEqual({ width: 800, height: 600 });
  });

  it('never enlarges an image to fill the limit', () => {
    // A 40x40 icon is a 40x40 icon. Enlarging to 800 would be a rule about the board winning over the
    // thing that was dropped, and a person who drops a stamp gets a poster.
    expect(placementSize(40, 40)).toEqual({ width: 40, height: 40 });
    expect(placementSize(1, 1)).toEqual({ width: 1, height: 1 });
    expect(placementSize(799, 1)).toEqual({ width: 799, height: 1 });
  });

  it('keeps the proportions of anything it scales', () => {
    // The promise, stated as arithmetic rather than as the four examples above: after scaling, the ratio
    // is the ratio it was, to within a floating point epsilon, and the long side is the limit.
    for (const [width, height] of (/** Sizes to scale, landscape and portrait. */ [
      [1600, 1200],
      [300, 3200],
      [4032, 3024],
      [1000, 750],
      [900, 4000],
      [2000, 500],
    ]) as ReadonlyArray<readonly [number, number]>) {
      const sized = placementSize(width, height);
      expect(sized.width / sized.height).toBeCloseTo(width / height, 8);
      expect(Math.max(sized.width, sized.height)).toBe(IMAGE_MAX_PLACE_SIZE_WORLD);
    }
  });

  it('does not round the scaled side away from the ratio', () => {
    // A size that does not divide evenly is the interesting case: rounding to whole board units would be a
    // ratio that is almost right, and an almost-right ratio is what a resize handle then multiplies.
    const sized = placementSize(1234, 4321);
    expect(sized.height).toBe(IMAGE_MAX_PLACE_SIZE_WORLD);
    expect(sized.width / sized.height).toBeCloseTo(1234 / 4321, 8);
    expect(Number.isInteger(sized.width)).toBe(false);
  });

  it('says nothing for a size that is not a picture', () => {
    // Zero, negative, infinite, NaN: all of them are "there is no such picture", and the answer the
    // caller can test for is a box with no size rather than a number that would have been drawn at.
    for (const [width, height] of (/** Nothing that could be a picture's size. */ [
      [0, 0],
      [0, 300],
      [-5, 10],
      [Number.POSITIVE_INFINITY, 10],
      [Number.NaN, 100],
      [100, Number.NaN],
    ]) as ReadonlyArray<readonly [number, number]>) {
      expect(placementSize(width, height)).toEqual({ width: 0, height: 0 });
    }
  });
});

/* --------------------------------------------------------------------------- TC-04 */

describe('layoutRow', () => {
  const three = [
    { width: 400, height: 300 },
    { width: 200, height: 200 },
    { width: 600, height: 400 },
  ];

  it('puts the first box at the drop point and the rest to the right of it', () => {
    const rects = layoutRow(three, { x: 100, y: 200 }, 'top-left');
    expect(rects[0]).toEqual({ x: 100, y: 200, width: 400, height: 300 });
    expect(rects[1]!.x).toBe(100 + 400 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2]!.x).toBe(rects[1]!.x + 200 + IMAGE_LAYOUT_GAP_WORLD);
  });

  it('separates them by exactly the gap, and aligns their tops', () => {
    const rects = layoutRow(three, { x: 0, y: 50 }, 'top-left');
    expect(rects[1]!.x - (rects[0]!.x + rects[0]!.width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2]!.x - (rects[1]!.x + rects[1]!.width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    expect(rects.map((rect) => rect.y)).toEqual([50, 50, 50]);
  });

  it('gives each box the size it was asked for', () => {
    // The row is about position; the sizes came from placementSize and are not touched on the way.
    const rects = layoutRow(three, { x: 0, y: 0 }, 'top-left');
    expect(rects.map((rect) => `${rect.width}x${rect.height}`)).toEqual(['400x300', '200x200', '600x400']);
  });

  it('centres the whole row on the point when there is no pointer to take a corner from', () => {
    // Paste and the Image tool have a view, not a drop point: the row's full width - three images and two
    // gaps - is balanced on the centre, so what appears is where the person was looking.
    const centre = { x: 1000, y: 500 };
    const rects = layoutRow(three, centre, 'centre');
    const rowWidth = 400 + 200 + 600 + 2 * IMAGE_LAYOUT_GAP_WORLD;
    expect(rects[0]!.x).toBe(centre.x - rowWidth / 2);
    expect(rects[2]!.x + rects[2]!.width).toBe(centre.x + rowWidth / 2);
  });

  it('centres the row on the tallest of them, not on the first', () => {
    const centre = { x: 0, y: 0 };
    const rects = layoutRow(three, centre, 'centre');
    const tallest = 400;
    expect(rects.map((rect) => rect.y)).toEqual([
      -tallest / 2,
      -tallest / 2,
      -tallest / 2,
    ]);
  });

  it('centres a single image on the point', () => {
    const rects = layoutRow([{ width: 800, height: 600 }], { x: 400, y: 300 }, 'centre');
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('lays out nothing for no images', () => {
    expect(layoutRow([], { x: 10, y: 20 }, 'top-left')).toEqual([]);
    expect(layoutRow([], { x: 10, y: 20 }, 'centre')).toEqual([]);
  });

  it('lays out twenty of them in one row that does not wrap', () => {
    // A twenty-image batch is a row twenty wide, not a grid: the person who drops twenty screenshots pans
    // out to see them, and a layout that wrapped would be this module deciding the shape of their window.
    const rects = layoutRow(Array.from({ length: 20 }, () => ({ width: 100, height: 100 })), { x: 0, y: 0 }, 'top-left');
    expect(rects).toHaveLength(20);
    expect(new Set(rects.map((rect) => rect.y)).size).toBe(1);
    expect(rects[19]!.x).toBe(19 * (100 + IMAGE_LAYOUT_GAP_WORLD));
  });
});

/* --------------------------------------------------------------------------- TC-05 */

describe('createImagePlaceholders', () => {
  it('writes the whole batch as one object each, waiting for bytes', () => {
    const doc = board();
    const ids = createImagePlaceholders(
      doc,
      layoutRow(
        [
          { width: 400, height: 300 },
          { width: 200, height: 200 },
          { width: 800, height: 600 },
        ],
        { x: 100, y: 100 },
        'top-left',
      ).map((rect) => placement(rect.x, rect.width, rect.height)),
      'someone',
      NOW,
    );

    expect(ids).toHaveLength(3);
    const objects = snapshot(doc);
    expect(objects).toHaveLength(3);
    for (const id of ids) {
      const image = imageOf(doc, id);
      expect(image.type).toBe(IMAGE_TYPE);
      // The picture is not there yet, and everything about the object says so: a place, a size, a natural
      // size, and no key to fetch anything by.
      expect(image.status).toBe('uploading');
      expect(image.assetKey).toBeNull();
      expect(image.uploadStartedAt).toBe(NOW);
      expect(image.uploaderId).toBe('someone');
      expect(image.contentType).toBe('image/png');
    }
    const first = imageOf(doc, ids[0]!);
    expect([first.x, first.y, first.width, first.height]).toEqual([100, 100, 400, 300]);
  });

  it('writes the batch in one transaction, from the local origin', () => {
    // One gesture, one update, one thing for the other end to receive. Three separate transactions would
    // sync the same three objects and be three steps on the undo stack - see the next test.
    const doc = board();
    const { result: ids, updates, origins } = countUpdates(doc, () =>
      createImagePlaceholders(doc, [placement(0), placement(424), placement(848)], 'someone', NOW),
    );
    expect(ids).toHaveLength(3);
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  it('is one undo step for twenty images', () => {
    // The PRD's rule, measured on the stack story 8 built rather than on our own count: drop twenty, undo
    // once, and the board is empty again. An implementation that transacted per image would leave nineteen
    // pictures behind, which is the kind of bug nobody notices until they have undone a drop and four
    // photographs refuse to come back.
    const doc = board();
    const undo = new Y.UndoManager(doc.getMap(OBJECTS_MAP), { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    createImagePlaceholders(
      doc,
      Array.from({ length: 20 }, (_unused, index) => placement(index * 100)),
      'someone',
      NOW,
    );
    expect(undo.undoStack).toHaveLength(1);
    undo.undo();
    expect(snapshot(doc)).toEqual([]);
    undo.redo();
    expect(imageSnapshots(doc)).toHaveLength(20);
  });

  it('stacks the new images above everything already on the board', () => {
    const doc = board();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const stickyZ = snapshot(doc).find((object) => object.id === sticky)!.z;
    const ids = createImagePlaceholders(doc, [placement(0), placement(424)], 'someone', NOW);
    const z = ids.map((id) => imageOf(doc, id).z);
    expect(z).toEqual([stickyZ + 1, stickyZ + 2]);
  });

  it('skips an item whose natural size is not a size, and creates the ones that are', () => {
    // Half a picture is not drawable at any size, but the other two files were dropped and are fine. The
    // alternative - refusing the batch because one decode went wrong - punishes the two good ones.
    const doc = board();
    const ids = createImagePlaceholders(doc, [
      placement(0),
      { ...placement(424), naturalWidth: Number.NaN },
      placement(848),
    ], 'someone', NOW);
    expect(ids).toHaveLength(2);
    expect(imageSnapshots(doc)).toHaveLength(2);
  });

  it('writes nothing for a batch of nothing', () => {
    // An empty add is not an event: no transaction means no update to sync and no empty step on the undo
    // stack for a person to trip over.
    const doc = board();
    const { result, updates } = countUpdates(doc, () => createImagePlaceholders(doc, [], 'someone', NOW));
    expect(result).toEqual([]);
    expect(updates).toBe(0);
  });
});

describe('markImageReady', () => {
  it('points one image at its bytes and leaves the others waiting', () => {
    const doc = board();
    const ids = createImagePlaceholders(doc, [placement(0), placement(424), placement(848)], 'someone', NOW);
    const assetKey = key();

    const { result, updates, origins } = countUpdates(doc, () => markImageReady(doc, ids[1]!, assetKey));

    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(origins).toEqual([UPLOAD_ORIGIN]);
    expect(imageOf(doc, ids[1]!).status).toBe('ready');
    expect(imageOf(doc, ids[1]!).assetKey).toBe(assetKey);
    expect(imageOf(doc, ids[0]!).status).toBe('uploading');
    expect(imageOf(doc, ids[2]!).assetKey).toBeNull();
  });

  it('is not an undo step', () => {
    // The whole reason UPLOAD_ORIGIN exists. The upload finishing is not something the person did, so it
    // must not be something they can undo - and, worse, must not merge with or extend the step that was
    // the drop. An UndoManager that tracked this origin would put a "network was quick" between the drop
    // and whatever came next.
    const doc = board();
    const undo = new Y.UndoManager(doc.getMap(OBJECTS_MAP), { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    const ids = createImagePlaceholders(doc, [placement(0)], 'someone', NOW);
    expect(undo.undoStack).toHaveLength(1);

    const { origins } = countUpdates(doc, () => markImageReady(doc, ids[0]!, key()));
    expect(origins).toEqual([UPLOAD_ORIGIN]);
    expect(undo.undoStack).toHaveLength(1);
    expect(undo.redoStack).toEqual([]);
  });

  it('goes back with the batch it came from, and comes back with it', () => {
    // What undoing a drop means when one picture had already arrived: the object goes, the key goes with
    // it, and redoing brings the object back holding the key it had been given - because the key is a fact
    // about the object, and undo is about the gesture, not about the file storage.
    const doc = board();
    const undo = new Y.UndoManager(doc.getMap(OBJECTS_MAP), { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    const ids = createImagePlaceholders(doc, [placement(0), placement(424)], 'someone', NOW);
    const assetKey = key();
    markImageReady(doc, ids[0]!, assetKey);

    undo.undo();
    expect(snapshot(doc)).toEqual([]);
    undo.redo();
    const images = imageSnapshots(doc);
    expect(images).toHaveLength(2);
    expect(images.find((image) => image.id === ids[0])?.status).toBe('ready');
    expect(images.find((image) => image.id === ids[0])?.assetKey).toBe(assetKey);
  });

  it('keeps the natural size and the box it was written with', () => {
    // The upload's answer says nothing about size: the object's geometry was decided at the drop, from the
    // decode, and a person who had already started resizing it must not have it jump back.
    const doc = board();
    const ids = createImagePlaceholders(doc, [{ ...placement(0, 1600, 1200), rect: { x: 10, y: 20, width: 800, height: 600 } }], 'someone', NOW);
    markImageReady(doc, ids[0]!, key());
    const image = imageOf(doc, ids[0]!);
    expect([image.naturalWidth, image.naturalHeight]).toEqual([1600, 1200]);
    expect([image.x, image.y, image.width, image.height]).toEqual([10, 20, 800, 600]);
  });
});

/* --------------------------------------------------------------------------- TC-06 */

describe('displayStatus', () => {
  /** One uploading image, on a board of its own. */
  function waiting(doc: Y.Doc = board()): { readonly id: string; readonly image: ImageSnapshot } {
    const id = createImagePlaceholders(doc, [placement(0)], 'someone', NOW)[0]!;
    return { id, image: imageOf(doc, id) };
  }

  it('says uploading right up to the boundary', () => {
    const { image } = waiting();
    expect(displayStatus(image, NOW)).toBe('uploading');
    expect(displayStatus(image, NOW + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
  });

  it('says unfinished one millisecond past it', () => {
    // The clock is the only thing that changes between these two lines, which is the point: nobody sends a
    // message about timeouts, so the read has to be the message. Five minutes is long enough that a person
    // who is still uploading has probably gone, and short enough that nobody has to wonder for long.
    const { image } = waiting();
    expect(displayStatus(image, NOW + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(IMAGE_UPLOAD_STALE_MS).toBe(5 * 60 * 1000);
  });

  it('says uploading at exactly five minutes, because the rule is "more than"', () => {
    // The PRD's wording is "has been uploading for more than 5 minutes", so the boundary belongs to
    // uploading and not to unfinished. Pinned rather than assumed, because `>=` would read the same and
    // look just as right.
    const { image } = waiting();
    expect(displayStatus(image, NOW + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
  });

  it('says failed whatever the clock says', () => {
    // A failure is a fact about the upload, not a wait: an image that failed an hour ago is "Upload
    // failed" with a Retry on it, not "didn't finish" with a Remove.
    const doc = board();
    const { id } = waiting(doc);
    markImageFailed(doc, id);
    const image = imageOf(doc, id);
    expect(image.status).toBe('failed');
    expect(displayStatus(image, NOW + IMAGE_UPLOAD_STALE_MS * 100)).toBe('failed');
  });

  it('says ready whatever the clock says', () => {
    const doc = board();
    const { id } = waiting(doc);
    markImageReady(doc, id, key());
    const image = imageOf(doc, id);
    expect(displayStatus(image, NOW + IMAGE_UPLOAD_STALE_MS * 100)).toBe('ready');
  });

  it('says unfinished for an upload nobody finished, on every client at once', () => {
    // The tab was closed mid-upload: the object stays `uploading` forever, and every client that looks at
    // it after five minutes reaches the same answer without a single byte having been written about it.
    // Two docs, one update apart, both read the same stale placeholder the same way.
    const uploader = board();
    const id = createImagePlaceholders(uploader, [placement(0)], 'someone', NOW)[0]!;
    const watcher = new Y.Doc();
    initDoc(watcher);
    Y.applyUpdate(watcher, Y.encodeStateAsUpdate(uploader));

    const later = NOW + IMAGE_UPLOAD_STALE_MS + 1;
    expect(displayStatus(imageOf(uploader, id), later)).toBe('unfinished');
    expect(displayStatus(imageOf(watcher, id), later)).toBe('unfinished');
    // …and it is still a placeholder rather than a broken picture: the key was never written, so there is
    // nothing to fail to load. What is shown is the sentence about it, which is image.unfinished.
    expect(imageOf(watcher, id).assetKey).toBeNull();
  });

  it('gives a retry a clock that starts again', () => {
    // The stale clock is why markImageRetrying exists as a separate write: an upload tried again an hour
    // later would be read as overdue on the next tick, and would say "didn't finish" over the top of the
    // progress bar of the person watching it.
    const doc = board();
    const { id } = waiting(doc);
    markImageFailed(doc, id);
    const retriedAt = NOW + IMAGE_UPLOAD_STALE_MS * 6;
    expect(markImageRetrying(doc, id, retriedAt)).toBe(true);

    const image = imageOf(doc, id);
    expect(image.status).toBe('uploading');
    expect(image.uploadStartedAt).toBe(retriedAt);
    expect(displayStatus(image, retriedAt + 1000)).toBe('uploading');
    expect(displayStatus(image, retriedAt + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });
});

/* --------------------------------------------------------------------------- TC-07 */

describe('the status writes refuse ids that are not waiting images', () => {
  it('says no to an image that has been deleted, and writes nothing', () => {
    const doc = board();
    const id = createImagePlaceholders(doc, [placement(0)], 'someone', NOW)[0]!;
    deleteObjects(doc, [id]);
    expect(doc.getMap(OBJECTS_MAP).get(id)).toBeUndefined();

    const { result, updates } = countUpdates(doc, () => markImageReady(doc, id, key()));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('says no to an id the board never had', () => {
    const doc = board();
    expect(markImageReady(doc, 'made-up-id', key())).toBe(false);
    expect(markImageFailed(doc, 'made-up-id')).toBe(false);
    expect(markImageRetrying(doc, 'made-up-id', NOW)).toBe(false);
    expect(snapshot(doc)).toEqual([]);
  });

  it('says no to an object that is not an image', () => {
    // An upload completing against an id that has since become a sticky note - undo put the note back and
    // the ids crossed, or a bug elsewhere - must not write image fields onto it. The board would then draw
    // a note that claims to be a picture waiting for bytes.
    const doc = board();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    expect(markImageReady(doc, sticky, key())).toBe(false);
    expect(markImageFailed(doc, sticky)).toBe(false);
    expect(markImageRetrying(doc, sticky, NOW)).toBe(false);
    expect(snapshot(doc)[0]!.type).toBe('sticky');
  });

  it('writes nothing when the answer is already what it would have written', () => {
    // A retried upload whose response arrives twice, a client that re-sends after a reconnect: the second
    // one has nothing to say, and an update that says nothing is sync traffic and an undo-stack
    // interaction for no change.
    const doc = board();
    const id = createImagePlaceholders(doc, [placement(0)], 'someone', NOW)[0]!;
    const assetKey = key();
    expect(markImageReady(doc, id, assetKey)).toBe(true);

    const { result, updates } = countUpdates(doc, () => markImageReady(doc, id, assetKey));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('says no to a key that is not an asset key', () => {
    // The upload's answer is not trusted: a key that does not look like `<board>/<asset>` names nothing the
    // bucket has and nothing the serving route would answer, so writing it would be an image that is
    // `ready`, shows "Image unavailable" forever, and cannot be retried because nothing thinks it failed.
    const doc = board();
    const id = createImagePlaceholders(doc, [placement(0)], 'someone', NOW)[0]!;
    const badKeys = ['', '../etc/passwd', newBoardId(), `${newBoardId()}/${newBoardId()}/extra`, 'not a key'];

    const { updates } = countUpdates(doc, () => {
      for (const bad of badKeys) {
        expect(markImageReady(doc, id, bad)).toBe(false);
      }
    });
    expect(updates).toBe(0);
    expect(imageOf(doc, id).status).toBe('uploading');
    expect(imageOf(doc, id).assetKey).toBeNull();
  });

  it('will not fail an image that is already showing, or retry one that is uploading', () => {
    // Both are the same mistake seen from either end of a race: two answers about one upload. The first one
    // to arrive wins and the other writes nothing, so the board never flickers from ready to failed and
    // back while somebody is looking at the picture.
    const doc = board();
    const id = createImagePlaceholders(doc, [placement(0)], 'someone', NOW)[0]!;
    markImageReady(doc, id, key());
    expect(countUpdates(doc, () => markImageFailed(doc, id)).updates).toBe(0);
    expect(imageOf(doc, id).status).toBe('ready');

    const other = createImagePlaceholders(doc, [placement(424)], 'someone', NOW)[0]!;
    expect(markImageRetrying(doc, other, NOW + 1000)).toBe(false);
    expect(imageOf(doc, other).uploadStartedAt).toBe(NOW);
  });

  it('will not write a box that is not a box', () => {
    // A placeholder's size comes from a decode; a caller that hands over NaN or a negative width is a bug
    // upstream, and the answer is no object at all rather than an object nothing can draw or select.
    const doc = board();
    const ids = createImagePlaceholders(
      doc,
      [
        { ...placement(0), rect: { x: Number.NaN, y: 0, width: 100, height: 100 } },
        { ...placement(0), rect: { x: 0, y: 0, width: -100, height: 100 } },
        { ...placement(0), rect: { x: 0, y: 0, width: 0, height: 100 } },
      ],
      'someone',
      NOW,
    );
    expect(ids).toEqual([]);
    expect(snapshot(doc)).toEqual([]);
  });

  it('keeps the smallest image the board allows drawable', () => {
    // A 1x1 GIF is a real thing people drop, and it is drawn at 1x1 - the minimum applies to resizing, not
    // to being dropped, or the board would be full of squares nobody dropped.
    const doc = board();
    const id = createImagePlaceholders(doc, [{ ...placement(0, 1, 1), rect: { x: 0, y: 0, width: 1, height: 1 } }], 'someone', NOW)[0]!;
    const image = imageOf(doc, id);
    expect([image.width, image.height]).toEqual([1, 1]);
    expect(IMAGE_MIN_SIZE_WORLD).toBe(16);
  });
});


/* ------------------------------------------------------------------- an older document */

describe('an image written by a client that says less than this one does', () => {
  /** A raw image object, with only the fields an older client would have written. */
  function raw(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
    const object = new Y.Map<unknown>();
    object.set('type', IMAGE_TYPE);
    object.set('x', 0);
    object.set('y', 0);
    object.set('width', 400);
    object.set('height', 300);
    object.set('z', 1);
    object.set('naturalWidth', 400);
    object.set('naturalHeight', 300);
    for (const [field, value] of Object.entries(fields)) {
      object.set(field, value);
    }
    doc.getMap(OBJECTS_MAP).set(id, object);
  }

  it('treats an image that names bytes as one it has', () => {
    // A board saved by a client that stored no `status` field: the object names a place the bytes are, and
    // the only sane reading is that the picture is there. Inferring "uploading" instead would be a board
    // of photographs telling everybody to wait for something that already arrived.
    const doc = board();
    const assetKey = key();
    raw(doc, 'old', { assetKey });
    const image = asImageSnapshot(snapshot(doc).find((object) => object.id === 'old')!);
    expect(image?.status).toBe('ready');
    expect(image?.assetKey).toBe(assetKey);
  });

  it('treats an image that names no bytes as still waiting for them', () => {
    const doc = board();
    raw(doc, 'old', {});
    const image = asImageSnapshot(snapshot(doc).find((object) => object.id === 'old')!);
    expect(image?.status).toBe('uploading');
    expect(image?.assetKey).toBeNull();
  });

  it('measures an upload it cannot date from the beginning of time, and says so', () => {
    // No `uploadStartedAt`, no `createdAt`: there is no way to know when this upload started, and the
    // answer that keeps pretending it is going to finish is the worse one. `0` is the date the document
    // gives, and five minutes past 1970 is a wait that has certainly gone past the boundary.
    const doc = board();
    raw(doc, 'old', {});
    const image = asImageSnapshot(snapshot(doc).find((object) => object.id === 'old')!)!;
    expect(image.uploadStartedAt).toBe(0);
    expect(displayStatus(image, NOW)).toBe('unfinished');
  });

  it('refuses to read an image with no ratio rather than draw one at a guess', () => {
    const doc = board();
    raw(doc, 'old', { naturalWidth: undefined });
    (doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get('old') as Y.Map<unknown>).delete('naturalWidth');
    expect(snapshot(doc).find((object) => object.id === 'old')).toBeUndefined();
    expect(imageSnapshots(doc)).toEqual([]);
  });
});
