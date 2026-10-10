import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import { LOCAL_ORIGIN, objectSnapshots } from '../../src/shared/board-model';
import {
  createImagePlaceholders,
  displayStatus,
  isImageSchema,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  markImageUnavailable,
  placementSize,
  readImage,
  type ImagePlacement,
  type ImageSnap,
} from '../../src/shared/objects/image';

/**
 * Unit tests for the image object model (anchor `image.placeholders`,
 * `image.status`) on a real `Y.Doc`.
 *
 * TC-03 proportional placement size, TC-04 row layout, TC-05 placeholders and
 * one undo step, TC-06 the 5-minute clock, TC-07 stale ids on status updates,
 * and the `image.schema` field list. TC-14's unit half (the image type's minimum
 * size) lives in `tests/unit/registry.test.ts`.
 */

/** A key the asset API could really have produced. */
const BOARD = 'brd1AAAAAAAAAAAAAAAAAA';
const KEY = `${BOARD}/asset1234567890abcdefghij`;

const items = (over: Partial<ImagePlacement>[] = []): ImagePlacement[] =>
  (over.length > 0 ? over : [{ x: 0, y: 0, width: 100, height: 80 }]).map((item) => ({
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    ...item,
  }));

/** The undo history the board keeps, so "one step" can be counted. */
const undoManagerOf = (doc: Y.Doc): Y.UndoManager =>
  new Y.UndoManager(doc.getMap<unknown>('objects'), {
    captureTimeout: 0,
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
  });

const imagesOf = (doc: Y.Doc): ImageSnap[] =>
  objectSnapshots(doc)
    .filter((obj) => obj.type === 'image')
    .map((obj) => obj as ImageSnap);

describe('image.placeholders - proportional size (TC-03)', () => {
  // TC-03
  it('TC-03 scales to fit 800x800 with the aspect ratio intact', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(1920, 1080)).toEqual({ width: 800, height: 450 });
    expect(placementSize(4032, 3024)).toEqual({ width: 800, height: 600 });
  });

  // TC-03
  it('TC-03 leaves anything that already fits at its natural size', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1, 1)).toEqual({ width: 1, height: 1 });
  });

  // TC-03 boundary: exactly 800 stays, 801 scales.
  it('TC-03 800 is the accepted side of the boundary', () => {
    expect(placementSize(IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD)).toEqual({
      width: 800,
      height: 800,
    });
    const scaled = placementSize(801, 801);
    expect(scaled).toEqual({ width: 800, height: 800 });
  });

  it('TC-03 a ratio is never rounded away: the stored sides keep the natural ratio', () => {
    for (const [nw, nh] of [
      [1440, 900],
      [300, 3200],
      [1024, 768],
      [768, 1024],
    ] as const) {
      const size = placementSize(nw, nh);
      if (!size) {
        throw new Error('a real image size must place');
      }
      expect(Math.abs(size.width / size.height - nw / nh)).toBeLessThan(1e-9);
    }
  });

  it('TC-03 a size that cannot describe a picture places nothing', () => {
    expect(placementSize(0, 100)).toBeNull();
    expect(placementSize(Number.NaN, 100)).toBeNull();
    expect(placementSize(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('image.placeholders - row layout (TC-04)', () => {
  const sizes = [
    { width: 100, height: 80 },
    { width: 200, height: 160 },
    { width: 50, height: 200 },
  ];
  const start = { x: 1000, y: 500 };

  // TC-04
  it('TC-04 a top-left anchor aligns tops at the point with the named gap between them', () => {
    const rects = layoutRow(sizes, start, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 1000, y: 500, width: 100, height: 80 });
    expect(rects[1]).toEqual({ x: 1000 + 100 + IMAGE_LAYOUT_GAP_WORLD, y: 500, width: 200, height: 160 });
    expect(rects[2]).toEqual({
      x: 1000 + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD,
      y: 500,
      width: 50,
      height: 200,
    });
    expect(rects.every((rect) => rect.y === start.y)).toBe(true);
  });

  // TC-04
  it('TC-04 a centre anchor centres the whole row on the point', () => {
    const rects = layoutRow(sizes, start, 'centre');
    const left = Math.min(...rects.map((rect) => rect.x));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const top = Math.min(...rects.map((rect) => rect.y));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    expect((left + right) / 2).toBeCloseTo(start.x, 6);
    expect((top + bottom) / 2).toBeCloseTo(start.y, 6);
    expect(rects.map((rect) => `${rect.width}x${rect.height}`)).toEqual(['100x80', '200x160', '50x200']);
    // The gaps are the same as the top-left row.
    const gaps = rects.slice(1).map((rect, i) => rect.x - (rects[i]!.x + rects[i]!.width));
    expect(gaps.every((gap) => gap === IMAGE_LAYOUT_GAP_WORLD)).toBe(true);
  });

  it('TC-04 one image sits on the point itself', () => {
    expect(layoutRow([{ width: 200, height: 100 }], start, 'top-left')).toEqual([
      { x: 1000, y: 500, width: 200, height: 100 },
    ]);
    expect(layoutRow([{ width: 200, height: 100 }], start, 'centre')).toEqual([
      { x: 900, y: 450, width: 200, height: 100 },
    ]);
    expect(layoutRow([], start, 'centre')).toEqual([]);
  });
});

describe('image.placeholders - placeholders and one undo step (TC-05)', () => {
  // TC-05
  it('TC-05 three placeholders are three ids, three objects, one undo step', () => {
    const doc = new Y.Doc();
    const undo = undoManagerOf(doc);
    const ids = createImagePlaceholders(
      doc,
      items([
        { x: 0, y: 0, width: 100, height: 80 },
        { x: 124, y: 0, width: 200, height: 160 },
        { x: 348, y: 0, width: 50, height: 200 },
      ]),
      'c_uploader',
      1000,
    );

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(objectSnapshots(doc)).toHaveLength(3);
    expect(undo.undoStack.length).toBe(1);

    const images = imagesOf(doc);
    expect(images.map((image) => image.id)).toEqual(ids);
    for (const image of images) {
      expect(image.type).toBe('image');
      expect(image.status).toBe('uploading');
      expect(image.assetKey).toBeNull();
      expect(image.contentType).toBeNull();
      expect(image.uploaderId).toBe('c_uploader');
      expect(image.uploadStartedAt).toBe(1000);
      expect(image.createdAt).toBe(1000);
      expect(image.createdBy).toBe('c_uploader');
      expect(displayStatus(image, 1000)).toBe('uploading');
    }
    // Distinct, increasing z, and the sizes are the ones asked for.
    const zValues = images.map((image) => image.z);
    expect(zValues).toEqual([...zValues].sort((a, b) => a - b));
    expect(new Set(zValues).size).toBe(3);
    expect(images.map((image) => `${image.width}x${image.height}`)).toEqual([
      '100x80',
      '200x160',
      '50x200',
    ]);

    // One undo removes the whole batch.
    undo.undo();
    expect(undo.undoStack.length).toBe(0);
    expect(objectSnapshots(doc)).toHaveLength(0);
    undo.destroy();
  });

  it('TC-05 width and height are always present on an image object', () => {
    const doc = new Y.Doc();
    createImagePlaceholders(doc, items(), 'c_uploader', 1);
    const image = imagesOf(doc)[0]!;
    expect(typeof image.width).toBe('number');
    expect(typeof image.height).toBe('number');
    expect(image.width > 0 && image.height > 0).toBe(true);
  });

  it('TC-05 a non-finite placement is skipped instead of written', () => {
    const doc = new Y.Doc();
    const ids = createImagePlaceholders(
      doc,
      items([
        { x: 0, y: 0, width: 100, height: 80 },
        { x: Number.NaN, y: 0, width: 100, height: 80 },
        { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 80 },
        { x: 0, y: 0, width: 100, height: 0 },
      ]),
      'c_uploader',
      1,
    );
    expect(ids).toHaveLength(1);
    expect(objectSnapshots(doc)).toHaveLength(1);
  });

  it('TC-05 nothing at all to place opens no transaction', () => {
    const doc = new Y.Doc();
    const undo = undoManagerOf(doc);
    expect(createImagePlaceholders(doc, [], 'c_uploader', 1)).toEqual([]);
    expect(undo.undoStack.length).toBe(0);
    undo.destroy();
  });
});

describe('image.status - the 5 minute clock (TC-06)', () => {
  /** An `uploading` image as the document would hold it, started at `startedAt`. */
  const uploading = (startedAt: number): ImageSnap => ({
    id: 'img-clock',
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    z: 1,
    createdAt: startedAt,
    createdBy: 'c_uploader',
    assetKey: null,
    contentType: null,
    naturalWidth: 100,
    naturalHeight: 80,
    status: 'uploading',
    uploadStartedAt: startedAt,
    uploaderId: 'c_uploader',
  });

  // TC-06 boundary: 5 minutes minus a step is uploading, plus a step is unfinished.
  it('TC-06 uploading turns into unfinished across the 5 minute line and nothing else', () => {
    const staleAt = IMAGE_UPLOAD_STALE_MS;
    expect(displayStatus(uploading(0), staleAt - 1)).toBe('uploading');
    expect(displayStatus(uploading(0), staleAt)).toBe('uploading');
    expect(displayStatus(uploading(0), staleAt + 1)).toBe('unfinished');
    expect(displayStatus(uploading(0), staleAt + 10 * 60 * 1000)).toBe('unfinished');
  });

  it('TC-06 a ready image stays ready however long the clock runs', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items(), 'c_uploader', 0);
    markImageReady(doc, id!, KEY);
    const image = readImage(doc, id!)!;
    expect(displayStatus(image, IMAGE_UPLOAD_STALE_MS * 100)).toBe('ready');
  });

  it('TC-06 the stored statuses pass through, and an unfinished one stays unfinished', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items(), 'c_uploader', 0);
    markImageFailed(doc, id!);
    expect(displayStatus(readImage(doc, id!)!, 0)).toBe('failed');
    markImageUnavailable(doc, id!);
    expect(displayStatus(readImage(doc, id!)!, 0)).toBe('unavailable');
    // The computed unfinished is stored the same way once written.
    expect(displayStatus({ ...readImage(doc, id!)!, status: 'unfinished' }, 0)).toBe('unfinished');
  });
});

describe('image.status - stale ids (TC-07)', () => {
  // TC-07
  it('TC-07 an id no longer in the doc is refused without an update', () => {
    const doc = new Y.Doc();
    const undo = undoManagerOf(doc);
    createImagePlaceholders(doc, items(), 'c_uploader', 1000);
    const before = objectSnapshots(doc);

    expect(markImageReady(doc, 'gone', KEY)).toBe(false);
    expect(markImageRetrying(doc, 'gone', 2000)).toBe(false);
    expect(markImageFailed(doc, 'gone')).toBe(false);
    expect(markImageUnavailable(doc, 'gone')).toBe(false);
    expect(markImageReady(doc, '', KEY)).toBe(false);

    expect(objectSnapshots(doc)).toHaveLength(before.length);
    expect(readImage(doc, 'gone')).toBeNull();
    undo.destroy();
  });

  // TC-07
  it('TC-07 retry re-publishes uploading with a fresh start time', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items(), 'c_uploader', 1000);
    markImageFailed(doc, id!);
    expect(readImage(doc, id!)!.status).toBe('failed');

    expect(markImageRetrying(doc, id!, 5000)).toBe(true);
    const retrying = readImage(doc, id!)!;
    expect(retrying.status).toBe('uploading');
    expect(retrying.uploadStartedAt).toBe(5000);
    expect(retrying.assetKey).toBeNull();
    expect(displayStatus(retrying, 5001)).toBe('uploading');
    expect(displayStatus(retrying, 5000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('TC-07 a successful upload stores the key and no URL', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items(), 'c_uploader', 1000);
    expect(markImageReady(doc, id!, KEY, 'image/png')).toBe(true);
    const image = readImage(doc, id!)!;
    expect(image.status).toBe('ready');
    expect(image.assetKey).toBe(KEY);
    expect(image.contentType).toBe('image/png');
    expect(isImageSchema(image)).toBe(true);

    const stored = doc.getMap<unknown>('objects').get(id!) as Y.Map<unknown>;
    expect([...stored.keys()].sort()).toEqual([
      'assetKey',
      'contentType',
      'createdAt',
      'createdBy',
      'height',
      'naturalHeight',
      'naturalWidth',
      'status',
      'type',
      'uploadStartedAt',
      'uploaderId',
      'width',
      'x',
      'y',
      'z',
    ]);
    for (const forbidden of ['url', 'src', 'href', 'path', 'dataUrl']) {
      expect(stored.has(forbidden)).toBe(false);
    }
  });

  it('TC-07 status updates stay out of the undo history', () => {
    const doc = new Y.Doc();
    const undo = undoManagerOf(doc);
    const [id] = createImagePlaceholders(doc, items(), 'c_uploader', 1000);
    expect(undo.undoStack.length).toBe(1);

    markImageReady(doc, id!, KEY);
    markImageFailed(doc, id!);
    markImageRetrying(doc, id!, 2000);
    markImageUnavailable(doc, id!);
    expect(undo.undoStack.length).toBe(1);

    // Undoing the insert takes the whole image with it, ready or not.
    undo.undo();
    expect(objectSnapshots(doc)).toHaveLength(0);
    undo.destroy();
  });

  it('TC-07 a malformed asset key is refused at write time', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items(), 'c_uploader', 1000);
    for (const key of [`${BOARD}/short`, 'a/b', `${BOARD}/..`, '', `${BOARD}/a/b`]) {
      expect(markImageReady(doc, id!, key)).toBe(false);
    }
    expect(readImage(doc, id!)!.status).toBe('uploading');
    expect(readImage(doc, id!)!.assetKey).toBeNull();
  });
});

describe('image.schema - the field list (TC-14 storage half)', () => {
  it('isImageSchema accepts a real image and refuses everything else', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items(), 'c_uploader', 1000);
    markImageReady(doc, id!, KEY);
    const image = readImage(doc, id!)!;
    expect(isImageSchema(image)).toBe(true);

    expect(isImageSchema({ ...image, width: undefined })).toBe(false);
    expect(isImageSchema({ ...image, height: Number.NaN })).toBe(false);
    expect(isImageSchema({ ...image, status: 'done' })).toBe(false);
    expect(isImageSchema({ ...image, assetKey: `${BOARD}/short` })).toBe(false);
    expect(isImageSchema({ ...image, x: '0' })).toBe(false);
    expect(isImageSchema({ ...image, url: '/api/assets/brd/asset1234567890abcdefghij' })).toBe(false);
    expect(isImageSchema(null)).toBe(false);
    expect(isImageSchema('image')).toBe(false);
    expect(isImageSchema(objectSnapshots(doc)[0]!)).toBe(true);
  });

  it('an image is part of the selectable object types the generic machinery reads', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items(), 'c_uploader', 1000);
    const image = imagesOf(doc)[0]!;
    expect(image.id).toBe(id);
    // `objectSnapshots()` reads it like any other object, so story 7's machinery applies.
    expect(objectSnapshots(doc).map((obj) => obj.id)).toEqual([id]);
    expect(objectSnapshots(doc)[0]!.width).toBe(100);
  });
});
