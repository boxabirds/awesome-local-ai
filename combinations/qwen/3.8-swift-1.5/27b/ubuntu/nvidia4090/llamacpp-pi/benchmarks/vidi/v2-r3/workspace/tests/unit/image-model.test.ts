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
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';

// TC-03: placementSize
describe('TC-03: placementSize', () => {
  it('400x300 → 400x300 (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 → 800x600 (scaled down)', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 → 75x800 (portrait scaled down)', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 → 800x800 (at boundary)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

// TC-04: layoutRow
describe('TC-04: layoutRow', () => {
  it('top-left: 3 sizes at a point → tops aligned, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 200, height: 100 },
      { width: 150, height: 75 },
    ];
    const start = { x: 10, y: 20 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects).toHaveLength(3);
    // First at the start point
    expect(rects[0].x).toBe(10);
    expect(rects[0].y).toBe(20);
    // Second after first + gap
    expect(rects[1].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBe(20);
    // Third after second + gap
    expect(rects[2].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].y).toBe(20);
  });

  it('centre: row centred on the point', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 100, height: 50 },
    ];
    const centre = { x: 500, y: 300 };
    const rects = layoutRow(sizes, centre, 'centre');

    // Total width = 100 + 24 + 100 = 224
    // Start x = 500 - 224/2 = 388
    expect(rects[0].x).toBe(500 - (100 + IMAGE_LAYOUT_GAP_WORLD + 100) / 2);
    expect(rects[0].y).toBe(300);
    expect(rects[1].x).toBe(500 - (100 + IMAGE_LAYOUT_GAP_WORLD + 100) / 2 + 100 + IMAGE_LAYOUT_GAP_WORLD);
  });
});

// TC-05: createImagePlaceholders + markImageReady + UndoManager
describe('TC-05: createImagePlaceholders and undo', () => {
  it('creates 3 objects in one update; markImageReady sets assetKey; undo stack length is 1', () => {
    const doc = new Y.Doc();
    const undoManager = new Y.UndoManager(doc, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    const now = Date.now();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 200, height: 100 }, naturalWidth: 200, naturalHeight: 100, contentType: 'image/jpeg' },
      { rect: { x: 348, y: 0, width: 150, height: 75 }, naturalWidth: 150, naturalHeight: 75, contentType: 'image/gif' },
    ];

    const ids = createImagePlaceholders(doc, items, 'uploader-1', now);
    expect(ids).toHaveLength(3);

    // All objects should be uploading
    for (const id of ids) {
      const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
      expect(m.get('status')).toBe('uploading');
      expect(m.get('uploaderId')).toBe('uploader-1');
      expect(m.get('uploadStartedAt')).toBe(now);
    }

    // UndoManager should have exactly 1 step (the createImagePlaceholders transaction)
    expect(undoManager.undoStack.length).toBe(1);

    // markImageReady uses UPLOAD_ORIGIN (not tracked)
    const ok = markImageReady(doc, ids[0], 'boardId1234567890123/assetId1234567890123');
    expect(ok).toBe(true);

    // The object is now ready
    const m0 = doc.getMap('objects').get(ids[0]) as Y.Map<unknown>;
    expect(m0.get('status')).toBe('ready');
    expect(m0.get('assetKey')).toBe('boardId1234567890123/assetId1234567890123');

    // UndoManager stack should still be 1 (upload completion is not an undo step)
    expect(undoManager.undoStack.length).toBe(1);

    // Undo removes all 3 placeholders in one step
    undoManager.undo();
    for (const id of ids) {
      expect(doc.getMap('objects').get(id)).toBeUndefined();
    }
  });
});

// TC-06: displayStatus
describe('TC-06: displayStatus', () => {
  function makeSnap(status: 'uploading' | 'ready' | 'failed', uploadStartedAt: number): ImageSnap {
    return {
      id: 'test-id',
      type: 'image',
      x: 0, y: 0, z: 1,
      width: 100, height: 50,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 100, naturalHeight: 50,
      status,
      uploadStartedAt,
      uploaderId: 'test',
    };
  }

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const now = 1_000_000;
    const snap = makeSnap('uploading', now - (IMAGE_UPLOAD_STALE_MS - 1));
    expect(displayStatus(snap, now)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const now = 1_000_000;
    const snap = makeSnap('uploading', now - (IMAGE_UPLOAD_STALE_MS + 1));
    expect(displayStatus(snap, now)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const now = 1_000_000;
    const snap = makeSnap('failed', now - 100_000);
    expect(displayStatus(snap, now)).toBe('failed');
  });

  it('ready → ready', () => {
    const now = 1_000_000;
    const snap = makeSnap('ready', now - 100_000);
    expect(displayStatus(snap, now)).toBe('ready');
  });
});

// TC-07: markImageReady / markImageFailed on deleted id
describe('TC-07: stale id returns false', () => {
  it('markImageReady on deleted id → false, no update', () => {
    const doc = new Y.Doc();
    let updateCount = 0;
    doc.on('update', () => updateCount++);

    const result = markImageReady(doc, 'nonexistent-id', 'some/key');
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('markImageFailed on deleted id → false, no update', () => {
    const doc = new Y.Doc();
    let updateCount = 0;
    doc.on('update', () => updateCount++);

    const result = markImageFailed(doc, 'nonexistent-id');
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('markImageRetrying on deleted id → false, no update', () => {
    const doc = new Y.Doc();
    let updateCount = 0;
    doc.on('update', () => updateCount++);

    const result = markImageRetrying(doc, 'nonexistent-id', Date.now());
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
  });
});
