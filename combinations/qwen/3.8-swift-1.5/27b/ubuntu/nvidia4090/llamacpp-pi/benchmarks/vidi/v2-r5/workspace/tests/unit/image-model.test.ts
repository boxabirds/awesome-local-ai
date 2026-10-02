// tests/unit/image-model.test.ts
// TC-03: placementSize
// TC-04: layoutRow
// TC-05: createImagePlaceholders + markImageReady + UndoManager
// TC-06: displayStatus boundary
// TC-07: markImageReady/Failed on deleted id

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  displayStatus,
} from '../../src/shared/objects/image';
import type { ImageSnap } from '../../src/shared/objects/image';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

describe('TC-03: placementSize', () => {
  it('400x300 → 400x300 (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 → 800x600 (landscape scaled down)', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 → 75x800 (portrait scaled down)', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 → 800x800 (boundary)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('TC-04: layoutRow', () => {
  it('top-left: tops aligned at point, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 200, height: 80 },
      { width: 150, height: 60 },
    ];
    const start = { x: 10, y: 20 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects).toHaveLength(3);
    expect(rects[0].x).toBe(10);
    expect(rects[0].y).toBe(20);
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
    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 200;
    const centre = { x: 500, y: 300 };
    const rects = layoutRow(sizes, centre, 'centre');

    expect(rects[0].x).toBe(500 - totalWidth / 2);
    expect(rects[0].y).toBe(300);
    expect(rects[1].x).toBe(500 - totalWidth / 2 + 100 + IMAGE_LAYOUT_GAP_WORLD);
  });
});

describe('TC-05: createImagePlaceholders + markImageReady + UndoManager', () => {
  it('creates 3 uploading objects in one update; markImageReady sets assetKey; undo stack length 1; undo removes all 3', () => {
    const doc = new Y.Doc();
    const undoManager = new Y.UndoManager(doc, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 200, height: 80 }, naturalWidth: 200, naturalHeight: 80, contentType: 'image/jpeg' },
      { rect: { x: 348, y: 0, width: 150, height: 60 }, naturalWidth: 150, naturalHeight: 60, contentType: 'image/webp' },
    ];

    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    expect(ids).toHaveLength(3);

    // Verify all are uploading
    const objects = doc.getMap('objects');
    for (const id of ids) {
      const obj = objects.get(id) as Y.Map<unknown>;
      expect(obj.get('status')).toBe('uploading');
      expect(obj.get('uploaderId')).toBe('user1');
      expect(obj.get('uploadStartedAt')).toBe(1000);
      expect(obj.get('assetKey')).toBeNull();
    }

    // UndoManager should have exactly 1 entry (the create transaction)
    expect(undoManager.canUndo()).toBe(true);
    expect(undoManager.undoStack.length).toBe(1);

    // markImageReady uses UPLOAD_ORIGIN (not tracked)
    const ok = markImageReady(doc, ids[0], 'board1/asset1');
    expect(ok).toBe(true);

    const obj0 = objects.get(ids[0]) as Y.Map<unknown>;
    expect(obj0.get('status')).toBe('ready');
    expect(obj0.get('assetKey')).toBe('board1/asset1');

    // Undo stack should still be 1 (UPLOAD_ORIGIN is not tracked)
    expect(undoManager.undoStack.length).toBe(1);

    // Undo should remove all 3 placeholders
    undoManager.undo();
    for (const id of ids) {
      expect(objects.has(id)).toBe(false);
    }
  });
});

describe('TC-06: displayStatus boundary', () => {
  function makeSnap(overrides: Partial<ImageSnap> = {}): ImageSnap {
    return {
      id: 'test',
      type: 'image',
      x: 0, y: 0, z: 0,
      width: 100, height: 50,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 100, naturalHeight: 50,
      status: 'uploading',
      uploadStartedAt: 0,
      uploaderId: 'user1',
      ...overrides,
    };
  }

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const snap = makeSnap({ uploadStartedAt: 0 });
    expect(displayStatus(snap, IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const snap = makeSnap({ uploadStartedAt: 0 });
    expect(displayStatus(snap, IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const snap = makeSnap({ status: 'failed' });
    expect(displayStatus(snap, 999999999)).toBe('failed');
  });

  it('ready → ready', () => {
    const snap = makeSnap({ status: 'ready', assetKey: 'board/asset' });
    expect(displayStatus(snap, 999999999)).toBe('ready');
  });
});

describe('TC-07: markImageReady/Failed on deleted id', () => {
  it('markImageReady on deleted id returns false, no update', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    
    // Delete the object
    const objects = doc.getMap('objects');
    objects.delete(ids[0]);

    const result = markImageReady(doc, ids[0], 'board/asset');
    expect(result).toBe(false);
  });

  it('markImageFailed on deleted id returns false', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    
    const objects = doc.getMap('objects');
    objects.delete(ids[0]);

    const result = markImageFailed(doc, ids[0]);
    expect(result).toBe(false);
  });
});
