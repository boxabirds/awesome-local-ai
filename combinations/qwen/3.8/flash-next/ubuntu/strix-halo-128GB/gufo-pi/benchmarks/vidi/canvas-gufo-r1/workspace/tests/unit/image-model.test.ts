/**
 * Story 12: Image object model unit tests.
 * TC-03 to TC-07
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
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';

// ─── TC-03: placementSize ───────────────────────────────────────────────────

describe('TC-03: placementSize', () => {
  it('400x300 → 400x300 (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 → 800x600 (landscape, longest side 1600 > 800)', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 → 75x800 (portrait)', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 → 800x800 (exactly at boundary, no scaling)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });

  it('100x50 → 100x50 (small, no upscale)', () => {
    expect(placementSize(100, 50)).toEqual({ width: 100, height: 50 });
  });
});

// ─── TC-04: layoutRow ───────────────────────────────────────────────────────

describe('TC-04: layoutRow', () => {
  const sizes = [
    { width: 100, height: 200 },
    { width: 300, height: 150 },
    { width: 200, height: 250 },
  ];

  it('top-left anchor: tops aligned at point, left to right with gap', () => {
    const start = { x: 50, y: 100 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects).toHaveLength(3);
    // First at start point
    expect(rects[0]).toEqual({ x: 50, y: 100, width: 100, height: 200 });
    // Second at 50 + 100 + 24 = 174
    expect(rects[1]).toEqual({ x: 174, y: 100, width: 300, height: 150 });
    // Third at 174 + 300 + 24 = 498
    expect(rects[2]).toEqual({ x: 498, y: 100, width: 200, height: 250 });
    // All tops aligned
    expect(rects.every((r) => r.y === 100)).toBe(true);
  });

  it('centre anchor: row centred on point', () => {
    const centre = { x: 400, y: 300 };
    const rects = layoutRow(sizes, centre, 'centre');

    expect(rects).toHaveLength(3);
    // Total width: 100 + 24 + 300 + 24 + 200 = 648
    // Start x: 400 - 648/2 = 76
    expect(rects[0].x).toBe(76);
    expect(rects[1].x).toBe(200); // 76 + 100 + 24
    expect(rects[2].x).toBe(524); // 200 + 300 + 24

    // Max height: 250; all tops at: 300 - 250/2 = 175
    expect(rects.every((r) => r.y === 175)).toBe(true);
  });

  it('gap between images is IMAGE_LAYOUT_GAP_WORLD', () => {
    const rects = layoutRow(
      [{ width: 50, height: 50 }, { width: 50, height: 50 }],
      { x: 0, y: 0 },
      'top-left',
    );
    expect(rects[1].x - (rects[0].x + rects[0].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
  });
});

// ─── TC-05: createImagePlaceholders + markImageReady + UndoManager ──────────

describe('TC-05: createImagePlaceholders and undo', () => {
  let doc: Y.Doc;
  let undoManager: Y.UndoManager;

  beforeEach(() => {
    doc = new Y.Doc();
    doc.getMap('objects');
    undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 0,
    });
  });

  it('3 items created in one transaction → 3 uploading objects', () => {
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 200, naturalHeight: 200, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 200, height: 150 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/jpeg' },
      { rect: { x: 348, y: 0, width: 150, height: 200 }, naturalWidth: 300, naturalHeight: 400, contentType: 'image/gif' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user-1', 1000);
    expect(ids).toHaveLength(3);

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    for (const id of ids) {
      const obj = objects.get(id);
      expect(obj).toBeDefined();
      expect(obj!.get('status')).toBe('uploading');
      expect(obj!.get('uploaderId')).toBe('user-1');
      expect(obj!.get('uploadStartedAt')).toBe(1000);
    }
  });

  it('markImageReady on one sets assetKey; undo stack length is 1', () => {
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 200, naturalHeight: 200, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 200, height: 150 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/jpeg' },
      { rect: { x: 348, y: 0, width: 150, height: 200 }, naturalWidth: 300, naturalHeight: 400, contentType: 'image/gif' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user-1', 1000);

    // Undo stack should have 1 item (one transaction)
    expect(undoManager.undoStack.length).toBe(1);

    // Mark one as ready (uses UPLOAD_ORIGIN, not tracked)
    markImageReady(doc, ids[0], 'board-123/asset-456');

    // Undo stack still has 1 item (upload completion is NOT a separate undo step)
    expect(undoManager.undoStack.length).toBe(1);

    // Verify the object is ready
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objects.get(ids[0])!.get('status')).toBe('ready');
    expect(objects.get(ids[0])!.get('assetKey')).toBe('board-123/asset-456');
  });

  it('undo removes all 3 placeholders', () => {
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 200, naturalHeight: 200, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 200, height: 150 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/jpeg' },
      { rect: { x: 348, y: 0, width: 150, height: 200 }, naturalWidth: 300, naturalHeight: 400, contentType: 'image/gif' },
    ];
    createImagePlaceholders(doc, items, 'user-1', 1000);

    // Undo
    undoManager.undo();

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objects.size).toBe(0);
  });

  it('skips items with non-finite dimensions', () => {
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 200, naturalHeight: 200, contentType: 'image/png' },
      { rect: { x: NaN, y: 0, width: 200, height: 150 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/jpeg' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user-1', 1000);
    expect(ids).toHaveLength(1);
  });
});

// ─── TC-06: displayStatus ───────────────────────────────────────────────────

describe('TC-06: displayStatus', () => {
  function makeImg(status: string, uploadStartedAt: number): ImageSnap {
    return {
      id: 'img-1',
      type: 'image',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      z: 1,
      createdAt: uploadStartedAt,
      createdBy: 'user-1',
      assetKey: status === 'ready' ? 'board/asset' : null,
      contentType: 'image/png',
      naturalWidth: 100,
      naturalHeight: 100,
      status: status as ImageSnap['status'],
      uploadStartedAt,
      uploaderId: 'user-1',
      text: '',
    };
  }

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const img = makeImg('uploading', 1000);
    expect(displayStatus(img, 1000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const img = makeImg('uploading', 1000);
    expect(displayStatus(img, 1000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('uploading at exactly IMAGE_UPLOAD_STALE_MS → unfinished', () => {
    const img = makeImg('uploading', 1000);
    expect(displayStatus(img, 1000 + IMAGE_UPLOAD_STALE_MS)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const img = makeImg('failed', 1000);
    expect(displayStatus(img, 1000 + IMAGE_UPLOAD_STALE_MS + 10000)).toBe('failed');
  });

  it('ready → ready', () => {
    const img = makeImg('ready', 1000);
    expect(displayStatus(img, 1000 + IMAGE_UPLOAD_STALE_MS + 10000)).toBe('ready');
  });
});

// ─── TC-07: stale id returns false ──────────────────────────────────────────

describe('TC-07: markImageReady / markImageFailed on deleted id → false', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    doc.getMap('objects');
  });

  it('markImageReady on non-existent id returns false', () => {
    expect(markImageReady(doc, 'non-existent', 'key')).toBe(false);
  });

  it('markImageFailed on non-existent id returns false', () => {
    expect(markImageFailed(doc, 'non-existent')).toBe(false);
  });

  it('markImageRetrying on non-existent id returns false', () => {
    expect(markImageRetrying(doc, 'non-existent', Date.now())).toBe(false);
  });

  it('markImageReady on deleted id returns false', () => {
    const ids = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' }],
      'user-1',
      Date.now(),
    );
    // Delete
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    objects.delete(ids[0]);
    // Now markImageReady should return false
    expect(markImageReady(doc, ids[0], 'key')).toBe(false);
  });
});
