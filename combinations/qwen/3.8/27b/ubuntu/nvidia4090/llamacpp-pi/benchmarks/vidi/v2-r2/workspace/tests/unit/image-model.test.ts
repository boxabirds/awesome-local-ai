/**
 * Unit tests for image model (story 12 TC-03 to TC-07).
 *
 * TC-03: placementSize boundaries.
 * TC-04: layoutRow top-left and centre.
 * TC-05: createImagePlaceholders + markImageReady undo behaviour.
 * TC-06: displayStatus stale boundary.
 * TC-07: markImageReady / markImageFailed on deleted id → false.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
  imageSnapshot,
  UPLOAD_ORIGIN,
} from '../../src/shared/objects/image';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('placementSize (TC-03)', () => {
  it('400x300 → 400x300 (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 → 800x600', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 → 75x800', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 → 800x800 (boundary)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('layoutRow (TC-04)', () => {
  it('top-left: tops aligned at the point, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 200, height: 80 },
      { width: 50, height: 30 },
    ];
    const start = { x: 10, y: 20 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects).toHaveLength(3);
    // First image top-left at start
    expect(rects[0].x).toBe(10);
    expect(rects[0].y).toBe(20);
    // Second image starts after first + gap
    expect(rects[1].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBe(20);
    // Third image starts after second + gap
    expect(rects[2].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].y).toBe(20);
    // Widths and heights preserved
    expect(rects[0].width).toBe(100);
    expect(rects[0].height).toBe(50);
    expect(rects[1].width).toBe(200);
    expect(rects[1].height).toBe(80);
  });

  it('centre: row centred on the point', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 200, height: 80 },
      { width: 50, height: 30 },
    ];
    const start = { x: 1000, y: 500 };
    const rects = layoutRow(sizes, start, 'centre');

    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD + 50;
    // The row is centred on start.x
    expect(rects[0].x).toBeCloseTo(start.x - totalWidth / 2, 1);
    // All y values are at start.y
    for (const r of rects) {
      expect(r.y).toBe(start.y);
    }
  });
});

describe('createImagePlaceholders + markImageReady (TC-05)', () => {
  it('creates 3 placeholders in one update; markImageReady sets assetKey; undo removes all 3', () => {
    const doc = newDoc();
    const undoManager = new Y.UndoManager(doc, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
      { rect: { x: 248, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
    ];
    const uploaderId = 'user1';
    const now = Date.now();
    const ids = createImagePlaceholders(doc, items, uploaderId, now);

    expect(ids).toHaveLength(3);

    // All three should be 'uploading'
    for (const id of ids) {
      const snap = imageSnapshot(doc, id);
      expect(snap).toBeDefined();
      expect(snap!.status).toBe('uploading');
      expect(snap!.uploaderId).toBe(uploaderId);
      expect(snap!.uploadStartedAt).toBe(now);
    }

    // Mark one as ready (UPLOAD_ORIGIN, not tracked by UndoManager)
    const ok = markImageReady(doc, ids[0], 'boardId/assetId');
    expect(ok).toBe(true);
    expect(imageSnapshot(doc, ids[0])!.status).toBe('ready');
    expect(imageSnapshot(doc, ids[0])!.assetKey).toBe('boardId/assetId');

    // The undo stack should have length 1 (the create, not the ready)
    // Since we tracked LOCAL_ORIGIN only and markImageReady used UPLOAD_ORIGIN
    // (which is NOT in trackedOrigins), the undo stack only has the create.
    // Note: the undoManager tracks LOCAL_ORIGIN which is a unique symbol.
    // We need to verify the stack length is 1.
    // Actually, Y.UndoManager's undoStack tracks individual transactions
    // from tracked origins. The create was one transaction (LOCAL_ORIGIN),
    // and the markImageReady was one transaction (UPLOAD_ORIGIN, not tracked).
    // So the undo stack should have exactly 1 entry.
    expect(undoManager.undoStack.length).toBe(1);

    // Undo removes all 3 placeholders (the create was one step)
    undoManager.undo();
    for (const id of ids) {
      expect(doc.getMap('objects').get(id)).toBeUndefined();
    }
  });
});

describe('displayStatus (TC-06)', () => {
  const now = 1_000_000;

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const img = { status: 'uploading' as const, uploadStartedAt: now - (IMAGE_UPLOAD_STALE_MS - 1) };
    expect(displayStatus(img, now)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const img = { status: 'uploading' as const, uploadStartedAt: now - (IMAGE_UPLOAD_STALE_MS + 1) };
    expect(displayStatus(img, now)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const img = { status: 'failed' as const, uploadStartedAt: now - 100 };
    expect(displayStatus(img, now)).toBe('failed');
  });

  it('ready → ready', () => {
    const img = { status: 'ready' as const, uploadStartedAt: now - 100 };
    expect(displayStatus(img, now)).toBe('ready');
  });
});

describe('stale id on status update (TC-07)', () => {
  it('markImageReady on a deleted id returns false', () => {
    const doc = newDoc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', Date.now());
    // Delete the object
    doc.getMap('objects').delete(ids[0]);
    const result = markImageReady(doc, ids[0], 'boardId/assetId');
    expect(result).toBe(false);
  });

  it('markImageFailed on a deleted id returns false', () => {
    const doc = newDoc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', Date.now());
    doc.getMap('objects').delete(ids[0]);
    const result = markImageFailed(doc, ids[0]);
    expect(result).toBe(false);
  });

  it('markImageRetrying on a deleted id returns false', () => {
    const doc = newDoc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', Date.now());
    doc.getMap('objects').delete(ids[0]);
    const result = markImageRetrying(doc, ids[0], Date.now());
    expect(result).toBe(false);
  });
});
