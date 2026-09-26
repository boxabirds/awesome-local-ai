import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, deleteObjects, LOCAL_ORIGIN } from '@/shared/board-model';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
  readImage,
  type ImagePlaceholderItem,
} from '@/shared/objects/image';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '@/shared/config';

/**
 * Story 12 — image.model unit tests (TC-03 to TC-07) on a real Y.Doc with a
 * real Y.UndoManager tracking LOCAL_ORIGIN only.
 */

const item = (x: number, y: number, w: number, h: number): ImagePlaceholderItem => ({
  rect: { x, y, width: w, height: h },
  naturalWidth: w,
  naturalHeight: h,
  contentType: 'image/png',
});

describe('placementSize (TC-03)', () => {
  it('never upscales (no scaling under 800)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });
  it('scales down landscape to 800 longest side', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });
  it('scales down portrait to 800 longest side', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });
  it('at the boundary (800x800) it is unchanged', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('layoutRow (TC-04)', () => {
  const sizes = [
    { width: 100, height: 80 },
    { width: 60, height: 40 },
    { width: 120, height: 100 },
  ];
  const start = { x: 100, y: 50 };

  it('top-left: tops aligned at the point, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const rects = layoutRow(sizes, start, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 100, y: 50, width: 100, height: 80 });
    for (let i = 0; i < rects.length; i++) {
      expect(rects[i].y).toBe(50); // tops aligned at the point
    }
    for (let i = 1; i < rects.length; i++) {
      const gap = rects[i].x - (rects[i - 1].x + rects[i - 1].width);
      expect(gap).toBe(IMAGE_LAYOUT_GAP_WORLD);
    }
  });

  it('centre: the whole row is centred on the point', () => {
    const rects = layoutRow(sizes, start, 'centre');
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    expect((minX + maxX) / 2).toBe(start.x); // row centred on start.x
    expect((minY + maxY) / 2).toBe(start.y); // row centred on start.y
    // Still laid out left to right with the gap.
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i].x - (rects[i - 1].x + rects[i - 1].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    }
  });

  it('empty input -> empty output', () => {
    expect(layoutRow([], start, 'top-left')).toEqual([]);
  });
});

describe('createImagePlaceholders + undo (TC-05)', () => {
  it('3 items -> 3 uploading placeholders in ONE update; ready is not its own step; undo removes all 3', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // A real UndoManager tracking LOCAL_ORIGIN only (captureTimeout 0: every
    // tracked transaction is its own step).
    const um = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
      captureTimeout: 0,
    });

    let updates = 0;
    const onUpd = (): void => {
      updates += 1;
    };
    doc.on('update', onUpd);
    const ids = createImagePlaceholders(doc, [item(0, 0, 100, 100), item(120, 0, 80, 80), item(220, 0, 60, 60)], 'leo', 1000);
    doc.off('update', onUpd);

    expect(ids).toHaveLength(3);
    // The whole add action is a single update event (one undo step).
    expect(updates).toBe(1);

    for (const id of ids) {
      const snap = readImage(doc, id);
      expect(snap).toBeDefined();
      expect(snap!.status).toBe('uploading');
      expect(snap!.uploaderId).toBe('leo');
      expect(snap!.uploadStartedAt).toBe(1000);
      expect(snap!.assetKey).toBeNull();
    }
    // One undo step so far.
    expect(um.undoStack.length).toBe(1);

    // Marking one ready (UPLOAD_ORIGIN) is NOT tracked by the UndoManager.
    expect(markImageReady(doc, ids[0], 'board/asset')).toBe(true);
    expect(um.undoStack.length).toBe(1);
    const readySnap = readImage(doc, ids[0]);
    expect(readySnap!.assetKey).toBe('board/asset');
    expect(readySnap!.status).toBe('ready');

    // Undoing the single step removes ALL 3 placeholders (the completion was
    // not its own step).
    um.undo();
    for (const id of ids) {
      expect(readImage(doc, id)).toBeUndefined();
    }
  });

  it('skips items with non-finite sizes and writes nothing when all are invalid', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const ids = createImagePlaceholders(doc, [
      { rect: { x: 0, y: 0, width: NaN, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
    ], 'leo', 0);
    expect(ids).toEqual([]);
    expect(doc.getMap('objects').size).toBe(0);
  });
});

describe('displayStatus (TC-06)', () => {
  const uploading = { status: 'uploading', uploadStartedAt: 0 } as const;
  it('uploading at STALE-1 stays uploading; at STALE+1 becomes unfinished (boundary)', () => {
    expect(displayStatus(uploading, IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(uploading, IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });
  it('failed and ready pass through', () => {
    expect(displayStatus({ status: 'failed', uploadStartedAt: 0 }, 0)).toBe('failed');
    expect(displayStatus({ status: 'ready', uploadStartedAt: 0 }, 0)).toBe('ready');
  });
});

describe('status updates on a stale id (TC-07)', () => {
  it('markImageReady / markImageFailed / markImageRetrying on a deleted id return false, no update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createImagePlaceholders(doc, [item(0, 0, 100, 100)], 'leo', 0)[0];
    expect(deleteObjects(doc, [id])).toBe(1);

    let updates = 0;
    const onUpd = (): void => {
      updates += 1;
    };
    doc.on('update', onUpd);
    expect(markImageReady(doc, id, 'board/asset')).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 123)).toBe(false);
    doc.off('update', onUpd);
    expect(updates).toBe(0);
  });

  it('markImageRetrying re-arms a failed image (status uploading, fresh timestamp)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createImagePlaceholders(doc, [item(0, 0, 100, 100)], 'leo', 0)[0];
    expect(markImageFailed(doc, id)).toBe(true);
    expect(readImage(doc, id)!.status).toBe('failed');
    expect(markImageRetrying(doc, id, 999)).toBe(true);
    const snap = readImage(doc, id)!;
    expect(snap.status).toBe('uploading');
    expect(snap.uploadStartedAt).toBe(999);
  });
});
