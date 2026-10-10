import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import {
  IMAGE_TYPE,
  UPLOAD_ORIGIN,
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  readImage,
  type ImagePlacement,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { deleteObjects } from '../../src/shared/board-model';
import { assetKeyFor } from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';
import type { Point, Size } from '../../src/shared/geometry';

/**
 * Story 12, `image.model`.
 *
 * The three numbers a dropped image arrives with — where it goes, how big it is drawn, and
 * how long its upload is believed — are all decided here, on a real `Y.Doc`, because each is
 * a promise to somebody who is not in this tab: the promise that the image will not cover the
 * cursor it was dropped at, that it will keep the shape of the file it came from, and that a
 * person looking at this board in ten minutes will not be watching a spinner for a tab that
 * closed.
 */

const START: Point = { x: 400, y: 300 };

/** A key of the shape a 201 answer would have carried. */
function storedKey(): string {
  return assetKeyFor(newBoardId(), newBoardId());
}

function createDoc(): Y.Doc {
  return new Y.Doc();
}

/** Every image object in the doc, as the model reads them back. */
function images(doc: Y.Doc): ImageSnap[] {
  const out: ImageSnap[] = [];
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  objects.forEach((item, id) => {
    if (item.get('type') !== IMAGE_TYPE) return;
    const image = readImage(doc, id);
    if (image !== null) out.push(image);
  });
  return out;
}

/** The whole add action as `useImageInsert` would ask for it: measured, then laid out. */
function placements(sizes: readonly Size[], at: Point = START): ImagePlacement[] {
  const rects = layoutRow(sizes, at, 'top-left');
  return sizes.map((size, index) => ({
    rect: rects[index],
    naturalWidth: size.width,
    naturalHeight: size.height,
    contentType: 'image/png',
  }));
}

describe('TC-03: an image is placed at its own size, unless that is too big', () => {
  it('keeps a small image at its natural pixel size', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('scales a landscape image down so its longest side is the limit', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('scales a portrait image down by the same factor on both sides', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('leaves an image exactly at the limit alone', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
    expect(Math.max(...Object.values(placementSize(800, 800)))).toBe(IMAGE_MAX_PLACE_SIZE_WORLD);
  });

  it('never enlarges a small image, however thin', () => {
    expect(placementSize(40, 8)).toEqual({ width: 40, height: 8 });
  });

  it('keeps the ratio within a rounding step for an awkward size', () => {
    const size = placementSize(1920, 1080);
    expect(size.width).toBe(IMAGE_MAX_PLACE_SIZE_WORLD);
    expect(size.height).toBeCloseTo(450, 6);
  });
});

describe('TC-04: a drop lays the images out in a row from the point', () => {
  const sizes: Size[] = [
    { width: 100, height: 80 },
    { width: 200, height: 150 },
    { width: 50, height: 50 },
  ];

  it('aligns the tops at the point and separates them by the layout gap', () => {
    const rects = layoutRow(sizes, START, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 400, y: 300, width: 100, height: 80 });
    expect(rects[1].x).toBe(400 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x).toBe(400 + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD);
    // Every image keeps the size it was measured at, and every top is on the line of the drop.
    for (const [index, rect] of rects.entries()) {
      expect(rect.width).toBe(sizes[index].width);
      expect(rect.height).toBe(sizes[index].height);
      expect(rect.y).toBe(START.y);
    }
  });

  it('centres the row on the point when asked, so it lands where the person is looking', () => {
    const rects = layoutRow(sizes, START, 'centre');
    const left = Math.min(...rects.map((r) => r.x));
    const right = Math.max(...rects.map((r) => r.x + r.width));
    const top = Math.min(...rects.map((r) => r.y));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    expect((left + right) / 2).toBeCloseTo(START.x, 6);
    expect((top + bottom) / 2).toBeCloseTo(START.y, 6);
  });

  it('lays out a single image', () => {
    expect(layoutRow([{ width: 300, height: 200 }], START, 'top-left')).toEqual([
      { x: 400, y: 300, width: 300, height: 200 },
    ]);
  });
});

describe('TC-05: one add action is one object set and one undo step', () => {
  const sizes: Size[] = [
    { width: 100, height: 80 },
    { width: 200, height: 150 },
    { width: 50, height: 50 },
  ];

  it('creates every placeholder in one update, sized and positioned as measured', () => {
    const doc = createDoc();
    const updates: number[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u.length));

    const ids = createImagePlaceholders(doc, placements(sizes), 'tab-1', 1000);
    expect(ids).toHaveLength(3);
    expect(updates).toHaveLength(1);

    const created = images(doc);
    expect(created).toHaveLength(3);
    const rects = layoutRow(sizes, START, 'top-left');
    expect(created.map((image) => [image.x, image.y, image.width, image.height])).toEqual(
      rects.map((r) => [r.x, r.y, r.width, r.height]),
    );
    for (const [index, image] of created.entries()) {
      expect(image.id).toBe(ids[index]);
      expect(image.type).toBe(IMAGE_TYPE);
      expect(image.naturalWidth).toBe(sizes[index].width);
      expect(image.naturalHeight).toBe(sizes[index].height);
      expect(image.contentType).toBe('image/png');
      expect(image.status).toBe('uploading');
      expect(image.assetKey).toBeNull();
      expect(image.uploaderId).toBe('tab-1');
      // uploadStartedAt is the stale clock, so it starts at the moment of the add, not at 0.
      expect(image.uploadStartedAt).toBe(1000);
    }
  });

  it('writes status under a different origin from creation, which is how the board ignores it', () => {
    const doc = createDoc();
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));

    const ids = createImagePlaceholders(doc, placements(sizes), 'tab-1', 1000);
    expect(markImageReady(doc, ids[0], storedKey())).toBe(true);

    // Two transactions: the add, and the upload landing. The board's UndoManager tracks the
    // origin of the first and not `UPLOAD_ORIGIN`, so the second cannot become an undo step
    // (asserted against the real UndoManager in the useImageInsert component tests).
    expect(origins).toHaveLength(2);
    expect(origins[1]).toBe(UPLOAD_ORIGIN);
    expect(origins[1]).not.toBe(origins[0]);
  });

  it('records the key the server answered with, and only for that image', () => {
    const doc = createDoc();
    const ids = createImagePlaceholders(doc, placements(sizes), 'tab-1', 1000);
    const key = storedKey();
    expect(markImageReady(doc, ids[0], key)).toBe(true);

    const after = images(doc);
    expect(after[0].status).toBe('ready');
    expect(after[0].assetKey).toBe(key);
    expect(after.slice(1).every((i) => i.status === 'uploading' && i.assetKey === null)).toBe(true);
  });
});

describe('TC-06: an upload that never lands stops being believed', () => {
  const base: ImageSnap = {
    id: 'img-1',
    type: IMAGE_TYPE,
    x: 0,
    y: 0,
    z: 0,
    width: 100,
    height: 80,
    known: true,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 80,
    status: 'uploading',
    uploadStartedAt: 1_000,
    uploaderId: 'tab-1',
  };

  it('stays "uploading" up to the stale moment and becomes "unfinished" after it', () => {
    expect(displayStatus(base, 1_000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(base, 1_000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('passes a failed and a ready image straight through', () => {
    expect(displayStatus({ ...base, status: 'failed' }, 10_000_000)).toBe('failed');
    expect(
      displayStatus({ ...base, status: 'ready', assetKey: storedKey() }, 10_000_000),
    ).toBe('ready');
  });

  it('a retry restarts the clock, so an old object can be uploading honestly', () => {
    const doc = createDoc();
    const [id] = createImagePlaceholders(doc, placements([{ width: 100, height: 80 }]), 'tab-1', 1000);
    expect(markImageFailed(doc, id)).toBe(true);
    expect(markImageRetrying(doc, id, 2_000)).toBe(true);
    const retrying = readImage(doc, id);
    expect(retrying?.status).toBe('uploading');
    expect(retrying?.uploadStartedAt).toBe(2_000);
    expect(displayStatus(retrying as ImageSnap, 2_000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    // Long after the retry clock, the same object is unfinished again: the retry's tab went
    // away too.
    expect(displayStatus(retrying as ImageSnap, 2_000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });
});

describe('TC-07: a status update for an object that is gone does nothing', () => {
  it('reports nothing to update when the placeholder was deleted or undone', () => {
    const doc = createDoc();
    const [id] = createImagePlaceholders(doc, placements([{ width: 100, height: 80 }]), 'tab-1', 1000);
    deleteObjects(doc, [id]);
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));

    expect(markImageReady(doc, id, storedKey())).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 2_000)).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('refuses an asset key it could never serve, so the image is not left as a hole', () => {
    const doc = createDoc();
    const [id] = createImagePlaceholders(doc, placements([{ width: 100, height: 80 }]), 'tab-1', 1000);
    for (const bad of ['', '..', '../x', `${newBoardId()}/x`, `${newBoardId()}/${newBoardId()}/x`]) {
      expect(markImageReady(doc, id, bad)).toBe(false);
    }
    // It is still the honest `uploading` box, rather than a ready image that 404s.
    expect(readImage(doc, id)?.status).toBe('uploading');
  });
});
