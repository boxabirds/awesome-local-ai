/**
 * Unit tests for image object model.
 * TC-03, TC-04, TC-05, TC-06, TC-07
 */
import { describe, it, expect, beforeEach } from 'vitest';
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
} from '../../src/shared/objects/image';
import type { ImageSnap } from '../../src/shared/objects/image';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

describe('placementSize (TC-03)', () => {
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
});

describe('layoutRow (TC-04)', () => {
  it('top-left anchor: 3 images with gaps, tops aligned at start', () => {
    const sizes = [
      { width: 100, height: 200 },
      { width: 150, height: 100 },
      { width: 80, height: 300 },
    ];
    const start = { x: 50, y: 60 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects[0]).toEqual({ x: 50, y: 60, width: 100, height: 200 });
    expect(rects[1]).toEqual({ x: 50 + 100 + IMAGE_LAYOUT_GAP_WORLD, y: 60, width: 150, height: 100 });
    expect(rects[2]).toEqual({ x: 50 + 100 + IMAGE_LAYOUT_GAP_WORLD + 150 + IMAGE_LAYOUT_GAP_WORLD, y: 60, width: 80, height: 300 });

    // All tops aligned at start.y
    for (const r of rects) {
      expect(r.y).toBe(60);
    }
  });

  it('centre anchor: row is centred on the start point', () => {
    const sizes = [
      { width: 100, height: 200 },
      { width: 100, height: 200 },
    ];
    const start = { x: 400, y: 300 };
    const rects = layoutRow(sizes, start, 'centre');

    // Total width = 100 + 24 + 100 = 224
    // Origin X = 400 - 224/2 = 288
    expect(rects[0].x).toBe(288);
    expect(rects[1].x).toBe(288 + 100 + IMAGE_LAYOUT_GAP_WORLD);

    // Max height = 200, origin Y = 300 - 200/2 = 200
    expect(rects[0].y).toBe(200);
    expect(rects[1].y).toBe(200);
  });
});

describe('createImagePlaceholders and markImageReady (TC-05)', () => {
  let doc: Y.Doc;
  let undoManager: Y.UndoManager;

  beforeEach(() => {
    doc = new Y.Doc();
    // Set up undo manager tracking only LOCAL_ORIGIN
    undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
  });

  it('creates 3 placeholders in one update with correct fields', () => {
    const items = [
      { rect: { x: 0, y: 0, width: 200, height: 300 }, naturalWidth: 400, naturalHeight: 600, contentType: 'image/png' },
      { rect: { x: 224, y: 0, width: 400, height: 300 }, naturalWidth: 800, naturalHeight: 600, contentType: 'image/jpeg' },
      { rect: { x: 648, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/gif' },
    ];

    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    const ids = createImagePlaceholders(doc, items, 'uploader1', 1000);

    expect(ids).toHaveLength(3);
    expect(updateCount).toBe(1); // one transaction

    // Verify all have status uploading
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    for (const id of ids) {
      const m = objects.get(id);
      expect(m).toBeDefined();
      expect(m!.get('status')).toBe('uploading');
      expect(m!.get('uploaderId')).toBe('uploader1');
      expect(m!.get('uploadStartedAt')).toBe(1000);
    }

    // markImageReady uses UPLOAD_ORIGIN (not tracked by UndoManager)
    updateCount = 0;
    const result = markImageReady(doc, ids[0], 'board1/asset1');
    expect(result).toBe(true);
    expect(objects.get(ids[0])!.get('status')).toBe('ready');
    expect(objects.get(ids[0])!.get('assetKey')).toBe('board1/asset1');

    // UndoManager stack should be 1 (from creation only, not from markImageReady)
    expect(undoManager.undoStack.length).toBe(1);

    // Undo removes all 3 placeholders
    undoManager.undo();
    expect(objects.size).toBe(0);
  });
});

describe('displayStatus (TC-06)', () => {
  const baseImg: ImageSnap = {
    id: 'test-id',
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
    uploadStartedAt: 0,
    uploaderId: 'user1',
  };

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const img = { ...baseImg, uploadStartedAt: 1000 };
    expect(displayStatus(img, 1000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const img = { ...baseImg, uploadStartedAt: 1000 };
    expect(displayStatus(img, 1000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('uploading at exactly IMAGE_UPLOAD_STALE_MS → unfinished', () => {
    const img = { ...baseImg, uploadStartedAt: 1000 };
    expect(displayStatus(img, 1000 + IMAGE_UPLOAD_STALE_MS)).toBe('unfinished');
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

describe('markImageReady / markImageFailed on deleted id (TC-07)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('markImageReady on missing id returns false, no update', () => {
    let updated = false;
    doc.on('update', () => { updated = true; });

    const result = markImageReady(doc, 'nonexistent', 'board/asset');
    expect(result).toBe(false);
    expect(updated).toBe(false);
  });

  it('markImageFailed on missing id returns false, no update', () => {
    let updated = false;
    doc.on('update', () => { updated = true; });

    const result = markImageFailed(doc, 'nonexistent');
    expect(result).toBe(false);
    expect(updated).toBe(false);
  });

  it('markImageRetrying on missing id returns false', () => {
    const result = markImageRetrying(doc, 'nonexistent', 9999);
    expect(result).toBe(false);
  });
});
