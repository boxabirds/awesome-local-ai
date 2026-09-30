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
} from '@shared/objects/image';
import { LOCAL_ORIGIN } from '@shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '@shared/config';

// TC-03: placementSize
describe('TC-03: placementSize', () => {
  it('400x300 stays 400x300 (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 scales to 800x600', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 scales to 75x800', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 stays 800x800 (boundary)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

// TC-04: layoutRow
describe('TC-04: layoutRow', () => {
  it('three items with top-left anchor: tops aligned, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const sizes = [
      { width: 100, height: 200 },
      { width: 150, height: 100 },
      { width: 80, height: 300 },
    ];
    const start = { x: 500, y: 300 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 500, y: 300, width: 100, height: 200 });
    expect(rects[1]).toEqual({ x: 500 + 100 + IMAGE_LAYOUT_GAP_WORLD, y: 300, width: 150, height: 100 });
    expect(rects[2]).toEqual({
      x: 500 + 100 + IMAGE_LAYOUT_GAP_WORLD + 150 + IMAGE_LAYOUT_GAP_WORLD,
      y: 300,
      width: 80,
      height: 300,
    });
  });

  it('centre anchor: row is centred on the point', () => {
    const sizes = [
      { width: 100, height: 200 },
      { width: 150, height: 100 },
    ];
    const centre = { x: 500, y: 400 };
    const rects = layoutRow(sizes, centre, 'centre');

    // Total width = 100 + 24 + 150 = 274; left = 500 - 137 = 363
    // Top = 400 - 200/2 = 300
    expect(rects[0].x).toBeCloseTo(500 - 274 / 2);
    expect(rects[0].y).toBeCloseTo(400 - 200 / 2);
    expect(rects[1].x).toBeCloseTo(500 - 274 / 2 + 100 + IMAGE_LAYOUT_GAP_WORLD);
  });
});

// TC-05: createImagePlaceholders + markImageReady + undo
describe('TC-05: createImagePlaceholders and undo', () => {
  it('creates 3 uploading placeholders in one update; markImageReady one; undo removes all', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');

    // Set up UndoManager tracking only LOCAL_ORIGIN BEFORE any changes
    const undoManager = new Y.UndoManager(objects, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    // Track update events
    const updateEvents: Array<{ origin: unknown }> = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      updateEvents.push({ origin });
    });

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 200, height: 150 }, naturalWidth: 200, naturalHeight: 150, contentType: 'image/jpeg' },
      { rect: { x: 348, y: 0, width: 80, height: 80 }, naturalWidth: 80, naturalHeight: 80, contentType: 'image/gif' },
    ];

    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    expect(ids).toHaveLength(3);

    // All three objects exist with status 'uploading'
    for (const id of ids) {
      const obj = objects.get(id);
      expect(obj).toBeDefined();
      expect(obj!.get('status')).toBe('uploading');
      expect(obj!.get('uploaderId')).toBe('user1');
      expect(obj!.get('uploadStartedAt')).toBe(1000);
    }

    // The createImagePlaceholders was one LOCAL_ORIGIN transaction
    expect(undoManager.undoStack.length).toBe(1);

    // markImageReady uses UPLOAD_ORIGIN, not LOCAL_ORIGIN
    updateEvents.length = 0;
    const result = markImageReady(doc, ids[0], 'board123/asset456');
    expect(result).toBe(true);
    expect(objects.get(ids[0])!.get('status')).toBe('ready');
    expect(objects.get(ids[0])!.get('assetKey')).toBe('board123/asset456');

    // Verify the markImageReady update was NOT from LOCAL_ORIGIN
    for (const ev of updateEvents) {
      expect(ev.origin).not.toBe(LOCAL_ORIGIN);
    }

    // Undo stack is still 1 (upload completion did NOT add a step)
    expect(undoManager.undoStack.length).toBe(1);

    // Undo removes all 3 placeholders
    undoManager.undo();
    for (const id of ids) {
      expect(objects.has(id)).toBe(false);
    }

    undoManager.destroy();
  });
});

// TC-06: displayStatus
describe('TC-06: displayStatus', () => {
  function makeSnap(overrides: Partial<ImageSnap> = {}): ImageSnap {
    return {
      id: 'test',
      type: 'image',
      x: 0, y: 0, width: 100, height: 100, z: 1,
      createdAt: 0,
      createdBy: 'user1',
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 100,
      naturalHeight: 100,
      status: 'uploading',
      uploadStartedAt: 0,
      uploaderId: 'user1',
      ...overrides,
    };
  }

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 returns uploading', () => {
    const img = makeSnap({ uploadStartedAt: 1000 });
    const result = displayStatus(img, 1000 + IMAGE_UPLOAD_STALE_MS - 1);
    expect(result).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 returns unfinished', () => {
    const img = makeSnap({ uploadStartedAt: 1000 });
    const result = displayStatus(img, 1000 + IMAGE_UPLOAD_STALE_MS + 1);
    expect(result).toBe('unfinished');
  });

  it('failed returns failed', () => {
    const img = makeSnap({ status: 'failed' });
    expect(displayStatus(img, 999999)).toBe('failed');
  });

  it('ready returns ready', () => {
    const img = makeSnap({ status: 'ready', assetKey: 'b/a' });
    expect(displayStatus(img, 999999)).toBe('ready');
  });
});

// TC-07: markImageReady / markImageFailed on deleted id returns false
describe('TC-07: stale id operations return false', () => {
  it('markImageReady on deleted id returns false', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.delete(ids[0]);
    expect(markImageReady(doc, ids[0], 'key')).toBe(false);
  });

  it('markImageFailed on deleted id returns false', () => {
    const doc = new Y.Doc();
    expect(markImageFailed(doc, 'nonexistent')).toBe(false);
  });

  it('markImageRetrying on deleted id returns false', () => {
    const doc = new Y.Doc();
    expect(markImageRetrying(doc, 'nonexistent', 9999)).toBe(false);
  });
});
