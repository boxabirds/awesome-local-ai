/** TC-03 to TC-07 — image object model unit tests */

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
} from '@shared/objects/image';
import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '@shared/config';
import { LOCAL_ORIGIN } from '@shared/board-model';

function makeDoc() {
  const doc = new Y.Doc();
  doc.getMap('meta').set('schemaVersion', 1);
  return doc;
}

// ─── TC-03: placementSize ──────────────────────────────────────────────

describe('TC-03: placementSize', () => {
  it('no upscale: 400x300 stays 400x300', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('scales down landscape: 1600x1200 → 800x600', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('scales down portrait: 300x3200 → 75x800', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('boundary at exactly IMAGE_MAX_PLACE_SIZE_WORLD', () => {
    expect(placementSize(IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD))
      .toEqual({ width: IMAGE_MAX_PLACE_SIZE_WORLD, height: IMAGE_MAX_PLACE_SIZE_WORLD });
  });

  it('never enlarges smaller images', () => {
    expect(placementSize(100, 50)).toEqual({ width: 100, height: 50 });
    expect(placementSize(10, 20)).toEqual({ width: 10, height: 20 });
  });
});

// ─── TC-04: layoutRow ──────────────────────────────────────────────────

describe('TC-04: layoutRow', () => {
  const sizes = [
    { width: 200, height: 150 },
    { width: 300, height: 200 },
    { width: 100, height: 100 },
  ];

  it('top-left: tops aligned at start.y, gaps between items', () => {
    const rects = layoutRow(sizes, { x: 50, y: 100 }, 'top-left');
    expect(rects.length).toBe(3);
    // All tops at start.y
    for (const r of rects) {
      expect(r.y).toBe(100);
    }
    // First at x=50
    expect(rects[0].x).toBe(50);
    // Gaps of IMAGE_LAYOUT_GAP_WORLD
    expect(rects[1].x).toBe(50 + 200 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x).toBe(50 + 200 + IMAGE_LAYOUT_GAP_WORLD + 300 + IMAGE_LAYOUT_GAP_WORLD);
  });

  it('centre: whole row centred on the start point', () => {
    const rects = layoutRow(sizes, { x: 500, y: 100 }, 'centre');
    // Row spans from rects[0].x to rects[2].x + rects[2].width
    const rowStart = rects[0].x;
    const rowEnd = rects[2].x + rects[2].width;
    const midX = (rowStart + rowEnd) / 2;
    expect(midX).toBe(500);
    // Tops still at start.y
    for (const r of rects) {
      expect(r.y).toBe(100);
    }
  });

  it('empty input returns empty array', () => {
    expect(layoutRow([], { x: 0, y: 0 }, 'top-left')).toEqual([]);
  });
});

// ─── TC-05: createImagePlaceholders and undo ───────────────────────────

describe('TC-05: createImagePlaceholders creates one undo step', () => {
  it('creates 3 objects with status uploading in a single update event', () => {
    const doc = makeDoc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' },
      { rect: { x: 100, y: 0, width: 120, height: 90 }, naturalWidth: 120, naturalHeight: 90, contentType: 'image/jpeg' },
      { rect: { x: 224, y: 0, width: 50, height: 50 }, naturalWidth: 50, naturalHeight: 50, contentType: 'image/gif' },
    ];

    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    const ids = createImagePlaceholders(doc, items, 'user-1', Date.now());
    expect(ids.length).toBe(3);

    // All three have status 'uploading'
    const objs = doc.getMap('objects') as any;
    for (const id of ids) {
      const dm = objs.get(id);
      expect(dm.get('status')).toBe('uploading');
      expect(dm.get('uploaderId')).toBe('user-1');
      expect(dm.has('uploadStartedAt')).toBe(true);
      expect(dm.get('assetKey')).toBeNull();
    }

    // One update event
    expect(updateCount).toBe(1);
  });

  it('markImageReady with UPLOAD_ORIGIN does not create additional undo step', () => {
    const doc = makeDoc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' },
      { rect: { x: 100, y: 0, width: 120, height: 90 }, naturalWidth: 120, naturalHeight: 90, contentType: 'image/jpeg' },
      { rect: { x: 224, y: 0, width: 50, height: 50 }, naturalWidth: 50, naturalHeight: 50, contentType: 'image/gif' },
    ];

    const objectsMap = doc.getMap('objects');
    const ids = createImagePlaceholders(doc, items, 'user-1', Date.now());

    // Set up UndoManager tracking only LOCAL_ORIGIN (after placeholders are created)
    const um = new Y.UndoManager(objectsMap, { trackedOrigins: new Set([LOCAL_ORIGIN]) });

    // Create a second batch of placeholders — this creates the undo step
    const items2 = [
      { rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' },
    ];
    const ids2 = createImagePlaceholders(doc, items2, 'user-2', Date.now());

    // Should have 1 undo step from the create call
    expect((um.undoStack as any).length).toBe(1);

    // Mark one as ready using UPLOAD_ORIGIN
    const result = markImageReady(doc, ids2[0], 'abc/test123');
    expect(result).toBe(true);

    // No change to undo stack length
    expect((um.undoStack as any).length).toBe(1);

    // Check the object is now ready
    const dm = objectsMap.get(ids2[0]) as Y.Map<unknown>;
    expect((dm as any).get('status')).toBe('ready');
    expect((dm as any).get('assetKey')).toBe('abc/test123');
  });

  it('undo removes all 3 placeholders at once', () => {
    const doc = makeDoc();
    const objectsMap = doc.getMap('objects');

    // Create placeholders first
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' },
      { rect: { x: 100, y: 0, width: 120, height: 90 }, naturalWidth: 120, naturalHeight: 90, contentType: 'image/jpeg' },
      { rect: { x: 224, y: 0, width: 50, height: 50 }, naturalWidth: 50, naturalHeight: 50, contentType: 'image/gif' },
    ];

    // Set up UndoManager before creating placeholders so they get tracked
    const um = new Y.UndoManager(objectsMap, { trackedOrigins: new Set([LOCAL_ORIGIN]) });

    // Now create placeholders in the same transaction — but we already created a UM...
    // The issue is that we need to create the UM first, then create objects in a LOCAL_ORIGIN tx.
    // Actually createImagePlaceholders uses LOCAL_ORIGIN which IS what the UM tracks.
    // Let me check if the order matters... Actually the UM needs to be created BEFORE the tx.
    
    // Let's redo: create UM first, THEN create placeholders
    const doc2 = makeDoc();
    const objectsMap2 = doc2.getMap('objects');
    const um2 = new Y.UndoManager(objectsMap2, { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    const ids = createImagePlaceholders(doc2, items, 'user-1', Date.now());
    expect(ids.length).toBe(3);
    expect((um2.undoStack as any).length).toBe(1);

    // Undo should remove all three
    um2.undo();

    for (const id of ids) {
      expect(objectsMap2.has(id)).toBe(false);
    }
  });
});

// ─── TC-06: displayStatus boundaries ───────────────────────────────────

describe('TC-06: displayStatus transitions at stale threshold', () => {
  function makeImageSnapshot(status: string, uploadStartedAt: number): any {
    return {
      id: 'img-1',
      type: 'image' as const,
      x: 0, y: 0, width: 100, height: 80,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 100,
      naturalHeight: 80,
      status: status as 'uploading' | 'ready' | 'failed',
      uploadStartedAt,
      uploaderId: 'user-1',
      z: 1,
      createdAt: uploadStartedAt,
    };
  }

  it('uploading < IMAGE_UPLOAD_STALE_MS → "uploading"', () => {
    const img = makeImageSnapshot('uploading', Date.now() - (IMAGE_UPLOAD_STALE_MS - 1));
    expect(displayStatus(img, Date.now())).toBe('uploading');
  });

  it('uploading >= IMAGE_UPLOAD_STALE_MS → "unfinished"', () => {
    const img = makeImageSnapshot('uploading', Date.now() - IMAGE_UPLOAD_STALE_MS);
    expect(displayStatus(img, Date.now())).toBe('unfinished');

    // Also test slightly after threshold
    const img2 = makeImageSnapshot('uploading', Date.now() - (IMAGE_UPLOAD_STALE_MS + 1000));
    expect(displayStatus(img2, Date.now())).toBe('unfinished');
  });

  it('failed → "failed"', () => {
    const img = makeImageSnapshot('failed', 0);
    expect(displayStatus(img, Date.now())).toBe('failed');
  });

  it('ready → "ready"', () => {
    const img = makeImageSnapshot('ready', 0);
    expect(displayStatus(img, Date.now())).toBe('ready');
  });
});

// ─── TC-07: markImageReady/Failure on deleted id ───────────────────────

describe('TC-07: stale id handling', () => {
  it('markImageReady on non-existent id returns false', () => {
    const doc = makeDoc();
    expect(markImageReady(doc, 'nonexistent-id', 'test/key')).toBe(false);
  });

  it('markImageFailed on non-existent id returns false', () => {
    const doc = makeDoc();
    expect(markImageFailed(doc, 'nonexistent-id')).toBe(false);
  });

  it('markImageRetrying on non-existent id returns false', () => {
    const doc = makeDoc();
    expect(markImageRetrying(doc, 'nonexistent-id', Date.now())).toBe(false);
  });

  it('mark on already-deleted id returns false', () => {
    const doc = makeDoc();
    const objectsMap = doc.getMap('objects') as any;
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'u1', Date.now());
    expect(ids.length).toBe(1);

    // Delete directly from the objects map (simulating story 7 deleteObjects)
    objectsMap.delete(ids[0]);

    // mark on deleted id should fail
    expect(markImageReady(doc, ids[0], 'k/v')).toBe(false);
    expect(markImageFailed(doc, ids[0])).toBe(false);
    expect(markImageRetrying(doc, ids[0], Date.now())).toBe(false);
  });
});
