/**
 * Unit tests for image object model (TC-03 to TC-07).
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
  type ImageSnap,
} from '../../src/shared/objects/image';
import { LOCAL_ORIGIN } from '../../src/shared/local-origin';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';

describe('placementSize (TC-03)', () => {
  it('400x300 → 400x300 (no upscale, below max)', () => {
    const r = placementSize(400, 300);
    expect(r.width).toBe(400);
    expect(r.height).toBe(300);
  });

  it('1600x1200 → 800x600 (scale down landscape)', () => {
    const r = placementSize(1600, 1200);
    expect(r.width).toBeCloseTo(800);
    expect(r.height).toBeCloseTo(600);
  });

  it('300x3200 → 75x800 (scale down portrait)', () => {
    const r = placementSize(300, 3200);
    expect(r.width).toBeCloseTo(75);
    expect(r.height).toBeCloseTo(800);
  });

  it('800x800 → 800x800 (exactly at IMAGE_MAX_PLACE_SIZE_WORLD boundary)', () => {
    const r = placementSize(800, 800);
    expect(r.width).toBe(800);
    expect(r.height).toBe(800);
  });
});

describe('layoutRow (TC-04)', () => {
  it('three sizes with top-left anchor: tops aligned, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const sizes = [
      { width: 100, height: 200 },
      { width: 150, height: 100 },
      { width: 80, height: 300 },
    ];
    const point = { x: 50, y: 60 };
    const rects = layoutRow(sizes, point, 'top-left');

    expect(rects).toHaveLength(3);
    // All tops aligned at the point
    for (const r of rects) {
      expect(r.y).toBe(point.y);
    }
    // First rect at the point
    expect(rects[0].x).toBe(50);
    // Second rect: first.x + first.width + gap
    expect(rects[1].x).toBe(50 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    // Third: second.x + second.width + gap
    expect(rects[2].x).toBe(50 + 100 + IMAGE_LAYOUT_GAP_WORLD + 150 + IMAGE_LAYOUT_GAP_WORLD);
  });

  it('centre anchor: row centred on point', () => {
    const sizes = [
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ];
    const point = { x: 500, y: 500 };
    const rects = layoutRow(sizes, point, 'centre');

    expect(rects).toHaveLength(2);
    // Total width = 100 + 24 + 100 = 224
    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 100;
    const expectedStartX = point.x - totalWidth / 2;
    expect(rects[0].x).toBeCloseTo(expectedStartX);
    expect(rects[1].x).toBeCloseTo(expectedStartX + 100 + IMAGE_LAYOUT_GAP_WORLD);
    // Max height = 100, centred
    expect(rects[0].y).toBeCloseTo(point.y - 100 / 2);
  });
});

describe('createImagePlaceholders and status (TC-05)', () => {
  let doc: Y.Doc;
  let undoManager: Y.UndoManager;

  beforeEach(() => {
    doc = new Y.Doc();
    doc.getMap('objects');
    undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
  });

  it('creates 3 placeholders in one update; markReady on one sets assetKey; undo stack length is 1', () => {
    let updateCount = 0;
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 200 }, naturalWidth: 100, naturalHeight: 200, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 80, height: 160 }, naturalWidth: 80, naturalHeight: 160, contentType: 'image/jpeg' },
      { rect: { x: 228, y: 0, width: 60, height: 120 }, naturalWidth: 60, naturalHeight: 120, contentType: 'image/gif' },
    ];

    const now = Date.now();
    const ids = createImagePlaceholders(doc, items, 'user-a', now);

    expect(ids).toHaveLength(3);
    expect(updateCount).toBe(1); // one transaction

    // Check objects exist with correct status
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    for (const id of ids) {
      const obj = objects.get(id);
      expect(obj).toBeDefined();
      expect(obj!.get('status')).toBe('uploading');
      expect(obj!.get('uploaderId')).toBe('user-a');
      expect(obj!.get('uploadStartedAt')).toBe(now);
      expect(obj!.get('type')).toBe('image');
    }

    // Mark one as ready
    const ready = markImageReady(doc, ids[0], 'abc/def');
    expect(ready).toBe(true);
    const obj0 = objects.get(ids[0]);
    expect(obj0!.get('status')).toBe('ready');
    expect(obj0!.get('assetKey')).toBe('abc/def');

    // Undo stack should be length 1 (createImagePlaceholders was one step)
    expect(undoManager.undoStack.length).toBe(1);

    // Undo removes all 3 placeholders
    undoManager.undo();
    for (const id of ids) {
      expect(objects.get(id)).toBeUndefined();
    }
  });

  it('markImageReady with UPLOAD_ORIGIN does not create a separate undo step', () => {
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user-a', Date.now());

    // After creation: stack length 1
    expect(undoManager.undoStack.length).toBe(1);

    // markImageReady uses UPLOAD_ORIGIN which is NOT tracked
    markImageReady(doc, ids[0], 'key/id');
    // Stack length should still be 1 (upload status is not an undo step)
    expect(undoManager.undoStack.length).toBe(1);
  });
});

describe('displayStatus (TC-06)', () => {
  function makeSnap(status: string, uploadStartedAt: number): ImageSnap {
    return {
      id: 'test',
      type: 'image',
      x: 0, y: 0, width: 100, height: 100,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 100, naturalHeight: 100,
      status: status as any,
      uploadStartedAt,
      uploaderId: 'user',
      z: 1,
      createdAt: uploadStartedAt,
      createdBy: 'user',
    };
  }

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const now = 1000000;
    const snap = makeSnap('uploading', now - (IMAGE_UPLOAD_STALE_MS - 1));
    expect(displayStatus(snap, now)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const now = 1000000;
    const snap = makeSnap('uploading', now - (IMAGE_UPLOAD_STALE_MS + 1));
    expect(displayStatus(snap, now)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const snap = makeSnap('failed', 0);
    expect(displayStatus(snap, Date.now())).toBe('failed');
  });

  it('ready → ready', () => {
    const snap = makeSnap('ready', 0);
    expect(displayStatus(snap, Date.now())).toBe('ready');
  });
});

describe('stale id returns false (TC-07)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    doc.getMap('objects');
  });

  it('markImageReady on deleted id returns false', () => {
    expect(markImageReady(doc, 'nonexistent', 'key/id')).toBe(false);
  });

  it('markImageFailed on deleted id returns false', () => {
    expect(markImageFailed(doc, 'nonexistent')).toBe(false);
  });

  it('markImageRetrying on deleted id returns false', () => {
    expect(markImageRetrying(doc, 'nonexistent', Date.now())).toBe(false);
  });
});
