import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  UPLOAD_ORIGIN,
  type ImageItem,
} from '../../src/shared/objects/image';
import {
  createSticky,
  deleteObjects,
  getObjects,
  initDoc,
  snapshotAll,
  LOCAL_ORIGIN,
  type ImageSnap,
} from '../../src/shared/board-model';
import { withPeer } from './helpers/peer';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
  MAX_OBJECT_SIZE_WORLD,
} from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { clampScale } from '../../src/shared/geometry';

/**
 * Story 12, image.model: the small amount of document an image is.
 *
 * Two things are being tested here and they are the two the story is about. The
 * first is that a picture's size on the board comes from the picture: the ratio it
 * was taken at survives being placed and survives being shrunk to the longest side
 * the board places at. The second is that a placeholder is one thing — written in
 * one transaction, undone in one step, and completed by a write which is not a step
 * at all, which is the difference between "undo took my image back" and "undo
 * undid my upload", the second being a thing no person would ever ask for.
 */

const START = 1_700_000_000_000;

let doc: Y.Doc;
let undo: UndoController;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  undo = createUndo(doc);
});

afterEach(() => {
  undo.destroy();
  doc.destroy();
});

/** The image with this id, read back out of the document like the board reads it. */
function imageOf(id: string): ImageSnap {
  const found = snapshotAll(doc).find((object) => object.id === id);
  if (found === undefined || found.type !== 'image') throw new Error(`no image '${id}'`);
  return found;
}

const item = (
  x: number,
  y: number,
  width: number,
  height: number,
  naturalWidth = 100,
  naturalHeight = 100,
): ImageItem => ({
  rect: { x, y, width, height },
  naturalWidth,
  naturalHeight,
  contentType: 'image/png',
});

describe('TC-03: placementSize keeps the picture and caps the longest side', () => {
  it('a picture smaller than the limit is placed at its own size', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('a landscape picture is placed 800 units wide, and its height comes with it', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('a portrait picture is placed 800 units tall, and its width comes with it', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('a square at the limit is the limit', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });

  it('a screenshot is 800 units wide whatever it was taken at', () => {
    expect(placementSize(1440, 900)).toEqual({ width: 800, height: 500 });
    expect(placementSize(4032, 3024)).toEqual({ width: 800, height: 600 });
  });

  it('the ratio survives, to the last decimal the board keeps', () => {
    for (const [width, height] of [
      [1600, 1200],
      [300, 3200],
      [4032, 3024],
      [640, 480],
      [1080, 1920],
    ] as const) {
      const placed = placementSize(width, height);
      expect(placed.width / placed.height).toBeCloseTo(width / height, 6);
    }
  });

  it('nothing is ever the longer side than the limit, and nothing is ever blown up', () => {
    for (const [width, height] of [
      [1, 1],
      [799, 1],
      [1, 799],
      [800, 1],
      [1, 800],
      [1000000, 3],
    ] as const) {
      const placed = placementSize(width, height);
      expect(Math.max(placed.width, placed.height)).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
      // A 1x1 picture is one board unit, not eight hundred: making a picture bigger
      // than it is not something anybody asked for.
      expect(Math.max(placed.width, placed.height)).toBeLessThanOrEqual(Math.max(width, height));
    }
  });

  it('a size which is not a number places nothing', () => {
    expect(Number.isNaN(placementSize(0, 100).width)).toBe(true);
    expect(Number.isNaN(placementSize(100, -1).height)).toBe(true);
    expect(Number.isNaN(placementSize(Number.NaN, 100).width)).toBe(true);
    expect(Number.isNaN(placementSize(100, Number.POSITIVE_INFINITY).height)).toBe(true);
  });
});

describe('TC-04: layoutRow puts a row where it was told to', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 200, height: 120 },
    { width: 80, height: 300 },
  ];
  const point = { x: 1000, y: 500 };

  it('a dropped row starts where the pointer was, in the order it was dropped', () => {
    const row = layoutRow(sizes, point, 'top-left');
    expect(row).toHaveLength(3);
    expect(row[0]!.x).toBe(point.x);
    expect(row[1]!.x).toBe(point.x + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(row[2]!.x).toBe(point.x + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD);
  });

  it('the tops are in line, which is what a row is', () => {
    const row = layoutRow(sizes, point, 'top-left');
    for (const box of row) expect(box.y).toBe(point.y);
  });

  it('every box keeps its own size', () => {
    const row = layoutRow(sizes, point, 'top-left');
    expect(row.map((box) => [box.width, box.height])).toEqual([
      [100, 50],
      [200, 120],
      [80, 300],
    ]);
  });

  it('a row that was not dropped is centred on the view', () => {
    const row = layoutRow(sizes, point, 'centre');
    const width = 100 + 200 + 80 + IMAGE_LAYOUT_GAP_WORLD * 2;
    const tallest = 300;
    expect(row[0]!.x).toBe(point.x - width / 2);
    expect(row[0]!.y).toBe(point.y - tallest / 2);
    expect(row[2]!.x + row[2]!.width).toBe(point.x + width / 2);
  });

  it('one file is a row of one, at the point', () => {
    expect(layoutRow([{ width: 400, height: 300 }], point, 'top-left')).toEqual([
      { x: point.x, y: point.y, width: 400, height: 300 },
    ]);
  });

  it('nothing to lay out is an empty row, not a box at zero', () => {
    expect(layoutRow([], point, 'top-left')).toEqual([]);
    expect(layoutRow([{ width: Number.NaN, height: 100 }], point, 'centre')).toEqual([]);
    expect(layoutRow([{ width: 0, height: 0 }], point, 'centre')).toEqual([]);
  });

  it('a size which cannot be a box leaves that box off the row and the row keeps step', () => {
    const row = layoutRow([sizes[0]!, { width: Number.NaN, height: 10 }, sizes[2]!], point, 'top-left');
    expect(row).toHaveLength(2);
    expect(row[1]!.x).toBe(point.x + 100 + IMAGE_LAYOUT_GAP_WORLD);
  });
});

describe('TC-05: a drop is one thing, and its upload is not a thing at all', () => {
  it('three placeholders appear, all uploading, in one update', () => {
    // What the other person's board sees is the update, once: the row arrives as a
    // row, which is the difference between three notes on a board and a row.
    const peer = withPeer(doc);
    let updates = 0;
    peer.doc.on('update', () => {
      updates += 1;
    });

    const ids = createImagePlaceholders(doc, [item(0, 0, 100, 80), item(124, 0, 100, 80), item(248, 0, 100, 80)], 'me', START);

    expect(updates).toBe(1);
    for (const id of ids) {
      const image = imageOf(id);
      expect(image.type).toBe('image');
      expect(image.status).toBe('uploading');
      expect(image.assetKey).toBeNull();
      expect(image.uploaderId).toBe('me');
      expect(image.uploadStartedAt).toBe(START);
      expect(image.createdAt).toBe(START);
      expect(image.width).toBe(100);
      expect(image.height).toBe(80);
      // The placeholder already has the picture's ratio, which is the whole reason
      // nobody watches a box change shape while the bytes come up.
      expect(image.naturalWidth / image.naturalHeight).toBe(1);
    }
    expect(ids).toHaveLength(3);
    expect(updates).toBe(1);
    // The other board has the whole row from that one update: three objects, each
    // already the size and place it will stay.
    const there = snapshotAll(peer.doc);
    expect(there.map((object) => object.type)).toEqual(['image', 'image', 'image']);
    expect(there.map((object) => object.x)).toEqual([0, 124, 248]);
    peer.destroy();
  });

  it('they are on top of what is already there, in the order dropped', () => {
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const ids = createImagePlaceholders(doc, [item(0, 0, 10, 10), item(34, 0, 10, 10)], 'me', START);
    const zOf = (id: string): number => imageOf(id).z;
    expect(zOf(ids[0]!)).toBeGreaterThan(snapshotAll(doc).find((o) => o.id === sticky)!.z);
    expect(zOf(ids[1]!)).toBeGreaterThan(zOf(ids[0]!));
  });

  it('one becomes ready with its key, and one undo of history takes all three back in one step', () => {
    const ids = createImagePlaceholders(
      doc,
      [item(0, 0, 10, 10, 400, 300), item(34, 0, 10, 10), item(68, 0, 10, 10)],
      'me',
      START,
    );
    expect(undo.canUndo()).toBe(true);

    // The completion is written under an origin the history does not track, which
    // is what makes it a fact about a file rather than a change to the board.
    expect(markImageReady(doc, ids[0]!, 'board/asset')).toBe(true);
    expect(imageOf(ids[0]!).status).toBe('ready');
    expect(imageOf(ids[0]!).assetKey).toBe('board/asset');

    // Still one step: the upload did not add one.
    expect(undo.undo()).toBe(true);
    expect(snapshotAll(doc)).toEqual([]);
    // And there is no second step to press: an undo press does not get to rewind
    // an upload that finished.
    expect(undo.undo()).toBe(false);
  });

  it('the completion is not on the undo stack, however many of them there are', () => {
    const ids = createImagePlaceholders(doc, [item(0, 0, 10, 10), item(34, 0, 10, 10)], 'me', START);
    markImageReady(doc, ids[0]!, 'board/a');
    markImageReady(doc, ids[1]!, 'board/b');
    expect(undo.undo()).toBe(true);
    expect(snapshotAll(doc)).toEqual([]);
    expect(undo.undo()).toBe(false);
    // The redo stack holds the drop, and one redo brings both images back.
    expect(undo.redo()).toBe(true);
    expect(snapshotAll(doc).map((object) => object.type)).toEqual(['image', 'image']);
  });

  it('a completion writes nothing when the image was deleted while it was in flight', () => {
    const [id] = createImagePlaceholders(doc, [item(0, 0, 10, 10)], 'me', START);
    deleteObjects(doc, [id!]);
    expect(markImageReady(doc, id!, 'board/a')).toBe(false);
    expect(markImageFailed(doc, id!)).toBe(false);
    expect(markImageRetrying(doc, id!, START + 1)).toBe(false);
    expect(snapshotAll(doc)).toEqual([]);
  });

  it('a completion leaves a note alone', () => {
    const sticky = createSticky(doc, { x: 0, y: 0 });
    expect(markImageReady(doc, sticky, 'board/a')).toBe(false);
    expect(markImageFailed(doc, sticky)).toBe(false);
    expect(snapshotAll(doc).find((object) => object.id === sticky)?.type).toBe('sticky');
  });

  it('an item which is not a box is not put on the board', () => {
    const ids = createImagePlaceholders(
      doc,
      [item(0, 0, 10, 10), item(Number.NaN, 0, 10, 10), item(34, 0, 10, 10, Number.NaN, 100)],
      'me',
      START,
    );
    expect(ids).toHaveLength(1);
    expect(snapshotAll(doc)).toHaveLength(1);
  });

  it('nothing to place writes no transaction at all', () => {
    let updates = 0;
    getObjects(doc).observe(() => {
      updates += 1;
    });
    expect(createImagePlaceholders(doc, [], 'me', START)).toEqual([]);
    expect(updates).toBe(0);
  });
});

describe('TC-06: the status the board shows, and the moment it changes', () => {
  const uploading = { status: 'uploading' as const, uploadStartedAt: START };

  it('one millisecond before the line it is still uploading', () => {
    expect(displayStatus(uploading, START + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
  });

  it('exactly on the line it is still uploading, because the line is *after* five minutes', () => {
    expect(displayStatus(uploading, START + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
  });

  it('one millisecond past it, it did not finish', () => {
    expect(displayStatus(uploading, START + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('a failed upload says so, and does not become unfinished by waiting', () => {
    const failed = { status: 'failed' as const, uploadStartedAt: START };
    expect(displayStatus(failed, START + IMAGE_UPLOAD_STALE_MS * 10)).toBe('failed');
  });

  it('a ready image is ready for as long as it is on the board', () => {
    const ready = { status: 'ready' as const, uploadStartedAt: START };
    expect(displayStatus(ready, START + IMAGE_UPLOAD_STALE_MS * 100)).toBe('ready');
  });

  it('an upload with no start time cannot be late', () => {
    expect(displayStatus({ status: 'uploading', uploadStartedAt: Number.NaN }, START + 1e12)).toBe(
      'uploading',
    );
  });

  it('the unfinished state is never written to the document', () => {
    const [id] = createImagePlaceholders(doc, [item(0, 0, 10, 10)], 'me', START);
    expect(imageOf(id).status).toBe('uploading');
    expect(displayStatus(imageOf(id), START + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    // Six minutes later the document still says what it said: the board changed,
    // not the record, which is the only way a fact about time can be true on a
    // screen without anybody having to write it.
    expect(imageOf(id).status).toBe('uploading');
  });
});

describe('the upload states, as the document holds them', () => {
  it('a failed upload is failed, and keeps its key empty', () => {
    const [id] = createImagePlaceholders(doc, [item(0, 0, 10, 10)], 'me', START);
    expect(markImageFailed(doc, id!)).toBe(true);
    const failed = imageOf(id!);
    expect(failed.status).toBe('failed');
    expect(failed.assetKey).toBeNull();
    expect(failed.uploaderId).toBe('me');
  });

  it('a retry is uploading again with the clock started afresh', () => {
    const [id] = createImagePlaceholders(doc, [item(0, 0, 10, 10)], 'me', START);
    markImageFailed(doc, id!);
    expect(markImageRetrying(doc, id!, START + 60_000)).toBe(true);
    const retried = imageOf(id!);
    expect(retried.status).toBe('uploading');
    expect(retried.uploadStartedAt).toBe(START + 60_000);
    // The new attempt is on time again: the stale line is measured from the retry.
    expect(displayStatus(retried, START + IMAGE_UPLOAD_STALE_MS + 1)).toBe('uploading');
    expect(displayStatus(retried, START + 60_000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('a retry after a success does not lose the bytes already stored', () => {
    // Nothing in the board says a ready image may not be pointed at a second set of
    // bytes, but nothing in the story asks for it either, and the key it already
    // has is the one the board is showing.
    const [id] = createImagePlaceholders(doc, [item(0, 0, 10, 10)], 'me', START);
    markImageReady(doc, id!, 'board/a');
    markImageRetrying(doc, id!, START + 1);
    expect(imageOf(id!).assetKey).toBe('board/a');
  });

  it('the completion origin is neither the local origin nor nobody', () => {
    // LOCAL_ORIGIN would make an upload undoable; undefined would put it in every
    // person's history. Both are wrong, and both are what someone would try first.
    expect(UPLOAD_ORIGIN).not.toBe(LOCAL_ORIGIN);
    expect(UPLOAD_ORIGIN).toBeDefined();
    const seen: unknown[] = [];
    doc.on('update', (_: Uint8Array, origin: unknown) => {
      seen.push(origin);
    });
    markImageFailed(doc, createImagePlaceholders(doc, [item(0, 0, 10, 10)], 'me', START)[0]!);
    expect(seen).toEqual([LOCAL_ORIGIN, UPLOAD_ORIGIN]);
  });

  it('an image is read back with everything the board needs about it', () => {
    const [id] = createImagePlaceholders(doc, [item(12, 34, 400, 300, 1600, 1200)], 'someone', START);
    markImageReady(doc, id!, 'board/x');
    const image = imageOf(id!);
    expect(image).toMatchObject({
      type: 'image',
      x: 12,
      y: 34,
      width: 400,
      height: 300,
      naturalWidth: 1600,
      naturalHeight: 1200,
      contentType: 'image/png',
      status: 'ready',
      assetKey: 'board/x',
      uploaderId: 'someone',
    });
    // The box is the box: the minimum size and the aspect lock are the registry's
    // business, and the object's box is what they are applied to.
    expect(image.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
  });
});

describe('the smallest picture a resize may leave, which is one number for two sides', () => {
  // Resizing one object applies ONE scale to both of its sides, so that one number has
  // to keep the width and the height above the minimum at the same time. Its floor is
  // the *larger* of the two per-axis floors; taken the other way round the longer side
  // walks on past the minimum while the shorter one stops exactly at it, which is a
  // minimum that was not kept. Story 7's tests of this function use squares, where the
  // two floors are equal and the difference between them cannot be seen — an image, the
  // first object on this board whose shape is locked to something that is not a square,
  // is what makes it matter.
  const MAX = MAX_OBJECT_SIZE_WORLD;

  it('keeps both sides of a picture whose shape is 4:3 at or above the minimum', () => {
    const box = { x: 0, y: 0, width: 40, height: 30 };
    const scale = clampScale({ x: 0.1, y: 0.1 }, [box], [IMAGE_MIN_SIZE_WORLD], MAX);

    expect(40 * scale.x).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    expect(30 * scale.y).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    // The height is the side that decides, because 16/30 is the larger of the two
    // floors — and one scale is one scale, whatever the two axes were asked for.
    expect(scale.x).toBeCloseTo(IMAGE_MIN_SIZE_WORLD / 30);
    expect(scale.x).toBe(scale.y);
  });

  it('takes the largest floor of several pictures, so nobody is left under it', () => {
    const wide = { x: 0, y: 0, width: 800, height: 40 };
    const small = { x: 0, y: 0, width: 40, height: 30 };
    const scale = clampScale(
      { x: 0.01, y: 0.01 },
      [wide, small],
      [IMAGE_MIN_SIZE_WORLD, IMAGE_MIN_SIZE_WORLD],
      MAX,
    );

    for (const rect of [wide, small]) {
      expect(rect.width * scale.x).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
      expect(rect.height * scale.x).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    }
  });

  it('takes the smallest ceiling, which is the same interval from the other side', () => {
    const big = { x: 0, y: 0, width: 800, height: 600 };
    // 100x would put the width at 80 000, three times over what the board allows an
    // object: the width is the side that decides, and the proposal comes back inside
    // the interval rather than being refused.
    const scale = clampScale({ x: 100, y: 100 }, [big], [IMAGE_MIN_SIZE_WORLD], MAX);

    expect(big.width * scale.x).toBeLessThanOrEqual(MAX);
    expect(big.height * scale.x).toBeLessThanOrEqual(MAX);
    expect(scale.x).toBeCloseTo(MAX / 800);
  });

  it('leaves a scale that breaks nothing exactly where it was', () => {
    const box = { x: 0, y: 0, width: 40, height: 30 };

    expect(clampScale({ x: 2, y: 2 }, [box], [IMAGE_MIN_SIZE_WORLD], MAX)).toEqual({ x: 2, y: 2 });
  });
});
