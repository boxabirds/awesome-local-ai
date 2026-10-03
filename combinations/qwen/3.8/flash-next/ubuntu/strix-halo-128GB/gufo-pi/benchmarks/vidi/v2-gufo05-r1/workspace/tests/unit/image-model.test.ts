/**
 * The image object model (`image.model`, `image.placement_size`, `image.drop`, `image.layout`).
 *
 * These run against a real `Y.Doc` — and, for TC-05, against the real undo controller —
 * because the two things most worth pinning here are invisible in a pure function: one add
 * action has to be one transaction (so it is one undo step and one sync message), and the
 * status writes that follow it must *not* be steps of their own.
 *
 * TC-03 placement size: 1440×900 → 800×500, 300×200 unchanged, 300×3200 → 75×800
 * TC-04 a row of three at x = 100, 924, 1748, all one y; centred too
 * TC-05 placeholders in one transaction, one undo step, status and assetKey fields
 * TC-06 z above the existing top
 * TC-07 ready/failed/unfinished transitions, no enlargement, refusing nonsense
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  moveableIds,
  objectSnapshots,
  resizeObjects,
} from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import type { Size } from '../../src/shared/geometry';
import { createUndo } from '../../src/client/board/undo';
import {
  createImagePlaceholders,
  displayStatus,
  IMAGE_TYPE,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImageSnapshot,
} from '../../src/shared/objects/image';

/** A document with the board's containers created, as `BoardPage` would make one. */
function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** The single transaction a document sees, if the block ran in more or fewer. */
function transactionCount(doc: Y.Doc, run: () => void): number {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  doc.on('update', listener);
  try {
    run();
  } finally {
    doc.off('update', listener);
  }
  return count;
}

/** The images on the board, in creation order. */
function imagesOf(doc: Y.Doc): ImageSnapshot[] {
  return objectSnapshots(doc).filter((object) => object.type === IMAGE_TYPE) as ImageSnapshot[];
}

/** One placeholder, at a rect of the given size. */
function item(width: number, height: number, x = 0, y = 0) {
  return { rect: { x, y, width, height }, naturalWidth: width, naturalHeight: height, contentType: 'image/png' };
}

describe('placementSize (TC-03, TC-07)', () => {
  it('sizes each of the contract\'s four cases to the board', () => {
    // Below the limit, twice the limit, and a portrait at the limit — the four shapes a
    // moodboard is made of, with the boundary itself (`image.placement_size`).
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });

  it('scales the screenshot fixture the way the design says it should', () => {
    expect(placementSize(1440, 900)).toEqual({ width: 800, height: 500 });
  });

  it('never enlarges a small image to the limit (TC-07)', () => {
    expect(placementSize(600, 400)).toEqual({ width: 600, height: 400 });
  });

  it('places an image one pixel over the limit at exactly the limit', () => {
    const over = placementSize(IMAGE_MAX_PLACE_SIZE_WORLD + 1, 400);
    if (over === null) throw new Error('a finite positive size always has a placement');
    expect(Math.max(over.width, over.height)).toBe(IMAGE_MAX_PLACE_SIZE_WORLD);
  });

  it('keeps the aspect ratio for a size nobody thought of', () => {
    const size = placementSize(2560, 1440);
    if (size === null) throw new Error('a finite positive size always has a placement');
    expect(size.width / size.height).toBeCloseTo(2560 / 1440, 6);
    expect(Math.max(size.width, size.height)).toBe(IMAGE_MAX_PLACE_SIZE_WORLD);
  });

  it('refuses a size that is not a size', () => {
    expect(placementSize(0, 100)).toBeNull();
    expect(placementSize(Number.NaN, 100)).toBeNull();
    expect(placementSize(100, -5)).toBeNull();
  });
});

describe('layoutRow (TC-04)', () => {
  const three: Size[] = [
    { width: 800, height: 500 },
    { width: 800, height: 500 },
    { width: 800, height: 500 },
  ];

  it('lays three of one size left to right at the expected x values', () => {
    const rects = layoutRow(three, { x: 100, y: 100 }, 'top-left');
    expect(rects.map((rect) => rect.x)).toEqual([100, 924, 1748]);
    expect(rects.map((rect) => rect.y)).toEqual([100, 100, 100]);
    expect(rects.map((rect) => rect.width)).toEqual([800, 800, 800]);
  });

  it('uses the gap between neighbours, never before the first or after the last', () => {
    const rects = layoutRow(three, { x: 0, y: 0 }, 'top-left');
    expect(rects[2]!.x + rects[2]!.width).toBe(3 * 800 + 2 * IMAGE_LAYOUT_GAP_WORLD);
  });

  it('keeps every image on one row, top aligned', () => {
    const rects = layoutRow(
      [
        { width: 400, height: 300 },
        { width: 200, height: 500 },
        { width: 100, height: 100 },
      ],
      { x: 0, y: 0 },
      'top-left',
    );
    expect(rects.map((rect) => rect.x)).toEqual([0, 424, 648]);
    expect(rects.map((rect) => rect.y)).toEqual([0, 0, 0]);
  });

  it('centres the row as a whole on the point a paste gave it', () => {
    const rects = layoutRow(three, { x: 1000, y: 500 }, 'centre');
    const totalWidth = 3 * 800 + 2 * IMAGE_LAYOUT_GAP_WORLD;
    expect(rects[0]!.x).toBe(1000 - totalWidth / 2);
    expect(rects[2]!.x + rects[2]!.width).toBe(1000 + totalWidth / 2);
    // Vertically the row is as tall as its tallest member.
    expect(rects[0]!.y).toBe(500 - 500 / 2);
  });

  it('places one image with no gap at all', () => {
    expect(layoutRow([{ width: 300, height: 200 }], { x: 7, y: 9 }, 'top-left')).toEqual([
      { x: 7, y: 9, width: 300, height: 200 },
    ]);
  });

  it('places nothing when there is nothing to place', () => {
    expect(layoutRow([], { x: 0, y: 0 }, 'top-left')).toEqual([]);
  });
});

describe('createImagePlaceholders (TC-05, TC-06)', () => {
  it('writes every placeholder of one drop in a single transaction', () => {
    const doc = freshDoc();
    const count = transactionCount(doc, () => {
      createImagePlaceholders(
        doc,
        [item(800, 500, 0, 0), item(800, 500, 824, 0), item(800, 500, 1648, 0)],
        'person-a',
        1_000,
      );
    });
    expect(count).toBe(1);
  });

  it('is one undo step, and one redo brings them all back (TC-05)', () => {
    const doc = freshDoc();
    const undo = createUndo(doc);
    const ids = createImagePlaceholders(doc, [item(800, 500), item(800, 500)], 'person-a', 1_000);
    expect(imagesOf(doc)).toHaveLength(2);

    expect(undo.undo()).toBe(true);
    expect(imagesOf(doc)).toHaveLength(0);

    expect(undo.redo()).toBe(true);
    const restored = imagesOf(doc);
    expect(restored).toHaveLength(2);
    // Redo restores the objects under the ids they were created with, so an upload that is
    // still running still knows which object to complete.
    expect(restored.map((image) => image.id)).toEqual(ids);
    undo.destroy();
  });

  it('records the fields an image needs, starting as a placeholder', () => {
    const doc = freshDoc();
    const [id] = createImagePlaceholders(doc, [item(300, 200)], 'person-a', 4_321);
    const [image] = imagesOf(doc);
    expect(image).toMatchObject({
      id,
      type: 'image',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      status: 'uploading',
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 300,
      naturalHeight: 200,
      createdAt: 4_321,
      uploadStartedAt: 4_321,
      uploaderId: 'person-a',
    });
  });

  it('stacks the placeholders above everything already on the board (TC-06)', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    createImagePlaceholders(doc, [item(300, 200), item(300, 200)], 'person-a', 1);
    const [first, second] = imagesOf(doc);
    const topOfBoard = Math.max(...objectSnapshots(doc).filter((o) => o.id !== first?.id && o.id !== second?.id).map((o) => o.z));
    expect(first!.z).toBe(topOfBoard + 1);
    expect(second!.z).toBe(topOfBoard + 2);
  });

  it('creates nothing when given nothing, and refuses an unusable item', () => {
    const doc = freshDoc();
    expect(createImagePlaceholders(doc, [], 'person-a', 1)).toEqual([]);
    expect(
      transactionCount(doc, () => {
        createImagePlaceholders(
          doc,
          [{ rect: { x: 0, y: 0, width: Number.NaN, height: 100 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' }],
          'person-a',
          1,
        );
      }),
    ).toBe(0);
    expect(imagesOf(doc)).toEqual([]);
  });
});

describe('the upload lifecycle (TC-07)', () => {
  /** A doc with one placeholder of the given status. */
  function oneUploading(now = 10_000) {
    const doc = freshDoc();
    const [id] = createImagePlaceholders(doc, [item(300, 200)], 'person-a', now);
    return { doc, id: id as string };
  }

  it('completes an upload: ready, with the key everybody will fetch', () => {
    const { doc, id } = oneUploading();
    expect(markImageReady(doc, id, 'board/asset')).toBe(true);
    const [image] = imagesOf(doc);
    expect(image).toMatchObject({ status: 'ready', assetKey: 'board/asset' });
    expect(displayStatus(image!, 20_000)).toBe('ready');
  });

  it('marks an upload as failed without deleting anything', () => {
    const { doc, id } = oneUploading();
    expect(markImageFailed(doc, id)).toBe(true);
    const [image] = imagesOf(doc);
    expect(image!.status).toBe('failed');
    expect(image!.assetKey).toBeNull();
    expect(displayStatus(image!, 20_000)).toBe('failed');
  });

  it('returns an image to uploading when it is retried, with a fresh clock', () => {
    const { doc, id } = oneUploading(10_000);
    markImageFailed(doc, id);
    expect(markImageRetrying(doc, id, 90_000)).toBe(true);
    const [image] = imagesOf(doc);
    expect(image).toMatchObject({ status: 'uploading', uploadStartedAt: 90_000 });
  });

  it('refuses an id that is not on the board, and one that is not an image', () => {
    const doc = freshDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    expect(markImageReady(doc, 'no-such-id', 'board/asset')).toBe(false);
    expect(markImageFailed(doc, 'no-such-id')).toBe(false);
    expect(markImageRetrying(doc, 'no-such-id', 1)).toBe(false);
    expect(markImageReady(doc, sticky, 'board/asset')).toBe(false);
    expect(markImageFailed(doc, sticky)).toBe(false);
    // Refusing writes nothing: the sticky is untouched.
    expect(objectSnapshots(doc).find((object) => object.id === sticky)).toMatchObject({ type: 'sticky' });
  });

  it('does not record the status change as an undo step (TC-07)', () => {
    const doc = freshDoc();
    const undo = createUndo(doc);
    const [id] = createImagePlaceholders(doc, [item(300, 200)], 'person-a', 1);
    undo.boundary();
    markImageReady(doc, id as string, 'board/asset');

    // One undo takes the image away entirely: the upload finishing was never a step.
    expect(undo.undo()).toBe(true);
    expect(imagesOf(doc)).toEqual([]);
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  it('reads `unfinished` once an upload has been going too long, at the boundary', () => {
    const { doc } = oneUploading(1_000);
    const [image] = imagesOf(doc);
    expect(image!.status).toBe('uploading');

    // One millisecond short of the window is still an upload in progress; one past it is an
    // upload nobody is going to finish (TC-06's pair).
    expect(displayStatus(image!, 1_000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(image!, 1_000 + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    expect(displayStatus(image!, 1_000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('never reads a failed or finished image as unfinished, however old', () => {
    const { doc, id } = oneUploading(0);
    markImageFailed(doc, id);
    const [image] = imagesOf(doc);
    expect(displayStatus(image!, 10 ** 12)).toBe('failed');
    markImageRetrying(doc, id, 0);
    markImageReady(doc, id, 'board/asset');
    const [done] = imagesOf(doc);
    expect(displayStatus(done!, 10 ** 12)).toBe('ready');
  });
});

describe('an image among the other objects', () => {
  it('is movable and resizable by the generic gestures, and deletable', () => {
    const doc = freshDoc();
    const [id] = createImagePlaceholders(doc, [item(400, 300, 10, 20)], 'person-a', 1);
    expect(moveableIds(doc, [id as string])).toEqual([id]);

    expect(moveObjects(doc, new Map([[id as string, { x: 60, y: 70 }]]))).toBe(1);
    expect(resizeObjects(doc, new Map([[id as string, { x: 60, y: 70, width: 200, height: 150 }]]))).toBe(1);
    expect(imagesOf(doc)[0]).toMatchObject({ x: 60, y: 70, width: 200, height: 150 });

    expect(deleteObjects(doc, [id as string])).toBe(1);
    expect(imagesOf(doc)).toEqual([]);
  });

  it('refuses a status update for an object that has been deleted, writing nothing (TC-07)', () => {
    const doc = freshDoc();
    const [id] = createImagePlaceholders(doc, [item(400, 300)], 'person-a', 1);
    deleteObjects(doc, [id as string]);

    const updates = transactionCount(doc, () => {
      expect(markImageReady(doc, id as string, 'board/asset')).toBe(false);
      expect(markImageFailed(doc, id as string)).toBe(false);
      expect(markImageRetrying(doc, id as string, 2)).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('survives a peer sync, in both directions', () => {
    const doc = freshDoc();
    const [id] = createImagePlaceholders(doc, [item(400, 300, 12, 34)], 'person-a', 1);
    const peer = freshDoc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));

    const [copy] = imagesOf(peer);
    expect(copy).toMatchObject({ id, type: 'image', x: 12, y: 34, status: 'uploading' });

    markImageReady(peer, id as string, 'board/asset');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    expect(displayStatus(imagesOf(doc)[0]!, 2)).toBe('ready');
  });

  it('ignores a document that claims an image has no usable geometry', () => {
    const doc = freshDoc();
    const map = doc.getMap<unknown>('objects');
    const broken = new Y.Map<unknown>();
    broken.set('type', 'image');
    broken.set('x', 'far');
    broken.set('y', 0);
    broken.set('width', 10);
    broken.set('height', 10);
    broken.set('z', 1);
    broken.set('createdAt', 1);
    map.set('broken-image', broken);
    expect(objectSnapshots(doc).find((object) => object.id === 'broken-image')).toBeUndefined();
  });
});
