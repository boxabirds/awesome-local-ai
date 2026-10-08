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
  LOCAL_ORIGIN,
  UPLOAD_ORIGIN,
} from '../../src/shared/objects/image';
import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

describe('placementSize (TC-03)', () => {
  it('400x300 stays 400x300 (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 scales to 800x600', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 scales to 75x800 (portrait tall)', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 stays 800x800 (at boundary)', () => {
    expect(placementSize(IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD)).toEqual(
      { width: IMAGE_MAX_PLACE_SIZE_WORLD, height: IMAGE_MAX_PLACE_SIZE_WORLD },
    );
  });

  it('rejects non-finite values', () => {
    expect(placementSize(NaN, 100)).toEqual({ width: 0, height: 0 });
    expect(placementSize(100, Infinity)).toEqual({ width: 0, height: 0 });
    expect(placementSize(-100, 100)).toEqual({ width: 0, height: 0 });
    expect(placementSize(0, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe('layoutRow (TC-04)', () => {
  it('top-left aligns first image at start point with gaps', () => {
    const sizes = [
      { width: 100, height: 100 },
      { width: 200, height: 150 },
      { width: 50, height: 80 },
    ];
    const rects = layoutRow(sizes, { x: 10, y: 20 }, 'top-left');

    expect(rects[0]).toEqual({ x: 10, y: 20, width: 100, height: 100 });
    expect(rects[1]).toEqual({ x: 10 + 100 + IMAGE_LAYOUT_GAP_WORLD, y: 20, width: 200, height: 150 });
    expect(rects[2]).toEqual({
      x: 10 + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD,
      y: 20,
      width: 50,
      height: 80,
    });
  });

  it('centre centres the row on the start point', () => {
    const sizes = [
      { width: 100, height: 80 },
      { width: 100, height: 80 },
    ];
    const totalWidth = 100 + 24 + 100; // two images + one gap
    const rects = layoutRow(sizes, { x: totalWidth / 2, y: 100 }, 'centre');

    expect(rects[0].y).toBe(100);
    expect(rects[1].y).toBe(100);
    // Row starts at centre - totalWidth/2
    expect(rects[0].x).toBe(totalWidth / 2 - totalWidth / 2);
    expect(rects[1].x).toBe(totalWidth / 2 - totalWidth / 2 + 100 + 24);
  });

  it('empty sizes returns empty array', () => {
    expect(layoutRow([], { x: 0, y: 0 }, 'top-left')).toEqual([]);
  });
});

describe('createImagePlaceholders (TC-05)', () => {
  function makeDoc(): Y.Doc {
    const doc = new Y.Doc();
    return doc;
  }

  it('creates placeholders in a single transaction and they are present', () => {
    const doc = makeDoc();
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 200, height: 150 }, naturalWidth: 200, naturalHeight: 150, contentType: 'image/jpeg' },
      { rect: { x: 348, y: 0, width: 50, height: 50 }, naturalWidth: 50, naturalHeight: 50, contentType: 'image/gif' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);

    expect(updateCount).toBe(1); // One transaction for all three
    expect(ids.length).toBe(3);

    // Verify all are present and correct
    const objects = doc.getMap('objects') as Y.Map<any>;
    expect(objects.size).toBe(3);

    for (const id of ids) {
      const obj = objects.get(id);
      expect(obj.get('type')).toBe('image');
      expect(obj.get('status')).toBe('uploading');
      expect(obj.get('uploaderId')).toBe('user1');
      expect(obj.get('uploadStartedAt')).toBe(1000);
      expect(obj.get('assetKey')).toBeNull();
    }
  });

  it('skips items with non-finite sizes', () => {
    const doc = makeDoc();
    const items = [
      { rect: { x: 0, y: 0, width: NaN, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
      { rect: { x: 0, y: 0, width: 100, height: Infinity }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    expect(ids.length).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('one undo step for multiple placeholders', () => {
    const doc = makeDoc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 200, height: 150 }, naturalWidth: 200, naturalHeight: 150, contentType: 'image/jpeg' },
    ];

    const undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    // Multiple objects created in one transaction = one undo step
    expect(undoManager.undoStack.length).toBe(1);
    expect(ids.length).toBe(2);
  });
});

describe('displayStatus (TC-06)', () => {
  const baseImg = {
    id: 'test',
    type: 'image' as const,
    x: 0, y: 0, width: 100, height: 100, z: 1,
    assetKey: null, contentType: 'image/png',
    naturalWidth: 100, naturalHeight: 100,
    status: 'uploading' as const,
    uploadStartedAt: 0, uploaderId: 'user1',
  };

  it('returns uploading when below stale threshold', () => {
    const now = IMAGE_UPLOAD_STALE_MS;
    const img = { ...baseImg, uploadStartedAt: now - IMAGE_UPLOAD_STALE_MS + 1 };
    expect(displayStatus(img as any, now)).toBe('uploading');
  });

  it('returns unfinished when at stale threshold', () => {
    const now = IMAGE_UPLOAD_STALE_MS;
    const img = { ...baseImg, uploadStartedAt: now - IMAGE_UPLOAD_STALE_MS };
    expect(displayStatus(img as any, now)).toBe('unfinished');
  });

  it('returns failed for failed status', () => {
    const img = { ...baseImg, status: 'failed' as const };
    expect(displayStatus(img as any, 999999)).toBe('failed');
  });

  it('returns ready for ready status', () => {
    const img = { ...baseImg, status: 'ready' as const, assetKey: 'board/asset' };
    expect(displayStatus(img as any, 999999)).toBe('ready');
  });
});

describe('markImageReady / markImageFailed (TC-07)', () => {
  function getObj(doc: Y.Doc, id: string): Y.Map<any> | undefined {
    return doc.getMap('objects').get(id) as Y.Map<any>;
  }

  function makeDocWithImage(): { doc: Y.Doc; id: string } {
    const doc = new Y.Doc();
    const items = [{
      rect: { x: 0, y: 0, width: 100, height: 100 },
      naturalWidth: 100, naturalHeight: 100,
      contentType: 'image/png',
    }];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    return { doc, id: ids[0]! };
  }

  it('markImageReady sets assetKey and status', () => {
    const { doc, id } = makeDocWithImage();
    const result = markImageReady(doc, id, 'board/abc123');
    expect(result).toBe(true);
    const obj = getObj(doc, id);
    expect(obj!.get('status')).toBe('ready');
    expect(obj!.get('assetKey')).toBe('board/abc123');
  });

  it('markImageFailed sets status to failed', () => {
    const { doc, id } = makeDocWithImage();
    const result = markImageFailed(doc, id);
    expect(result).toBe(true);
    const obj = getObj(doc, id);
    expect(obj!.get('status')).toBe('failed');
  });

  it('markImageRetrying resets uploadStartedAt and status', () => {
    const { doc, id } = makeDocWithImage();
    const result = markImageRetrying(doc, id, 5000);
    expect(result).toBe(true);
    const obj = getObj(doc, id);
    expect(obj!.get('status')).toBe('uploading');
    expect(obj!.get('uploadStartedAt')).toBe(5000);
  });

  it('returns false for unknown id', () => {
    const { doc } = makeDocWithImage();
    expect(markImageReady(doc, 'nonexistent-id', 'key')).toBe(false);
    expect(markImageFailed(doc, 'nonexistent-id')).toBe(false);
    expect(markImageRetrying(doc, 'nonexistent-id', Date.now())).toBe(false);
  });

  it('does not increment undo stack length (UPLOAD_ORIGIN is untracked)', () => {
    const { doc, id } = makeDocWithImage();

    // Create an undo manager tracking only LOCAL_ORIGIN
    const undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    const initialStackLength = undoManager.undoStack.length;

    // markImageReady uses UPLOAD_ORIGIN
    markImageReady(doc, id, 'board/test');

    // Undo stack should not grow from UPLOAD_ORIGIN
    const afterReadyLength = undoManager.undoStack.length;
    expect(afterReadyLength).toBe(initialStackLength);

    // But a LOCAL_ORIGIN transaction would grow it
    doc.transact(() => {
      const obj = getObj(doc, id);
      if (obj) obj.set('z', (obj.get('z') as number) + 1);
    }, LOCAL_ORIGIN);

    expect(undoManager.undoStack.length).toBeGreaterThan(afterReadyLength);
  });
});
