/**
 * Unit tests for image object model (TC-03 to TC-07).
 */

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
  UPLOAD_ORIGIN,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';

describe('TC-03: placementSize', () => {
  it('400x300 → 400x300 (no upscale, both sides below 800)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 → 800x600 (landscape, scaled down)', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 → 75x800 (portrait, scaled down)', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 → 800x800 (exact boundary, no scaling)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('TC-04: layoutRow', () => {
  it('3 sizes with top-left anchor: tops aligned at start, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const sizes = [
      { width: 100, height: 200 },
      { width: 150, height: 100 },
      { width: 80, height: 300 },
    ];
    const start = { x: 50, y: 70 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects).toHaveLength(3);
    // First image top-left at start
    expect(rects[0]!.x).toBe(50);
    expect(rects[0]!.y).toBe(70);
    // Second image: x = 50 + 100 + gap
    expect(rects[1]!.x).toBe(50 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1]!.y).toBe(70);
    // Third image: x = second.x + 150 + gap
    expect(rects[2]!.x).toBe(50 + 100 + IMAGE_LAYOUT_GAP_WORLD + 150 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2]!.y).toBe(70);
  });

  it('3 sizes with centre anchor: row centred on the point', () => {
    const sizes = [
      { width: 100, height: 200 },
      { width: 100, height: 200 },
      { width: 100, height: 200 },
    ];
    const centre = { x: 400, y: 300 };
    const rects = layoutRow(sizes, centre, 'centre');

    expect(rects).toHaveLength(3);
    // total width = 100 + 24 + 100 + 24 + 100 = 348
    const totalWidth = 100 * 3 + IMAGE_LAYOUT_GAP_WORLD * 2;
    expect(rects[0]!.x).toBe(centre.x - totalWidth / 2);
    // Row centre x = start.x + totalWidth/2 = 400
    const rowCentreX = rects[0]!.x + totalWidth / 2;
    expect(rowCentreX).toBeCloseTo(400);
    // Tallest is 200, so top y = 300 - 200/2 = 200
    expect(rects[0]!.y).toBe(200);
  });
});

describe('TC-05: createImagePlaceholders + markImageReady + UndoManager', () => {
  it('3 placeholders in one undo step; markImageReady is NOT its own undo step', () => {
    const doc = new Y.Doc();
    const undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    const items = [
      { rect: { x: 0, y: 0, width: 200, height: 150 }, naturalWidth: 200, naturalHeight: 150, contentType: 'image/png' },
      { rect: { x: 224, y: 0, width: 300, height: 200 }, naturalWidth: 300, naturalHeight: 200, contentType: 'image/jpeg' },
      { rect: { x: 548, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/gif' },
    ];

    // Count update events
    let updateCount = 0;
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    expect(ids).toHaveLength(3);
    expect(updateCount).toBe(1); // one transaction

    // All three should be uploading
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    for (const id of ids) {
      const map = objects.get(id)!;
      expect(map.get('status')).toBe('uploading');
      expect(map.get('uploaderId')).toBe('user1');
      expect(map.get('uploadStartedAt')).toBe(1000);
    }

    // markImageReady uses UPLOAD_ORIGIN → no undo step
    const readyResult = markImageReady(doc, ids[0]!, 'board/asset');
    expect(readyResult).toBe(true);
    const map0 = objects.get(ids[0]!)!;
    expect(map0.get('status')).toBe('ready');
    expect(map0.get('assetKey')).toBe('board/asset');

    // Undo stack should be length 1 (the one creation transaction)
    expect(undoManager.undoStack.length).toBe(1);

    // Undo removes all 3 placeholders
    undoManager.undo();
    expect(objects.size).toBe(0);

    undoManager.destroy();
  });
});

describe('TC-06: displayStatus', () => {
  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const img: ImageSnap = {
      id: 'test', type: 'image', x: 0, y: 0, width: 100, height: 100, z: 1,
      assetKey: null, contentType: 'image/png', naturalWidth: 100, naturalHeight: 100,
      status: 'uploading', uploadStartedAt: 1000, uploaderId: 'u1',
    };
    // now - uploadStartedAt = IMAGE_UPLOAD_STALE_MS - 1 → still uploading
    const now = 1000 + IMAGE_UPLOAD_STALE_MS - 1;
    expect(displayStatus(img, now)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const img: ImageSnap = {
      id: 'test', type: 'image', x: 0, y: 0, width: 100, height: 100, z: 1,
      assetKey: null, contentType: 'image/png', naturalWidth: 100, naturalHeight: 100,
      status: 'uploading', uploadStartedAt: 1000, uploaderId: 'u1',
    };
    const now = 1000 + IMAGE_UPLOAD_STALE_MS + 1;
    expect(displayStatus(img, now)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const img: ImageSnap = {
      id: 'test', type: 'image', x: 0, y: 0, width: 100, height: 100, z: 1,
      assetKey: null, contentType: 'image/png', naturalWidth: 100, naturalHeight: 100,
      status: 'failed', uploadStartedAt: 1000, uploaderId: 'u1',
    };
    expect(displayStatus(img, 999999999)).toBe('failed');
  });

  it('ready → ready', () => {
    const img: ImageSnap = {
      id: 'test', type: 'image', x: 0, y: 0, width: 100, height: 100, z: 1,
      assetKey: 'board/asset', contentType: 'image/png', naturalWidth: 100, naturalHeight: 100,
      status: 'ready', uploadStartedAt: 1000, uploaderId: 'u1',
    };
    expect(displayStatus(img, 999999999)).toBe('ready');
  });
});

describe('TC-07: markImageReady / markImageFailed on deleted id', () => {
  it('markImageReady on deleted id returns false, no update emitted', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'u1', 1000);
    const id = ids[0]!;

    // Delete the object
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    doc.transact(() => { objects.delete(id); }, LOCAL_ORIGIN);

    // markImageReady should return false
    let updateEmitted = false;
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === UPLOAD_ORIGIN) updateEmitted = true;
    });
    expect(markImageReady(doc, id, 'some/key')).toBe(false);
    expect(updateEmitted).toBe(false);
  });

  it('markImageFailed on deleted id returns false', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'u1', 1000);
    const id = ids[0]!;

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    doc.transact(() => { objects.delete(id); }, LOCAL_ORIGIN);

    expect(markImageFailed(doc, id)).toBe(false);
  });

  it('markImageRetrying on deleted id returns false', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'u1', 1000);
    const id = ids[0]!;

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    doc.transact(() => { objects.delete(id); }, LOCAL_ORIGIN);

    expect(markImageRetrying(doc, id, 2000)).toBe(false);
  });
});
