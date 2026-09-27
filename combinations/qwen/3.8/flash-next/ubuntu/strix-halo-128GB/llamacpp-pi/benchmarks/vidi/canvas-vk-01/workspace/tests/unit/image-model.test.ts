import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import { initDoc, objectSnapshots } from '../../src/shared/board-model';
import {
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { createUndo } from '../../src/client/board/undo';
import { T0, UPLOADER_ID, seedImage } from '../fixtures/image-objects';

/** A key of the shape the asset API returns. */
const ASSET_KEY = 'V2fXq0Kd7Yh1N4sT8pLm3a/0Jw6Qm2Xs9Yd4Kb7Tf1hNg';

const imageIn = (doc: Y.Doc, id: string): ImageSnap => {
  const snap = objectSnapshots(doc).find((entry) => entry.id === id);
  if (snap === undefined) throw new Error(`no object ${id}`);
  return snap as ImageSnap;
};

/**
 * TC-03 to TC-07 (image.place_size, image.row_layout, image.undo,
 * image.placeholder_survives): the shared arithmetic and the shared model.
 */
describe('image placement', () => {
  it('TC-03: leaves an image that fits untouched', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(IMAGE_MAX_PLACE_SIZE_WORLD, 40)).toEqual({
      width: IMAGE_MAX_PLACE_SIZE_WORLD,
      height: 40,
    });
  });

  it('TC-03: scales a larger image by its longest side, keeping the ratio', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(4096, 4096)).toEqual({ width: 800, height: 800 });
    for (const { width, height } of [placementSize(1600, 1200), placementSize(300, 3200), placementSize(4096, 4096)]) {
      expect(Math.max(width, height)).toBe(IMAGE_MAX_PLACE_SIZE_WORLD);
    }
  });

  it('TC-03: keeps every placed side within the minimum and the maximum', () => {
    const sizes: Array<[number, number]> = [
      [400, 300],
      [1600, 1200],
      [300, 3200],
      [4096, 4096],
      [100_000, 10],
      [10, 100_000],
      [1, 1],
      [24, 20],
    ];
    for (const [naturalWidth, naturalHeight] of sizes) {
      const size = placementSize(naturalWidth, naturalHeight);
      expect(Number.isFinite(size.width)).toBe(true);
      expect(Number.isFinite(size.height)).toBe(true);
      expect(size.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
      expect(size.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
      // Proportions are kept wherever the minimum does not interfere.
      if (size.width > IMAGE_MIN_SIZE_WORLD && size.height > IMAGE_MIN_SIZE_WORLD) {
        expect(size.width / size.height).toBeCloseTo(naturalWidth / naturalHeight, 1);
      }
    }
  });

  it('TC-04: lays a row left to right from the top-left anchor, tops aligned', () => {
    const rects = layoutRow(
      [
        { width: 100, height: 100 },
        { width: 200, height: 100 },
        { width: 50, height: 20 },
      ],
      { x: 100, y: 100 },
      'top-left',
    );
    expect(rects).toEqual([
      { x: 100, y: 100, width: 100, height: 100 },
      { x: 100 + 100 + IMAGE_LAYOUT_GAP_WORLD, y: 100, width: 200, height: 100 },
      {
        x: 100 + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD,
        y: 100,
        width: 50,
        height: 20,
      },
    ]);
    expect(new Set(rects.map((rect) => rect.y)).size).toBe(1);
  });

  it('TC-04: centres the row on the point when the anchor is the centre', () => {
    const rects = layoutRow(
      [
        { width: 100, height: 100 },
        { width: 100, height: 100 },
      ],
      { x: 0, y: 0 },
      'centre',
    );
    const rowWidth = 100 * 2 + IMAGE_LAYOUT_GAP_WORLD;
    expect(rects[0]!.x).toBe(-rowWidth / 2);
    expect(rects[1]!.x).toBe(-rowWidth / 2 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    // The row's centre is the requested point.
    const left = rects[0]!.x;
    const right = rects[1]!.x + rects[1]!.width;
    expect((left + right) / 2).toBeCloseTo(0, 6);
  });

  it('TC-04: an empty batch lays out nothing', () => {
    expect(layoutRow([], { x: 10, y: 10 }, 'top-left')).toEqual([]);
    expect(layoutRow([], { x: 10, y: 10 }, 'centre')).toEqual([]);
  });

  it('TC-05: creates placeholders with the upload status an object needs', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // The hook's own composition: measure, lay the row out, then insert.
    const naturals = [
      { naturalWidth: 1600, naturalHeight: 1200, contentType: 'image/png' },
      { naturalWidth: 200, naturalHeight: 200, contentType: 'image/jpeg' },
    ];
    const rects = layoutRow(
      naturals.map((item) => placementSize(item.naturalWidth, item.naturalHeight)),
      { x: 0, y: 0 },
      'top-left',
    );
    const ids = createImagePlaceholders(
      doc,
      naturals.map((item, index) => ({ ...item, rect: rects[index]! })),
      UPLOADER_ID,
      T0,
    );
    expect(ids).toHaveLength(2);
    const [firstId, secondId] = ids as [string, string];
    const first = imageIn(doc, firstId);
    expect(first).toMatchObject({
      type: 'image',
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 1600,
      naturalHeight: 1200,
      status: 'uploading',
      uploadStartedAt: T0,
      uploaderId: UPLOADER_ID,
      // The placed size is the natural size capped at the placement maximum.
      width: IMAGE_MAX_PLACE_SIZE_WORLD,
      height: 600,
    });
    expect(first.id).toBe(firstId);
    expect(first.z).toBeGreaterThan(0);
    // Every object shares one transaction, and the row keeps its order.
    const second = imageIn(doc, secondId);
    expect(second.x).toBe(first.x + IMAGE_MAX_PLACE_SIZE_WORLD + IMAGE_LAYOUT_GAP_WORLD);
    expect(second.width).toBe(200);
    expect(second.height).toBe(200);
    expect(second.z).toBeGreaterThan(first.z);
  });

  it('TC-05: refuses a batch with no readable size', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(
      createImagePlaceholders(
        doc,
        [{ rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 0, naturalHeight: 0, contentType: 'image/png' }],
        UPLOADER_ID,
        T0,
      ),
    ).toEqual([]);
    expect(objectSnapshots(doc)).toHaveLength(0);
  });

  it('TC-06: records the outcome, and only for an object that is still there', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = seedImage({ doc });
    expect(displayStatus(imageIn(doc, id), T0)).toBe('uploading');

    expect(markImageReady(doc, id, ASSET_KEY)).toBe(true);
    const ready = imageIn(doc, id);
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe(ASSET_KEY);
    expect(displayStatus(ready, T0 + IMAGE_UPLOAD_STALE_MS * 10)).toBe('ready');

    // A second outcome for the same object: the first one stands.
    expect(markImageFailed(doc, id)).toBe(false);
    expect(imageIn(doc, id).status).toBe('ready');

    // And an object that is gone answers false rather than throwing.
    const gone = seedImage({ doc });
    deleteObject(doc, gone);
    expect(markImageReady(doc, gone, ASSET_KEY)).toBe(false);
    expect(markImageFailed(doc, gone)).toBe(false);
    expect(markImageRetrying(doc, gone, T0)).toBe(false);
  });

  it('TC-06: retrying puts a failed image back to uploading with a fresh clock', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = seedImage({ doc, status: 'failed', uploadStartedAt: T0 });
    const later = T0 + 60_000;
    expect(displayStatus(imageIn(doc, id), later)).toBe('failed');
    expect(markImageRetrying(doc, id, later)).toBe(true);
    const retrying = imageIn(doc, id);
    expect(retrying.status).toBe('uploading');
    expect(retrying.uploadStartedAt).toBe(later);
    expect(displayStatus(retrying, later)).toBe('uploading');
    // A second retry of an upload that is already running is refused: the user
    // gets one attempt per failed image, not a queue.
    expect(markImageRetrying(doc, id, later)).toBe(false);
  });

  it('TC-07: marks the outcome failed for an image whose upload gave up', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = seedImage({ doc });
    expect(markImageFailed(doc, id)).toBe(true);
    const failed = imageIn(doc, id);
    expect(failed.status).toBe('failed');
    expect(failed.assetKey).toBeNull();
    expect(displayStatus(failed, T0)).toBe('failed');
  });

  it('TC-06: calls an image still marked uploading after the stale window unfinished', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = seedImage({ doc, uploadStartedAt: T0 });
    const image = imageIn(doc, id);
    expect(displayStatus(image, T0)).toBe('uploading');
    expect(displayStatus(image, T0 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(image, T0 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    // `unfinished` never rewrites the shared record — only the reader's clock does.
    expect(imageIn(doc, id).status).toBe('uploading');
    // Failed and ready are their own display states whatever the clock says.
    const failed = seedImage({ doc, status: 'failed' });
    expect(displayStatus(imageIn(doc, failed), T0 + IMAGE_UPLOAD_STALE_MS * 100)).toBe('failed');
  });

  it('TC-07: one undo step removes the whole batch, whatever their upload status', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    const stickyBefore = objectSnapshots(doc).length;

    const rects = layoutRow(
      [
        placementSize(400, 300),
        placementSize(300, 400),
      ],
      { x: 0, y: 0 },
      'top-left',
    );
    const ids = createImagePlaceholders(
      doc,
      [
        { rect: rects[0]!, naturalWidth: 400, naturalHeight: 300, contentType: 'image/png' },
        { rect: rects[1]!, naturalWidth: 300, naturalHeight: 400, contentType: 'image/webp' },
      ],
      UPLOADER_ID,
      T0,
    );
    expect(objectSnapshots(doc)).toHaveLength(stickyBefore + 2);
    // Upload outcomes land between the insertion and the undo. They are not
    // undoable steps of their own, and undo does not branch on them.
    markImageReady(doc, ids[0]!, ASSET_KEY);
    markImageFailed(doc, ids[1]!);

    expect(undo.undo()).toBe(true);
    expect(objectSnapshots(doc)).toHaveLength(stickyBefore);
  });

  it('TC-07: a ready image survives reload, and so does one still uploading', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const readyId = seedImage({ doc, status: 'ready' });
    const uploadingId = seedImage({ doc, status: 'uploading', uploadStartedAt: Date.now() });

    // "Reload" the way the app does: send the persisted state to a brand new doc.
    const reloaded = new Y.Doc();
    initDoc(reloaded);
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(doc));

    const ready = imageIn(reloaded, readyId);
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe(ASSET_KEY);
    expect(objectSnapshots(reloaded).map((snap) => snap.id)).toContain(uploadingId);
    const uploading = imageIn(reloaded, uploadingId);
    expect(uploading.status).toBe('uploading');
    expect(uploading.assetKey).toBeNull();
    // The placeholder renders: it has a position and a size.
    expect(uploading.width).toBeGreaterThan(0);
    expect(uploading.height).toBeGreaterThan(0);
    expect(Number.isFinite(uploading.x)).toBe(true);
  });

  it('TC-07: a document with no images snapshots as it did before images existed', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(() => objectSnapshots(doc)).not.toThrow();
    expect(objectSnapshots(doc)).toEqual([]);
  });
});

/** Remove an object the way the delete action does, bypassing the image model. */
function deleteObject(doc: Y.Doc, id: string): void {
  const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
  doc.transact(() => {
    objects.delete(id);
  });
}
