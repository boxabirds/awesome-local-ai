// Story 12 task 2 — image.model, on a real Y.Doc with a real UndoManager.
//
// What this suite holds is the part of "dropping a picture" that has nothing to do with a
// picture: where a box goes, what a record says about an upload, and which of those writes a
// person can undo. They are tested against yjs itself rather than a stub because the answers
// come from yjs's own transaction and undo machinery — an `UndoManager` that tracks origins is
// the whole mechanism behind "undoing your note does not un-finish somebody's photo", and a
// fake that agrees with my opinion of it would prove nothing.
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, initDoc, objectSnapshots } from '../../src/shared/board-model.ts';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config.ts';
import {
  asImageSnapshot,
  assetUrl,
  createImagePlaceholders,
  displayStatus,
  imageSnapshot,
  imageSnapshots,
  imageStatus,
  isImageSnapshot,
  isUploaderView,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  rowExtent,
  UPLOAD_ORIGIN,
  type ImagePlacement,
  type Size,
} from '../../src/shared/objects/image.ts';

const T0 = 1_700_000_000_000;
/** The tab doing the uploading, and a second tab on the same board. */
const Leo = 'leo-tab';
const Nora = 'nora-tab';

function item(naturalWidth: number, naturalHeight: number, x = 0): ImagePlacement {
  const size = placementSize(naturalWidth, naturalHeight) ?? { width: 0, height: 0 };
  return {
    rect: { x, y: 0, width: size.width, height: size.height },
    naturalWidth,
    naturalHeight,
    contentType: 'image/png',
  };
}

/** An image record written by hand, for the cases no honest creation produces. */
function rawImage(
  doc: Y.Doc,
  id: string,
  fields: Record<string, unknown>,
  origin: unknown = LOCAL_ORIGIN,
): void {
  doc.transact(() => {
    const o = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(fields)) o.set(key, value);
    doc.getMap<Y.Map<unknown>>('objects').set(id, o);
  }, origin);
}

describe('placementSize (image.placement_size)', () => {
  it('TC-03 scales the longest side to the ceiling and never upscales', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(800, 800)).toEqual({ width: IMAGE_MAX_PLACE_SIZE_WORLD, height: 800 });
  });

  it('TC-03 keeps proportions, whichever side is longer', () => {
    for (const [w, h] of [
      [4032, 3024],
      [3024, 4032],
      [1440, 900],
      [900, 1440],
    ]) {
      const placed = placementSize(w, h)!;
      expect(placed.width / placed.height).toBeCloseTo(w / h, 2);
      expect(Math.max(placed.width, placed.height)).toBeLessThanOrEqual(
        IMAGE_MAX_PLACE_SIZE_WORLD,
      );
    }
  });

  it('leaves a long thin picture a long thin strip', () => {
    // Nothing lifts a thin strip back up to a seeable size: a 40 x 4000 panorama becomes an
    // 8 x 800 strip and stays one. The PRD's placement rule is only the ceiling, and the
    // setting that does bound how small an image can get (IMAGE_MIN_SIZE_WORLD) belongs to the
    // resize gesture, where a person is choosing the size — not to placing one they dropped.
    expect(placementSize(40, 4000)).toEqual({ width: 8, height: 800 });
    expect(placementSize(1, 1)).toEqual({ width: 1, height: 1 });
    expect(IMAGE_MIN_SIZE_WORLD).toBeLessThan(IMAGE_MAX_PLACE_SIZE_WORLD);
  });

  it('TC-03 reports nothing for a file that reports no usable dimensions', () => {
    // The client measures the picture before creating anything, so a measurement of zero is a
    // file that never told us its size — and a box with no proportions is an object that
    // cannot be resized, only sat on.
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [-5, 10],
      [Number.NaN, 10],
      [10, Number.POSITIVE_INFINITY],
    ]) {
      expect(placementSize(w, h)).toBeNull();
    }
  });
});

describe('layoutRow (image.drop, image.pick)', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 200, height: 100 },
    { width: 60, height: 60 },
  ];

  it('TC-04 lays a row out left to right, level at the top, IMAGE_LAYOUT_GAP_WORLD apart', () => {
    const rects = layoutRow(sizes, { x: 10, y: 20 }, 'top-left');
    expect(rects).toEqual([
      { x: 10, y: 20, width: 100, height: 50 },
      { x: 134, y: 20, width: 200, height: 100 },
      { x: 358, y: 20, width: 60, height: 60 },
    ]);
    expect(rects[1].x - (rects[0].x + rects[0].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    expect(new Set(rects.map((r) => r.y)).size).toBe(1);
  });

  it('TC-04 centres a row on the point it is given', () => {
    // The middle of the row — the whole strip, gaps included — lands on the point, which for a
    // picker or a paste is the middle of what the person can see.
    const rects = layoutRow(sizes, { x: 500, y: 300 }, 'centre');
    const extent = rowExtent(sizes);
    expect(extent.width).toBe(100 + 200 + 60 + 2 * IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[0].x).toBe(500 - extent.width / 2);
    expect(rects[0].y).toBe(300 - extent.height / 2);
    const right = rects[2].x + rects[2].width;
    expect((rects[0].x + right) / 2).toBe(500);
  });

  it('anchors at the point when told nothing, and lays out an empty row as nothing', () => {
    expect(layoutRow([sizes[0]], { x: 7, y: 9 })).toEqual([
      { x: 7, y: 9, width: 100, height: 50 },
    ]);
    expect(layoutRow([], { x: 7, y: 9 })).toEqual([]);
    expect(rowExtent([])).toEqual({ width: 0, height: 0 });
  });
});

describe('createImagePlaceholders (image.insert, undo.image_insert)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('TC-05 writes three placeholders as one local update, ready to be undone as one', () => {
    const natural = [
      [400, 320],
      [800, 600],
      [300, 300],
    ];
    const laidOutList: Size[] = [
      { width: 100, height: 80 },
      { width: 200, height: 150 },
      { width: 90, height: 90 },
    ];
    const laidOut = (i: number) => laidOutList[i]!;
    const updates: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => updates.push(origin));

    const ids = createImagePlaceholders(
      doc,
      layoutRow(laidOutList, { x: 0, y: 0 }).map((rect, i) => ({
        rect,
        naturalWidth: natural[i]![0],
        naturalHeight: natural[i]![1],
        contentType: 'image/png',
      })),
      Leo,
      T0,
    );

    expect(ids).toHaveLength(3);
    // One transaction: one update on the wire, so three dropped files arrive on every other
    // screen in the same moment, and one step in this tab's history.
    expect(updates).toEqual([LOCAL_ORIGIN]);

    const images = imageSnapshots(doc);
    expect(images).toHaveLength(3);
    for (const [i, image] of images.entries()) {
      expect(image.status).toBe('uploading');
      expect(image.uploaderId).toBe(Leo);
      expect(image.uploadStartedAt).toBe(T0);
      // Nothing is known about where the bytes are: the server that stores them is the one
      // that names the address, and it has not answered yet.
      expect(image.assetKey).toBeNull();
      // The box is the one the caller laid out, not a size recomputed on arrival: the layout
      // does not move when the upload finishes.
      expect({ width: image.width, height: image.height }).toEqual(laidOut(i));
    }
    expect(images[1].x).toBe(124);
  });

  it('TC-05 undoes the whole add in one step, and a finished upload is not a step of its own', () => {
    // The history is open before the drop, which is how the app has it too: an UndoManager
    // only ever holds what happened while it was listening.
    const manager = new Y.UndoManager(doc.getMap('objects'), {
      captureTimeout: 0,
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    });
    const ids = createImagePlaceholders(
      doc,
      [item(400, 300), item(640, 480), item(300, 300)],
      Leo,
      T0,
    );

    expect(markImageReady(doc, ids[1]!, 'board/asset', 'image/jpeg')).toBe(true);
    // The upload finishing is not a thing the user did, so it is not a step: the history still
    // holds one entry, and undoing it takes all three objects away — including the ready one.
    // Without the separate origin, undoing a note typed thirty seconds after a drop would put
    // the photo back in a grey box and redo would be expected to fetch it again.
    expect(manager.undoStack.length).toBe(1);
    expect(imageSnapshot(doc, ids[1]!)!.status).toBe('ready');

    manager.undo();
    expect(imageSnapshots(doc)).toEqual([]);
    expect(objectSnapshots(doc).some((o) => o.type === 'image')).toBe(false);

    manager.redo();
    expect(imageSnapshots(doc)).toHaveLength(3);
    // The redo restores what this tab wrote: the placeholders, with the upload's answer left
    // where the record put it.
    expect(imageSnapshot(doc, ids[1]!)!.status).toBe('ready');
    manager.destroy();
  });

  it('writes nothing at all for an add of nothing, so it is not an undo step either', () => {
    const updates: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => updates.push(origin));
    expect(createImagePlaceholders(doc, [], Leo, T0)).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('skips an item with no usable dimensions instead of creating an object of size zero', () => {
    const ids = createImagePlaceholders(
      doc,
      [item(400, 300), item(0, 0), item(640, 480)],
      Leo,
      T0,
    );
    // Two objects, in the boxes the caller laid out for the files that could be measured; the
    // file that reported no size was refused before the drop, and refusing again here is what
    // keeps a hand-written call from writing an unrenderable object.
    expect(ids).toHaveLength(2);
    expect(imageSnapshots(doc).map((i) => i.naturalWidth)).toEqual([400, 640]);
  });

  it('stacks above everything already on the board', () => {
    createImagePlaceholders(doc, [item(400, 300)], Leo, T0);
    const before = imageSnapshots(doc)[0]!.z;
    createImagePlaceholders(doc, [item(400, 300)], Nora, T0 + 1);
    const images = imageSnapshots(doc);
    expect(images[1]!.z).toBeGreaterThan(before);
    expect(images[1]!.uploaderId).toBe(Nora);
  });

  it('TC-07 refuses to write about an id that is not there, and writes nothing', () => {
    const ids = createImagePlaceholders(doc, [item(400, 300)], Leo, T0);
    const updateCount = () => {
      let n = 0;
      const listener = () => n++;
      doc.on('update', listener);
      return {
        stop: () => {
          doc.off('update', listener);
          return n;
        },
      };
    };

    const gone = ids[0]!;
    doc.transact(() => doc.getMap<Y.Map<unknown>>('objects').delete(gone), LOCAL_ORIGIN);

    for (const write of [
      () => markImageReady(doc, gone, 'board/asset', 'image/png'),
      () => markImageFailed(doc, gone),
      () => markImageRetrying(doc, gone, Leo, T0 + 1000),
    ]) {
      const counting = updateCount();
      expect(write()).toBe(false);
      // A stale id is an object that is gone: not a state to update, and no update goes on the
      // wire for it.
      expect(counting.stop()).toBe(0);
    }
    // An id that was never an image is the same answer.
    expect(markImageFailed(doc, 'no-such-object')).toBe(false);
  });

  it('carries the status writes under an origin the undo history does not track', () => {
    const [id] = createImagePlaceholders(doc, [item(400, 300)], Leo, T0);
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));

    markImageReady(doc, id!, 'board/asset', 'image/png');
    markImageFailed(doc, id!);
    markImageRetrying(doc, id!, Leo, T0 + 5000);

    // Three writes, none of them LOCAL_ORIGIN: whatever the upload does, this tab's undo
    // history has one step about the drop and no steps about the network.
    expect(origins.filter((o) => o === LOCAL_ORIGIN)).toEqual([]);
    expect(origins.every((o) => o === UPLOAD_ORIGIN)).toBe(true);
    expect(imageStatus(doc, id!)).toBe('uploading');
    expect(imageSnapshot(doc, id!)!.uploadStartedAt).toBe(T0 + 5000);
  });
});

describe('the record read back as an image', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('refuses to render an image whose own record cannot be used', () => {
    const [id] = createImagePlaceholders(doc, [item(400, 300)], Leo, T0);
    expect(isImageSnapshot(objectSnapshots(doc).find((o) => o.id === id))).toBe(true);
    const image = imageSnapshot(doc, id)!;

    // A record that cannot say how big the picture is has nothing to size a box by, and a
    // record whose status is a word this board does not use cannot be rendered at all.
    expect(asImageSnapshot({ ...image, naturalWidth: Number.NaN })).toBeNull();
    expect(asImageSnapshot({ ...image, uploadStartedAt: undefined })).toBeNull();
    expect(asImageSnapshot({ ...image, status: 'done' as never })).toBeNull();
    expect(asImageSnapshot(null)).toBeNull();
    expect(isImageSnapshot({ ...image, type: 'sticky' as never })).toBe(false);
  });

  it('keeps a ready image with no address as an image, because there is something to say about it', () => {
    // The record claims a picture exists and cannot say where. Dropping the object would be
    // the board forgetting a picture the board still has; the screen's answer is "Image
    // unavailable", which is only reachable if the object is still an image.
    rawImage(
      doc,
      'ready-without-address',
      {
        type: 'image',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        z: 1,
        assetKey: null,
        contentType: 'image/png',
        naturalWidth: 400,
        naturalHeight: 320,
        status: 'ready',
        uploadStartedAt: T0,
        uploaderId: Leo,
      },
      UPLOAD_ORIGIN,
    );
    const image = imageSnapshot(doc, 'ready-without-address')!;
    expect(image.status).toBe('ready');
    expect(image.assetKey).toBeNull();
    expect(displayStatus(image, T0 + 10)).toBe('ready');
  });

  it('is not an image at all when the type is something else', () => {
    rawImage(doc, 'a-note', { type: 'sticky', x: 0, y: 0, width: 100, height: 100, z: 1 });
    expect(imageSnapshot(doc, 'a-note')).toBeNull();
    expect(imageStatus(doc, 'a-note')).toBeNull();
    expect(imageSnapshots(doc)).toEqual([]);
  });
});

describe('displayStatus (image.uploading, image.unfinished)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  const one = (overrides: Partial<ImagePlacement> = {}) => {
    const base = item(800, 600);
    return createImagePlaceholders(
      doc,
      [{ ...base, ...overrides, rect: overrides.rect ?? base.rect }],
      Leo,
      T0,
    )[0]!;
  };

  it('TC-06 turns at IMAGE_UPLOAD_STALE_MS and not before', () => {
    const id = one();
    const image = imageSnapshot(doc, id)!;
    expect(displayStatus(image, T0 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(image, T0 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    // Every screen agrees, because the clock is in the record and not in anybody's tab: this
    // is one number read at two moments, not a state anybody wrote.
    expect(displayStatus(image, T0 + IMAGE_UPLOAD_STALE_MS + 1)).toBe(
      displayStatus(image, T0 + IMAGE_UPLOAD_STALE_MS + 1),
    );
  });

  it('TC-06 says what the record says once the bytes have answered', () => {
    const id = one();
    markImageReady(doc, id, 'board/asset', 'image/png');
    const ready = imageSnapshot(doc, id)!;
    // A finished upload stops ageing: five minutes on, an hour on, it is a picture.
    expect(displayStatus(ready, T0 + IMAGE_UPLOAD_STALE_MS * 12)).toBe('ready');

    markImageFailed(doc, id);
    expect(displayStatus(imageSnapshot(doc, id)!, T0)).toBe('failed');
  });

  it('has no opinion about an object that is not a usable image', () => {
    expect(displayStatus(null, T0)).toBeNull();
    expect(displayStatus(undefined, T0)).toBeNull();
  });

  it('says which screen has the file, which is all a Retry button needs', () => {
    const id = one();
    markImageFailed(doc, id);
    const image = imageSnapshot(doc, id)!;
    // "Upload failed" plus Retry for one tab, "Image unavailable" for the rest: one record, and
    // the comparison that tells them apart is this one.
    expect(isUploaderView(image, Leo)).toBe(true);
    expect(isUploaderView(image, Nora)).toBe(false);
    expect(isUploaderView(image, '')).toBe(false);
  });

  it('rounds a whole upload through the states, in order', () => {
    const id = one();
    expect(displayStatus(imageSnapshot(doc, id)!, T0)).toBe('uploading');
    markImageReady(doc, id, 'board/asset', 'image/png');
    expect(displayStatus(imageSnapshot(doc, id)!, T0)).toBe('ready');
    // A retry restarts the clock, which is the reason this function exists: without the new
    // timestamp, an upload that has only just begun again would be reported as abandoned the
    // moment it started.
    markImageRetrying(doc, id, Nora, T0 + 60_000);
    const retrying = imageSnapshot(doc, id)!;
    expect(retrying.status).toBe('uploading');
    expect(displayStatus(retrying, T0 + 61_000)).toBe('uploading');
    expect(displayStatus(retrying, T0 + 60_000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    // The address of an attempt that has not happened is not known yet.
    expect(retrying.assetKey).toBeNull();
  });
});

describe('assetUrl', () => {
  it('is the address of the bytes, with the board’s id in it', () => {
    // The key begins with the board id, so the address is the key; the route re-checks the two
    // against each other, which is what stops an edited address naming another board's file.
    expect(assetUrl('vKd9nR2pQ8sT4uW1xY7zA3/aB3dE5fG7hI9jK1lM3nO5p')).toBe(
      '/api/assets/vKd9nR2pQ8sT4uW1xY7zA3/aB3dE5fG7hI9jK1lM3nO5p',
    );
  });
});
