/**
 * Unit tests for the image object model (TC-03 to TC-07).
 *
 * Tests placementSize, layoutRow, createImagePlaceholders, markImageReady,
 * markImageFailed, markImageRetrying, and displayStatus on a real Y.Doc
 * with a real Y.UndoManager tracking LOCAL_ORIGIN only.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, deleteObjects, initDoc } from '../../src/shared/board-model';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
  type Size
} from '../../src/shared/objects/image';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';

describe('placementSize (TC-03)', () => {
  it('keeps 400x300 unchanged (smaller than max)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('scales 1600x1200 to 800x600', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('scales 300x3200 to 75x800 (portrait)', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('keeps 800x800 unchanged (exactly at boundary)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });

  it('never upscales: 100x50 stays 100x50', () => {
    expect(placementSize(100, 50)).toEqual({ width: 100, height: 50 });
  });
});

describe('layoutRow (TC-04)', () => {
  const sizes: Size[] = [
    { width: 100, height: 80 },
    { width: 200, height: 150 },
    { width: 50, height: 50 }
  ];

  it('top-left anchor: tops aligned, separated by IMAGE_LAYOUT_GAP_WORLD', () => {
    const start: Point = { x: 100, y: 200 };
    const rects = layoutRow(sizes, start, 'top-left');
    expect(rects).toHaveLength(3);
    // First image top-left at the point
    expect(rects[0]).toEqual({ x: 100, y: 200, width: 100, height: 80 });
    // Second starts after first width + gap
    expect(rects[1].x).toBe(100 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBe(200);
    expect(rects[1].width).toBe(200);
    expect(rects[1].height).toBe(150);
    // Third starts after second
    expect(rects[2].x).toBe(100 + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].y).toBe(200);
  });

  it('centre anchor: row centred on the point', () => {
    const centre: Point = { x: 500, y: 300 };
    const rects = layoutRow(sizes, centre, 'centre');
    expect(rects).toHaveLength(3);
    // Total row width = 100 + gap + 200 + gap + 50 = 374
    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD + 50;
    const startX = centre.x - totalWidth / 2;
    expect(rects[0].x).toBeCloseTo(startX);
    // Centre of the row should be at centre.x
    const rowCentre = rects[0].x + totalWidth / 2;
    expect(rowCentre).toBeCloseTo(centre.x);
    // Tops should be centred on the tallest image
    const maxHeight = 150;
    const topY = centre.y - maxHeight / 2;
    // All rects should have their y such that the row is centred vertically
    expect(rects[0].y).toBeCloseTo(topY);
  });

  it('empty sizes returns empty array', () => {
    expect(layoutRow([], { x: 0, y: 0 }, 'top-left')).toEqual([]);
  });
});

describe('createImagePlaceholders and status updates (TC-05)', () => {
  it('creates 3 placeholders in one transaction, one becomes ready, undo stack length is 1', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN])
    });

    const items = [
      { rect: { x: 0, y: 0, width: 200, height: 150 }, naturalWidth: 200, naturalHeight: 150, contentType: 'image/png' },
      { rect: { x: 224, y: 0, width: 300, height: 200 }, naturalWidth: 300, naturalHeight: 200, contentType: 'image/jpeg' },
      { rect: { x: 548, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/gif' }
    ];

    const now = 1000000;
    const ids = createImagePlaceholders(doc, items, 'user-1', now);
    expect(ids).toHaveLength(3);

    // All objects have status 'uploading'
    const objects = doc.getMap('objects');
    for (const id of ids) {
      const obj = objects.get(id) as Y.Map<unknown>;
      expect(obj.get('type')).toBe('image');
      expect(obj.get('status')).toBe('uploading');
      expect(obj.get('uploaderId')).toBe('user-1');
      expect(obj.get('uploadStartedAt')).toBe(now);
    }

    // Undo stack has exactly 1 step
    expect(undoManager.undoStack.length).toBe(1);

    // Mark one as ready (UPLOAD_ORIGIN — should NOT add to undo stack)
    const result = markImageReady(doc, ids[0], 'boardid12345678901234/assetid1234567890123456');
    expect(result).toBe(true);
    const obj = objects.get(ids[0]) as Y.Map<unknown>;
    expect(obj.get('status')).toBe('ready');
    expect(obj.get('assetKey')).toBe('boardid12345678901234/assetid1234567890123456');

    // Undo stack still has exactly 1 step (markImageReady uses UPLOAD_ORIGIN which is not tracked)
    expect(undoManager.undoStack.length).toBe(1);

    // Undo removes all 3 placeholders
    undoManager.undo();
    expect(objects.get(ids[0])).toBeUndefined();
    expect(objects.get(ids[1])).toBeUndefined();
    expect(objects.get(ids[2])).toBeUndefined();

    undoManager.destroy();
  });
});

describe('displayStatus (TC-06)', () => {
  const base = {
    id: 'test-id',
    type: 'image' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    z: 1,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 100,
    uploadStartedAt: 1000,
    uploaderId: 'user-1'
  };

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 returns uploading', () => {
    const img = { ...base, status: 'uploading' as const };
    const now = base.uploadStartedAt + IMAGE_UPLOAD_STALE_MS - 1;
    expect(displayStatus(img, now)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 returns unfinished', () => {
    const img = { ...base, status: 'uploading' as const };
    const now = base.uploadStartedAt + IMAGE_UPLOAD_STALE_MS + 1;
    expect(displayStatus(img, now)).toBe('unfinished');
  });

  it('uploading at exactly IMAGE_UPLOAD_STALE_MS returns uploading (boundary inclusive)', () => {
    const img = { ...base, status: 'uploading' as const };
    const now = base.uploadStartedAt + IMAGE_UPLOAD_STALE_MS;
    // "older than" means strictly greater than
    expect(displayStatus(img, now)).toBe('uploading');
  });

  it('failed returns failed', () => {
    const img = { ...base, status: 'failed' as const };
    expect(displayStatus(img, 999999999)).toBe('failed');
  });

  it('ready returns ready', () => {
    const img = { ...base, status: 'ready' as const, assetKey: 'key' };
    expect(displayStatus(img, 999999999)).toBe('ready');
  });
});

describe('markImageReady / markImageFailed on deleted id (TC-07)', () => {
  it('returns false for a deleted id with no update', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' }
    ];
    const ids = createImagePlaceholders(doc, items, 'user-1', 1000);

    // Delete the object
    deleteObjects(doc, ids);

    // markImageReady on deleted id returns false
    expect(markImageReady(doc, ids[0], 'some/key')).toBe(false);

    // markImageFailed on deleted id returns false
    expect(markImageFailed(doc, ids[0])).toBe(false);

    // markImageRetrying on deleted id returns false
    expect(markImageRetrying(doc, ids[0], 2000)).toBe(false);
  });
});
