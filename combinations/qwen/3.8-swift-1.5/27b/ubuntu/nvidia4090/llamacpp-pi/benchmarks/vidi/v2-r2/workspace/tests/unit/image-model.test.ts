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
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

describe('TC-03: placementSize', () => {
  it('400x300 → 400x300 (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 → 800x600 (scale down)', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 → 75x800 (portrait scale down)', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 → 800x800 (boundary)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('TC-04: layoutRow', () => {
  it('top-left anchor: 3 sizes at a point', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 80, height: 40 },
      { width: 60, height: 30 },
    ];
    const start = { x: 200, y: 100 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects).toHaveLength(3);
    expect(rects[0].x).toBe(200);
    expect(rects[0].y).toBe(100);
    expect(rects[0].width).toBe(100);
    expect(rects[0].height).toBe(50);

    expect(rects[1].x).toBe(200 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBe(100);

    expect(rects[2].x).toBe(200 + 100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].y).toBe(100);
  });

  it('centre anchor: row centred on the point', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 80, height: 40 },
    ];
    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 80;
    const start = { x: 500, y: 300 };
    const rects = layoutRow(sizes, start, 'centre');

    expect(rects[0].x).toBe(500 - totalWidth / 2);
    expect(rects[1].x).toBe(500 - totalWidth / 2 + 100 + IMAGE_LAYOUT_GAP_WORLD);
  });
});

describe('TC-05: createImagePlaceholders and markImageReady', () => {
  it('creates 3 placeholders in one update; markImageReady on one; undo stack is 1', () => {
    const doc = new Y.Doc();
    const undoManager = new Y.UndoManager(doc, { trackedOrigins: new Set([LOCAL_ORIGIN]) });

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 80, height: 40 }, naturalWidth: 80, naturalHeight: 40, contentType: 'image/png' },
      { rect: { x: 228, y: 0, width: 60, height: 30 }, naturalWidth: 60, naturalHeight: 30, contentType: 'image/png' },
    ];

    const ids = createImagePlaceholders(doc, items, 'uploader-1', Date.now());
    expect(ids).toHaveLength(3);

    // Verify objects exist with status 'uploading'
    const objects = doc.getMap('objects');
    for (const id of ids) {
      const obj = objects.get(id) as Y.Map<unknown>;
      expect(obj.get('type')).toBe('image');
      expect(obj.get('status')).toBe('uploading');
      expect(obj.get('uploaderId')).toBe('uploader-1');
    }

    // markImageReady on one (UPLOAD_ORIGIN - not tracked)
    markImageReady(doc, ids[0], 'board/asset');
    const obj0 = objects.get(ids[0]) as Y.Map<unknown>;
    expect(obj0.get('status')).toBe('ready');
    expect(obj0.get('assetKey')).toBe('board/asset');

    // UndoManager should have exactly 1 undo step (the creation transaction)
    expect(undoManager.undoStack.length).toBe(1);

    // Undo removes all 3 placeholders
    undoManager.undo();
    for (const id of ids) {
      expect(objects.get(id)).toBeUndefined();
    }
  });
});

describe('TC-06: displayStatus', () => {
  function makeSnap(overrides: Partial<ImageSnap>): ImageSnap {
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
      uploaderId: 'test',
      ...overrides,
    };
  }

  it('uploading at STALE_MS - 1 → uploading', () => {
    const snap = makeSnap({ uploadStartedAt: 0, status: 'uploading' });
    expect(displayStatus(snap, IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
  });

  it('uploading at STALE_MS + 1 → unfinished', () => {
    const snap = makeSnap({ uploadStartedAt: 0, status: 'uploading' });
    expect(displayStatus(snap, IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const snap = makeSnap({ status: 'failed', uploadStartedAt: 0 });
    expect(displayStatus(snap, IMAGE_UPLOAD_STALE_MS + 10000)).toBe('failed');
  });

  it('ready → ready', () => {
    const snap = makeSnap({ status: 'ready', assetKey: 'board/asset', uploadStartedAt: 0 });
    expect(displayStatus(snap, IMAGE_UPLOAD_STALE_MS + 10000)).toBe('ready');
  });
});

describe('TC-07: markImageReady / markImageFailed on deleted id', () => {
  it('markImageReady on deleted id → false', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'uploader-1', Date.now());
    const objects = doc.getMap('objects');
    objects.delete(ids[0]);

    expect(markImageReady(doc, ids[0], 'board/asset')).toBe(false);
  });

  it('markImageFailed on deleted id → false', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'uploader-1', Date.now());
    const objects = doc.getMap('objects');
    objects.delete(ids[0]);

    expect(markImageFailed(doc, ids[0])).toBe(false);
  });

  it('markImageRetrying on deleted id → false', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'uploader-1', Date.now());
    const objects = doc.getMap('objects');
    objects.delete(ids[0]);

    expect(markImageRetrying(doc, ids[0], Date.now())).toBe(false);
  });
});
