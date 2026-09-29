import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '@shared/board-model';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
  snapshotImage,
  UPLOAD_ORIGIN,
  type ImageSnap,
} from '@shared/objects/image';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '@shared/config';
import type { Size, Point } from '@client/canvas/camera';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('placementSize (TC-03)', () => {
  it('400x300 → 400x300 (no upscale, longest side 400 < 800)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 → 800x600 (scale down)', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 → 75x800 (portrait, scale down)', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 → 800x800 (boundary: longest side equals limit)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('layoutRow (TC-04)', () => {
  it('top-left anchor: 3 sizes placed left-to-right with gap, tops aligned at point', () => {
    const sizes: Size[] = [
      { width: 100, height: 200 },
      { width: 150, height: 120 },
      { width: 80, height: 160 },
    ];
    const start: Point = { x: 300, y: 400 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects).toHaveLength(3);
    // All tops aligned at the start y
    expect(rects[0].y).toBe(400);
    expect(rects[1].y).toBe(400);
    expect(rects[2].y).toBe(400);

    // First rect at start x
    expect(rects[0].x).toBe(300);
    // Second rect at first x + first width + gap
    expect(rects[1].x).toBe(300 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    // Third rect at second x + second width + gap
    expect(rects[2].x).toBe(300 + 100 + IMAGE_LAYOUT_GAP_WORLD + 150 + IMAGE_LAYOUT_GAP_WORLD);
  });

  it('centre anchor: row is centred on the point', () => {
    const sizes: Size[] = [
      { width: 100, height: 200 },
      { width: 200, height: 100 },
    ];
    const start: Point = { x: 500, y: 600 };
    const rects = layoutRow(sizes, start, 'centre');

    expect(rects).toHaveLength(2);
    // Total row width: 100 + 24 + 200 = 324
    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 200;
    // Total row height: max(200, 100) = 200
    const totalHeight = 200;
    // Row starts at: 500 - 324/2, 600 - 200/2
    const expectedStartX = 500 - totalWidth / 2;
    const expectedStartY = 600 - totalHeight / 2;
    expect(rects[0].x).toBeCloseTo(expectedStartX);
    expect(rects[0].y).toBeCloseTo(expectedStartY);
    expect(rects[1].x).toBeCloseTo(expectedStartX + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBeCloseTo(expectedStartY);
  });
});

describe('createImagePlaceholders + status transitions (TC-05)', () => {
  it('creates 3 uploading objects in one LOCAL_ORIGIN transaction; markImageReady uses UPLOAD_ORIGIN; undo stack length is 1', () => {
    const doc = makeDoc();
    const um = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 0,
    });

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 200, height: 150 }, naturalWidth: 200, naturalHeight: 150, contentType: 'image/png' },
      { rect: { x: 348, y: 0, width: 50, height: 50 }, naturalWidth: 50, naturalHeight: 50, contentType: 'image/jpeg' },
    ];

    const now = Date.now();
    const ids = createImagePlaceholders(doc, items, 'alice', now);
    expect(ids).toHaveLength(3);

    // Undo stack should be 1 (all 3 in one transaction)
    expect(um.undoStack.length).toBe(1);

    // All should be uploading
    const snaps = snapshotImage(doc);
    expect(snaps).toHaveLength(3);
    for (const s of snaps) {
      expect(s.status).toBe('uploading');
      expect(s.uploaderId).toBe('alice');
      expect(s.uploadStartedAt).toBe(now);
    }

    // Mark one as ready (uses UPLOAD_ORIGIN)
    const ok = markImageReady(doc, ids[0], 'key/asset');
    expect(ok).toBe(true);

    // Undo stack should still be 1 (UPLOAD_ORIGIN not tracked)
    expect(um.undoStack.length).toBe(1);

    // Verify the ready one has assetKey
    const updated = snapshotImage(doc);
    const readyOne = updated.find((s) => s.id === ids[0]);
    expect(readyOne?.status).toBe('ready');
    expect(readyOne?.assetKey).toBe('key/asset');

    // Undo removes all 3 placeholders
    um.undo();
    expect(snapshotImage(doc)).toHaveLength(0);

    um.destroy();
  });
});

describe('displayStatus (TC-06)', () => {
  const baseSnap: ImageSnap = {
    id: 'x',
    type: 'image',
    x: 0, y: 0, width: 100, height: 100,
    z: 1, createdAt: 0, createdBy: 'u',
    assetKey: null, contentType: 'image/png',
    naturalWidth: 100, naturalHeight: 100,
    status: 'uploading', uploadStartedAt: 1000, uploaderId: 'alice',
  };

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS - 1;
    expect(displayStatus(baseSnap, now)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS + 1;
    expect(displayStatus(baseSnap, now)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const snap: ImageSnap = { ...baseSnap, status: 'failed' };
    expect(displayStatus(snap, 999999)).toBe('failed');
  });

  it('ready → ready', () => {
    const snap: ImageSnap = { ...baseSnap, status: 'ready', assetKey: 'a/b' };
    expect(displayStatus(snap, 999999)).toBe('ready');
  });
});

describe('markImageReady / markImageFailed on deleted id (TC-07)', () => {
  it('markImageReady on deleted id → false, no update', () => {
    const doc = makeDoc();
    const now = Date.now();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'alice', now);

    // Delete the object
    doc.getMap('objects').delete(ids[0]);

    // Now markImageReady should fail
    let updateFired = false;
    doc.on('update', () => { updateFired = true; });
    const ok = markImageReady(doc, ids[0], 'key/asset');
    expect(ok).toBe(false);
    expect(updateFired).toBe(false);
  });

  it('markImageFailed on deleted id → false, no update', () => {
    const doc = makeDoc();
    const now = Date.now();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'alice', now);

    doc.getMap('objects').delete(ids[0]);

    let updateFired = false;
    doc.on('update', () => { updateFired = true; });
    const ok = markImageFailed(doc, ids[0]);
    expect(ok).toBe(false);
    expect(updateFired).toBe(false);
  });
});
