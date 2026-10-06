/**
 * Image object model unit tests (TC-03 to TC-07) against a real Y.Doc and a real
 * `Y.UndoManager`.
 *
 * Four things are asserted here that nothing else in the story can assert:
 *
 *  - an image is sized from its own pixels and never enlarged, with the longest side capped at
 *    `IMAGE_MAX_PLACE_SIZE_WORLD` in both directions and in both orientations;
 *  - `layoutRow` is the one place the "side by side with a gap" rule lives, for a drop anchored at
 *    its top-left and for a paste or pick anchored at the centre of the view;
 *  - adding a batch is *one* undo step, while completing an upload is *not* one - which is the
 *    difference between `LOCAL_ORIGIN` and `UPLOAD_ORIGIN`, and the reason an undo stack of length
 *    1 is the interesting assertion rather than the document's contents;
 *  - a status write against an id that is gone says so and leaves no update behind.
 */
import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import {
  createSticky,
  deleteObjects,
  initDoc,
  LOCAL_ORIGIN,
  snapshot,
  type ImageSnapshot,
} from '../../src/shared/board-model';
import {
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  UPLOAD_ORIGIN,
} from '../../src/shared/objects/image';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import type { Size, Point, Rect } from '../../src/shared/geometry';

function board(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function imageOf(doc: Y.Doc, id: string): ImageSnapshot | undefined {
  return snapshot(doc).find((obj) => obj.id === id) as ImageSnapshot | undefined;
}

/** The update events this screen produced, with their origins, so "one transaction" is countable. */
function watchUpdates(doc: Y.Doc): { updates: unknown[] } {
  const seen: { updates: unknown[] } = { updates: [] };
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    seen.updates.push(origin);
  });
  return seen;
}

/** A history over the objects map that follows this screen's own writes only, as the app does. */
function historyOf(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager(doc.getMap<Y.Map<unknown>>('objects'), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: 0,
  });
}

const size = (width: number, height: number): Size => ({ width, height });

describe('image.placement_size: an image is placed at its own proportions', () => {
  test('TC-03 an image smaller than the limit keeps its natural size', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  test('TC-03 a landscape image is scaled so its longest side is the limit', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  test('TC-03 a portrait image is scaled the same way', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  test('TC-03 exactly at the limit is left alone', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
    expect(placementSize(IMAGE_MAX_PLACE_SIZE_WORLD, 400)).toEqual({
      width: IMAGE_MAX_PLACE_SIZE_WORLD,
      height: 400,
    });
  });

  test('a tiny image is never enlarged', () => {
    expect(placementSize(8, 4)).toEqual({ width: 8, height: 4 });
  });

  test('a size that is not a number places nothing', () => {
    expect(placementSize(Number.NaN, 300)).toBeNull();
    expect(placementSize(300, Number.POSITIVE_INFINITY)).toBeNull();
    expect(placementSize(0, 300)).toBeNull();
  });
});

describe('image.drop / image.pick: a row of images starts at the point and keeps a gap', () => {
  const sizes = [size(300, 200), size(400, 300), size(250, 250)];
  const point: Point = { x: 1000, y: 500 };

  test('TC-04 with the top-left anchor the first box starts at the point, tops aligned', () => {
    const rects = layoutRow(sizes, point, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 1000, y: 500, width: 300, height: 200 });
    expect(rects[1]).toEqual({
      x: 1000 + 300 + IMAGE_LAYOUT_GAP_WORLD,
      y: 500,
      width: 400,
      height: 300,
    });
    expect(rects[2]).toEqual({
      x: 1000 + 300 + IMAGE_LAYOUT_GAP_WORLD + 400 + IMAGE_LAYOUT_GAP_WORLD,
      y: 500,
      width: 250,
      height: 250,
    });
    for (const rect of rects) expect(rect.y).toBe(500);
  });

  test('TC-04 with the centre anchor the whole row is centred on the point', () => {
    const rects = layoutRow(sizes, point, 'centre');
    const totalWidth = 300 + 400 + 250 + 2 * IMAGE_LAYOUT_GAP_WORLD;
    const totalHeight = 300; // the tallest box sets the row's height
    expect(rects[0]!.x).toBeCloseTo(point.x - totalWidth / 2, 6);
    // tops are still aligned, and the row as a whole is vertically centred
    for (const rect of rects) expect(rect.y).toBeCloseTo(point.y - totalHeight / 2, 6);
  });

  test('one image, anchored at its centre, is centred on the point', () => {
    expect(layoutRow([size(200, 100)], point, 'centre')).toEqual([
      { x: point.x - 100, y: point.y - 50, width: 200, height: 100 },
    ]);
  });

  test('a size that is not a number is skipped rather than poisoning the row', () => {
    const rects = layoutRow([size(100, 100), size(Number.NaN, 50), size(50, 50)], point, 'top-left');
    expect(rects).toHaveLength(2);
    expect(rects[1]!.x).toBe(1000 + 100 + IMAGE_LAYOUT_GAP_WORLD);
  });

  test('no sizes lay out nothing', () => {
    expect(layoutRow([], point, 'top-left')).toEqual([]);
  });
});

describe('image.uploading: a batch is created in one step, and finishing is not another', () => {
  const uploader = 'identity-leo';
  const startedAt = 1_700_000_000_000;

  function items(...sizes: Size[]) {
    let x = 0;
    return sizes.map(({ width, height }) => {
      const rect: Rect = { x, y: 0, width, height };
      x += width + IMAGE_LAYOUT_GAP_WORLD;
      return { rect, naturalWidth: width, naturalHeight: height, contentType: 'image/png' };
    });
  }

  test('TC-05 three placeholders, in one update, each already its final size', () => {
    const doc = board();
    const updates = watchUpdates(doc);
    const ids = createImagePlaceholders(doc, items(size(300, 200), size(400, 300), size(250, 250)), uploader, startedAt);

    expect(ids).toHaveLength(3);
    // one transaction for the whole add action
    expect(updates.updates).toEqual([LOCAL_ORIGIN]);

    const objects = snapshot(doc);
    expect(objects).toHaveLength(3);
    for (const id of ids) {
      const image = imageOf(doc, id)!;
      expect(image.type).toBe('image');
      expect(image.status).toBe('uploading');
      expect(image.uploaderId).toBe(uploader);
      expect(image.uploadStartedAt).toBe(startedAt);
      expect(image.assetKey).toBeNull();
    }
    // the boxes came from the layout untouched
    expect(imageOf(doc, ids[1]!)).toMatchObject({ x: 324, width: 400, height: 300 });
    // and they stack in the order they were added
    const zs = ids.map((id) => imageOf(doc, id)!.z);
    expect([...zs].sort((a, b) => a - b)).toEqual(zs);
  });

  test('TC-05 markImageReady carries the asset key and is its own transaction with an untracked origin', () => {
    const doc = board();
    const ids = createImagePlaceholders(doc, items(size(100, 100), size(200, 200)), uploader, startedAt);
    const updates = watchUpdates(doc);

    expect(markImageReady(doc, ids[0]!, 'boardid1234567890ab/cdn1234567890abcdefghij')).toBe(true);
    expect(updates.updates).toEqual([UPLOAD_ORIGIN]);

    const ready = imageOf(doc, ids[0]!)!;
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe('boardid1234567890ab/cdn1234567890abcdefghij');
    // the other placeholder is still uploading
    expect(imageOf(doc, ids[1]!)!.status).toBe('uploading');
  });

  test('TC-05 undo removes the whole batch in one step, and completing an upload is not a step', () => {
    const doc = board();
    const manager = historyOf(doc);
    const ids = createImagePlaceholders(doc, items(size(100, 100), size(120, 120), size(140, 140)), uploader, startedAt);
    markImageReady(doc, ids[1]!, 'boardid1234567890ab/cdn1234567890abcdefghij');

    // the undo step is the *add action*: one entry, whatever the uploads did afterwards
    expect(manager.undoStack.length).toBe(1);

    expect(manager.undo()).toBeTruthy();
    expect(snapshot(doc).length).toBe(0);

    // redo brings the batch back; the undone step is the insertion, not a completion
    expect(manager.redo()).toBeTruthy();
    expect(snapshot(doc).length).toBe(3);
    manager.destroy();
  });

  test('an image insertion is one step alongside the other object types', () => {
    const doc = board();
    const manager = historyOf(doc);
    createSticky(doc, { x: 0, y: 0 });
    manager.stopCapturing();
    createImagePlaceholders(doc, items(size(100, 100)), uploader, startedAt);
    expect(manager.undoStack.length).toBe(2);
    manager.undo();
    expect(snapshot(doc).map((obj) => obj.type)).toEqual(['sticky']);
    manager.destroy();
  });

  test('a batch with a size that is not a number skips that item', () => {
    const doc = board();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
      {
        rect: { x: 200, y: 0, width: Number.NaN, height: 100 },
        naturalWidth: 100,
        naturalHeight: 100,
        contentType: 'image/png',
      },
    ];
    const ids = createImagePlaceholders(doc, items, uploader, startedAt);
    expect(ids).toHaveLength(1);
    expect(snapshot(doc)).toHaveLength(1);
  });

  test('an empty batch writes nothing at all', () => {
    const doc = board();
    const updates = watchUpdates(doc);
    expect(createImagePlaceholders(doc, [], uploader, startedAt)).toEqual([]);
    expect(updates.updates).toEqual([]);
  });
});

describe('image.unfinished: an upload that never came back is called what it is', () => {
  const snap = (over: Partial<ImageSnapshot>): ImageSnapshot =>
    ({
      id: 'img',
      type: 'image',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      z: 1,
      createdAt: 0,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 100,
      naturalHeight: 100,
      status: 'uploading',
      uploadStartedAt: 1000,
      uploaderId: 'me',
      ...over,
    }) as ImageSnapshot;

  test('TC-06 an upload that has not been going for five minutes is still uploading', () => {
    const image = snap({});
    // "more than 5 minutes": the moment the fifth minute ends is still counted as uploading
    expect(displayStatus(image, 1000 + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    expect(displayStatus(image, 1000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(image, 1000)).toBe('uploading');
  });

  test('TC-06 one millisecond past it is unfinished', () => {
    const image = snap({});
    expect(displayStatus(image, 1000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(displayStatus(image, 1000 + IMAGE_UPLOAD_STALE_MS * 3)).toBe('unfinished');
  });

  test('TC-06 a failed or ready image is never called unfinished', () => {
    expect(displayStatus(snap({ status: 'failed' }), 10_000_000_000)).toBe('failed');
    expect(
      displayStatus(snap({ status: 'ready', assetKey: 'boardid1234567890ab/cdn1234567890abcdefghij' }), 10_000_000_000),
    ).toBe('ready');
  });

  test('a status this build does not understand is not drawn as a live upload', () => {
    // a document from a later story, or a half-written record: the upload cannot have succeeded,
    // so it is the failed state that offers a way out rather than a permanent "Uploading…"
    expect(displayStatus(snap({ status: 'nonsense' as ImageSnapshot['status'] }), 2000)).toBe('failed');
  });
});

describe('status writes against an id that has gone away', () => {
  /** One placeholder on a fresh board, and the doc it lives on. */
  function oneImage(doc: Y.Doc): string[] {
    return createImagePlaceholders(
      doc,
      [
        {
          rect: { x: 0, y: 0, width: 100, height: 100 },
          naturalWidth: 100,
          naturalHeight: 100,
          contentType: 'image/png',
        },
      ],
      'me',
      5000,
    );
  }

  test('TC-07 markImageReady on a deleted id is false and writes no update', () => {
    const doc = board();
    const [id] = oneImage(doc);
    deleteObjects(doc, [id!]);
    const updates = watchUpdates(doc);
    expect(markImageReady(doc, id!, 'boardid1234567890ab/cdn1234567890abcdefghij')).toBe(false);
    expect(updates.updates).toEqual([]);
  });

  test('TC-07 markImageFailed and markImageRetrying likewise', () => {
    const doc = board();
    const [id] = oneImage(doc);
    deleteObjects(doc, [id!]);
    const updates = watchUpdates(doc);
    expect(markImageFailed(doc, id!)).toBe(false);
    expect(markImageRetrying(doc, id!, 6000)).toBe(false);
    expect(markImageReady(doc, 'never-existed', 'boardid1234567890ab/cdn1234567890abcdefghij')).toBe(false);
    expect(updates.updates).toEqual([]);
  });

  test('a status write against another object type is refused', () => {
    const doc = board();
    const note = createSticky(doc, { x: 0, y: 0 });
    expect(markImageFailed(doc, note)).toBe(false);
    expect(markImageReady(doc, note, 'boardid1234567890ab/cdn1234567890abcdefghij')).toBe(false);
  });

  test('retry puts the image back to uploading with a fresh clock and its own origin', () => {
    const doc = board();
    const [id] = oneImage(doc);
    markImageFailed(doc, id!);
    expect(imageOf(doc, id!)!.status).toBe('failed');
    const updates = watchUpdates(doc);
    expect(markImageRetrying(doc, id!, 9000)).toBe(true);
    expect(updates.updates).toEqual([UPLOAD_ORIGIN]);
    expect(imageOf(doc, id!)!).toMatchObject({ status: 'uploading', uploadStartedAt: 9000 });
  });
});
