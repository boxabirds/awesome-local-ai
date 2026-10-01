// Task 2, cases 03 to 07: the image object model - where a picture is placed, how a row of
// them is laid out, what a placeholder holds, what the status writes change and what they
// must never change, and which of those writes an undo manager is allowed to see.
//
// The two cases that carry the story are 05 and 06. Case 05 is the PRD's "Undo once removes
// all placeholders from one multi-drop": three placeholders are one transaction under
// `LOCAL_ORIGIN`, so one undo removes all three. Case 06 is the other half - an upload that
// lands afterwards is not an undo step, so `markImageReady` writes under `UPLOAD_ORIGIN`,
// and one Ctrl+Z after three images have landed still takes away the three of them rather
// than taking back one upload.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
  TYPE_IMAGE,
} from '../../src/shared/config';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  UPLOAD_ORIGIN,
  createImagePlaceholders,
  displayStatus,
  imageSnapshot,
  imageSnapshots,
  imageUrl,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImageSnapshot,
  type PlaceholderItem,
} from '../../src/shared/objects/image';

const START = { x: 100, y: 200 };

function items(...sizes: [number, number][]): PlaceholderItem[] {
  const rects = layoutRow(
    sizes.map(([naturalWidth, naturalHeight]) => placementSize(naturalWidth, naturalHeight)),
    START,
    'top-left',
  );
  return sizes.map(([naturalWidth, naturalHeight], index) => ({
    rect: rects[index],
    naturalWidth,
    naturalHeight,
    contentType: 'image/png',
  }));
}

function ready(id: string, over: Partial<ImageSnapshot> = {}): ImageSnapshot {
  return {
    id,
    type: TYPE_IMAGE,
    x: 0,
    y: 0,
    z: 1,
    width: 100,
    height: 50,
    createdAt: 1000,
    assetKey: 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB',
    contentType: 'image/png',
    naturalWidth: 200,
    naturalHeight: 100,
    status: 'ready',
    uploadStartedAt: 900,
    uploaderId: 'me',
    ...over,
  };
}

describe('03 placementSize', () => {
  it('leaves a picture smaller than the limit exactly its natural size', () => {
    // 400x300 is not scaled up to the cap: a small image is not blown up to fill the board
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('scales the longest edge down to the limit and keeps the proportions', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('caps a tall picture on its long edge, so it comes out narrow', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('a picture exactly at the limit is not scaled at all', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });

  it('never grows a picture, however flat', () => {
    expect(placementSize(20, 4)).toEqual({ width: 20, height: 4 });
    expect(placementSize(4, 20)).toEqual({ width: 4, height: 20 });
  });

  it('a size that is not a usable number places nothing', () => {
    for (const [width, height] of [
      [0, 100],
      [100, 0],
      [-100, 100],
      [Number.NaN, 100],
      [100, Number.POSITIVE_INFINITY],
    ]) {
      expect(placementSize(width, height)).toEqual({ width: 0, height: 0 });
    }
  });

  it('the limit and the resize floor are different settings', () => {
    // the placement cap says how big a picture arrives; the floor says how small a resize may
    // take it; neither is the other, and the global maximum stays the maximum
    expect(IMAGE_MAX_PLACE_SIZE_WORLD).toBe(800);
    expect(IMAGE_MIN_SIZE_WORLD).toBe(16);
  });
});

describe('04 layoutRow', () => {
  it('puts a row at the point, left to right, with the gap between and tops aligned', () => {
    const rects = layoutRow([{ width: 100, height: 80 }, { width: 200, height: 80 }], START, 'top-left');
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ x: 100, y: 200, width: 100, height: 80 });
    expect(rects[1]).toEqual({
      x: 100 + 100 + IMAGE_LAYOUT_GAP_WORLD,
      y: 200,
      width: 200,
      height: 80,
    });
  });

  it('keeps the tops on one line even when the boxes differ in height', () => {
    const rects = layoutRow(
      [{ width: 100, height: 400 }, { width: 100, height: 20 }, { width: 50, height: 300 }],
      START,
      'top-left',
    );
    expect(rects.map((rect) => rect.y)).toEqual([200, 200, 200]);
    // each gap is the same, and no box is stretched to the row
    expect(rects[1].x - (rects[0].x + rects[0].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x - (rects[1].x + rects[1].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].height).toBe(20);
  });

  it('centres the whole row on the point with the centre anchor', () => {
    const sizes = [
      { width: 100, height: 80 },
      { width: 200, height: 160 },
      { width: 60, height: 40 },
    ];
    const rects = layoutRow(sizes, START, 'centre');
    const rowWidth = 100 + 200 + 60 + IMAGE_LAYOUT_GAP_WORLD * 2;
    const rowHeight = 160;
    // the row as a whole is centred: its left edge and its right edge are as far from the
    // point as each other, in both directions
    expect(rects[0].x).toBeCloseTo(START.x - rowWidth / 2, 6);
    expect(rects[2].x + rects[2].width).toBeCloseTo(START.x + rowWidth / 2, 6);
    expect(rects[0].y).toBeCloseTo(START.y - rowHeight / 2, 6);
    // and it is still one row of boxes, not a scatter
    expect(rects.map((rect) => rect.y)).toEqual([rects[0].y, rects[0].y, rects[0].y]);
  });

  it('one size gives one box at the point', () => {
    expect(layoutRow([{ width: 300, height: 200 }], START, 'top-left')).toEqual([
      { x: START.x, y: START.y, width: 300, height: 200 },
    ]);
    expect(layoutRow([{ width: 300, height: 200 }], START, 'centre')).toEqual([
      { x: START.x - 150, y: START.y - 100, width: 300, height: 200 },
    ]);
  });

  it('no sizes gives no boxes', () => {
    expect(layoutRow([], START, 'top-left')).toEqual([]);
    expect(layoutRow([], START, 'centre')).toEqual([]);
  });

  it('a box of nothing takes no place in the row', () => {
    const rects = layoutRow([{ width: 100, height: 100 }, { width: 0, height: 0 }], START, 'top-left');
    expect(rects).toHaveLength(1);
  });

  it('the gap is the setting, and it is between boxes rather than inside them', () => {
    expect(IMAGE_LAYOUT_GAP_WORLD).toBe(24);
    const rects = layoutRow(
      new Array(5).fill({ width: 40, height: 40 }),
      START,
      'top-left',
    );
    expect(rects[4].x + 40 - START.x).toBe(5 * 40 + 4 * IMAGE_LAYOUT_GAP_WORLD);
  });
});

describe('05 createImagePlaceholders', () => {
  it('creates one readable image per item, in the row it was given', () => {
    const doc = new Y.Doc();
    const ids = createImagePlaceholders(doc, items([400, 300], [1600, 1200], [400, 300]), 'me', 1000);
    expect(ids).toHaveLength(3);

    const images = imageSnapshots(doc);
    expect(images).toHaveLength(3);
    expect(images.map((image) => image.id)).toEqual(ids);

    // left to right, in the order given, with the placement sizes
    const [first, second, third] = images;
    expect(first.x).toBeCloseTo(START.x, 6);
    expect(second.x).toBeCloseTo(START.x + first.width + IMAGE_LAYOUT_GAP_WORLD, 6);
    expect(third.x).toBeCloseTo(second.x + second.width + IMAGE_LAYOUT_GAP_WORLD, 6);
    expect([first.width, first.height]).toEqual([400, 300]);
    expect([second.width, second.height]).toEqual([800, 600]);
    expect(images.map((image) => image.y)).toEqual([START.y, START.y, START.y]);

    // z is the next index per object, in order, so the row arrives on top of the board
    expect(images.map((image) => image.z)).toEqual([1, 2, 3]);

    for (const image of images) {
      expect(image.type).toBe(TYPE_IMAGE);
      expect(image.status).toBe('uploading');
      expect(image.assetKey).toBeNull();
      expect(image.contentType).toBe('image/png');
      expect(image.uploaderId).toBe('me');
      expect(image.uploadStartedAt).toBe(1000);
      expect(image.createdAt).toBe(1000);
      expect(image.naturalHeight).toBeGreaterThan(0);
    }
    // a placeholder has its box before it has its bytes
    expect(images.every((image) => image.width > 0 && image.height > 0)).toBe(true);
  });

  it('one multi-drop is one undo step: undo once removes all three placeholders', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const undo = new Y.UndoManager(objects, { trackedOrigins: new Set([LOCAL_ORIGIN]) });

    createImagePlaceholders(doc, items([400, 300], [400, 300], [400, 300]), 'me', 1000);
    expect(imageSnapshots(doc)).toHaveLength(3);
    // the addition itself is the only thing the manager was asked to remember
    expect(undo.undoStack.length).toBe(1);
    expect(undo.redoStack.length).toBe(0);

    undo.undo();
    expect(imageSnapshots(doc)).toHaveLength(0);
    expect(undo.redoStack.length).toBe(1);

    undo.redo();
    expect(imageSnapshots(doc)).toHaveLength(3);
  });

  it('a batch of one undoes the same way', () => {
    const doc = new Y.Doc();
    const undo = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
    const ids = createImagePlaceholders(doc, items([640, 480]), 'me', 1000);
    expect(ids).toHaveLength(1);
    undo.undo();
    expect(imageSnapshot(doc, ids[0])).toBeNull();
  });

  it('skips items whose box or size is not usable and creates the rest', () => {
    const doc = new Y.Doc();
    const ids = createImagePlaceholders(
      doc,
      [
        { rect: { x: 0, y: 0, width: 0, height: 0 }, naturalWidth: 0, naturalHeight: 0, contentType: 'image/png' },
        {
          rect: { x: 10, y: 10, width: Number.NaN, height: 20 },
          naturalWidth: 100,
          naturalHeight: 200,
          contentType: 'image/png',
        },
        { rect: { x: 20, y: 20, width: 100, height: 200 }, naturalWidth: 100, naturalHeight: 200, contentType: 'image/png' },
      ],
      'me',
      1000,
    );
    expect(ids).toHaveLength(1);
    expect(imageSnapshots(doc)).toHaveLength(1);
    expect(imageSnapshot(doc, ids[0])?.x).toBe(20);
  });

  it('nothing to place is no transaction at all', () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    expect(createImagePlaceholders(doc, [], 'me', 1000)).toEqual([]);
    expect(updates).toBe(0);
  });

  it('a placeholder is one object among all the others, and reads as an image only', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items([400, 300]), 'me', 1000);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.get(id)?.get('type')).toBe(TYPE_IMAGE);
    // another type's entry is not an image, whoever it is
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    objects.set('note-1', note);
    expect(imageSnapshot(doc, 'note-1')).toBeNull();
    expect(imageSnapshots(doc).map((image) => image.id)).toEqual([id]);
  });
});

describe('06 the status writes, and what undo is allowed to see', () => {
  it('markImageReady records the key and leaves the box where it is', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items([300, 3200]), 'me', 1000);
    const before = imageSnapshot(doc, id);

    expect(markImageReady(doc, id, 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB')).toBe(true);
    const after = imageSnapshot(doc, id);
    expect(after?.status).toBe('ready');
    expect(after?.assetKey).toBe('AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB');
    // the box does not move and does not resize: the bytes do not decide where a picture is
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
    expect(after?.naturalWidth).toBe(300);
    expect(after?.naturalHeight).toBe(3200);
    expect(after?.contentType).toBe('image/png');
    expect(imageUrl(after!)).toBe('/api/assets/AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB');
    expect(imageUrl({ assetKey: null })).toBeNull();
  });

  it('an upload that lands is not an undo step: one Ctrl+Z still removes all three', () => {
    const doc = new Y.Doc();
    const undo = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    const ids = createImagePlaceholders(doc, items([400, 300], [400, 300], [400, 300]), 'me', 1000);
    for (const id of ids) expect(markImageReady(doc, id, 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB')).toBe(true);

    // three uploads, still one step - the uploads wrote under an origin nobody tracks
    expect(undo.undoStack.length).toBe(1);

    undo.undo();
    expect(imageSnapshots(doc)).toHaveLength(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('the status writes are visible on the wire, under an origin of their own', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });
    const [id] = createImagePlaceholders(doc, items([400, 300]), 'me', 1000);
    markImageReady(doc, id, 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB');
    markImageFailed(doc, id);
    markImageRetrying(doc, id, 2000);

    expect(origins).toEqual([LOCAL_ORIGIN, UPLOAD_ORIGIN, UPLOAD_ORIGIN, UPLOAD_ORIGIN]);
    // and the retry clock is the retrying client's, so a stale image gets its window again
    expect(imageSnapshot(doc, id)?.uploadStartedAt).toBe(2000);
  });

  it('markImageFailed keeps the image and its box, with nothing to show', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items([640, 480]), 'me', 1000);
    expect(markImageFailed(doc, id)).toBe(true);
    const image = imageSnapshot(doc, id);
    expect(image?.status).toBe('failed');
    expect(image?.assetKey).toBeNull();
    expect(image?.width).toBe(640);
    expect(image?.height).toBe(480);
  });

  it('every status write on a gone object is false and writes nothing', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items([400, 300]), 'me', 1000);
    doc.getMap('objects').delete(id);
    expect(doc.getMap('objects').size).toBe(0);

    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    // the uploader deleted the placeholder while its upload was in flight: that is a thing
    // that happened, and the late answer about it changes nothing
    expect(markImageReady(doc, id, 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB')).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 3000)).toBe(false);
    expect(updates).toBe(0);
  });

  it('an object that is not an image is refused by every status write', () => {
    const doc = new Y.Doc();
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    doc.getMap<Y.Map<unknown>>('objects').set('note-1', note);

    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    expect(markImageReady(doc, 'note-1', 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB')).toBe(false);
    expect(markImageFailed(doc, 'note-1')).toBe(false);
    expect(markImageRetrying(doc, 'note-1', 1)).toBe(false);
    expect(updates).toBe(0);
  });

  it('a damaged image is not readable rather than thrown about', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items([400, 300]), 'me', 1000);
    const object = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    expect(imageSnapshot(doc, id)).not.toBeNull();
    object.set('width', 'wide');
    expect(imageSnapshot(doc, id)).toBeNull();
    object.set('width', 400);
    object.set('status', 'done');
    expect(imageSnapshot(doc, id)).toBeNull();
  });
});

describe('07 displayStatus', () => {
  it('says what was stored, while the upload is still inside its window', () => {
    const base = { status: 'uploading', uploadStartedAt: 0 } as const;
    expect(displayStatus(ready('a', base), IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(ready('a', { status: 'ready' }), 10_000)).toBe('ready');
    expect(displayStatus(ready('a', { status: 'failed' }), 10_000)).toBe('failed');
  });

  it('a stale upload is called unfinished, and the boundary is the setting', () => {
    expect(IMAGE_UPLOAD_STALE_MS).toBe(300_000); // five minutes, the design's number
    const uploading = ready('a', { status: 'uploading', uploadStartedAt: 0 });
    expect(displayStatus(uploading, IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    expect(displayStatus(uploading, IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('unfinished is computed at render time and never stored', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items([400, 300]), 'me', 1);
    const image = imageSnapshot(doc, id)!;
    // the far future, at which nobody is still uploading anything
    expect(displayStatus(image, IMAGE_UPLOAD_STALE_MS + 10)).toBe('unfinished');
    // nothing about it is on the object: the same object read a moment later says the same
    expect(doc.getMap<Y.Map<unknown>>('objects').get(id)?.get('status')).toBe('uploading');
    expect(displayStatus(imageSnapshot(doc, id)!, IMAGE_UPLOAD_STALE_MS + 10)).toBe('unfinished');
  });

  it('a retry resets the clock, and a ready or failed image is never unfinished', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, items([400, 300]), 'me', 1);
    const stale = imageSnapshot(doc, id)!;
    expect(displayStatus(stale, IMAGE_UPLOAD_STALE_MS + 10)).toBe('unfinished');

    markImageRetrying(doc, id, IMAGE_UPLOAD_STALE_MS + 10);
    const retried = imageSnapshot(doc, id)!;
    expect(displayStatus(retried, IMAGE_UPLOAD_STALE_MS + 10)).toBe('uploading');

    markImageReady(doc, id, 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB');
    const landed = imageSnapshot(doc, id)!;
    expect(displayStatus(landed, IMAGE_UPLOAD_STALE_MS * 100)).toBe('ready');
  });

  it('a clock that is not a number says uploading rather than guessing', () => {
    expect(displayStatus(ready('a', { status: 'uploading', uploadStartedAt: 0 }), Number.NaN)).toBe(
      'uploading',
    );
  });
});
