/**
 * Story 12 — the image object, on its own (TC-03 to TC-07).
 *
 * The part of an image that lives in the document, tested without a browser, a server or a canvas:
 *
 *   - TC-03 — a placeholder exists before the bytes do, and says so. It carries the size it will be drawn at
 *     and the dimensions the picture turned out to have, no key at all while it is still being uploaded, and
 *     it is visible to everybody on the board from the moment it is created — that is what an upload looks
 *     like on a shared board, as opposed to a private spinner in a corner of one person's screen.
 *   - TC-04 — where a drop of three files puts the three images: a row, gaps the same everywhere, tops in a
 *     line, centred on the point the files were dropped.
 *   - TC-05/TC-06/TC-07 — the rules the object is subject to: an upload finishing is not something anybody
 *     undoes; an image keeps its proportions; and dropping three files is one thing, so one undo takes all
 *     three away.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import { resizeRect } from '../../src/shared/geometry';
import { LOCAL_ORIGIN, deleteObjects, resizeObjects } from '../../src/shared/board-model';
import {
  UPLOAD_ORIGIN,
  assetUrl,
  createImagePlaceholders,
  displayStatus,
  imageSnapshots,
  isImageSnapshot,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  readImage,
  type ImageItem,
  type ImageSnap,
} from '../../src/shared/objects/image';

const uploader = '7391234';
const NOW = 1_700_000_000_000;
const KEY = 'vKd3xQ2mZ8rT7wL1nB4sY6/qW9tR2yU5iO8pA3sD6fG01';

function newDoc(): Y.Doc {
  return new Y.Doc({ gc: false });
}

/** One item as the insert would hand it over: the box to draw at and the picture it is standing in for. */
function item(rect: Rect, width = 1600, height = 1200): ImageItem {
  return { rect, naturalWidth: width, naturalHeight: height, contentType: 'image/png' };
}

function firstImage(doc: Y.Doc): ImageSnap {
  const images = imageSnapshots(doc);
  expect(images).toHaveLength(1);
  const image = images[0];
  if (!image) throw new Error('no image');
  return image;
}

describe('placing an image at its natural size', () => {
  it('TC-03: scales a large picture down to the largest side allowed, keeping its proportions', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(4032, 3024)).toEqual({ width: 800, height: 600 });
    // The tall one is scaled by its own longest side, so it does not come out as a wide box.
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('TC-03: leaves a picture that is already small enough exactly as it is', () => {
    expect(placementSize(320, 200)).toEqual({ width: 320, height: 200 });
    expect(placementSize(IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD)).toEqual({
      width: IMAGE_MAX_PLACE_SIZE_WORLD,
      height: IMAGE_MAX_PLACE_SIZE_WORLD,
    });
  });

  it('TC-03: says nothing about a picture with no size', () => {
    expect(placementSize(0, 100)).toBeNull();
    expect(placementSize(100, Number.NaN)).toBeNull();
  });
});

describe('creating image placeholders', () => {
  it('TC-03: creates one placeholder per file, visible to the shared snapshot machinery', () => {
    const doc = newDoc();
    const ids = createImagePlaceholders(
      doc,
      [item({ x: 0, y: 0, width: 800, height: 600 }), item({ x: 824, y: 0, width: 800, height: 600 })],
      uploader,
      NOW,
    );

    expect(ids).toHaveLength(2);
    // It is an object the board knows about: in the shared map, with a type, and readable as a snapshot.
    expect(doc.getMap('objects').size).toBe(2);
    expect(imageSnapshots(doc).map((image) => image.id)).toEqual(ids);
    expect(new Set(imageSnapshots(doc).map((image) => image.uploaderId))).toEqual(new Set([uploader]));
    expect(imageSnapshots(doc).every((image) => isImageSnapshot(image))).toBe(true);
  });

  it('TC-03: a placeholder is uploading, has no key, and carries the size it is drawn at', () => {
    const doc = newDoc();
    createImagePlaceholders(doc, [item({ x: 40, y: -20, width: 800, height: 600 })], uploader, NOW);

    const image = firstImage(doc);
    expect(image).toMatchObject({
      type: 'image',
      x: 40,
      y: -20,
      width: 800,
      height: 600,
      status: 'uploading',
      assetKey: null,
      naturalWidth: 1600,
      naturalHeight: 1200,
      contentType: 'image/png',
      uploadStartedAt: NOW,
      uploaderId: uploader,
    });
    // There is nothing to fetch yet, and the board says so rather than inventing a URL.
    expect(assetUrl(image.assetKey)).toBeNull();
    expect(displayStatus(image, NOW)).toBe('uploading');
  });

  it('TC-03: gives the placeholders increasing z order, each above everything already on the board', () => {
    const doc = newDoc();
    createImagePlaceholders(doc, [item({ x: 0, y: 0, width: 100, height: 100 })], uploader, NOW);
    createImagePlaceholders(
      doc,
      [item({ x: 0, y: 0, width: 100, height: 100 }), item({ x: 200, y: 0, width: 100, height: 100 })],
      uploader,
      NOW + 1,
    );

    const z = imageSnapshots(doc).map((image) => image.z);
    expect(z[1]).toBeGreaterThan(z[0]);
    expect(z[2]).toBeGreaterThan(z[1]);
  });

  it('TC-03: skips an item whose size or position is not a number, and says which ones it made', () => {
    const doc = newDoc();
    const ids = createImagePlaceholders(
      doc,
      [
        item({ x: 0, y: 0, width: 100, height: 75 }),
        { rect: { x: 200, y: 0, width: Number.NaN, height: 75 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/png' },
        { rect: { x: 400, y: 0, width: 100, height: 75 }, naturalWidth: 400, naturalHeight: 0, contentType: 'image/png' },
      ],
      uploader,
      NOW,
    );

    // A placeholder with no size is drawn as nothing and resized into something nobody can aim at; a
    // placeholder with no dimensions cannot be scaled at all. Neither is added to the document.
    expect(ids).toHaveLength(1);
    expect(imageSnapshots(doc).map((image) => image.x)).toEqual([0]);
  });

  it('TC-04: lays a row of images out left to right with the same gap between each', () => {
    const sizes = [
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ];
    const rects = layoutRow(sizes, { x: 0, y: 0 }, 'top-left');

    expect(rects.map((rect) => rect.x)).toEqual([0, 100 + IMAGE_LAYOUT_GAP_WORLD, 2 * (100 + IMAGE_LAYOUT_GAP_WORLD)]);
    // Tops in a line, whatever the heights: a row is aligned along the top, not along a baseline.
    expect(rects.map((rect) => rect.y)).toEqual([0, 0, 0]);
  });

  it('TC-04: keeps the tallest image in a mixed row as tall as it is', () => {
    const rects = layoutRow(
      [
        { width: 200, height: 100 },
        { width: 200, height: 400 },
      ],
      { x: 0, y: 0 },
      'top-left',
    );

    expect(rects[1]).toEqual({ x: 224, y: 0, width: 200, height: 400 });
  });

  it('TC-04: centres the whole row on the point the files were dropped', () => {
    const sizes = [
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ];
    const centre = { x: 1_000, y: 500 };
    const rects = layoutRow(sizes, centre, 'centre');

    const left = rects[0]!.x;
    const right = rects[2]!.x + rects[2]!.width;
    const top = Math.min(...rects.map((rect) => rect.y));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));

    expect((left + right) / 2).toBeCloseTo(centre.x, 6);
    expect((top + bottom) / 2).toBeCloseTo(centre.y, 6);
  });

  it('TC-04: puts a paste in the middle of what is on the screen and a drop where the pointer was', () => {
    const doc = newDoc();
    const dropped = layoutRow([{ width: 400, height: 300 }], { x: 333, y: 777 }, 'top-left');
    createImagePlaceholders(doc, [item(dropped[0]!)], uploader, NOW);
    expect(firstImage(doc)).toMatchObject({ x: 333, y: 777 });

    const pasted = layoutRow([{ width: 400, height: 300 }], { x: 1_000, y: 500 }, 'centre');
    createImagePlaceholders(doc, [item(pasted[0]!)], uploader, NOW + 1);
    const image = imageSnapshots(doc)[1]!;
    expect(image.x + image.width / 2).toBeCloseTo(1_000, 6);
    expect(image.y + image.height / 2).toBeCloseTo(500, 6);
  });
});

describe('an image keeping its proportions', () => {
  it('TC-06: keeps the ratio of the picture through the shared resize path', () => {
    const doc = newDoc();
    createImagePlaceholders(doc, [item({ x: 0, y: 0, width: 800, height: 600 }, 4032, 3024)], uploader, NOW);
    const image = firstImage(doc);

    // The aspect lock is a property of the object type that the resize gesture reads before it scales
    // anything (asserted against the registry itself in the component test); the shared resize path is given
    // the rectangle that lock produced, and must not round it into a different shape on the way in.
    const scaled = resizeRect({ ...image }, 'se', { x: -400, y: 0 }, true);
    resizeObjects(doc, new Map([[image.id, scaled]]));

    const resized = firstImage(doc);
    expect(resized.width).toBeCloseTo(400, 6);
    expect(resized.width / resized.height).toBeCloseTo(4032 / 3024, 6);
  });

  it('TC-06: the placed size and the picture’s own ratio are the same ratio', () => {
    const placed = placementSize(4032, 3024)!;
    expect(placed.width / placed.height).toBeCloseTo(4032 / 3024, 6);
  });
});

describe('an upload finishing, failing, and being retried', () => {
  it('TC-05: records a finished upload as the key and ready, without creating an undo step', () => {
    const doc = newDoc();
    const undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    });
    const [id] = createImagePlaceholders(doc, [item({ x: 0, y: 0, width: 800, height: 600 })], uploader, NOW);
    expect(undoManager.undoStack).toHaveLength(1);

    // The origin is the mechanism, and it is worth seeing directly: the transaction that records the key is
    // written in the upload's own origin and not in the one the history listens to.
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));

    expect(markImageReady(doc, id!, KEY)).toBe(true);
    expect(origins.filter((origin) => origin === UPLOAD_ORIGIN)).toHaveLength(1);
    expect(origins).not.toContain(LOCAL_ORIGIN);

    // An upload finishing is not something anybody did: it happens seconds after the drop, on its own, and
    // nobody can un-say it. It is written in its own transaction origin so the history can look the other way.
    expect(undoManager.undoStack).toHaveLength(1);

    expect(firstImage(doc)).toMatchObject({ assetKey: KEY, status: 'ready' });
    expect(displayStatus(firstImage(doc), NOW)).toBe('ready');
  });

  it('TC-05: says no to an upload result for an image that is not there any more', () => {
    const doc = newDoc();
    const [gone] = createImagePlaceholders(doc, [item({ x: 0, y: 0, width: 100, height: 100 })], uploader, NOW);
    deleteObjects(doc, [gone!]);

    // The person deleted it while it was in flight: the key arrived, and there is nothing to put it in.
    expect(markImageReady(doc, gone!, KEY)).toBe(false);
    expect(markImageFailed(doc, gone!)).toBe(false);
    expect(markImageRetrying(doc, gone!, NOW + 1)).toBe(false);
    expect(imageSnapshots(doc)).toEqual([]);
  });

  it('TC-05: says no to an upload result for an object that was never an image', () => {
    const doc = newDoc();
    // Something else that shares the object id space: a note.
    const note = new Y.Map<unknown>();
    for (const [key, value] of Object.entries({ type: 'sticky-note', x: 0, y: 0, width: 100, height: 100, z: 1, createdAt: 1 })) {
      note.set(key, value);
    }
    doc.getMap('objects').set('a-note', note);

    // An upload result belongs to an image; a note cannot be told it is ready, and nothing is written into it.
    expect(markImageFailed(doc, 'a-note')).toBe(false);
    expect(markImageReady(doc, 'a-note', KEY)).toBe(false);
    expect(markImageRetrying(doc, 'a-note', NOW + 1)).toBe(false);
    expect(note.get('status')).toBeUndefined();
  });

  it('TC-05: one undo after a drop of three takes all three, and the upload that finished is not a step', () => {
    const doc = newDoc();
    const undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    });
    const ids = createImagePlaceholders(
      doc,
      [
        item({ x: 0, y: 0, width: 100, height: 100 }),
        item({ x: 124, y: 0, width: 100, height: 100 }),
        item({ x: 248, y: 0, width: 100, height: 100 }),
      ],
      uploader,
      NOW,
    );
    markImageReady(doc, ids[0]!, KEY);
    expect(undoManager.undoStack).toHaveLength(1);

    expect(undoManager.undo()).toBeTruthy();
    expect(imageSnapshots(doc)).toEqual([]);
    expect(doc.getMap('objects').size).toBe(0);

    // What redo brings back is the drop: three placeholders. The key that arrived in between is still written
    // on the first one, because redo restores objects rather than a previous state of their fields — and that
    // is exactly what the second origin buys. The upload is not a step in the history (the stack length above
    // and the origin assertion in the test before this one are what say so), so undo never had it to take away
    // and redo cannot be said to have done it again.
    expect(undoManager.redo()).toBeTruthy();
    const images = imageSnapshots(doc);
    expect(images).toHaveLength(3);
    expect(images.map((image) => image.status)).toEqual(['ready', 'uploading', 'uploading']);
    expect(images[0]!.assetKey).toBe(KEY);
  });

  it('TC-07: records a failed upload as failed, and a retry as uploading from now', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, [item({ x: 0, y: 0, width: 100, height: 100 })], uploader, NOW);

    expect(markImageFailed(doc, id!)).toBe(true);
    expect(firstImage(doc)).toMatchObject({ status: 'failed', assetKey: null });
    expect(displayStatus(firstImage(doc), NOW + 1_000)).toBe('failed');

    // Retrying says when the attempt started, so the five minute clock starts again rather than expiring on
    // the spot for an upload that is only just going.
    expect(markImageRetrying(doc, id!, NOW + 2_000)).toBe(true);
    expect(firstImage(doc)).toMatchObject({ status: 'uploading', uploadStartedAt: NOW + 2_000 });
    expect(displayStatus(firstImage(doc), NOW + 3_000)).toBe('uploading');
  });

  it('TC-05: writing the same result twice writes nothing', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, [item({ x: 0, y: 0, width: 100, height: 100 })], uploader, NOW);
    expect(markImageReady(doc, id!, KEY)).toBe(true);

    const undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    });
    const before = doc.getMap('objects').get(id) as Y.Map<unknown>;
    const assetKeyBefore = before.get('assetKey');

    expect(markImageReady(doc, id!, KEY)).toBe(false);
    expect(before.get('assetKey')).toBe(assetKeyBefore);
    expect(undoManager.undoStack).toHaveLength(0);
  });
});

describe('an upload that never finished', () => {
  it('TC-07: says unfinished once the stale time has passed, and nothing before it', () => {
    const doc = newDoc();
    createImagePlaceholders(doc, [item({ x: 0, y: 0, width: 100, height: 100 })], uploader, NOW);
    const image = () => firstImage(doc);

    expect(displayStatus(image(), NOW)).toBe('uploading');
    expect(displayStatus(image(), NOW + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    // The boundary itself is still uploading: five minutes has not gone by yet.
    expect(displayStatus(image(), NOW + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    expect(displayStatus(image(), NOW + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('TC-07: says unfinished for a placeholder left by a tab that was closed, with no message from anybody', () => {
    const doc = newDoc();
    createImagePlaceholders(doc, [item({ x: 0, y: 0, width: 100, height: 100 })], uploader, NOW);

    // A second person, on a second tab, five minutes later: they have no clock of the first tab's, only the
    // timestamp the placeholder was created with and the document's own clock.
    const later = NOW + IMAGE_UPLOAD_STALE_MS + 60_000;
    expect(displayStatus(firstImage(doc), later)).toBe('unfinished');

    // A finished upload is never unfinished, however long it took to get there.
    const [ready] = createImagePlaceholders(doc, [item({ x: 0, y: 0, width: 100, height: 100 })], uploader, NOW);
    markImageReady(doc, ready!, KEY);
    expect(displayStatus(readImage(doc, ready!)!, later)).toBe('ready');

    // A failed upload is failed, and stays failed: it is not waiting for anything.
    const [failed] = createImagePlaceholders(doc, [item({ x: 0, y: 0, width: 100, height: 100 })], uploader, NOW);
    markImageFailed(doc, failed!);
    expect(displayStatus(readImage(doc, failed!)!, later)).toBe('failed');
  });

  it('TC-07: a failed image that is retried and left again goes unfinished on the same clock', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, [item({ x: 0, y: 0, width: 100, height: 100 })], uploader, NOW);
    markImageFailed(doc, id!);
    markImageRetrying(doc, id!, NOW + 10_000);

    expect(displayStatus(firstImage(doc), NOW + 10_000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });
});

describe('reading images out of a document', () => {
  it('TC-03: hands back only the images', () => {
    const doc = newDoc();
    createImagePlaceholders(doc, [item({ x: 0, y: 0, width: 100, height: 100 })], uploader, NOW);

    // Something that is not an image, in the same map.
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky-note');
    note.set('x', 0);
    note.set('y', 0);
    note.set('width', 100);
    note.set('height', 100);
    note.set('z', 5);
    note.set('createdAt', 1);
    doc.getMap('objects').set('a-note', note);

    expect(imageSnapshots(doc).map((image) => image.type)).toEqual(['image']);
    expect(imageSnapshots(doc)).toHaveLength(1);
    expect(isImageSnapshot(doc.getMap('objects').get('a-note') as never)).toBe(false);
  });
});

describe('the URL a stored image is served from', () => {
  it('TC-03: builds a URL from a key, and nothing from an image that has no key', () => {
    expect(assetUrl(KEY)).toBe(`/api/assets/${KEY}`);
    expect(assetUrl(null)).toBeNull();
  });
});
