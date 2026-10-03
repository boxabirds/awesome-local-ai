// image.model unit tests (story 12, TC-03 to TC-07).
//
// The arithmetic of putting a picture on a board: how big it is placed, where a row of them goes,
// and what happens to the shared document when they are written and when the upload answers.
//
// Two things here are worth the ceremony they cost:
//
//   * One add is one undo step (image.model, TC-05). Nine images dropped at once must not need nine
//     presses of Cmd-Z, so the whole batch goes into ONE transaction, which the UndoManager sees as
//     one stack item and story 3 sends as one update.
//   * "The upload finished" is not an action anyone can undo (image.upload_failure). The status write
//     carries an origin the undo history does not track, so the undo stack keeps exactly one step for
//     one add and undoing that add can never resurrect a placeholder whose bytes were already stored.
//
// Everything runs against a real Y.Doc and a real Y.UndoManager: these are statements about
// transactions and stack lengths, and a fake of either would be testing the fake.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  objectSnapshots,
  deleteObjects,
} from '../../src/shared/board-model';
import {
  UPLOAD_ORIGIN,
  createImagePlaceholders,
  displayStatus,
  imageFromMap,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  readImage,
  type ImageSnap,
  type Placement,
} from '../../src/shared/objects/image';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
  UNDO_CAPTURE_TIMEOUT_MS,
} from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';
import { assetKeyFor, isAssetKey } from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';

const UPLOADER = 'a-person';

/** Images of these natural sizes, laid out from `at`, ready for createImagePlaceholders. */
function placementsFor(
  sizes: ReadonlyArray<{ width: number; height: number }>,
  at: Point = { x: 0, y: 0 },
  anchor: 'top-left' | 'centre' = 'top-left',
): Placement[] {
  return layoutRow(sizes, at, anchor).map((rect, i) => ({
    rect,
    naturalWidth: sizes[i].width,
    naturalHeight: sizes[i].height,
    contentType: 'image/png',
  }));
}

function images(doc: Y.Doc): ImageSnap[] {
  return objectSnapshots(doc).filter(
    (snap): snap is ImageSnap => snap.type === 'image',
  );
}

function managerOf(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager(doc.getMap<Y.Map<unknown>>('objects'), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: UNDO_CAPTURE_TIMEOUT_MS,
  });
}

/** Record every update the doc emits, with its origin, for the "one update" assertions. */
function recordUpdates(doc: Y.Doc): Array<{ length: number; origin: unknown }> {
  const seen: Array<{ length: number; origin: unknown }> = [];
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    seen.push({ length: update.length, origin });
  });
  return seen;
}

describe('placementSize (TC-03)', () => {
  it('places a picture smaller than the cap at exactly its own size', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(100, 100)).toEqual({ width: 100, height: 100 });
  });

  it('never enlarges a picture that is exactly as big as the cap', () => {
    expect(placementSize(800, 800)).toEqual({
      width: IMAGE_MAX_PLACE_SIZE_WORLD,
      height: IMAGE_MAX_PLACE_SIZE_WORLD,
    });
    expect(placementSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('brings a big picture down to the cap and takes the other side with it', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    // Portrait, so the cap applies to the height and the width is the one that moves.
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    // A phone photo: 4032 x 3024 is 4:3, and 800 x 600 is still 4:3.
    expect(placementSize(4032, 3024)).toEqual({ width: 800, height: 600 });
  });

  it('keeps the ratio, both ways round, at every size above the cap', () => {
    for (const [naturalWidth, naturalHeight] of [
      [1440, 900],
      [1000, 400],
      [3024, 4032],
      [2000, 1999],
      [1, 4000],
    ]) {
      const placed = placementSize(naturalWidth, naturalHeight);
      const longest = Math.max(placed.width, placed.height);
      expect(longest).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
      if (longest === IMAGE_MAX_PLACE_SIZE_WORLD) {
        const before = naturalWidth / naturalHeight;
        const after = placed.width / placed.height;
        // Within a tenth of a percent: the sides are board units, the ratio is a real number.
        expect(Math.abs(after - before) / before).toBeLessThan(0.001);
      }
      expect(placed.width).toBeGreaterThan(0);
      expect(placed.height).toBeGreaterThan(0);
    }
  });
});

describe('layoutRow (TC-04)', () => {
  const at: Point = { x: 1000, y: 500 };
  const sizes = [
    { width: 100, height: 100 },
    { width: 100, height: 100 },
    { width: 100, height: 100 },
  ];

  it('puts three images in a row, tops aligned, the gap between each', () => {
    const rects = layoutRow(sizes, at, 'top-left');
    expect(rects.map((r) => r.x)).toEqual([1000, 1124, 1248]);
    expect(rects.map((r) => r.y)).toEqual([500, 500, 500]);
    expect(rects.map((r) => r.width)).toEqual([100, 100, 100]);
  });

  it('advances by each image’s own width plus the gap, so sizes differ honestly', () => {
    const rects = layoutRow(
      [{ width: 800, height: 500 }, { width: 100, height: 100 }, { width: 400, height: 300 }],
      at,
      'top-left',
    );
    expect(rects.map((r) => r.x)).toEqual([
      1000,
      1000 + 800 + IMAGE_LAYOUT_GAP_WORLD,
      1000 + 800 + IMAGE_LAYOUT_GAP_WORLD + 100 + IMAGE_LAYOUT_GAP_WORLD,
    ]);
    // The first is where the drop happened, so the picture lands under the pointer.
    expect(rects[0]).toEqual({ x: 1000, y: 500, width: 800, height: 500 });
  });

  it('centres the row on the point for a paste, and still leaves the gap', () => {
    const rects = layoutRow(sizes, at, 'centre');
    const rowWidth = 3 * 100 + 2 * IMAGE_LAYOUT_GAP_WORLD;
    expect(rects[0].x).toBe(at.x - rowWidth / 2);
    expect(rects[2].x + rects[2].width).toBeCloseTo(at.x + rowWidth / 2, 6);
    // Centred on the tallest of them, not on the first.
    const tall = layoutRow(
      [{ width: 10, height: 10 }, { width: 10, height: 100 }],
      at,
      'centre',
    );
    expect(tall[1].y).toBe(at.y - 50);
    expect(tall[0].y).toBe(at.y - 50);
  });

  it('handles one image and none at all', () => {
    expect(layoutRow([{ width: 50, height: 50 }], at, 'top-left')).toEqual([
      { x: 1000, y: 500, width: 50, height: 50 },
    ]);
    expect(layoutRow([], at, 'centre')).toEqual([]);
  });
});

describe('createImagePlaceholders + markImageReady (TC-05)', () => {
  it('writes the whole batch as one update, in one undo step, and marks it ready in none', () => {
    const doc = new Y.Doc();
    const updates = recordUpdates(doc);
    const undoManager = managerOf(doc);

    const ids = createImagePlaceholders(
      doc,
      placementsFor([{ width: 100, height: 100 }, { width: 200, height: 100 }, { width: 100, height: 80 }]),
      UPLOADER,
      1_700_000_000_000,
    );

    expect(ids).toHaveLength(3);
    // One drop is one update on the wire and one step in the history.
    expect(updates).toHaveLength(1);
    expect(updates[0].origin).toBe(LOCAL_ORIGIN);
    expect(undoManager.undoStack).toHaveLength(1);

    const placed = images(doc);
    expect(placed).toHaveLength(3);
    expect(placed.every((img) => img.status === 'uploading')).toBe(true);
    expect(placed.every((img) => img.assetKey === null)).toBe(true);
    expect(placed.every((img) => img.uploaderId === UPLOADER)).toBe(true);
    expect(placed.map((img) => img.z)).toEqual([...placed.map((img) => img.z)].sort((a, b) => a - b));
    expect(placed.map((img) => img.x)).toEqual([0, 124, 348]);
    expect(placed.map((img) => img.width)).toEqual([100, 200, 100]);
    expect(placed.map((img) => img.uploadStartedAt)).toEqual([1_700_000_000_000, 1_700_000_000_000, 1_700_000_000_000]);

    updates.length = 0;
    const key = assetKeyFor(newBoardId(), newBoardId());
    expect(markImageReady(doc, ids[1], key)).toBe(true);

    // The answer arrives as its own update — story 3 has to carry it to everyone else — but it is
    // not a step a person can undo, and the stack still holds exactly the one add.
    expect(updates).toHaveLength(1);
    expect(updates[0].origin).toBe(UPLOAD_ORIGIN);
    expect(undoManager.undoStack).toHaveLength(1);

    const ready = images(doc);
    expect(ready.find((img) => img.id === ids[1])?.status).toBe('ready');
    expect(ready.find((img) => img.id === ids[1])?.assetKey).toBe(key);
    expect(ready.filter((img) => img.status === 'uploading')).toHaveLength(2);

    // One undo takes all three away, and one redo brings them back with the answer it had.
    expect(undoManager.undo()).toBeTruthy();
    expect(images(doc)).toHaveLength(0);
    expect(undoManager.redo()).toBeTruthy();
    const restored = images(doc);
    expect(restored).toHaveLength(3);
    expect(restored.find((img) => img.id === ids[1])?.status).toBe('ready');
    undoManager.destroy();
  });

  it('places the batch on top of whatever is already on the board', () => {
    const doc = new Y.Doc();
    Y.transact(
      doc,
      () => {
        const obj = new Y.Map<unknown>();
        obj.set('type', 'sticky');
        obj.set('x', 0);
        obj.set('y', 0);
        obj.set('z', 41);
        obj.set('createdAt', 1);
        doc.getMap<Y.Map<unknown>>('objects').set('note', obj);
      },
      LOCAL_ORIGIN,
    );

    createImagePlaceholders(doc, placementsFor([{ width: 10, height: 10 }]), UPLOADER, 5);
    const [img] = images(doc);
    expect(img.z).toBeGreaterThan(41);
  });

  it('skips an item whose numbers are not numbers and writes the rest (partial batch)', () => {
    const doc = new Y.Doc();
    const updates = recordUpdates(doc);
    const good = placementsFor([{ width: 100, height: 100 }])[0];
    const broken: Placement[] = [
      { rect: { x: Number.NaN, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100 },
      { rect: { x: 0, y: 0, width: 0, height: 100 } as Rect, naturalWidth: 100, naturalHeight: 100 },
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100 },
      good,
    ];

    const ids = createImagePlaceholders(doc, broken, UPLOADER, 1);
    // Two of the four are unusable: one is at NaN, one has no width to draw.
    expect(ids).toHaveLength(2);
    expect(images(doc)).toHaveLength(2);
    expect(images(doc).every((img) => Number.isFinite(img.x) && img.width > 0)).toBe(true);
    // A usable neighbour is not held hostage by it, and all of it is still one transaction.
    expect(updates).toHaveLength(1);

    // A batch that is nothing but bad numbers writes nothing at all.
    updates.length = 0;
    const none = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 }, naturalWidth: 1, naturalHeight: 1 }],
      UPLOADER,
      1,
    );
    expect(none).toEqual([]);
    expect(updates).toHaveLength(0);
  });

  it('marks failed and retrying, and retry restarts the stale clock', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(
      doc,
      placementsFor([{ width: 100, height: 100 }]),
      UPLOADER,
      1000,
    );

    expect(markImageFailed(doc, id)).toBe(true);
    expect(readImage(doc, id)?.status).toBe('failed');
    expect(displayStatus(readImage(doc, id) as ImageSnap, 10_000)).toBe('failed');

    expect(markImageRetrying(doc, id, 9000)).toBe(true);
    const retrying = readImage(doc, id) as ImageSnap;
    expect(retrying.status).toBe('uploading');
    expect(retrying.uploadStartedAt).toBe(9000);
    // Five minutes from the retry, not from the attempt that gave up.
    expect(displayStatus(retrying, 9000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(retrying, 9000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('is readable from the raw map, and only as an image', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(
      doc,
      placementsFor([{ width: 100, height: 100 }]),
      UPLOADER,
      7,
    );
    const map = doc.getMap<Y.Map<unknown>>('objects').get(id) as Y.Map<unknown>;
    expect(imageFromMap(id, map)).toMatchObject({ id, type: 'image', status: 'uploading' });
    expect(imageFromMap('nope', new Y.Map())).toBeUndefined();
  });
});

describe('displayStatus (TC-06)', () => {
  const START = 1_700_000_000_000;

  function uploading(status: ImageSnap['status'] = 'uploading'): ImageSnap {
    return {
      id: 'img',
      type: 'image',
      x: 0,
      y: 0,
      z: 1,
      createdAt: START,
      width: 100,
      height: 100,
      naturalWidth: 100,
      naturalHeight: 100,
      assetKey: status === 'ready' ? assetKeyFor(newBoardId(), newBoardId()) : null,
      contentType: 'image/png',
      status,
      uploadStartedAt: START,
      uploaderId: UPLOADER,
      createdBy: UPLOADER,
    };
  }

  it('calls an upload that never answered unfinished, one millisecond at a time', () => {
    const img = uploading();
    expect(displayStatus(img, START)).toBe('uploading');
    expect(displayStatus(img, START + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(img, START + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    // The clock says it, for everyone looking: it is not stored, so it cannot disagree.
    expect(img.status).toBe('uploading');
  });

  it('leaves a failed and a ready image as they are, however long ago they happened', () => {
    expect(displayStatus(uploading('failed'), START + IMAGE_UPLOAD_STALE_MS * 10)).toBe('failed');
    expect(displayStatus(uploading('ready'), START + IMAGE_UPLOAD_STALE_MS * 10)).toBe('ready');
  });

  it('does not invent an unfinished image out of a broken clock', () => {
    expect(displayStatus(uploading(), Number.NaN)).toBe('uploading');
  });
});

describe('a stale id (TC-07)', () => {
  it('writes nothing when the image is gone, and so sends nothing', () => {
    const doc = new Y.Doc();
    const ids = createImagePlaceholders(
      doc,
      placementsFor([{ width: 100, height: 100 }, { width: 100, height: 100 }]),
      UPLOADER,
      1,
    );
    // The uploader removed one while its upload was in flight (image.delete_while_uploading).
    deleteObjects(doc, [ids[0]]);
    const updates = recordUpdates(doc);

    const key = assetKeyFor(newBoardId(), newBoardId());
    expect(isAssetKey(key)).toBe(true);
    expect(markImageReady(doc, ids[0], key)).toBe(false);
    expect(markImageFailed(doc, ids[0])).toBe(false);
    expect(markImageRetrying(doc, ids[0], 2)).toBe(false);
    // No update, so nothing to sync and nothing for anyone else to see appear and vanish.
    expect(updates).toHaveLength(0);
    expect(images(doc).map((img) => img.id)).toEqual([ids[1]]);

    // Nor is a placeholder written over an object that was never an image.
    expect(markImageReady(doc, 'never-existed', key)).toBe(false);
    const survivor = doc.getMap<Y.Map<unknown>>('objects').get(ids[1]) as Y.Map<unknown>;
    survivor.set('type', 'sticky');
    expect(markImageReady(doc, ids[1], key)).toBe(false);
    expect(markImageFailed(doc, ids[1])).toBe(false);
    survivor.set('type', 'image');
    expect(markImageReady(doc, ids[1], key)).toBe(true);
  });
});
