// TC-03: placementSize
// TC-04: layoutRow
// TC-05: createImagePlaceholders + markImageReady + undo stack
// TC-06: displayStatus boundary
// TC-07: markImageReady/Failed on deleted id

import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
  UPLOAD_ORIGIN,
  readImageSnap,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { initDoc, LOCAL_ORIGIN, getObjects } from '../../src/shared/board-model';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import type { Rect, Point } from '../../src/shared/geometry';

describe('TC-03: placementSize', () => {
  it('400x300 stays 400x300 (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 scales to 800x600', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 scales to 75x800 (portrait)', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 stays 800x800 (boundary)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });

  it('non-finite input returns zeros', () => {
    expect(placementSize(Infinity, 100)).toEqual({ width: 0, height: 0 });
    expect(placementSize(100, NaN)).toEqual({ width: 0, height: 0 });
  });
});

describe('TC-04: layoutRow', () => {
  it('top-left: 3 sizes at a point → tops aligned, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 80, height: 40 },
      { width: 60, height: 30 },
    ];
    const start: Point = { x: 200, y: 300 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 200, y: 300, width: 100, height: 50 });
    expect(rects[1]).toEqual({ x: 200 + 100 + IMAGE_LAYOUT_GAP_WORLD, y: 300, width: 80, height: 40 });
    expect(rects[2]).toEqual({ x: 200 + 100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD, y: 300, width: 60, height: 30 });
  });

  it('centre: row centred on the point (both axes)', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 80, height: 40 },
    ];
    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 80;
    const maxHeight = 50; // max of 50 and 40
    const start: Point = { x: 500, y: 200 };
    const rects = layoutRow(sizes, start, 'centre');

    expect(rects[0].x).toBe(500 - totalWidth / 2);
    expect(rects[1].x).toBe(500 - totalWidth / 2 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[0].y).toBe(200 - maxHeight / 2);
    expect(rects[1].y).toBe(200 - maxHeight / 2);
  });

  it('empty sizes returns empty array', () => {
    expect(layoutRow([], { x: 0, y: 0 }, 'top-left')).toEqual([]);
  });
});

describe('TC-05: createImagePlaceholders + markImageReady + undo', () => {
  it('creates 3 placeholders in one update; markImageReady sets assetKey; undo stack has 1 entry', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const undoManager = new Y.UndoManager(doc, { trackedOrigins: new Set([LOCAL_ORIGIN]) as any });

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 } as Rect, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 80, height: 40 } as Rect, naturalWidth: 80, naturalHeight: 40, contentType: 'image/jpeg' },
      { rect: { x: 228, y: 0, width: 60, height: 30 } as Rect, naturalWidth: 60, naturalHeight: 30, contentType: 'image/gif' },
    ];

    const now = Date.now();
    const ids = createImagePlaceholders(doc, items, 'uploader-1', now);

    expect(ids).toHaveLength(3);

    // All three are in 'uploading' status
    for (const id of ids) {
      const snap = readImageSnap(doc, id);
      expect(snap).toBeDefined();
      expect(snap!.status).toBe('uploading');
      expect(snap!.uploaderId).toBe('uploader-1');
      expect(snap!.uploadStartedAt).toBe(now);
      expect(snap!.assetKey).toBeNull();
    }

    // UndoManager should have exactly 1 entry (the create transaction)
    expect(undoManager.undoStack.length).toBe(1);

    // Mark one as ready
    const assetKey = 'boardid'.padEnd(22, 'a') + '/' + 'assetid'.padEnd(22, 'b');
    expect(markImageReady(doc, ids[0], assetKey)).toBe(true);

    // The ready image has the assetKey
    const readySnap = readImageSnap(doc, ids[0])!;
    expect(readySnap.status).toBe('ready');
    expect(readySnap.assetKey).toBe(assetKey);

    // UndoManager stack should still be 1 (markImageReady uses UPLOAD_ORIGIN, not tracked)
    expect(undoManager.undoStack.length).toBe(1);

    // Undo removes all 3 placeholders (one undo step)
    undoManager.undo();
    const objects = getObjects(doc);
    for (const id of ids) {
      expect(objects.has(id)).toBe(false);
    }
  });
});

describe('TC-06: displayStatus boundary', () => {
  function makeSnap(overrides: Partial<ImageSnap>): ImageSnap {
    return {
      id: 'test',
      type: 'image',
      x: 0, y: 0, z: 0, createdAt: 0,
      width: 100, height: 50,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 100, naturalHeight: 50,
      status: 'uploading',
      uploadStartedAt: 0,
      uploaderId: 'u1',
      ...overrides,
    };
  }

  it('uploading at STALE_MS - 1 → uploading', () => {
    const snap = makeSnap({ uploadStartedAt: 0 });
    expect(displayStatus(snap, IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
  });

  it('uploading at STALE_MS + 1 → unfinished', () => {
    const snap = makeSnap({ uploadStartedAt: 0 });
    expect(displayStatus(snap, IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const snap = makeSnap({ status: 'failed' });
    expect(displayStatus(snap, 0)).toBe('failed');
  });

  it('ready → ready', () => {
    const snap = makeSnap({ status: 'ready', assetKey: 'a/b' });
    expect(displayStatus(snap, 0)).toBe('ready');
  });
});

describe('TC-07: markImageReady/Failed on deleted id', () => {
  it('markImageReady on deleted id returns false, no update', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const items = [{ rect: { x: 0, y: 0, width: 100, height: 50 } as Rect, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' }];
    const ids = createImagePlaceholders(doc, items, 'u1', Date.now());

    // Delete the object
    doc.transact(() => {
      getObjects(doc).delete(ids[0]);
    }, LOCAL_ORIGIN);

    expect(markImageReady(doc, ids[0], 'a/b')).toBe(false);
  });

  it('markImageFailed on deleted id returns false, no update', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const items = [{ rect: { x: 0, y: 0, width: 100, height: 50 } as Rect, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' }];
    const ids = createImagePlaceholders(doc, items, 'u1', Date.now());

    doc.transact(() => {
      getObjects(doc).delete(ids[0]);
    }, LOCAL_ORIGIN);

    expect(markImageFailed(doc, ids[0])).toBe(false);
  });
});
