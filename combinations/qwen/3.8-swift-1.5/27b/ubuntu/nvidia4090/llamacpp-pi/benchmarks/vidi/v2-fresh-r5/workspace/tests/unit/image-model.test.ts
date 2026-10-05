import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  displayStatus,
  type ImageSnap,
} from '../../src/shared/objects/image';
import type { Rect, Point, Size } from '../../src/shared/geometry';

// ─── TC-03: placementSize ─────────────────────────────────────────────────────

describe('TC-03: placementSize', () => {
  it('400x300 → 400x300 (no upscale)', () => {
    const result = placementSize(400, 300);
    expect(result).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 → 800x600 (scale down landscape)', () => {
    const result = placementSize(1600, 1200);
    expect(result).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 → 75x800 (scale down portrait)', () => {
    const result = placementSize(300, 3200);
    expect(result).toEqual({ width: 75, height: 800 });
  });

  it('800x800 → 800x800 (boundary: exactly at limit)', () => {
    const result = placementSize(800, 800);
    expect(result).toEqual({ width: 800, height: 800 });
  });

  it('100x100 → 100x100 (small image, no change)', () => {
    const result = placementSize(100, 100);
    expect(result).toEqual({ width: 100, height: 100 });
  });
});

// ─── TC-04: layoutRow ─────────────────────────────────────────────────────────

describe('TC-04: layoutRow', () => {
  it('top-left anchor: 3 sizes at a point, tops aligned, gaps correct', () => {
    const sizes: Size[] = [
      { width: 100, height: 50 },
      { width: 200, height: 100 },
      { width: 50, height: 25 },
    ];
    const start: Point = { x: 1000, y: 500 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects).toHaveLength(3);
    // First rect starts at the point
    expect(rects[0].x).toBe(1000);
    expect(rects[0].y).toBe(500);
    expect(rects[0].width).toBe(100);
    expect(rects[0].height).toBe(50);

    // Second rect: x = 1000 + 100 + 24 (gap), same top
    expect(rects[1].x).toBe(1000 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBe(500);
    expect(rects[1].width).toBe(200);
    expect(rects[1].height).toBe(100);

    // Third rect: x = 1000 + 100 + 24 + 200 + 24, same top
    expect(rects[2].x).toBe(1000 + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].y).toBe(500);
    expect(rects[2].width).toBe(50);
    expect(rects[2].height).toBe(25);
  });

  it('centre anchor: row centred on the point', () => {
    const sizes: Size[] = [
      { width: 100, height: 50 },
      { width: 100, height: 50 },
    ];
    // Total row width: 100 + 24 + 100 = 224
    const centre: Point = { x: 1000, y: 500 };
    const rects = layoutRow(sizes, centre, 'centre');

    expect(rects).toHaveLength(2);
    // Row starts at centre.x - totalWidth/2
    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 100;
    expect(rects[0].x).toBe(1000 - totalWidth / 2);
    expect(rects[0].y).toBe(500);
    expect(rects[1].x).toBe(1000 - totalWidth / 2 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBe(500);
  });
});

// ─── TC-05: createImagePlaceholders + markImageReady + undo ──────────────────

describe('TC-05: createImagePlaceholders and markImageReady', () => {
  it('creates 3 uploading objects in one transaction; markImageReady sets assetKey; undo stack = 1', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap('objects');
    const undoManager = new Y.UndoManager(objects, { trackedOrigins: new Set([LOCAL_ORIGIN]) });

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 } as Rect, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 200, height: 100 } as Rect, naturalWidth: 200, naturalHeight: 100, contentType: 'image/jpeg' },
      { rect: { x: 348, y: 0, width: 50, height: 25 } as Rect, naturalWidth: 50, naturalHeight: 25, contentType: 'image/gif' },
    ];

    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    expect(ids).toHaveLength(3);

    // Check all are uploading
    for (const id of ids) {
      const obj = objects.get(id) as Y.Map<unknown> | undefined;
      expect(obj).toBeDefined();
      expect(obj!.get('status')).toBe('uploading');
      expect(obj!.get('uploaderId')).toBe('user1');
      expect(obj!.get('uploadStartedAt')).toBe(1000);
      expect(obj!.get('assetKey')).toBeNull();
    }

    // Mark one as ready
    const ready = markImageReady(doc, ids[0], 'board123/asset456');
    expect(ready).toBe(true);
    const readyObj = objects.get(ids[0]) as Y.Map<unknown>;
    expect(readyObj.get('status')).toBe('ready');
    expect(readyObj.get('assetKey')).toBe('board123/asset456');

    // UndoManager should have exactly 1 step (the creation, not the ready update)
    expect(undoManager.canUndo()).toBe(true);
    // Undo removes all 3 placeholders
    undoManager.undo();
    for (const id of ids) {
      expect(objects.get(id)).toBeUndefined();
    }
    expect(undoManager.canUndo()).toBe(false);
  });
});

// ─── TC-06: displayStatus ─────────────────────────────────────────────────────

describe('TC-06: displayStatus', () => {
  function makeImageSnap(overrides: Partial<ImageSnap> = {}): ImageSnap {
    return {
      id: 'img1',
      type: 'image',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      z: 1,
      createdAt: 0,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 100,
      naturalHeight: 50,
      status: 'uploading',
      uploadStartedAt: 0,
      uploaderId: 'user1',
      ...overrides,
    };
  }

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const img = makeImageSnap({ uploadStartedAt: 0, status: 'uploading' });
    const now = IMAGE_UPLOAD_STALE_MS - 1;
    expect(displayStatus(img, now)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const img = makeImageSnap({ uploadStartedAt: 0, status: 'uploading' });
    const now = IMAGE_UPLOAD_STALE_MS + 1;
    expect(displayStatus(img, now)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const img = makeImageSnap({ status: 'failed', uploadStartedAt: 0 });
    expect(displayStatus(img, 0)).toBe('failed');
  });

  it('ready → ready', () => {
    const img = makeImageSnap({ status: 'ready', assetKey: 'b/a', uploadStartedAt: 0 });
    expect(displayStatus(img, 0)).toBe('ready');
  });
});

// ─── TC-07: markImageReady/markImageFailed on deleted id ──────────────────────

describe('TC-07: stale id returns false', () => {
  it('markImageReady on a deleted id returns false', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 } as Rect, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    // Delete the object
    const objects = doc.getMap('objects');
    doc.transact(() => { objects.delete(ids[0]); }, LOCAL_ORIGIN);
    const result = markImageReady(doc, ids[0], 'b/a');
    expect(result).toBe(false);
  });

  it('markImageFailed on a deleted id returns false', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 } as Rect, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    const objects = doc.getMap('objects');
    doc.transact(() => { objects.delete(ids[0]); }, LOCAL_ORIGIN);
    const result = markImageFailed(doc, ids[0]);
    expect(result).toBe(false);
  });
});
