/**
 * Unit tests for image object model (TC-03 to TC-07).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
  type ImageSnap,
} from '../../src/shared/objects/image';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import { LOCAL_ORIGIN, snapshot } from '../../src/shared/board-model';

// --- TC-03: placementSize ---

describe('TC-03: placementSize', () => {
  it('400x300 → 400x300 (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 → 800x600', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 → 75x800', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 → 800x800 (boundary)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

// --- TC-04: layoutRow ---

describe('TC-04: layoutRow', () => {
  it('top-left: 3 sizes at a point → tops aligned, gaps correct', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 200, height: 80 },
      { width: 150, height: 60 },
    ];
    const start = { x: 10, y: 20 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(rects[1].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBe(20);
    expect(rects[2].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].y).toBe(20);
  });

  it('centre: row centred on the point', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 200, height: 80 },
    ];
    const centre = { x: 500, y: 300 };
    const rects = layoutRow(sizes, centre, 'centre');

    // Total width = 100 + 24 + 200 = 324
    // Start x = 500 - 324/2 = 338
    expect(rects[0].x).toBe(500 - (100 + IMAGE_LAYOUT_GAP_WORLD + 200) / 2);
    expect(rects[0].y).toBe(300);
    expect(rects[1].x).toBe(rects[0].x + 100 + IMAGE_LAYOUT_GAP_WORLD);
  });
});

// --- TC-05: createImagePlaceholders + markImageReady + UndoManager ---

describe('TC-05: createImagePlaceholders and markImageReady', () => {
  it('creates 3 placeholders in one update, markImageReady sets assetKey, undo stack = 1', () => {
    const doc = new Y.Doc();
    const undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    });

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 200, height: 80 }, naturalWidth: 200, naturalHeight: 80, contentType: 'image/jpeg' },
      { rect: { x: 348, y: 0, width: 150, height: 60 }, naturalWidth: 150, naturalHeight: 60, contentType: 'image/gif' },
    ];

    const ids = createImagePlaceholders(doc, items, 'user1', Date.now());
    expect(ids).toHaveLength(3);

    // Verify all are uploading
    const snaps = snapshot(doc);
    const images = snaps.filter((s) => s.type === 'image');
    expect(images).toHaveLength(3);
    for (const img of images) {
      const imgSnap = img as ImageSnap;
      expect(imgSnap.status).toBe('uploading');
      expect(imgSnap.uploaderId).toBe('user1');
      expect(imgSnap.assetKey).toBeNull();
    }

    // Mark one as ready
    markImageReady(doc, ids[0], 'board/asset1');

    // UndoManager should have exactly 1 step (the create, not the markReady)
    expect(undoManager.undoStack.length).toBe(1);

    // Verify the ready image
    const snaps2 = snapshot(doc);
    const readyImg = snaps2.find((s) => s.id === ids[0]) as ImageSnap;
    expect(readyImg.status).toBe('ready');
    expect(readyImg.assetKey).toBe('board/asset1');

    // Undo removes all 3 placeholders (one step)
    undoManager.undo();
    const snaps3 = snapshot(doc);
    const images3 = snaps3.filter((s) => s.type === 'image');
    expect(images3).toHaveLength(0);
  });
});

// --- TC-06: displayStatus ---

describe('TC-06: displayStatus', () => {
  const baseImg: ImageSnap = {
    id: 'test',
    type: 'image',
    x: 0, y: 0, width: 100, height: 50,
    z: 1, createdAt: 0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100, naturalHeight: 50,
    status: 'uploading',
    uploadStartedAt: 1000,
    uploaderId: 'user1',
  };

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS - 1;
    expect(displayStatus(baseImg, now)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS + 1;
    expect(displayStatus(baseImg, now)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const img = { ...baseImg, status: 'failed' as const };
    expect(displayStatus(img, Date.now())).toBe('failed');
  });

  it('ready → ready', () => {
    const img = { ...baseImg, status: 'ready' as const, assetKey: 'b/a' };
    expect(displayStatus(img, Date.now())).toBe('ready');
  });
});

// --- TC-07: markImageReady / markImageFailed on deleted id ---

describe('TC-07: stale id handling', () => {
  it('markImageReady on deleted id returns false', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', Date.now());
    expect(ids).toHaveLength(1);

    // Delete the object
    const objects = doc.getMap('objects');
    objects.delete(ids[0]);

    // Now markImageReady should return false
    expect(markImageReady(doc, ids[0], 'b/a')).toBe(false);
  });

  it('markImageFailed on deleted id returns false', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', Date.now());

    const objects = doc.getMap('objects');
    objects.delete(ids[0]);

    expect(markImageFailed(doc, ids[0])).toBe(false);
  });

  it('markImageRetrying on deleted id returns false', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', Date.now());

    const objects = doc.getMap('objects');
    objects.delete(ids[0]);

    expect(markImageRetrying(doc, ids[0], Date.now())).toBe(false);
  });
});
