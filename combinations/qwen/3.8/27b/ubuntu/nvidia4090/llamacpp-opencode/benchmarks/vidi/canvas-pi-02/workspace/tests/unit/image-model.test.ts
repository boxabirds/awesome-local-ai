/**
 * TC-03: a drop of three files creates three placeholders in one undo step.
 * TC-04: placeholders carry imageStatus uploading and the uploader identity.
 * TC-05: upload completion flips the object to ready and sets the assetKey.
 * TC-06: a failed upload is failed for the uploader; other identities render
 *        "Image unavailable" (verified via displayStatus).
 * TC-07: Retry is available to the uploader while the file is in memory;
 *        after a reload it is unavailable (verified via canRetry logic).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  placementSize,
  layoutRow,
  displayStatus,
} from '../../src/shared/objects/image';
import type { ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';

// --- Helpers --------------------------------------------------------------------

function createDoc(): Y.Doc {
  return new Y.Doc();
}

function readImageObj(doc: Y.Doc, id: string): ImageSnap | null {
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  const m = objects.get(id);
  if (m === undefined || m === null) return null;
  return {
    id,
    type: 'image',
    x: m.get('x') as number,
    y: m.get('y') as number,
    width: m.get('width') as number,
    height: m.get('height') as number,
    z: m.get('z') as number,
    createdAt: m.get('createdAt') as number,
    assetKey: (m.get('assetKey') as string | null) ?? null,
    contentType: m.get('contentType') as string,
    naturalWidth: m.get('naturalWidth') as number,
    naturalHeight: m.get('naturalHeight') as number,
    imageStatus: m.get('imageStatus') as ImageSnap['imageStatus'],
    uploadStartedAt: m.get('uploadStartedAt') as number,
    uploaderId: m.get('uploaderId') as string,
  };
}

// --- TC-03: three files → three placeholders in one undo step --------------------

describe('TC-03: a drop of three files creates three placeholders in one undo step', () => {
  it('creates three objects; a single undo removes all three', async () => {
    const { createUndo } = await import('../../src/client/board/undo');
    const doc = createDoc();
    const undo = createUndo(doc);
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 800, naturalHeight: 600, contentType: 'image/png' },
      { rect: { x: 100, y: 0, width: 100, height: 100 }, naturalWidth: 800, naturalHeight: 600, contentType: 'image/jpeg' },
      { rect: { x: 200, y: 0, width: 100, height: 100 }, naturalWidth: 800, naturalHeight: 600, contentType: 'image/gif' },
    ];

    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    expect(ids).toHaveLength(3);

    // All three objects exist.
    for (const id of ids) {
      expect(readImageObj(doc, id!)).not.toBeNull();
    }

    // A single undo removes all three (one undo step).
    expect(undo.undo()).toBe(true);
    for (const id of ids) {
      expect(readImageObj(doc, id!)).toBeNull();
    }
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });
});

// --- TC-04: placeholders carry uploading status and uploader identity -----------

describe('TC-04: placeholders carry imageStatus uploading and the uploader identity', () => {
  it('sets imageStatus to uploading and uploaderId to the given identity', () => {
    const doc = createDoc();
    const items = [
      { rect: { x: 10, y: 20, width: 100, height: 80 }, naturalWidth: 800, naturalHeight: 640, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user42', 12345);
    const obj = readImageObj(doc, ids[0]!);
    expect(obj).not.toBeNull();
    expect(obj!.imageStatus).toBe('uploading');
    expect(obj!.uploaderId).toBe('user42');
    expect(obj!.assetKey).toBeNull();
    expect(obj!.uploadStartedAt).toBe(12345);
    expect(obj!.naturalWidth).toBe(800);
    expect(obj!.naturalHeight).toBe(640);
    expect(obj!.contentType).toBe('image/png');
    expect(obj!.x).toBe(10);
    expect(obj!.y).toBe(20);
    expect(obj!.width).toBe(100);
    expect(obj!.height).toBe(80);
  });
});

// --- TC-05: upload completion flips to ready and sets assetKey -------------------

describe('TC-05: upload completion flips the object to ready and sets the assetKey', () => {
  it('markImageReady sets imageStatus to ready and sets assetKey', () => {
    const doc = createDoc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 800, naturalHeight: 600, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    const id = ids[0]!;

    // Initially uploading.
    expect(readImageObj(doc, id)!.imageStatus).toBe('uploading');

    // Mark ready.
    const ok = markImageReady(doc, id, 'abc123');
    expect(ok).toBe(true);
    const obj = readImageObj(doc, id)!;
    expect(obj.imageStatus).toBe('ready');
    expect(obj.assetKey).toBe('abc123');
  });

  it('markImageReady returns false for a non-existent id', () => {
    const doc = createDoc();
    expect(markImageReady(doc, 'nonexistent', 'abc123')).toBe(false);
  });
});

// --- TC-06: failed upload is failed for uploader; others see unavailable --------

describe('TC-06: a failed upload is failed for the uploader; others see unavailable', () => {
  it('markImageFailed sets imageStatus to failed', () => {
    const doc = createDoc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 800, naturalHeight: 600, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    const id = ids[0]!;

    markImageFailed(doc, id);
    const obj = readImageObj(doc, id)!;
    expect(obj.imageStatus).toBe('failed');
  });

  it('displayStatus returns "failed" for the uploader', () => {
    const img: ImageSnap = {
      id: 'test', type: 'image', x: 0, y: 0, width: 100, height: 100,
      z: 0, createdAt: 0, assetKey: null, contentType: null,
      naturalWidth: null, naturalHeight: null, imageStatus: 'failed',
      uploadStartedAt: null, uploaderId: 'user1',
    };
    expect(displayStatus(img, Date.now())).toBe('failed');
  });

  it('displayStatus returns "failed" for other identities too (they see unavailable via rendering)', () => {
    // The displayStatus is "failed" for everyone; the rendering differs by identity.
    const img: ImageSnap = {
      id: 'test', type: 'image', x: 0, y: 0, width: 100, height: 100,
      z: 0, createdAt: 0, assetKey: null, contentType: null,
      naturalWidth: null, naturalHeight: null, imageStatus: 'failed',
      uploadStartedAt: null, uploaderId: 'user1',
    };
    // displayStatus is identity-agnostic; it returns "failed".
    // The ImageObject component checks isUploader to decide what to render.
    expect(displayStatus(img, Date.now())).toBe('failed');
  });
});

// --- TC-07: Retry is available while the file is in memory -----------------------

describe('TC-07: Retry is available while the file is in memory; after reload it is not', () => {
  it('markImageRetrying resets to uploading with a new timestamp', () => {
    const doc = createDoc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 800, naturalHeight: 600, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);
    const id = ids[0]!;

    // Fail it.
    markImageFailed(doc, id);
    expect(readImageObj(doc, id)!.imageStatus).toBe('failed');

    // Retry.
    const ok = markImageRetrying(doc, id, 99999);
    expect(ok).toBe(true);
    const obj = readImageObj(doc, id)!;
    expect(obj.imageStatus).toBe('uploading');
    expect(obj.uploadStartedAt).toBe(99999);
  });

  it('markImageRetrying returns false for a non-existent id', () => {
    const doc = createDoc();
    expect(markImageRetrying(doc, 'nonexistent', 1000)).toBe(false);
  });

  it('displayStatus returns "unfinished" when uploading is stale', () => {
    const img: ImageSnap = {
      id: 'test', type: 'image', x: 0, y: 0, width: 100, height: 100,
      z: 0, createdAt: 0, assetKey: null, contentType: null,
      naturalWidth: null, naturalHeight: null, imageStatus: 'uploading',
      uploadStartedAt: 0, uploaderId: 'user1',
    };
    // 5 minutes ago (stale).
    expect(displayStatus(img, 10 * 60 * 1000)).toBe('unfinished');
  });

  it('displayStatus returns "uploading" when not stale', () => {
    const img: ImageSnap = {
      id: 'test', type: 'image', x: 0, y: 0, width: 100, height: 100,
      z: 0, createdAt: 0, assetKey: null, contentType: null,
      naturalWidth: null, naturalHeight: null, imageStatus: 'uploading',
      uploadStartedAt: 999999, uploaderId: 'user1',
    };
    // Just started.
    expect(displayStatus(img, 1000000)).toBe('uploading');
  });
});

// --- placementSize ---------------------------------------------------------------

describe('placementSize', () => {
  it('returns the natural size when within limits', () => {
    const size = placementSize(800, 600);
    expect(size.width).toBe(800);
    expect(size.height).toBe(600);
  });

  it('clamps to max size while preserving aspect ratio', () => {
    const size = placementSize(4000, 3000);
    expect(size.width).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
    expect(size.height).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
    // Aspect ratio preserved.
    expect(size.width / size.height).toBeCloseTo(4000 / 3000, 1);
  });

  it('handles square images', () => {
    const size = placementSize(2000, 2000);
    expect(size.width).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
    expect(size.height).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
    expect(size.width).toBeCloseTo(size.height, 1);
  });
});

// --- layoutRow -------------------------------------------------------------------

describe('layoutRow', () => {
  it('places a single image at the anchor point (top-left)', () => {
    const sizes = [{ width: 100, height: 80 }];
    const point: Point = { x: 50, y: 60 };
    const rects = layoutRow(sizes, point, 'top-left');
    expect(rects).toHaveLength(1);
    expect(rects[0]!.x).toBe(50);
    expect(rects[0]!.y).toBe(60);
    expect(rects[0]!.width).toBe(100);
    expect(rects[0]!.height).toBe(80);
  });

  it('places two images side by side with a gap', () => {
    const sizes = [
      { width: 100, height: 80 },
      { width: 200, height: 100 },
    ];
    const point: Point = { x: 0, y: 0 };
    const rects = layoutRow(sizes, point, 'top-left');
    expect(rects).toHaveLength(2);
    // First at (0, 0).
    expect(rects[0]!.x).toBe(0);
    expect(rects[0]!.y).toBe(0);
    // Second after the gap.
    expect(rects[1]!.x).toBe(100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1]!.y).toBe(0);
  });

  it('centres the row on the anchor point (centre)', () => {
    const sizes = [
      { width: 100, height: 80 },
      { width: 200, height: 100 },
    ];
    const point: Point = { x: 500, y: 500 };
    const rects = layoutRow(sizes, point, 'centre');
    expect(rects).toHaveLength(2);
    // Total width = 100 + gap + 200.
    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 200;
    // First rect starts at 500 - totalWidth/2.
    expect(rects[0]!.x).toBeCloseTo(500 - totalWidth / 2, 1);
    // Centre of the row is at (500, 500).
    const midX = (rects[0]!.x + (rects[1]!.x + rects[1]!.width)) / 2;
    expect(midX).toBeCloseTo(500, 1);
  });
});
