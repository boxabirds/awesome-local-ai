/**
 * Unit tests for the image object model (story 12, image.model).
 * TC-03 to TC-07.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, objects, LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
  UPLOAD_ORIGIN,
  type ImageSnap,
  type ImageItem,
} from '../../src/shared/objects/image';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';

function imageSnap(partial: Partial<ImageSnap>): ImageSnap {
  return {
    id: 'id',
    type: 'image',
    x: 0,
    y: 0,
    z: 0,
    createdAt: 0,
    width: 100,
    height: 100,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 100,
    status: 'uploading',
    uploadStartedAt: 0,
    uploaderId: 'u1',
    ...partial,
  };
}

describe('image.model: placementSize (TC-03)', () => {
  it('TC-03: no upscale; scale down so longest side is at most 800', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('image.model: layoutRow (TC-04)', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 80, height: 40 },
    { width: 60, height: 30 },
  ];

  it('TC-04: top-left anchor — tops aligned at the point, gaps of 24', () => {
    const start = { x: 10, y: 20 };
    const rects = layoutRow(sizes, start, 'top-left');
    expect(rects).toHaveLength(3);
    // First image's top-left is at the point.
    expect(rects[0].x).toBe(10);
    expect(rects[0].y).toBe(20);
    // Tops aligned.
    expect(rects[1].y).toBe(20);
    expect(rects[2].y).toBe(20);
    // Gaps of IMAGE_LAYOUT_GAP_WORLD between.
    expect(rects[1].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD);
  });

  it('TC-04: centre anchor — row centred on the point', () => {
    const start = { x: 0, y: 0 };
    const rects = layoutRow(sizes, start, 'centre');
    const totalWidth = 100 + 80 + 60 + IMAGE_LAYOUT_GAP_WORLD * 2;
    const maxHeight = 50;
    expect(rects[0].x).toBe(-totalWidth / 2);
    expect(rects[0].y).toBe(-maxHeight / 2);
    // Row spans symmetrically about the point.
    const right = rects[2].x + rects[2].width;
    expect(right).toBe(totalWidth / 2);
    // Bottom symmetric about the point.
    expect(rects[0].y + maxHeight).toBe(maxHeight / 2);
  });
});

describe('image.model: createImagePlaceholders + status (TC-05, TC-07)', () => {
  // TC-05: 3 placeholders in one update; markImageReady sets assetKey; the
  // undo stack has exactly 1 step and undo removes all 3.
  it('TC-05: one undo step for the add; completion is not a separate step', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    let updateCount = 0;
    doc.on('update', () => updateCount++);

    const items: ImageItem[] = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 80, height: 40 }, naturalWidth: 80, naturalHeight: 40, contentType: 'image/jpeg' },
      { rect: { x: 228, y: 0, width: 60, height: 30 }, naturalWidth: 60, naturalHeight: 30, contentType: 'image/gif' },
    ];
    const ids = createImagePlaceholders(doc, items, 'uploader-1', 1000);
    expect(ids).toHaveLength(3);
    // Exactly one update event for the whole add action.
    expect(updateCount).toBe(1);

    // All three are uploading with the uploader id and start time.
    const snaps = objects(doc) as unknown as ImageSnap[];
    for (const id of ids) {
      const s = snaps.find((o) => o.id === id)!;
      expect(s.status).toBe('uploading');
      expect(s.uploaderId).toBe('uploader-1');
      expect(s.uploadStartedAt).toBe(1000);
      expect(s.assetKey).toBeNull();
    }

    // One undo step so far.
    expect(undo.undoStack.length).toBe(1);

    // Completing one image (UPLOAD_ORIGIN) sets the assetKey and is NOT a
    // separate undo step.
    updateCount = 0;
    expect(markImageReady(doc, ids[0], 'board/asset')).toBe(true);
    expect(updateCount).toBe(1);
    const ready = (objects(doc) as unknown as ImageSnap[]).find((o) => o.id === ids[0])!;
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe('board/asset');
    // Undo stack unchanged (completion is not an undo step).
    expect(undo.undoStack.length).toBe(1);

    // Undo removes all three placeholders in one step.
    expect(undo.undoStack.length).toBe(1);
    undo.undo();
    const after = (objects(doc) as unknown as ImageSnap[]).filter(
      (o) => o.type === 'image',
    );
    expect(after).toHaveLength(0);
  });

  it('TC-05: non-finite sizes are skipped (no partial objects)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const items: ImageItem[] = [
      { rect: { x: NaN, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'u', 0);
    expect(ids).toHaveLength(1);
    expect((objects(doc) as unknown as ImageSnap[]).filter((o) => o.type === 'image')).toHaveLength(1);
  });

  // TC-07: markImageReady / markImageFailed on a deleted id → false, no update.
  it('TC-07: stale id → false, no update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let updateCount = 0;
    doc.on('update', () => updateCount++);
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' }],
      'u',
      0,
    );
    updateCount = 0;
    doc.getMap('objects').delete(id);
    updateCount = 0;
    expect(markImageReady(doc, id, 'k')).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 0)).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('markImageRetrying returns the image to uploading with a fresh start time', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' }],
      'u',
      100,
    );
    markImageFailed(doc, id);
    expect(markImageRetrying(doc, id, 500)).toBe(true);
    const s = (objects(doc) as unknown as ImageSnap[]).find((o) => o.id === id)!;
    expect(s.status).toBe('uploading');
    expect(s.uploadStartedAt).toBe(500);
  });
});

describe('image.model: displayStatus (TC-06)', () => {
  it('TC-06: uploading at STALE_MS - 1 → uploading; + 1 → unfinished', () => {
    const started = 1_000_000;
    const img = imageSnap({ uploadStartedAt: started, status: 'uploading' });
    expect(displayStatus(img, started + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(img, started + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('TC-06: failed → failed; ready → ready', () => {
    expect(displayStatus(imageSnap({ status: 'failed' }), 0)).toBe('failed');
    expect(displayStatus(imageSnap({ status: 'ready' }), 0)).toBe('ready');
  });
});

// Keep the import referenced (guards against tree-shaking in the test build).
void UPLOAD_ORIGIN;
