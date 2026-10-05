/**
 * TC-03 to TC-07: image object model unit tests.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
  type CreateImageItem,
} from '../../src/shared/objects/image';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';

describe('placementSize (TC-03)', () => {
  it('keeps small images at natural size (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('scales landscape down so longest side = IMAGE_MAX_PLACE_SIZE_WORLD', () => {
    const result = placementSize(1600, 1200);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it('scales portrait down so longest side = IMAGE_MAX_PLACE_SIZE_WORLD', () => {
    const result = placementSize(300, 3200);
    expect(result.width).toBe(75);
    expect(result.height).toBe(800);
  });

  it('keeps exactly 800x800 unchanged (boundary)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('layoutRow (TC-04)', () => {
  it('places 3 images left to right with gap at top-left anchor', () => {
    const sizes = [
      { width: 100, height: 200 },
      { width: 150, height: 100 },
      { width: 80, height: 120 },
    ];
    const start = { x: 500, y: 300 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects).toHaveLength(3);
    // First image top-left at start
    expect(rects[0]!.x).toBe(500);
    expect(rects[0]!.y).toBe(300);
    // Second: first.x + first.width + gap
    expect(rects[1]!.x).toBe(500 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1]!.y).toBe(300);
    // Third: second.x + second.width + gap
    expect(rects[2]!.x).toBe(500 + 100 + IMAGE_LAYOUT_GAP_WORLD + 150 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2]!.y).toBe(300);
  });

  it('centres row on the given point with centre anchor', () => {
    const sizes = [
      { width: 100, height: 200 },
      { width: 200, height: 100 },
    ];
    const start = { x: 500, y: 400 };
    const rects = layoutRow(sizes, start, 'centre');

    expect(rects).toHaveLength(2);
    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 200;
    const expectedFirstX = 500 - totalWidth / 2;
    expect(rects[0]!.x).toBeCloseTo(expectedFirstX);
    // Vertically centred on the tallest image (200): y = 400 - 200/2 = 300
    expect(rects[0]!.y).toBe(300);
    expect(rects[1]!.x).toBeCloseTo(expectedFirstX + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1]!.y).toBe(300);
  });

  it('handles empty list', () => {
    expect(layoutRow([], { x: 0, y: 0 }, 'top-left')).toEqual([]);
  });
});

describe('createImagePlaceholders and status updates (TC-05)', () => {
  it('creates 3 placeholders in one transaction, ready one does not add undo step', () => {
    const doc = new Y.Doc();
    const items: CreateImageItem[] = [
      { rect: { x: 0, y: 0, width: 100, height: 200 }, naturalWidth: 100, naturalHeight: 200, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 150, height: 100 }, naturalWidth: 150, naturalHeight: 100, contentType: 'image/jpeg' },
      { rect: { x: 298, y: 0, width: 80, height: 120 }, naturalWidth: 80, naturalHeight: 120, contentType: 'image/gif' },
    ];

    const undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    expect(ids).toHaveLength(3);
    // All 3 created in one transaction = 1 update event
    expect(updateCount).toBe(1);

    // Verify all are uploading
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    for (const id of ids) {
      const obj = objects.get(id)!;
      expect(obj.get('status')).toBe('uploading');
      expect(obj.get('uploaderId')).toBe('user1');
      expect(obj.get('uploadStartedAt')).toBe(1000);
      expect(obj.get('type')).toBe('image');
    }

    updateCount = 0;
    // Mark one ready (UPLOAD_ORIGIN — should not count as undo step)
    const ok = markImageReady(doc, ids[0]!, 'board/asset');
    expect(ok).toBe(true);
    expect(objects.get(ids[0]!)!.get('status')).toBe('ready');
    expect(objects.get(ids[0]!)!.get('assetKey')).toBe('board/asset');

    // Undo stack length should still be 1 (the original creation)
    expect(undoManager.undoStack.length).toBe(1);

    // Undo removes all 3
    undoManager.undo();
    expect(objects.size).toBe(0);
  });
});

describe('displayStatus (TC-06)', () => {
  const baseTime = 1000000;

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 stays uploading', () => {
    expect(
      displayStatus(
        { status: 'uploading', uploadStartedAt: baseTime },
        baseTime + IMAGE_UPLOAD_STALE_MS - 1,
      ),
    ).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 becomes unfinished', () => {
    expect(
      displayStatus(
        { status: 'uploading', uploadStartedAt: baseTime },
        baseTime + IMAGE_UPLOAD_STALE_MS + 1,
      ),
    ).toBe('unfinished');
  });

  it('failed stays failed', () => {
    expect(
      displayStatus(
        { status: 'failed', uploadStartedAt: baseTime },
        baseTime + IMAGE_UPLOAD_STALE_MS + 9999,
      ),
    ).toBe('failed');
  });

  it('ready stays ready', () => {
    expect(
      displayStatus(
        { status: 'ready', uploadStartedAt: baseTime },
        baseTime + IMAGE_UPLOAD_STALE_MS + 9999,
      ),
    ).toBe('ready');
  });
});

describe('stale id handling (TC-07)', () => {
  it('markImageReady on deleted id returns false, no update', () => {
    const doc = new Y.Doc();
    const items: CreateImageItem[] = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    // Delete the object
    doc.transact(() => { objects.delete(ids[0]!); });

    let updateCount = 0;
    doc.on('update', () => { updateCount++; });
    expect(markImageReady(doc, ids[0]!, 'key')).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('markImageFailed on deleted id returns false', () => {
    const doc = new Y.Doc();
    expect(markImageFailed(doc, 'nonexistent')).toBe(false);
  });

  it('markImageRetrying on deleted id returns false', () => {
    const doc = new Y.Doc();
    expect(markImageRetrying(doc, 'nonexistent', 2000)).toBe(false);
  });
});
