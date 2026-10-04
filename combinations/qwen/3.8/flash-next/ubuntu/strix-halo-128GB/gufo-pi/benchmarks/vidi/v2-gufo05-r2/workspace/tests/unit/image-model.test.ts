/**
 * Story 12 unit tests: image object model (TC-03 to TC-07).
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
  type ImageSnapshot,
} from '../../src/shared/objects/image';

describe('TC-03: placementSize', () => {
  it('400x300 → 400x300 (no upscale, both below limit)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 → 800x600 (landscape, scale down)', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 → 75x800 (portrait, scale down)', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 → 800x800 (at boundary, no scale)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('TC-04: layoutRow', () => {
  const sizes = [
    { width: 100, height: 80 },
    { width: 200, height: 120 },
    { width: 150, height: 90 },
  ];

  it('top-left anchor: tops aligned at point, gaps between images', () => {
    const point = { x: 50, y: 100 };
    const rects = layoutRow(sizes, point, 'top-left');
    expect(rects).toHaveLength(3);
    // All tops at the point's y
    expect(rects[0]!.y).toBe(100);
    expect(rects[1]!.y).toBe(100);
    expect(rects[2]!.y).toBe(100);
    // First image starts at the point's x
    expect(rects[0]!.x).toBe(50);
    // Second starts after first + gap
    expect(rects[1]!.x).toBe(50 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    // Third starts after second + gap
    expect(rects[2]!.x).toBe(50 + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD);
    // Widths/heights preserved
    expect(rects[0]!.width).toBe(100);
    expect(rects[1]!.width).toBe(200);
    expect(rects[2]!.width).toBe(150);
  });

  it('centre anchor: row centred on the point', () => {
    const point = { x: 400, y: 300 };
    const rects = layoutRow(sizes, point, 'centre');
    expect(rects).toHaveLength(3);
    // Total row width: 100 + 24 + 200 + 24 + 150 = 498
    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD + 150;
    const expectedStartX = 400 - totalWidth / 2;
    expect(rects[0]!.x).toBeCloseTo(expectedStartX);
    // Max height is 120, so tops are at point.y - maxHeight/2
    const maxHeight = 120;
    expect(rects[0]!.y).toBeCloseTo(300 - maxHeight / 2);
  });
});

describe('TC-05: createImagePlaceholders and undo', () => {
  it('3 placeholders created in one update; markImageReady uses UPLOAD_ORIGIN; undo removes all 3', () => {
    const doc = new Y.Doc();
    const now = 1000;
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 200, height: 150 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/jpeg' },
      { rect: { x: 348, y: 0, width: 80, height: 80 }, naturalWidth: 80, naturalHeight: 80, contentType: 'image/gif' },
    ];

    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    // Set up UndoManager tracking only LOCAL_ORIGIN before the transaction
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const um = new Y.UndoManager(objects, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    const ids = createImagePlaceholders(doc, items, 'user-1', now);
    expect(ids).toHaveLength(3);
    // One transaction = one update event
    expect(updateCount).toBe(1);

    // All three objects exist with status 'uploading'
    for (const id of ids) {
      const entry = objects.get(id);
      expect(entry).toBeDefined();
      expect(entry!.get('status')).toBe('uploading');
      expect(entry!.get('uploaderId')).toBe('user-1');
      expect(entry!.get('uploadStartedAt')).toBe(now);
    }

    // markImageReady uses UPLOAD_ORIGIN — should NOT add an undo step
    const readyId = ids[0]!;
    const beforeStack = um.undoStack.length;
    markImageReady(doc, readyId, 'boardid/assetid');
    expect(um.undoStack.length).toBe(beforeStack);

    // The image is now 'ready'
    const readyEntry = objects.get(readyId);
    expect(readyEntry!.get('status')).toBe('ready');
    expect(readyEntry!.get('assetKey')).toBe('boardid/assetid');

    // Undo stack should have length 1 (the single createImagePlaceholders transaction)
    expect(um.undoStack.length).toBe(1);

    // Undo removes all 3 placeholders
    um.undo();
    for (const id of ids) {
      expect(objects.get(id)).toBeUndefined();
    }
  });
});

describe('TC-06: displayStatus', () => {
  const baseImg: ImageSnapshot = {
    id: 'img-1',
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    z: 1,
    createdAt: 0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 100,
    status: 'uploading',
    uploadStartedAt: 1000,
    uploaderId: 'user-1',
  };

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS - 1;
    expect(displayStatus(baseImg, now)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS + 1;
    expect(displayStatus(baseImg, now)).toBe('unfinished');
  });

  it('uploading at exactly IMAGE_UPLOAD_STALE_MS → unfinished', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS;
    expect(displayStatus(baseImg, now)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const img = { ...baseImg, status: 'failed' as const };
    expect(displayStatus(img, 999999)).toBe('failed');
  });

  it('ready → ready', () => {
    const img = { ...baseImg, status: 'ready' as const };
    expect(displayStatus(img, 999999)).toBe('ready');
  });
});

describe('TC-07: markImageReady/markImageFailed on deleted id', () => {
  it('markImageReady returns false for stale id, no update emitted', () => {
    const doc = new Y.Doc();
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });
    const result = markImageReady(doc, 'nonexistent', 'key');
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('markImageFailed returns false for stale id, no update emitted', () => {
    const doc = new Y.Doc();
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });
    const result = markImageFailed(doc, 'nonexistent');
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('markImageRetrying returns false for stale id', () => {
    const doc = new Y.Doc();
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });
    const result = markImageRetrying(doc, 'nonexistent', Date.now());
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
  });
});
