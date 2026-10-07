/**
 * The image object model (`tests/unit/image-model.test.ts`).
 *
 * TC-03 to TC-07 of story 12: how big an added image is, where a batch of them is
 * put, what an "uploading" object carries, and what happens to the undo history when
 * the upload finishes. They are unit tests on a **real `Y.Doc` with a real
 * `Y.UndoManager`**, because the interesting claims are not arithmetic:
 *
 * - *"one add is one undo step"* is a claim about Yjs transactions and tracked
 *   origins, and it can only be shown with a real `UndoManager` - a mock would let
 *   any implementation pass.
 * - *"the upload finishing is not an undo step"* is the same claim in the negative,
 *   and it is why `UPLOAD_ORIGIN` exists at all: an update that arrives two seconds
 *   later, on the other side of whatever else the person did, must not be something
 *   Ctrl+Z can take back on its own.
 *
 * The fake clock is explicit (`now` is an argument) so `IMAGE_UPLOAD_STALE_MS` can be
 * tested at ±1 ms without waiting five minutes for it (TC-06).
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  deleteObjects,
  objectBounds,
  objectSnapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model.js';
import {
  createImagePlaceholders,
  displayStatus,
  imageSnapshots,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  UPLOAD_ORIGIN,
  type ImageSnap,
} from '../../src/shared/objects/image.js';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config.js';
import { assetKeyFor } from '../../src/shared/image-format.js';
import { newBoardId } from '../../src/shared/board-id.js';

const GAP = IMAGE_LAYOUT_GAP_WORLD;
const MAX = IMAGE_MAX_PLACE_SIZE_WORLD;

/** An asset key of the shape the Worker returns. */
const keyFor = (): string => assetKeyFor(newBoardId(), newBoardId());

/** One item of an add action, in the shape `createImagePlaceholders` takes. */
const item = (
  width = 200,
  height = 100,
  over: Partial<{ naturalWidth: number; naturalHeight: number; contentType: string }> = {},
) => ({
  rect: { x: 0, y: 0, width, height },
  naturalWidth: over.naturalWidth ?? width,
  naturalHeight: over.naturalHeight ?? height,
  contentType: over.contentType ?? 'image/png',
});

describe('placementSize (TC-03)', () => {
  it('leaves an image smaller than the limit exactly as big as it is', () => {
    // One natural pixel is one board unit; nothing is enlarged.
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(16, 9)).toEqual({ width: 16, height: 9 });
    expect(placementSize(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it('scales a landscape image down so its longest side is the limit, keeping proportions', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(4032, 3024)).toEqual({ width: 800, height: 600 });
  });

  it('scales a portrait image by the same rule, on the side that is too long', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('stops exactly at the limit and does not shrink an image that is already at it', () => {
    expect(placementSize(MAX, MAX)).toEqual({ width: MAX, height: MAX });
    expect(placementSize(MAX, 1)).toEqual({ width: MAX, height: 1 });
    expect(placementSize(MAX + 1, MAX + 1)).toEqual({ width: MAX, height: MAX });
    expect(Math.max(...Object.values(placementSize(900, 1000)))).toBe(MAX);
  });

  it('keeps the ratio it was given, within a rounding', () => {
    for (const [width, height] of [[1600, 1200], [300, 3200], [4032, 3024], [1234, 5678]] as const) {
      const placed = placementSize(width, height);
      const before = width / height;
      const after = placed.width / placed.height;
      expect(Math.abs(before - after) / before).toBeLessThan(0.001);
    }
  });

  it('has no size to give an image that has no size, and says so with nothing', () => {
    // A decoder that reported 0 x 0 (or NaN) did not measure anything; inventing a
    // size for it would put a placeholder on the board for a picture nobody saw.
    expect(placementSize(0, 100)).toEqual({ width: 0, height: 0 });
    expect(placementSize(100, Number.NaN)).toEqual({ width: 0, height: 0 });
    expect(placementSize(Number.POSITIVE_INFINITY, 10)).toEqual({ width: 0, height: 0 });
  });
});

describe('layoutRow (TC-04)', () => {
  const sizes = [
    { width: 200, height: 100 },
    { width: 100, height: 300 },
    { width: 400, height: 200 },
  ];

  it('drops the first image at the point and lays the rest to its right, gap by gap', () => {
    const rects = layoutRow(sizes, { x: 10, y: 20 }, 'top-left');
    expect(rects).toHaveLength(3);
    // Tops aligned on the drop point: a row, not a staircase.
    expect(rects.map((rect) => rect.y)).toEqual([20, 20, 20]);
    expect(rects.map((rect) => rect.x)).toEqual([10, 10 + 200 + GAP, 10 + 200 + GAP + 100 + GAP]);
    expect(rects.map((rect) => rect.width)).toEqual([200, 100, 400]);
    expect(rects.map((rect) => rect.height)).toEqual([100, 300, 200]);
    // The gap between neighbours is exactly the setting, whatever the sizes were.
    expect(rects[1].x - (rects[0].x + rects[0].width)).toBe(GAP);
    expect(rects[2].x - (rects[1].x + rects[1].width)).toBe(GAP);
  });

  it('centres the whole row on the point for a pick and a paste', () => {
    const point = { x: 640, y: 400 };
    const rects = layoutRow(sizes, point, 'centre');
    const total = 200 + 100 + 400 + GAP * 2;
    expect(rects[0].x).toBe(point.x - total / 2);
    // The tallest image sets the height of the row, and the row is centred on it.
    const tallest = 300;
    expect(rects.every((rect) => rect.y === point.y - tallest / 2)).toBe(true);
    expect(rects[2].x + rects[2].width).toBe(point.x + total / 2);
  });

  it('places a single image without a gap in front of it', () => {
    expect(layoutRow([{ width: 50, height: 40 }], { x: 7, y: 9 }, 'top-left')).toEqual([
      { x: 7, y: 9, width: 50, height: 40 },
    ]);
    expect(layoutRow([], { x: 7, y: 9 }, 'top-left')).toEqual([]);
  });
});

describe('createImagePlaceholders, markImageReady and undo (TC-05)', () => {
  const NOW = 1_700_000_000_000;

  /** A document with an undo history that tracks this tab and nothing else. */
  const withHistory = (): { doc: Y.Doc; objects: Y.Map<Y.Map<unknown>>; undo: Y.UndoManager } => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const undo = new Y.UndoManager(objects, { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    return { doc, objects, undo };
  };

  it('writes every image of one add as uploading, in one update, and that is one undo step', () => {
    const { doc, undo } = withHistory();
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    const items = [item(400, 300), item(200, 600), item(800, 100)].map((one, index) => ({
      ...one,
      rect: { x: index * 300, y: 0, width: 400 - index * 100, height: 300 + index * 100 },
    }));
    const ids = createImagePlaceholders(doc, items, 'tab-1', NOW);

    expect(ids).toHaveLength(3);
    // One transaction for the whole action: one update event, not one per image.
    expect(updates).toBe(1);

    const images = imageSnapshots(doc);
    expect(images).toHaveLength(3);
    for (const image of images) {
      expect(image.status).toBe('uploading');
      expect(image.assetKey).toBeNull();
      expect(image.uploaderId).toBe('tab-1');
      expect(image.uploadStartedAt).toBe(NOW);
      expect(image.contentType).toBe('image/png');
    }
    // The positions are the ones the layout gave: an image is created where it will
    // stay, not moved there when the upload finishes.
    expect(images.map((image) => image.width)).toEqual([400, 300, 200]);
    expect(images.map((image) => image.height)).toEqual([300, 400, 500]);
    // Stacked above whatever was there, in the order they were added.
    expect(images.map((image) => image.z)).toEqual([1, 2, 3]);

    // ...then one of them finishes.
    const key = keyFor();
    expect(markImageReady(doc, ids[1] as string, key)).toBe(true);
    const after = imageSnapshots(doc).find((image) => image.id === ids[1]) as ImageSnap;
    expect(after.status).toBe('ready');
    expect(after.assetKey).toBe(key);
    expect(after.contentType).toBe('image/png');

    // ...and that is not an undo step: the whole add is still one thing to undo.
    expect(undo.undoStack.length).toBe(1);
    expect(undo.redoStack.length).toBe(0);
    undo.undo();
    expect(imageSnapshots(doc)).toHaveLength(0);
    expect(undo.undoStack.length).toBe(0);
    expect(undo.redoStack.length).toBe(1);
  });

  it('undoes and redoes the add as one step, and leaves an untracked status update alone', () => {
    const { doc, undo } = withHistory();
    const ids = createImagePlaceholders(doc, [item(300, 200), item(500, 400)], 'tab-1', NOW);
    markImageReady(doc, ids[0] as string, keyFor());
    // Something else this tab did, so the history has two separate things in it. The
    // `stopCapturing` is what the board's `undo.boundary()` calls: Yjs merges tracked
    // transactions that arrive less than `captureTimeout` apart, which is right for a
    // burst of typing and wrong for two separate actions - so "one add is one step" is
    // only true because the application closes the capture window between adds.
    undo.stopCapturing();
    createImagePlaceholders(doc, [item(100, 100)], 'tab-1', NOW + 1000);

    expect(imageSnapshots(doc)).toHaveLength(3);
    undo.undo();
    expect(imageSnapshots(doc)).toHaveLength(2);
    undo.undo();
    expect(imageSnapshots(doc)).toHaveLength(0);
    undo.redo();
    // Redoing the add brings back the images; the ready one is a fact about an upload
    // that happened inside a step that is being put back, so the board comes back
    // whole rather than as a placeholder that will never be filled.
    const back = imageSnapshots(doc);
    expect(back).toHaveLength(2);
    expect(back.map((image) => image.status).sort()).toEqual(['ready', 'uploading']);
    expect(back.every((image) => image.type === 'image')).toBe(true);
  });

  it('skips an image whose size was never measured, and adds the one that was', () => {
    const { doc, undo } = withHistory();
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    const ids = createImagePlaceholders(
      doc,
      [item(100, 100, { naturalWidth: 0, naturalHeight: 0 }), item(200, 100)],
      'tab-1',
      NOW,
    );
    // The image with no measured size is skipped; the one that was measured is added.
    expect(ids).toHaveLength(1);
    expect(updates).toBe(1);
    expect(imageSnapshots(doc)[0]?.naturalWidth).toBe(200);
    expect(undo.undoStack.length).toBe(1);
  });

  it('gives every image its own id and puts it in the document that everything else reads', () => {
    const doc = new Y.Doc();
    const ids = createImagePlaceholders(doc, [item(100, 80), item(120, 90)], 'tab-1', NOW);
    expect(new Set(ids).size).toBe(2);
    // The generic snapshot the room, the marquee and the selection all read.
    const objects = objectSnapshot(doc);
    expect(objects.map((object) => object.type)).toEqual(['image', 'image']);
    expect(objectBounds(objects[0] as (typeof objects)[number])).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
  });
});

describe('displayStatus (TC-06)', () => {
  const START = 1_700_000_000_000;
  const image = (over: Partial<ImageSnap> = {}): ImageSnap => ({
    id: 'image-1',
    type: 'image',
    x: 0,
    y: 0,
    z: 1,
    createdAt: START,
    width: 400,
    height: 300,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 400,
    naturalHeight: 300,
    status: 'uploading',
    uploadStartedAt: START,
    uploaderId: 'tab-1',
    ...over,
  });

  it('calls an upload that started a moment ago uploading, and one nobody is finishing unfinished', () => {
    // The boundary, to the millisecond: within the window it is still "Uploading…".
    expect(displayStatus(image(), START + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(image(), START + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    // Past it, the tab that held the file is gone and no update is coming.
    expect(displayStatus(image(), START + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(displayStatus(image(), START + IMAGE_UPLOAD_STALE_MS * 2)).toBe('unfinished');
  });

  it('says what a finished upload is, whatever the clock says', () => {
    const late = START + IMAGE_UPLOAD_STALE_MS * 3;
    expect(displayStatus(image({ status: 'ready', assetKey: keyFor() }), late)).toBe('ready');
    expect(displayStatus(image({ status: 'failed' }), late)).toBe('failed');
    // A 'ready' with nothing to show is not ready: there is no file at the address,
    // so the person is told it did not finish instead of being shown a broken image.
    expect(displayStatus(image({ status: 'ready' }), START)).toBe('unfinished');
  });

  it('does not invent a status it was not given', () => {
    expect(displayStatus(image({ status: 'nonsense' as ImageSnap['status'] }), START)).toBe('failed');
    expect(displayStatus(image({ uploadStartedAt: Number.NaN }), START)).toBe('failed');
  });
});

describe('status updates on ids that are gone (TC-07)', () => {
  const NOW = 1_700_000_000_000;

  /** A document, one image in it, and a way to count the updates it is asked to make. */
  const oneImage = (): { doc: Y.Doc; id: string; updates: () => number } => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    const [id] = createImagePlaceholders(doc, [item(300, 200)], 'tab-1', NOW);
    // The creation itself is one update; anything after it is counted from there.
    const created = updates;
    return { doc, id: id as string, updates: () => updates - created };
  };

  it('refuses to mark a deleted image ready, and writes nothing while trying', () => {
    const { doc, id, updates } = oneImage();
    expect(deleteObjects(doc, [id])).toBe(1);
    const before = updates();
    expect(markImageReady(doc, id, keyFor())).toBe(false);
    // "no update": a stale id must not put a transaction on the wire to other people
    // or into this tab's history.
    expect(updates()).toBe(before);
    expect(imageSnapshots(doc)).toHaveLength(0);
  });

  it('refuses to mark a deleted image failed or retrying', () => {
    const { doc, id, updates } = oneImage();
    deleteObjects(doc, [id]);
    const before = updates();
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, NOW + 5)).toBe(false);
    expect(updates()).toBe(before);
  });

  it('refuses an id that was never an image, and one that never existed at all', () => {
    const doc = new Y.Doc();
    expect(markImageReady(doc, 'no-such-object', keyFor())).toBe(false);
    expect(markImageFailed(doc, 'no-such-object')).toBe(false);
    expect(markImageRetrying(doc, 'no-such-object', NOW)).toBe(false);
    // A note is not an image, and a status update must not be able to write into one.
    const docWithNote = new Y.Doc();
    const objects = docWithNote.getMap<Y.Map<unknown>>('objects');
    const map = new Y.Map<unknown>();
    map.set('type', 'sticky');
    map.set('x', 0);
    map.set('y', 0);
    map.set('z', 1);
    objects.set('a-note', map);
    expect(markImageReady(docWithNote, 'a-note', keyFor())).toBe(false);
    expect(map.get('assetKey')).toBeUndefined();
  });

  it('marks an image failed and then retrying, keeping the add itself one undo step', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const undo = new Y.UndoManager(objects, { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    const [id] = createImagePlaceholders(doc, [item(300, 200)], 'tab-1', NOW);
    expect(markImageFailed(doc, id as string)).toBe(true);
    expect(imageSnapshots(doc)[0]?.status).toBe('failed');
    expect(imageSnapshots(doc)[0]?.assetKey).toBeNull();

    const later = NOW + 4_000;
    expect(markImageRetrying(doc, id as string, later)).toBe(true);
    const retrying = imageSnapshots(doc)[0] as ImageSnap;
    expect(retrying.status).toBe('uploading');
    expect(retrying.uploadStartedAt).toBe(later);
    // The clock is reset, so the new attempt gets its own five minutes.
    expect(displayStatus(retrying, later + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');

    // None of it is an undo step: only the add is.
    expect(undo.undoStack.length).toBe(1);
    undo.undo();
    expect(imageSnapshots(doc)).toHaveLength(0);
  });

  it('puts its updates behind an origin the undo history does not track', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const undo = new Y.UndoManager(objects, { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    const [id] = createImagePlaceholders(doc, [item(300, 200)], 'tab-1', NOW);
    // What the upload's own origin is called does not matter; that it is not this
    // tab's writing origin does - it is the whole of "completion is not an undo step".
    expect(UPLOAD_ORIGIN).not.toBe(LOCAL_ORIGIN);
    expect(undo.trackedOrigins.has(UPLOAD_ORIGIN)).toBe(false);
    markImageReady(doc, id as string, keyFor());
    markImageFailed(doc, id as string);
    markImageRetrying(doc, id as string, NOW + 1);
    expect(undo.undoStack.length).toBe(1);
    // ...and the object is still there to be undone once.
    undo.undo();
    expect(objectSnapshot(doc)).toHaveLength(0);
  });

  it('sizes a placeholder from its natural pixels and never below the resize floor', () => {
    const doc = new Y.Doc();
    const ids = createImagePlaceholders(
      doc,
      [
        {
          rect: { x: 0, y: 0, width: 800, height: 600 },
          naturalWidth: 4032,
          naturalHeight: 3024,
          contentType: 'image/jpeg',
        },
        {
          rect: { x: 900, y: 0, width: IMAGE_MIN_SIZE_WORLD, height: 8 },
          naturalWidth: 2,
          naturalHeight: 1,
          contentType: 'image/png',
        },
      ],
      'tab-2',
      NOW,
    );
    const [big, small] = imageSnapshots(doc);
    expect(big?.width).toBe(800);
    expect(big?.height).toBe(600);
    expect(big?.naturalWidth).toBe(4032);
    expect(big?.contentType).toBe('image/jpeg');
    // The model stores the box it was handed: a 2-pixel-wide image is 8 units wide
    // because that is what the person dropped, and the floor belongs to the resize.
    expect(small?.width).toBe(IMAGE_MIN_SIZE_WORLD);
    expect(small?.height).toBe(8);
    expect(ids).toHaveLength(2);
  });
});
