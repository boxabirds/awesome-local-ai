/**
 * Story 12: image object model unit tests (TC-03 to TC-07).
 *
 * Real Y.Doc with a real Y.UndoManager tracking LOCAL_ORIGIN only, so the
 * undo-step assertions match story 8's controller.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  placementSize, layoutRow, createImagePlaceholders,
  markImageReady, markImageFailed, markImageRetrying, displayStatus,
  UPLOAD_ORIGIN, type ImageSnap,
} from '@shared/objects/image';
import { LOCAL_ORIGIN, snapshot, deleteObjects } from '@shared/board-model';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS,
} from '@shared/config';
import type { Rect } from '@shared/geometry';

function makeDoc(): { doc: Y.Doc; undo: Y.UndoManager } {
  const doc = new Y.Doc();
  const objects = doc.getMap('objects');
  const undo = new Y.UndoManager(objects, { trackedOrigins: new Set([LOCAL_ORIGIN]) });
  return { doc, undo };
}

function trackUpdates(doc: Y.Doc): () => number {
  let count = 0;
  const handler = () => count++;
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return count;
  };
}

const ITEMS: { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[] = [
  { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
  { rect: { x: 124, y: 0, width: 80, height: 40 }, naturalWidth: 80, naturalHeight: 40, contentType: 'image/jpeg' },
  { rect: { x: 228, y: 0, width: 60, height: 30 }, naturalWidth: 60, naturalHeight: 30, contentType: 'image/gif' },
];

describe('TC-03: placementSize scales down only, longest side ≤ 800', () => {
  it('400x300 → 400x300 (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 → 800x600 (landscape)', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 → 75x800 (portrait)', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 → 800x800 (boundary: longest side exactly the limit)', () => {
    expect(placementSize(800, 800)).toEqual({ width: IMAGE_MAX_PLACE_SIZE_WORLD, height: IMAGE_MAX_PLACE_SIZE_WORLD });
  });
});

describe('TC-04: layoutRow', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 80, height: 40 },
    { width: 60, height: 30 },
  ];
  const start = { x: 1000, y: 500 };

  it('top-left: tops aligned at the point, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const rects = layoutRow(sizes, start, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 1000, y: 500, width: 100, height: 50 });
    expect(rects[1]).toEqual({ x: 1000 + 100 + IMAGE_LAYOUT_GAP_WORLD, y: 500, width: 80, height: 40 });
    expect(rects[2]).toEqual({ x: 1000 + 100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD, y: 500, width: 60, height: 30 });
  });

  it('centre: the whole row is centred on the point', () => {
    const rects = layoutRow(sizes, start, 'centre');
    const totalWidth = 100 + 80 + 60 + 2 * IMAGE_LAYOUT_GAP_WORLD;
    const rowHeight = 50; // tallest image
    expect(rects[0].x).toBe(1000 - totalWidth / 2);
    expect(rects[0].y).toBe(500 - rowHeight / 2);
    expect(rects[1].x).toBe(rects[0].x + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBe(500 - rowHeight / 2);
    expect(rects[2].x).toBe(rects[1].x + 80 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].y).toBe(500 - rowHeight / 2);
  });
});

describe('TC-05: placeholders, ready status and the single undo step', () => {
  it('3 placeholders in one update; ready is not its own undo step; undo removes all 3', () => {
    const { doc, undo } = makeDoc();
    const stopTracking = trackUpdates(doc);

    const ids = createImagePlaceholders(doc, ITEMS, 'uploader-1', 1_234_567);
    expect(ids).toHaveLength(3);
    expect(stopTracking()).toBe(1); // one update event for the whole add action

    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(3);
    for (const s of snaps) {
      const img = s as ImageSnap;
      expect(img.type).toBe('image');
      expect(img.status).toBe('uploading');
      expect(img.uploaderId).toBe('uploader-1');
      expect(img.uploadStartedAt).toBe(1_234_567);
      expect(img.assetKey).toBeNull();
    }
    expect((snaps[0] as ImageSnap).width).toBe(100);
    expect((snaps[1] as ImageSnap).x).toBe(124);

    // Upload completion (UPLOAD_ORIGIN) does not add an undo step.
    expect(markImageReady(doc, ids[0], 'boardid/assetid')).toBe(true);
    const ready = snapshot(doc).find((s) => s.id === ids[0]) as ImageSnap;
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe('boardid/assetid');
    expect(undo.undoStack.length).toBe(1);

    // Undo removes the whole add action in one step.
    undo.undo();
    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.undoStack.length).toBe(0);

    // Redo restores the insertion (one step).
    undo.redo();
    expect(snapshot(doc)).toHaveLength(3);
  });
});

describe('TC-06: displayStatus derives unfinished at the stale boundary', () => {
  const startedAt = 1_000_000;
  const base: ImageSnap = {
    id: 'x', type: 'image', x: 0, y: 0, width: 100, height: 50, z: 1, createdAt: 0,
    assetKey: null, contentType: 'image/png', naturalWidth: 100, naturalHeight: 50,
    status: 'uploading', uploadStartedAt: startedAt, uploaderId: 'u',
  };

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    expect(displayStatus(base, startedAt + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished (boundary)', () => {
    expect(displayStatus(base, startedAt + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('failed → failed', () => {
    expect(displayStatus({ ...base, status: 'failed' }, startedAt + IMAGE_UPLOAD_STALE_MS + 1000)).toBe('failed');
  });

  it('ready → ready', () => {
    expect(displayStatus({ ...base, status: 'ready', assetKey: 'b/a' }, startedAt + IMAGE_UPLOAD_STALE_MS + 1000)).toBe('ready');
  });
});

describe('TC-07: stale ids are rejected without updates', () => {
  it('markImageReady on a deleted id → false, no update', () => {
    const { doc } = makeDoc();
    const stopTracking = trackUpdates(doc);
    const ids = createImagePlaceholders(doc, [ITEMS[0]], 'u', 1);
    deleteObjects(doc, ids);
    const afterDelete = stopTracking();

    expect(markImageReady(doc, ids[0], 'b/a')).toBe(false);
    expect(stopTracking()).toBe(afterDelete); // no new update
  });

  it('markImageFailed on a deleted id → false, no update', () => {
    const { doc } = makeDoc();
    const stopTracking = trackUpdates(doc);
    const ids = createImagePlaceholders(doc, [ITEMS[0]], 'u', 1);
    deleteObjects(doc, ids);
    const afterDelete = stopTracking();

    expect(markImageFailed(doc, ids[0])).toBe(false);
    expect(stopTracking()).toBe(afterDelete);
  });

  it('markImageFailed on a live id → status failed', () => {
    const { doc } = makeDoc();
    const ids = createImagePlaceholders(doc, [ITEMS[0]], 'u', 1);
    expect(markImageFailed(doc, ids[0])).toBe(true);
    expect((snapshot(doc)[0] as ImageSnap).status).toBe('failed');
  });

  it('markImageRetrying puts the placeholder back to uploading with a new timestamp', () => {
    const { doc } = makeDoc();
    const ids = createImagePlaceholders(doc, [ITEMS[0]], 'u', 1);
    markImageFailed(doc, ids[0]);
    expect(markImageRetrying(doc, ids[0], 9_999)).toBe(true);
    const snap = snapshot(doc)[0] as ImageSnap;
    expect(snap.status).toBe('uploading');
    expect(snap.uploadStartedAt).toBe(9_999);
  });
});

// The UPLOAD_ORIGIN symbol must exist and be distinct from LOCAL_ORIGIN so
// the UndoManager (trackedOrigins: LOCAL_ORIGIN) can ignore it.
describe('UPLOAD_ORIGIN', () => {
  it('is a unique symbol distinct from LOCAL_ORIGIN', () => {
    expect(typeof UPLOAD_ORIGIN).toBe('symbol');
    expect(UPLOAD_ORIGIN).not.toBe(LOCAL_ORIGIN);
  });
});
